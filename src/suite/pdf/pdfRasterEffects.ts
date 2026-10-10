import {PDFDocument} from 'pdf-lib';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import {validatePngRaster} from './pngIntegrity';

/**
 * Local page-raster effects. These preserve visible page geometry but NOT
 * selectable text, vector geometry, annotations, forms, bookmarks or signatures.
 * Always export a new document; never replace the working PDF.
 */
export type PdfRasterEffect='contrast'|'invert'|'scan';
export const PDF_RASTER_EFFECT_MAX_PAGES=20;
export const PDF_RASTER_EFFECT_MAX_PIXELS=8_000_000;
export const PDF_RASTER_EFFECT_MAX_SOURCE_BYTES=32*1024*1024;
export const PDF_RASTER_EFFECT_MAX_OUTPUT_BYTES=32*1024*1024;
const MAX_PAGE_PNG_BYTES=12*1024*1024;
const MAX_TOTAL_PNG_BYTES=80*1024*1024;

export interface PdfRasterEffectOptions{
  effect:PdfRasterEffect;
  contrast?:number;
  signal?:AbortSignal;
  onProgress?:(done:number,total:number)=>void;
}

function assertEffect(options:PdfRasterEffectOptions):void{
  if(!['contrast','invert','scan'].includes(options.effect)){
    throw new Error('Unsupported local PDF raster effect.');
  }
  if(options.effect==='contrast'&&
    (!Number.isFinite(options.contrast??1.4)||
     (options.contrast??1.4)<0.5||(options.contrast??1.4)>3)){
    throw new Error('Contrast must be between 0.5 and 3.');
  }
}

function cancelIfRequested(signal?:AbortSignal):void{
  if(!signal?.aborted)return;
  const error=new Error('Local PDF raster effect was cancelled.');
  error.name='AbortError';
  throw error;
}
const channel=(value:number)=>Math.max(0,Math.min(255,Math.round(value)));

/** Deterministic, bounded RGBA pixel conversion; alpha is composited on white. */
export function transformPdfRasterPixels(
  pixels:Uint8ClampedArray,width:number,height:number,
  effect:PdfRasterEffect,contrast=1.4,
):void{
  assertEffect({effect,contrast});
  if(!(pixels instanceof Uint8ClampedArray)||
     !Number.isSafeInteger(width)||!Number.isSafeInteger(height)||
     width<1||height<1||width*height>PDF_RASTER_EFFECT_MAX_PIXELS||
     pixels.length!==width*height*4){
    throw new Error('Invalid raster dimensions or RGBA pixel buffer.');
  }
  for(let i=0;i<pixels.length;i+=4){
    const alpha=pixels[i+3]/255;
    let red=pixels[i]*alpha+255*(1-alpha);
    let green=pixels[i+1]*alpha+255*(1-alpha);
    let blue=pixels[i+2]*alpha+255*(1-alpha);
    if(effect==='contrast'){
      red=channel((red-128)*contrast+128);
      green=channel((green-128)*contrast+128);
      blue=channel((blue-128)*contrast+128);
    }else if(effect==='invert'){
      red=255-red;green=255-green;blue=255-blue;
    }else{
      // Paper-white grayscale with a hardened text/ink range, not OCR.
      const gray=red*0.2126+green*0.7152+blue*0.0722;
      const paper=gray<=90?0:gray>=205?255:(gray-90)*255/115;
      red=paper;green=paper;blue=paper;
    }
    pixels[i]=channel(red);
    pixels[i+1]=channel(green);
    pixels[i+2]=channel(blue);
    pixels[i+3]=255;
  }
}

async function encodeCanvasPng(canvas:HTMLCanvasElement):Promise<Uint8Array>{
  const blob=await new Promise<Blob>((resolve,reject)=>
    canvas.toBlob(value=>value?resolve(value):reject(new Error('Unable to encode processed PDF page.')),'image/png'));
  if(blob.size<57||blob.size>MAX_PAGE_PNG_BYTES){
    throw new Error('Processed page exceeds the 12 MB PNG safety limit.');
  }
  const bytes=new Uint8Array(await blob.arrayBuffer());
  if(!validatePngRaster(bytes)){
    throw new Error('Processed PDF page failed PNG integrity validation.');
  }
  return bytes;
}

export async function exportPdfRasterEffect(
  pdf:Pick<PDFDocumentProxy,'numPages'|'getPage'>,
  options:PdfRasterEffectOptions,
):Promise<Uint8Array>{
  assertEffect(options);
  if(!Number.isSafeInteger(pdf.numPages)||pdf.numPages<1||
     pdf.numPages>PDF_RASTER_EFFECT_MAX_PAGES){
    throw new Error('Local PDF raster effects support 1 to 20 pages; no pages were omitted.');
  }
  cancelIfRequested(options.signal);
  const output=await PDFDocument.create();
  output.setCreator('MALENJO offline raster effects');
  output.setTitle('Rasterized PDF - '+options.effect);
  let pngTotal=0;
  for(let number=1;number<=pdf.numPages;number++){
    cancelIfRequested(options.signal);
    const page=await pdf.getPage(number);
    cancelIfRequested(options.signal);
    const viewport=page.getViewport({scale:1});
    const width=Math.ceil(viewport.width),height=Math.ceil(viewport.height);
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||
       width<1||height<1||width*height>PDF_RASTER_EFFECT_MAX_PIXELS||
       viewport.width<=0||viewport.height<=0||
       viewport.width>14400||viewport.height>14400){
      throw new Error('PDF page exceeds the 8-megapixel or PDF page-size safety limit.');
    }
    const canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=height;
    try{
      const context=canvas.getContext('2d',{alpha:false});
      if(!context)throw new Error('Local PDF effects require 2D canvas support.');
      const task=page.render({canvas,canvasContext:context,viewport});
      const abort=()=>task.cancel();
      options.signal?.addEventListener('abort',abort,{once:true});
      try{
        await task.promise;
      }catch(reason){
        cancelIfRequested(options.signal);
        throw reason;
      }finally{
        options.signal?.removeEventListener('abort',abort);
      }
      cancelIfRequested(options.signal);
      const image=context.getImageData(0,0,width,height);
      transformPdfRasterPixels(image.data,width,height,options.effect,options.contrast);
      context.putImageData(image,0,0);
      cancelIfRequested(options.signal);
      const png=await encodeCanvasPng(canvas);
      pngTotal+=png.byteLength;
      if(pngTotal>MAX_TOTAL_PNG_BYTES){
        throw new Error('Processed page images exceed the 80 MB memory budget.');
      }
      const embedded=await output.embedPng(png);
      const outPage=output.addPage([viewport.width,viewport.height]);
      outPage.drawImage(embedded,{x:0,y:0,width:viewport.width,height:viewport.height});
      options.onProgress?.(number,pdf.numPages);
    }finally{
      canvas.width=0;canvas.height=0;
    }
  }
  cancelIfRequested(options.signal);
  const bytes=Uint8Array.from(await output.save({useObjectStreams:false}));
  if(bytes.length>PDF_RASTER_EFFECT_MAX_OUTPUT_BYTES){
    throw new Error('Rasterized PDF exceeds the 32 MB export limit.');
  }
  const reopened=await PDFDocument.load(bytes,{updateMetadata:false});
  if(reopened.getPageCount()!==pdf.numPages){
    throw new Error('Rasterized PDF failed the page-count reopen check.');
  }
  cancelIfRequested(options.signal);
  return bytes;
}
