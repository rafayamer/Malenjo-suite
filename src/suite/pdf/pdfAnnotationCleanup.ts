import {PDFArray,PDFDict,PDFDocument,PDFName,PDFRef} from 'pdf-lib';
import {PDF_INFO_MAX_INPUT_BYTES,PDF_INFO_MAX_PAGES} from './pdfInfo';

/**
 * Non-interactive markup and review annotations. Links, form widgets, file
 * attachments and unrelated interactive objects are intentionally preserved.
 * Removing these references is NOT a privacy-sanitization or redaction tool.
 */
const REMOVABLE_SUBTYPES=new Set([
  '/Text','/FreeText','/Highlight','/Underline','/StrikeOut','/Squiggly',
  '/Ink','/Stamp','/Caret','/Line','/Square','/Circle','/Polygon','/PolyLine',
]);
const ANNOT_KEY=PDFName.of('Annots');
const SUBTYPE_KEY=PDFName.of('Subtype');
const PARENT_KEY=PDFName.of('Parent');
const SIGNATURE_FIELD=PDFName.of('FT');
const SIGNATURE_TYPE=PDFName.of('Type');
const BYTE_RANGE=PDFName.of('ByteRange');
export const PDF_REVIEW_REMOVE_MAX_ANNOTATIONS=20000;

export interface PdfReviewRemovalResult{
  bytes:Uint8Array;
  removed:number;
}

function assertUnsigned(pdf:PDFDocument):void{
  if(pdf.catalog.has(PDFName.of('Perms'))){
    throw new Error('This PDF contains certification or usage-right permissions; annotation cleanup could invalidate a signature.');
  }
  for(const [,object] of pdf.context.enumerateIndirectObjects()){
    if(!(object instanceof PDFDict))continue;
    if(object.has(BYTE_RANGE)||
      object.get(SIGNATURE_FIELD)?.toString()==='/Sig'||
      object.get(SIGNATURE_TYPE)?.toString()==='/Sig'){
      throw new Error('This PDF contains a signature field or byte range; removing annotations could invalidate a signature.');
    }
  }
}

function readAnnotation(pdf:PDFDocument,item:unknown):PDFDict{
  // The parser may expose direct dictionaries as well as indirect refs.
  // Refuse malformed arrays rather than skip unknown content silently.
  return pdf.context.lookup(item as PDFRef|PDFDict,PDFDict);
}

function visibleReviewCount(pdf:PDFDocument):number{
  let count=0;
  for(const page of pdf.getPages()){
    const annots=page.node.lookupMaybe(ANNOT_KEY,PDFArray);
    if(!annots)continue;
    for(let i=0;i<annots.size();i++){
      const dict=readAnnotation(pdf,annots.get(i));
      if(REMOVABLE_SUBTYPES.has(dict.get(SUBTYPE_KEY)?.toString()??'')){
        count++;
      }
    }
  }
  return count;
}

/**
 * Removes visible review/markup annotations from the working PDF while
 * preserving Link, Widget, FileAttachment, and other interactive subtypes.
 * Also removes Popup annotations whose Parent belongs to removed markup.
 * Tests and consumers must not claim secure deletion of original raw bytes.
 */
export async function removePdfReviewMarkup(
  input:Uint8Array,
):Promise<PdfReviewRemovalResult>{
  if(input.byteLength<5||input.byteLength>PDF_INFO_MAX_INPUT_BYTES){
    throw new Error('Review cleanup requires a PDF of at most 512 MB.');
  }
  const pdf=await PDFDocument.load(input,{ignoreEncryption:false,updateMetadata:false});
  const pageCount=pdf.getPageCount();
  if(pageCount<1||pageCount>PDF_INFO_MAX_PAGES){
    throw new Error('Review cleanup supports 1–2,000 PDF pages.');
  }
  assertUnsigned(pdf);

  let total=0;
  let removed=0;
  const removableRefs=new Set<string>();
  const pageEntries:Array<{annots:PDFArray,indices:number[]}>=[];

  // Distinct pages can reference the *same* indirect /Annots array. Collect
  // each array once; otherwise descending deletions run twice against an
  // already-mutated array and can remove unrelated Link/Widget annotations.
  const visitedArrayRefs=new Set<string>();
  const visitedArrays=new WeakSet<PDFArray>();
  for(const page of pdf.getPages()){
    const annots=page.node.lookupMaybe(ANNOT_KEY,PDFArray);
    if(!annots)continue;
    const ref=page.node.get(ANNOT_KEY);
    const key=ref instanceof PDFRef?ref.toString():null;
    if((key!==null&&visitedArrayRefs.has(key))||visitedArrays.has(annots)){
      continue;
    }
    if(key!==null)visitedArrayRefs.add(key);
    visitedArrays.add(annots);
    total+=annots.size();
    if(total>PDF_REVIEW_REMOVE_MAX_ANNOTATIONS){
      throw new Error('Review cleanup exceeds the 20,000-annotation safety limit.');
    }
    const indices:number[]=[];
    for(let i=0;i<annots.size();i++){
      const item=annots.get(i);
      const dict=readAnnotation(pdf,item);
      const subtype=dict.get(SUBTYPE_KEY)?.toString()??'';
      // A redaction annotation is not itself applied redaction. Removing it
      // without permanently deleting its underlying content is dangerous,
      // so refuse the whole bulk operation rather than silently leaving it.
      if(subtype==='/Redact'){
        throw new Error('This PDF contains unapplied redaction markup. Use the dedicated redaction workflow before review annotation cleanup; nothing was changed.');
      }
      if(!REMOVABLE_SUBTYPES.has(subtype))continue;
      indices.push(i);
      if(item instanceof PDFRef)removableRefs.add(item.toString());
    }
    pageEntries.push({annots,indices});
    removed+=indices.length;
  }
  if(!removed){
    throw new Error('This PDF has no supported review or markup annotations to remove.');
  }

  // Remove related popups, but NEVER another object's popup or form widget.
  for(const {annots,indices} of pageEntries){
    for(let i=0;i<annots.size();i++){
      const item=annots.get(i);
      const dict=readAnnotation(pdf,item);
      if(dict.get(SUBTYPE_KEY)?.toString()!=='/Popup')continue;
      const parent=dict.get(PARENT_KEY);
      if(parent instanceof PDFRef&&removableRefs.has(parent.toString())){
        indices.push(i);
        removed++;
      }
    }
    for(const index of indices.sort((a,b)=>b-a))annots.remove(index);
  }

  const bytes=Uint8Array.from(await pdf.save({
    useObjectStreams:false,updateFieldAppearances:false,
  }));
  const checked=await PDFDocument.load(bytes,{
    ignoreEncryption:false,updateMetadata:false,
  });
  if(checked.getPageCount()!==pageCount||visibleReviewCount(checked)!==0){
    throw new Error('Review cleanup output verification failed; original PDF was preserved.');
  }
  return {bytes,removed};
}
