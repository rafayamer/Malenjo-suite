import type {PDFDocumentProxy} from 'pdfjs-dist';
import type {PdfDocumentInfo} from './pdfInfo';

/** Read-only JSON export of page text, page geometry, standard Info metadata
 * and bookmark titles. It does not represent graphical objects, XMP, image
 * bytes, annotation actions or the full upstream conversion contract.
 */
export const PDF_JSON_MAX_PAGES=2000;
export const PDF_JSON_MAX_CHARS=8_000_000;
export const PDF_JSON_MAX_TEXT_ITEMS=200_000;
export const PDF_JSON_MAX_BOOKMARKS=10_000;
export const PDF_JSON_MAX_OUTPUT_BYTES=16_000_000;

type OutlineItem={title:string;items:OutlineItem[]};
export interface PdfStructuredJson{
  schemaVersion:1;
  extraction:'local-selectable-text';
  pageCount:number;
  metadata:PdfDocumentInfo['metadata'];
  pages:Array<{
    page:number;widthPt:number;heightPt:number;rotationDegrees:number;
    text:string;selectableTextItems:number;
  }>;
  bookmarks:Array<{title:string;depth:number}>;
  warning:string;
}

function abortIfNeeded(signal?:AbortSignal){
  if(signal?.aborted){
    const error=new Error('PDF to JSON export cancelled.');
    error.name='AbortError';
    throw error;
  }
}

function boundedOutline(outline:OutlineItem[]|null):PdfStructuredJson['bookmarks']{
  const bookmarks:PdfStructuredJson['bookmarks']=[];
  const pending=(outline??[]).map(item=>({item,depth:0})).reverse();
  while(pending.length){
    const {item,depth}=pending.pop()!;
    if(bookmarks.length>=PDF_JSON_MAX_BOOKMARKS){
      throw new Error('PDF bookmark inventory exceeds 10,000 entries.');
    }
    if(depth>32){
      throw new Error('PDF bookmark hierarchy exceeds 32 levels.');
    }
    if(typeof item.title!=='string'||item.title.length>4096){
      throw new Error('PDF bookmark title is invalid or too long.');
    }
    bookmarks.push({title:item.title,depth});
    for(let i=item.items.length-1;i>=0;i--){
      pending.push({item:item.items[i],depth:depth+1});
    }
  }
  return bookmarks;
}

export async function exportPdfStructuredJson(
  document:Pick<PDFDocumentProxy,'numPages'|'getPage'|'getOutline'>,
  info:PdfDocumentInfo,
  options:{signal?:AbortSignal;onProgress?:(done:number,total:number)=>void}={},
):Promise<Uint8Array>{
  const count=document.numPages;
  if(!Number.isInteger(count)||count<1||count>PDF_JSON_MAX_PAGES){
    throw new Error('PDF to JSON export supports 1–2,000 pages.');
  }
  if(info.pageCount!==count||info.pages.length!==count){
    throw new Error('PDF metadata and rendered document disagree on page count.');
  }
  abortIfNeeded(options.signal);
  const outline=await document.getOutline();
  const bookmarks=boundedOutline(outline);
  const pages:PdfStructuredJson['pages']=[];
  let totalChars=0;
  let totalItems=0;
  let foundText=false;
  for(let i=1;i<=count;i++){
    abortIfNeeded(options.signal);
    const page=await document.getPage(i);
    abortIfNeeded(options.signal);
    const content=await page.getTextContent();
    const textParts:string[]=[];
    let pageItems=0;
    for(const item of content.items){
      if(!('str' in item))continue;
      pageItems++;
      totalItems++;
      if(totalItems>PDF_JSON_MAX_TEXT_ITEMS){
        throw new Error('PDF to JSON exceeds 200,000 selectable text fragments.');
      }
      const value=item.str.replace(/\u0000/g,'').trim();
      if(value){
        foundText=true;
        totalChars+=value.length;
        if(totalChars>PDF_JSON_MAX_CHARS){
          throw new Error('PDF to JSON exceeds the 8,000,000-character limit.');
        }
        textParts.push(value);
      }
      if(item.hasEOL)textParts.push('\n');
    }
    const text=textParts.join(' ').replace(/[ \t]*\n[ \t]*/g,'\n').replace(/[ \t]{2,}/g,' ').trim();
    const geometry=info.pages[i-1];
    if(geometry.page!==i)throw new Error('PDF page geometry is out of order.');
    pages.push({
      page:i,widthPt:geometry.widthPt,heightPt:geometry.heightPt,
      rotationDegrees:geometry.rotationDegrees,
      text,selectableTextItems:pageItems,
    });
    options.onProgress?.(i,count);
  }
  if(!foundText){
    throw new Error('No selectable PDF text exists for structured export. Use OCR on scanned pages first.');
  }
  abortIfNeeded(options.signal);
  const result:PdfStructuredJson={
    schemaVersion:1,extraction:'local-selectable-text',pageCount:count,
    metadata:info.metadata,pages,bookmarks,
    warning:'Structured selectable text, basic Info metadata, page geometry and bookmark titles only. Not a complete PDF object, graphics, images, annotations, reading-order or XMP export.',
  };
  const bytes=new TextEncoder().encode(JSON.stringify(result,null,2)+'\n');
  if(bytes.byteLength>PDF_JSON_MAX_OUTPUT_BYTES){
    throw new Error('PDF to JSON output exceeds the 16 MB safety limit.');
  }
  return bytes;
}
