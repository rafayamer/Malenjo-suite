import type { PDFDocumentProxy } from 'pdfjs-dist';
import { zipSync } from 'fflate';

export const PDF_PAGE_IMAGE_MAX_PAGES=50;
export const PDF_PAGE_IMAGE_MAX_PIXELS=16_000_000;
export const PDF_PAGE_IMAGE_MAX_PNG_BYTES=12*1024*1024;
export const PDF_PAGE_IMAGE_MAX_TOTAL_BYTES=100*1024*1024;

export interface PdfPagePng { pageNumber:number; bytes:Uint8Array }
export interface PdfPngExportOptions {
  signal?:AbortSignal;
  onProgress?:(completed:number,total:number)=>void;
  scale?:number;
}

function abortIfRequested(signal?:AbortSignal):void{
  if(!signal?.aborted)return;
  const error=new Error('PDF page-image export was cancelled.');
  error.name='AbortError';
  throw error;
}

export function archivePdfPagePngs(pages:PdfPagePng[],totalPages:number):Uint8Array{
  if(!Number.isSafeInteger(totalPages)||totalPages<1||totalPages>PDF_PAGE_IMAGE_MAX_PAGES||
    !pages.length||pages.length!==totalPages){
    throw new Error('PNG archive requires every page and supports at most 50 pages.');
  }
  const entries:Record<string,Uint8Array>={};
  let size=0;
  for(let index=0;index<pages.length;index++){
    const page=pages[index];
    if(page.pageNumber!==index+1)throw new Error('PDF PNG pages must be consecutive and correctly ordered.');
    if(!(page.bytes instanceof Uint8Array)||page.bytes.length<8||
      page.bytes[0]!==0x89||page.bytes[1]!==0x50||page.bytes[2]!==0x4e||
      page.bytes[3]!==0x47||page.bytes[4]!==0x0d||page.bytes[5]!==0x0a||
      page.bytes[6]!==0x1a||page.bytes[7]!==0x0a){
      throw new Error('PDF PNG archive contains an invalid PNG file.');
    }
    if(page.bytes.byteLength>PDF_PAGE_IMAGE_MAX_PNG_BYTES)throw new Error('Rendered PNG exceeds the 12 MB per-page limit.');
    size+=page.bytes.byteLength;
    if(size>PDF_PAGE_IMAGE_MAX_TOTAL_BYTES)throw new Error('Rendered PNGs exceed the 100 MB total limit.');
    const filename='page-'+String(page.pageNumber).padStart(4,'0')+'.png';
    entries[filename]=page.bytes;
  }
  const result=zipSync(entries,{level:0});
  if(result.byteLength>PDF_PAGE_IMAGE_MAX_TOTAL_BYTES+1_000_000){
    throw new Error('Exported image ZIP exceeds the safety limit.');
  }
  return result;
}

async function pngBytes(canvas:HTMLCanvasElement):Promise<Uint8Array>{
  const blob=await new Promise<Blob>((resolve,reject)=>{
    canvas.toBlob(value=>value?resolve(value):reject(new Error('Canvas could not encode page PNG.')),'image/png');
  });
  if(blob.size>PDF_PAGE_IMAGE_MAX_PNG_BYTES)throw new Error('Rendered PNG exceeds the 12 MB per-page limit.');
  return new Uint8Array(await blob.arrayBuffer());
}

/** Draws bounded, selectable PDF pages to a ZIP. Never modifies PDF source. */
export async function exportPdfPagesAsPngZip(
  pdf:Pick<PDFDocumentProxy,'numPages'|'getPage'>,
  options:PdfPngExportOptions={},
):Promise<Uint8Array>{
  const pageCount=pdf.numPages;
  if(!Number.isSafeInteger(pageCount)||pageCount<1||pageCount>PDF_PAGE_IMAGE_MAX_PAGES){
    throw new Error('PDF-to-PNG export supports up to 50 pages; no pages were silently omitted.');
  }
  const scale=options.scale??1;
  if(!Number.isFinite(scale)||scale<0.5||scale>2){
    throw new Error('PDF image scale must be between 0.5 and 2.');
  }
  const pages:PdfPagePng[]=[];
  let totalBytes=0;
  for(let pageNumber=1;pageNumber<=pageCount;pageNumber++){
    abortIfRequested(options.signal);
    const page=await pdf.getPage(pageNumber);
    abortIfRequested(options.signal);
    const viewport=page.getViewport({scale});
    const width=Math.ceil(viewport.width),height=Math.ceil(viewport.height);
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||
      width*height>PDF_PAGE_IMAGE_MAX_PIXELS){
      throw new Error('PDF render exceeds the 16-megapixel per-page limit.');
    }
    const canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d',{alpha:false});
    if(!context)throw new Error('PNG export requires a canvas rendering context.');
    const task=page.render({canvas,canvasContext:context,viewport});
    const cancel=()=>task.cancel();
    options.signal?.addEventListener('abort',cancel,{once:true});
    try{
      await task.promise;
    }catch(reason){
      if(options.signal?.aborted)abortIfRequested(options.signal);
      throw reason;
    }finally{
      options.signal?.removeEventListener('abort',cancel);
    }
    abortIfRequested(options.signal);
    const bytes=await pngBytes(canvas);
    // Release backing allocation before the next page is rendered.
    canvas.width=0;canvas.height=0;
    totalBytes+=bytes.byteLength;
    if(totalBytes>PDF_PAGE_IMAGE_MAX_TOTAL_BYTES)throw new Error('Rendered PNGs exceed the 100 MB total limit.');
    pages.push({pageNumber,bytes});
    options.onProgress?.(pageNumber,pageCount);
  }
  abortIfRequested(options.signal);
  return archivePdfPagePngs(pages,pageCount);
}
