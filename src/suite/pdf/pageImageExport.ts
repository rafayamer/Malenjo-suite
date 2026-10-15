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
    try {
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
      totalBytes+=bytes.byteLength;
      if(totalBytes>PDF_PAGE_IMAGE_MAX_TOTAL_BYTES)throw new Error('Rendered PNGs exceed the 100 MB total limit.');
      pages.push({pageNumber,bytes});
    } finally {
      // 16 MP can allocate tens of MB: release on render, abort AND encode errors.
      canvas.width=0;canvas.height=0;
    }
    options.onProgress?.(pageNumber,pageCount);
  }
  abortIfRequested(options.signal);
  return archivePdfPagePngs(pages,pageCount);
}


export const PDF_PAGE_JPEG_MAX_BYTES=12*1024*1024;

/** JPEG is a real page raster export, distinct from extracting embedded images.
 * Reject a single missing/invalid image instead of delivering a partial ZIP. */
export function archivePdfPageJpegs(pages:PdfPagePng[],totalPages:number):Uint8Array {
  if(!Number.isSafeInteger(totalPages)||totalPages<1||totalPages>PDF_PAGE_IMAGE_MAX_PAGES||
    pages.length!==totalPages){
    throw new Error('JPEG archive requires all PDF pages, with at most 50 pages.');
  }
  const entries:Record<string,Uint8Array>={};
  let totalBytes=0;
  for(let index=0;index<pages.length;index++){
    const {pageNumber,bytes}=pages[index];
    if(pageNumber!==index+1)throw new Error('JPEG pages must be consecutive in PDF order.');
    if(!(bytes instanceof Uint8Array)||bytes.length<4||
      bytes[0]!==0xff||bytes[1]!==0xd8||
      bytes[bytes.length-2]!==0xff||bytes[bytes.length-1]!==0xd9){
      throw new Error('Invalid JPEG page data; no partial archive was saved.');
    }
    if(bytes.length>PDF_PAGE_JPEG_MAX_BYTES){
      throw new Error('JPEG page exceeds the 12 MB output limit.');
    }
    totalBytes+=bytes.byteLength;
    if(totalBytes>PDF_PAGE_IMAGE_MAX_TOTAL_BYTES){
      throw new Error('JPEG pages exceed the 100 MB total output limit.');
    }
    entries['page-'+String(pageNumber).padStart(4,'0')+'.jpg']=bytes;
  }
  const zip=zipSync(entries,{level:0});
  if(zip.length>PDF_PAGE_IMAGE_MAX_TOTAL_BYTES+1_000_000){
    throw new Error('JPEG archive exceeds the total output size limit.');
  }
  return zip;
}

export interface PdfJpegExportOptions extends PdfPngExportOptions {
  quality?:number;
}

/** Real browser/PDF.js page-to-JPEG rendering; never modifies the source PDF. */
export async function exportPdfPagesAsJpegZip(
  pdf:Pick<PDFDocumentProxy,'numPages'|'getPage'>,
  options:PdfJpegExportOptions={},
):Promise<Uint8Array>{
  const total=pdf.numPages;
  if(!Number.isInteger(total)||total<1||total>PDF_PAGE_IMAGE_MAX_PAGES){
    throw new Error('PDF-to-JPEG supports 1 to 50 pages; refusing partial exports.');
  }
  const scale=options.scale??1.5;
  const quality=options.quality??0.9;
  if(!Number.isFinite(scale)||scale<0.5||scale>2){
    throw new Error('PDF JPEG rendering scale must be between 0.5 and 2.');
  }
  if(!Number.isFinite(quality)||quality<0.5||quality>1){
    throw new Error('JPEG quality must be between 0.5 and 1.');
  }
  const pages:PdfPagePng[]=[];
  let totalBytes=0;
  for(let pageNumber=1;pageNumber<=total;pageNumber++){
    abortIfRequested(options.signal);
    const page=await pdf.getPage(pageNumber);
    abortIfRequested(options.signal);
    const viewport=page.getViewport({scale});
    const width=Math.ceil(viewport.width),height=Math.ceil(viewport.height);
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||
      width*height>PDF_PAGE_IMAGE_MAX_PIXELS){
      throw new Error('PDF-to-JPEG page render exceeds the 16-megapixel safety limit.');
    }
    const canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d',{alpha:false});
    if(!context)throw new Error('JPEG conversion requires a canvas rendering context.');
    const task=page.render({canvas,canvasContext:context,viewport});
    const cancel=()=>task.cancel();
    options.signal?.addEventListener('abort',cancel,{once:true});
    try {
      await task.promise;
    }catch(reason){
      abortIfRequested(options.signal);
      throw reason;
    }finally{
      options.signal?.removeEventListener('abort',cancel);
    }
    abortIfRequested(options.signal);
    let blob:Blob;
    try {
      blob=await new Promise<Blob>((resolve,reject)=>{
        canvas.toBlob(data=>data?resolve(data):reject(new Error('Canvas did not encode JPEG.')),
          'image/jpeg',quality);
      });
    }finally{
      canvas.width=0;canvas.height=0;
    }
    if(blob.type!=='image/jpeg')throw new Error('Canvas encoder did not return JPEG.');
    const bytes=new Uint8Array(await blob.arrayBuffer());
    if(bytes.length>PDF_PAGE_JPEG_MAX_BYTES)throw new Error('JPEG page exceeds 12 MB.');
    totalBytes+=bytes.length;
    if(totalBytes>PDF_PAGE_IMAGE_MAX_TOTAL_BYTES)throw new Error('JPEG export exceeds 100 MB.');
    pages.push({pageNumber,bytes});
    options.onProgress?.(pageNumber,total);
  }
  abortIfRequested(options.signal);
  return archivePdfPageJpegs(pages,total);
}
