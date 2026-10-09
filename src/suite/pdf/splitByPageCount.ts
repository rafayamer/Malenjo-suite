import {PDFDict,PDFDocument,PDFName} from 'pdf-lib';
import {zipSync} from 'fflate';

/** Conservative bounds prevent a single document split from exhausting memory. */
export const PDF_SPLIT_MAX_INPUT_BYTES=128*1024*1024;
export const PDF_SPLIT_MAX_OUTPUT_BYTES=256*1024*1024;
export const PDF_SPLIT_MAX_PAGES=1000;
export const PDF_SPLIT_MAX_PARTS=200;

export interface PdfPageCountSplitResult{
  archive:Uint8Array;
  pageCounts:number[];
  sourcePageCount:number;
}

function refusesSignedOrInteractive(pdf:PDFDocument):void{
  if(pdf.catalog.has(PDFName.of('AcroForm'))){
    throw new Error('This document contains interactive form fields. Use a form-aware PDF split to avoid losing field relationships.');
  }
  for(const [,object] of pdf.context.enumerateIndirectObjects()){
    if(!(object instanceof PDFDict))continue;
    if(object.has(PDFName.of('ByteRange'))||
      object.get(PDFName.of('FT'))?.toString()==='/Sig'||
      object.get(PDFName.of('Type'))?.toString()==='/Sig'){
      throw new Error('This document contains signature objects. Splitting may invalidate signatures; use a signed-document workflow.');
    }
  }
}

/**
 * Truly local count-based PDF splitting. Exports each consecutive page group
 * as a valid standalone PDF in a ZIP. The source is never rewritten.
 * Not equivalent to the upstream size-based splitter; interactive forms and
 * signed documents are deliberately refused.
 */
export async function splitPdfByPageCount(
  source:Uint8Array,pagesPerPart:number,
):Promise<PdfPageCountSplitResult>{
  if(source.byteLength<5||source.byteLength>PDF_SPLIT_MAX_INPUT_BYTES){
    throw new Error('Offline page-count splitting accepts PDFs up to 128 MB.');
  }
  if(!Number.isSafeInteger(pagesPerPart)||pagesPerPart<1||
    pagesPerPart>PDF_SPLIT_MAX_PAGES){
    throw new Error('Pages per part must be a whole number between 1 and 1,000.');
  }
  const pdf=await PDFDocument.load(source,{
    ignoreEncryption:false,updateMetadata:false,
  });
  const count=pdf.getPageCount();
  if(count<2||count>PDF_SPLIT_MAX_PAGES){
    throw new Error('Offline splitting supports documents with 2–1,000 pages.');
  }
  if(pagesPerPart>=count){
    throw new Error('Pages per part must be smaller than the document page count.');
  }
  const parts=Math.ceil(count/pagesPerPart);
  if(parts>PDF_SPLIT_MAX_PARTS){
    throw new Error('The output would contain more than 200 PDFs. Increase pages per part.');
  }
  refusesSignedOrInteractive(pdf);

  const files:Record<string,Uint8Array>={};
  const pageCounts:number[]=[];
  let total=0;
  for(let start=0;start<count;start+=pagesPerPart){
    const next=await PDFDocument.create();
    const indices=Array.from({length:Math.min(pagesPerPart,count-start)},(_,i)=>start+i);
    const copied=await next.copyPages(pdf,indices);
    copied.forEach(page=>next.addPage(page));
    const bytes=Uint8Array.from(await next.save({useObjectStreams:false}));
    total+=bytes.byteLength;
    if(total>PDF_SPLIT_MAX_OUTPUT_BYTES){
      throw new Error('The split output exceeds the 256 MB safety limit; use smaller input documents.');
    }
    // Verify every standalone PDF before placing it into the returned archive.
    const reopened=await PDFDocument.load(bytes,{updateMetadata:false});
    if(reopened.getPageCount()!==indices.length){
      throw new Error('A split output failed page-count verification.');
    }
    const filename='part-'+String(pageCounts.length+1).padStart(3,'0')+'.pdf';
    files[filename]=bytes;
    pageCounts.push(indices.length);
  }
  const archive=zipSync(files,{level:0});
  if(archive.byteLength>PDF_SPLIT_MAX_OUTPUT_BYTES){
    throw new Error('The split ZIP exceeds the 256 MB safety limit.');
  }
  return {archive,pageCounts,sourcePageCount:count};
}
