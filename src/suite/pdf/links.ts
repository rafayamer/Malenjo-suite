import {
  PDFArray,PDFDict,PDFDocument,PDFHexString,PDFName,PDFRef,PDFString,
} from 'pdf-lib';

export type PdfLinkTarget =
  |{kind:'page';pageNumber:number}
  |{kind:'https';url:string};
export interface PdfLinkAnnotation {
  pageNumber:number;
  index:number;
  ref:string|null;
  kind:'page'|'https'|'unsupported';
  destination:string;
}
export interface PdfLinkRectangle {
  pageNumber:number;x:number;y:number;width:number;height:number;
}
export type PdfLinkRef=Pick<PdfLinkAnnotation,'pageNumber'|'index'|'ref'>;

const ANN=PDFName.of('Annots');
const SUBTYPE=PDFName.of('Subtype');
const ACT=PDFName.of('A');
const DEST=PDFName.of('Dest');
const URI=PDFName.of('URI');
const MAX_PAGES=2000;
const MAX_ANNOTATIONS=4000;
const MAX_LINKS=1000;
const MAX_URI_ENCODED_CHARS=16_384;
const MAX_TOTAL_URI_ENCODED_CHARS=2*1024*1024;

async function load(bytes:Uint8Array):Promise<PDFDocument>{
  if(!bytes.byteLength)throw new Error('PDF is empty.');
  return PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false});
}
async function save(pdf:PDFDocument):Promise<Uint8Array>{
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}
function validHttps(value:string):string{
  if(typeof value!=='string'||value.length>2000||
      !/^https:\/\//i.test(value)||/[\u0000-\u0020\u007F\\]/.test(value)){
    throw new Error('Use an HTTPS URL without credentials, spaces or control characters (maximum 2,000 characters).');
  }
  let url:URL;
  try{url=new URL(value);}catch{throw new Error('The HTTPS URL is malformed.');}
  if(url.protocol!=='https:'||!url.hostname||url.username||url.password){
    throw new Error('Only HTTPS links without embedded credentials are allowed.');
  }
  if(url.href.length>2000)throw new Error('HTTPS URL is too long.');
  return url.href;
}
function targetCheck(pdf:PDFDocument,target:PdfLinkTarget):void{
  if(target?.kind==='https'){validHttps(target.url);return;}
  if(target?.kind==='page'&&Number.isSafeInteger(target.pageNumber)&&
     target.pageNumber>=1&&target.pageNumber<=pdf.getPageCount())return;
  throw new Error('Choose an existing target page or a valid HTTPS URL.');
}
function rectCheck(pdf:PDFDocument,rect:PdfLinkRectangle):void{
  if(!Number.isSafeInteger(rect.pageNumber)||rect.pageNumber<1||rect.pageNumber>pdf.getPageCount()){
    throw new Error('Link annotation page is outside the PDF.');
  }
  if([rect.x,rect.y,rect.width,rect.height].some(x=>!Number.isFinite(x)||x<0||x>1)||
     rect.width<=0||rect.height<=0||rect.x+rect.width>1||rect.y+rect.height>1){
    throw new Error('Link rectangle must be nonempty and inside the PDF page.');
  }
}
function annotationList(pdf:PDFDocument,pageNumber:number):PDFArray|undefined{
  if(!Number.isSafeInteger(pageNumber)||pageNumber<1||pageNumber>pdf.getPageCount()){
    throw new Error('Link page no longer exists.');
  }
  return pdf.getPage(pageNumber-1).node.lookupMaybe(ANN,PDFArray);
}
function isLinkSubtype(pdf:PDFDocument,dict:PDFDict):boolean{
  const stored=dict.get(SUBTYPE);
  if(!stored)return false;
  try{
    const resolved=pdf.context.lookup(stored);
    return resolved instanceof PDFName&&resolved.toString()==='/Link';
  }catch{return false;}
}

/**
 * An imported /Annots array can be referenced from *any* indirect object,
 * not just another page (/AcroForm /Fields is one example).
 * Always copy and rebind before mutation; attempting alias detection across
 * only page dictionaries can silently corrupt non-page structures.
 */
function ownedAnnotationList(pdf:PDFDocument,pageNumber:number):PDFArray{
  const page=pdf.getPage(pageNumber-1);
  const current=annotationList(pdf,pageNumber);
  if(!current){
    const empty=pdf.context.obj([]) as PDFArray;
    page.node.set(ANN,empty);
    return empty;
  }
  const clone=pdf.context.obj([]) as PDFArray;
  for(let i=0;i<current.size();i++){
    const entry=current.get(i);
    if(!entry)throw new Error('Imported PDF annotation array contains an empty slot.');
    clone.push(entry);
  }
  page.node.set(ANN,pdf.context.register(clone));
  return clone;
}

function requireLinked(pdf:PDFDocument,target:PdfLinkRef):{annots:PDFArray;dict:PDFDict}{
  if(target.ref===null||typeof target.ref!=='string')throw new Error('Only indirect link annotations can be edited.');
  const annots=annotationList(pdf,target.pageNumber);
  if(!annots||!Number.isSafeInteger(target.index)||target.index<0||target.index>=annots.size()){
    throw new Error('Selected PDF link no longer exists.');
  }
  const ref=annots.get(target.index);
  if(!(ref instanceof PDFRef)||ref.toString()!==target.ref){
    throw new Error('PDF link identity changed; refresh the link list.');
  }
  const dict=pdf.context.lookup(ref,PDFDict);
  if(!isLinkSubtype(pdf,dict)){
    throw new Error('Selected PDF annotation is no longer a link.');
  }
  return {annots,dict};
}

function requireUniqueAnnotationIdentity(pdf:PDFDocument,selected:PDFDict):void{
  if(pdf.getPageCount()>MAX_PAGES)throw new Error('PDF link identity check exceeds page limits.');
  let examined=0;
  let matches=0;
  for(let pageNumber=1;pageNumber<=pdf.getPageCount();pageNumber++){
    const annots=annotationList(pdf,pageNumber);
    if(!annots)continue;
    examined+=annots.size();
    if(examined>MAX_ANNOTATIONS)throw new Error('PDF link identity check exceeds annotation limits.');
    for(let i=0;i<annots.size();i++){
      let dict:PDFDict;
      try{dict=pdf.context.lookup(annots.get(i),PDFDict);}catch{continue;}
      if(dict===selected&&++matches>1){
        throw new Error('The imported PDF reuses this link annotation on multiple pages or slots. Editing is disabled to prevent changing unrelated links.');
      }
    }
  }
}
function destination(pdf:PDFDocument,dict:PDFDict,uriBudget?:{used:number}):{
  kind:PdfLinkAnnotation['kind'];destination:string
}{
  let action:PDFDict|undefined;
  try{action=dict.lookupMaybe(ACT,PDFDict);}catch{
    return {kind:'unsupported',destination:'Unsupported PDF link action dictionary'};
  }
  const storedType=action?.get(PDFName.of('S'));
  let type:'URI'|'GoTo'|undefined;
  if(action){
    // Never stringify imported /S data before checking its type and
    // encoded length. Huge PDFName/PDFString values must stay inert and
    // must not be copied into the visible link inventory.
    let resolved:unknown;
    try{resolved=storedType?pdf.context.lookup(storedType):undefined;}catch{
      return {kind:'unsupported',destination:'Malformed PDF link action'};
    }
    if(!(resolved instanceof PDFName) || resolved.encodedName.length > 8){
      return {kind:'unsupported',destination:'Unsupported PDF link action'};
    }
    if(resolved.encodedName==='URI')type='URI';
    else if(resolved.encodedName==='GoTo')type='GoTo';
    else return {kind:'unsupported',destination:'Unsupported PDF link action'};
  }
  // A visible HTTPS /URI or /Dest is NOT sufficient proof of a safe link:
  // imported annotation-level /AA and action chains /Next can execute other
  // actions in external PDF readers. Keep those entries inert/read-only.
  if(dict.has(PDFName.of('AA')) || action?.has(PDFName.of('Next'))){
    return {kind:'unsupported',destination:'Imported link has additional or chained actions'};
  }
  if(type==='URI'){
    const uri=action?.get(URI);
    if(uri instanceof PDFHexString||uri instanceof PDFString){
      // Both PDFString and PDFHexString expose their encoded source without
      // decoding. Check source and *cumulative* budgets before decodeText()
      // allocates a UTF-16 string from untrusted PDF bytes.
      const encodedChars=uri.asString().length;
      if(uriBudget){
        uriBudget.used+=encodedChars;
        if(uriBudget.used>MAX_TOTAL_URI_ENCODED_CHARS){
          throw new Error('Imported PDF link URIs exceed the 2 MB encoded-data inspection limit. No incomplete inventory was returned.');
        }
      }
      if(encodedChars>MAX_URI_ENCODED_CHARS){
        return {kind:'unsupported',destination:'Oversized imported PDF URL'};
      }
      const value=uri.decodeText();
      try{return {kind:'https',destination:validHttps(value)};}catch{
        return {kind:'unsupported',destination:'Unsupported or unsafe external URL action'};
      }
    }
  }
  // Unknown action subtypes have already been classified without
  // rendering untrusted serialized names or strings.
  const storedDest=dict.get(DEST)??action?.get(PDFName.of('D'));
  let dest:PDFArray|undefined;
  try{
    const resolved=storedDest?pdf.context.lookup(storedDest):undefined;
    if(resolved instanceof PDFArray)dest=resolved;
  }catch{
    return {kind:'unsupported',destination:'Invalid indirect PDF destination'};
  }
  if(dest&&dest.size()>0){
    const pageRef=dest.get(0);
    if(pageRef instanceof PDFRef){
      const page=pdf.getPages().findIndex(p=>p.ref.toString()===pageRef.toString());
      if(page>=0)return {kind:'page',destination:String(page+1)};
    }
  }
  return {kind:'unsupported',destination:'Named or unsupported PDF destination'};
}
function assignTarget(pdf:PDFDocument,dict:PDFDict,target:PdfLinkTarget):void{
  targetCheck(pdf,target);
  dict.delete(DEST);
  if(target.kind==='page'){
    const page=pdf.getPage(target.pageNumber-1);
    dict.set(DEST,pdf.context.obj([page.ref,PDFName.of('Fit')]));
    dict.delete(ACT);
  }else{
    dict.set(ACT,pdf.context.obj({
      S:PDFName.of('URI'),
      URI:PDFString.of(validHttps(target.url)),
    }));
  }
}

export async function listPdfLinkAnnotations(bytes:Uint8Array):Promise<PdfLinkAnnotation[]>{
  const pdf=await load(bytes);
  if(pdf.getPageCount()>MAX_PAGES)throw new Error('PDF link inventory supports at most 2,000 pages.');
  const found:PdfLinkAnnotation[]=[];
  let visited=0;
  const uriBudget={used:0};
  for(let pageNumber=1;pageNumber<=pdf.getPageCount();pageNumber++){
    const annots=annotationList(pdf,pageNumber);
    if(!annots)continue;
    visited+=annots.size();
    if(visited>MAX_ANNOTATIONS)throw new Error('PDF has too many annotations for a complete link inventory.');
    for(let index=0;index<annots.size();index++){
      const ref=annots.get(index);
      let dict:PDFDict;
      try{dict=pdf.context.lookup(ref,PDFDict);}catch{continue;}
      if(!isLinkSubtype(pdf,dict))continue;
      if(found.length>=MAX_LINKS)throw new Error('PDF link inventory exceeds 1,000 links; no incomplete list was returned.');
      found.push({
        pageNumber,index,ref:ref instanceof PDFRef?ref.toString():null,
        ...destination(pdf,dict,uriBudget),
      });
    }
  }
  return found;
}

function ensureNewLinkCapacity(pdf:PDFDocument):void{
  if(pdf.getPageCount()>MAX_PAGES){
    throw new Error('PDF link editor supports at most 2,000 pages.');
  }
  let entries=0;
  let links=0;
  for(let pageNumber=1;pageNumber<=pdf.getPageCount();pageNumber++){
    const annots=annotationList(pdf,pageNumber);
    if(!annots)continue;
    entries+=annots.size();
    if(entries>=MAX_ANNOTATIONS){
      throw new Error('PDF already reaches the 4,000-annotation inventory limit.');
    }
    for(let index=0;index<annots.size();index++){
      let dict:PDFDict;
      try{dict=pdf.context.lookup(annots.get(index),PDFDict);}catch{continue;}
      if(isLinkSubtype(pdf,dict))links++;
      if(links>=MAX_LINKS){
        throw new Error('PDF already reaches the 1,000-link safety limit.');
      }
    }
  }
}

export async function addPdfLinkAnnotation(
  bytes:Uint8Array,rect:PdfLinkRectangle,target:PdfLinkTarget,
):Promise<Uint8Array>{
  const pdf=await load(bytes);
  rectCheck(pdf,rect);
  targetCheck(pdf,target);
  ensureNewLinkCapacity(pdf);
  const page=pdf.getPage(rect.pageNumber-1);
  const media=page.getMediaBox();
  const crop=page.getCropBox();
  const left=Math.max(media.x,crop.x),bottom=Math.max(media.y,crop.y);
  const right=Math.min(media.x+media.width,crop.x+crop.width);
  const top=Math.min(media.y+media.height,crop.y+crop.height);
  const visibleWidth=right-left,visibleHeight=top-bottom;
  if(visibleWidth<=0||visibleHeight<=0)throw new Error('PDF page has no valid visible crop region.');
  const annots=ownedAnnotationList(pdf,rect.pageNumber);
  if(annots.size()>=MAX_ANNOTATIONS)throw new Error('Page exceeds link annotation safety limits.');
  const dict=pdf.context.obj({
    Type:PDFName.of('Annot'),Subtype:PDFName.of('Link'),P:page.ref,
    Rect:[left+rect.x*visibleWidth,bottom+rect.y*visibleHeight,left+(rect.x+rect.width)*visibleWidth,bottom+(rect.y+rect.height)*visibleHeight],
    Border:[0,0,1],
    H:PDFName.of('I'),
    F:4,
  });
  assignTarget(pdf,dict,target);
  annots.push(pdf.context.register(dict));
  return save(pdf);
}

export async function updatePdfLinkAnnotation(
  bytes:Uint8Array,link:PdfLinkRef,target:PdfLinkTarget,
):Promise<Uint8Array>{
  const pdf=await load(bytes);
  const {dict}=requireLinked(pdf,link);
  requireUniqueAnnotationIdentity(pdf,dict);
  targetCheck(pdf,target);
  const current=destination(pdf,dict);
  if(current.kind==='unsupported'){
    throw new Error('Unsupported imported link actions cannot be overwritten by this editor.');
  }
  assignTarget(pdf,dict,target);
  return save(pdf);
}

export async function deletePdfLinkAnnotation(
  bytes:Uint8Array,link:PdfLinkRef,
):Promise<Uint8Array>{
  const pdf=await load(bytes);
  requireLinked(pdf,link);
  const annots=ownedAnnotationList(pdf,link.pageNumber);
  annots.remove(link.index);
  return save(pdf);
}
