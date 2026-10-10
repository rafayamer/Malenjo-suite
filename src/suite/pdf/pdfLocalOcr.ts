import {PDFDict,PDFDocument,PDFName,StandardFonts} from 'pdf-lib';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import {invoke,isTauri} from '@tauri-apps/api/core';
import {validatePngRaster} from './pngIntegrity';

/** Page-raster OCR, NOT editable layout reconstruction or searchable coordinate alignment.
 * The production recognizer calls only MALENJO's local PaddleOCR Tauri command.
 * No browser model worker or network fallback is used. A locally installed
 * model/runtime must already be usable without downloading anything.
 */
export const PDF_LOCAL_OCR_MAX_SOURCE_BYTES=32*1024*1024;
export const PDF_LOCAL_OCR_MAX_OUTPUT_BYTES=32*1024*1024;
export const PDF_LOCAL_OCR_MAX_PAGES=10;
export const PDF_LOCAL_OCR_MAX_PIXELS=8_000_000;
export const PDF_LOCAL_OCR_MAX_PNG_BYTES=12*1024*1024;
export interface PdfOcrPageResult{page:number;text:string;confidence:number}
export interface PdfOcrResult{bytes:Uint8Array;pages:PdfOcrPageResult[]}
export interface PdfOcrOptions{
  signal?:AbortSignal;
  recognize?:(png:Uint8Array,pageNumber:number)=>Promise<{text:string;confidence:number}>;
  onProgress?:(completed:number,total:number)=>void;
}
function checkAbort(signal?:AbortSignal):void{
  if(!signal?.aborted)return;
  const error=new Error('Local PDF OCR cancelled.');error.name='AbortError';throw error;
}
export function normalizePdfOcrText(text:string):string{
  if(typeof text!=='string'||text.length>20000)throw new Error('OCR text must be at most 20,000 characters per page.');
  // pdf-lib standard fonts are WinAnsi; make every non-printable/non-ASCII
  // code unit visible as a reversible ASCII escape rather than losing data.
  return [...text].map(c=>{
    const n=c.codePointAt(0)!;
    if(n>=32&&n<=126)return c;
    if(n===10||n===13||n===9)return ' ';
    return n<=0xffff?'\\u'+n.toString(16).padStart(4,'0'):'\\U'+n.toString(16).padStart(8,'0');
  }).join('').replace(/ {2,}/g,' ').trim();
}
function refuseSignedSource(pdf:PDFDocument):void{
  if(pdf.catalog.has(PDFName.of('Perms'))||pdf.catalog.has(PDFName.of('AcroForm'))){
    throw new Error('OCR PDF rebuilding refuses certified, signed or form-bearing documents.');
  }
  const byteRange=PDFName.of('ByteRange'),field=PDFName.of('FT');
  if(pdf.context.enumerateIndirectObjects().some(([,obj])=>
    obj instanceof PDFDict&&(obj.has(byteRange)||obj.get(field)?.toString()==='/Sig'))){
    throw new Error('OCR PDF rebuilding refuses signature dictionaries.');
  }
}
export async function recognizeLocalPdfPng(
  bytes:Uint8Array,pageNumber:number,
):Promise<{text:string;confidence:number}>{
  if(!isTauri())throw new Error('Offline PDF OCR requires the desktop local PaddleOCR provider.');
  if(!validatePngRaster(bytes)||bytes.length>PDF_LOCAL_OCR_MAX_PNG_BYTES){
    throw new Error('Local OCR input must be a validated PNG under 12 MB.');
  }
  return invoke<{text:string;confidence:number}>('paddle_ocr_image',{
    bytes:Array.from(bytes),language:'en',
    jobId:'malenjo-pdf-ocr-'+pageNumber+'-'+Date.now(),
  });
}
async function pngFromCanvas(canvas:HTMLCanvasElement):Promise<Uint8Array>{
  const blob=await new Promise<Blob>((resolve,reject)=>
    canvas.toBlob(value=>value?resolve(value):reject(new Error('Unable to encode PDF OCR input.')),'image/png'));
  if(blob.size<57||blob.size>PDF_LOCAL_OCR_MAX_PNG_BYTES)throw new Error('OCR rendered page exceeds the 12 MB PNG limit.');
  const bytes=new Uint8Array(await blob.arrayBuffer());
  if(!validatePngRaster(bytes))throw new Error('OCR rendered page failed PNG integrity validation.');
  return bytes;
}

export async function exportSearchablePdfFromLocalOcr(
  source:Uint8Array,
  reader:Pick<PDFDocumentProxy,'numPages'|'getPage'>,
  options:PdfOcrOptions={},
):Promise<PdfOcrResult>{
  if(!(source instanceof Uint8Array)||source.length<5||
     source.length>PDF_LOCAL_OCR_MAX_SOURCE_BYTES){
    throw new Error('Local PDF OCR accepts a PDF of at most 32 MB.');
  }
  checkAbort(options.signal);
  const src=await PDFDocument.load(source,{ignoreEncryption:false,updateMetadata:false});
  const total=src.getPageCount();
  if(total<1||total>PDF_LOCAL_OCR_MAX_PAGES||reader.numPages!==total){
    throw new Error('Local PDF OCR requires 1 to 10 consistently decoded pages.');
  }
  refuseSignedSource(src);
  if(!options.recognize&&!isTauri()){
    throw new Error('Local PDF OCR needs the desktop PaddleOCR provider; browser-only OCR is unavailable.');
  }
  const result=await PDFDocument.create();
  result.setCreator('MALENJO optional local PaddleOCR');
  result.setTitle('Searchable OCR PDF (raster pages)');
  const font=await result.embedFont(StandardFonts.Helvetica);
  const pages:PdfOcrPageResult[]=[];
  for(let number=1;number<=total;number++){
    checkAbort(options.signal);
    const page=await reader.getPage(number);
    const viewport=page.getViewport({scale:1});
    const width=Math.ceil(viewport.width),height=Math.ceil(viewport.height);
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||
       width<1||height<1||width*height>PDF_LOCAL_OCR_MAX_PIXELS||
       viewport.width<=0||viewport.height<=0||
       viewport.width>14400||viewport.height>14400){
      throw new Error('OCR page exceeds the 8-megapixel page-geometry limit.');
    }
    const canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=height;
    try{
      const context=canvas.getContext('2d',{alpha:false});
      if(!context)throw new Error('PDF OCR requires a local 2D canvas renderer.');
      const task=page.render({canvas,canvasContext:context,viewport});
      const abort=()=>task.cancel();
      options.signal?.addEventListener('abort',abort,{once:true});
      try{await task.promise;}catch(error){checkAbort(options.signal);throw error;}
      finally{options.signal?.removeEventListener('abort',abort);}
      checkAbort(options.signal);
      const png=await pngFromCanvas(canvas);
      const prediction=await (options.recognize??recognizeLocalPdfPng)(png,number);
      if(!prediction||!Number.isFinite(prediction.confidence)||
        prediction.confidence<0||prediction.confidence>100){
        throw new Error('Local OCR provider returned an invalid confidence score.');
      }
      const text=normalizePdfOcrText(prediction.text);
      if(!text)throw new Error('No OCR text was recognized on page '+number+'. Review the scan or language model.');
      const embedded=await result.embedPng(png);
      const destination=result.addPage([viewport.width,viewport.height]);
      destination.drawImage(embedded,{x:0,y:0,width:viewport.width,height:viewport.height});
      // Small near-invisible text is selectable/searchable, but it is not
      // aligned to each source glyph. Do NOT claim coordinate-accurate OCR.
      const fragments=text.match(/.{1,180}/g)?.slice(0,150)??[];
      for(let i=0;i<fragments.length;i++){
        destination.drawText(fragments[i],{
          x:1,y:Math.max(1,Math.min(viewport.height-1,1+(i%100)*0.8)),
          size:1,font,opacity:0.01,
        });
      }
      pages.push({page:number,text:prediction.text,confidence:prediction.confidence});
      options.onProgress?.(number,total);
    }finally{
      canvas.width=0;canvas.height=0;
    }
  }
  checkAbort(options.signal);
  const bytes=Uint8Array.from(await result.save({useObjectStreams:false}));
  if(bytes.byteLength>PDF_LOCAL_OCR_MAX_OUTPUT_BYTES){
    throw new Error('Searchable OCR PDF exceeds the 32 MB export limit.');
  }
  const reopened=await PDFDocument.load(bytes,{updateMetadata:false});
  if(reopened.getPageCount()!==total||
     reopened.getPages().some((p,i)=>
       Math.abs(p.getWidth()-src.getPage(i).getWidth())>2&&
       Math.abs(p.getHeight()-src.getPage(i).getHeight())>2)){
    throw new Error('Local OCR output could not be reopened with the required page count.');
  }
  return {bytes,pages};
}
