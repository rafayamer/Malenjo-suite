import {PDFDict,PDFDocument,PDFName,rgb} from 'pdf-lib';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import {validatePngRaster} from './pngIntegrity';

/**
 * Conservative offline automatic redaction: replace EACH matching page with
 * fresh opaque black vector content, then rasterize ALL remaining pages.
 *
 * This is a page-level redact-and-rebuild tool, NOT arbitrary-area redaction:
 * page text, graphics, annotations, forms, bookmarks, hidden layers, metadata
 * and file attachments are not copied to the output document. Nothing from a
 * matching source page is embedded. OCR must be completed separately; pages
 * without selectable text are rejected rather than assumed clean.
 *
 * A match is a literal, case-insensitive phrase in PDF.js selectable text.
 * User review is still required: PDF text extraction may miss text drawn as
 * paths, scans, rotated glyphs or other unsupported text encodings.
 */
export const PDF_AUTO_REDACT_MAX_INPUT_BYTES=32*1024*1024;
export const PDF_AUTO_REDACT_MAX_OUTPUT_BYTES=32*1024*1024;
export const PDF_AUTO_REDACT_MAX_PAGES=20;
export const PDF_AUTO_REDACT_MAX_PIXELS=8_000_000;
export const PDF_AUTO_REDACT_MAX_PATTERN_COUNT=20;
const MAX_PNG_BYTES=12*1024*1024;
const MAX_IMAGE_TOTAL_BYTES=80*1024*1024;

export interface PdfPageRedactionResult{
  bytes:Uint8Array;
  redactedPages:number[];
  matchedPatterns:string[];
  pageCount:number;
}
export interface PdfPageRedactionOptions{
  signal?:AbortSignal;
  onProgress?:(completed:number,total:number)=>void;
}

const cancelled=(signal?:AbortSignal):void=>{
  if(!signal?.aborted)return;
  const error=new Error('Automatic PDF page redaction was cancelled.');
  error.name='AbortError';
  throw error;
};

export function parsePdfAutoRedactPatterns(input:string):string[]{
  if(typeof input!=='string'||input.length>4096){
    throw new Error('Redaction patterns must be UTF-8 text of at most 4,096 characters.');
  }
  const values=input.split(/\r?\n/).map(item=>item.trim()).filter(Boolean);
  if(!values.length||values.length>PDF_AUTO_REDACT_MAX_PATTERN_COUNT){
    throw new Error('Provide 1 to 20 nonempty literal text phrases, one per line.');
  }
  for(const value of values){
    if(value.length>120||/[\u0000-\u001f\u007f]/.test(value)){
      throw new Error('Each redaction phrase must be at most 120 printable characters.');
    }
  }
  const seen=new Set<string>();
  for(const value of values){
    const lower=value.toLowerCase();
    if(seen.has(lower))throw new Error('Duplicate redaction phrase: '+value);
    seen.add(lower);
  }
  return values;
}

export function pageMatchesPdfRedaction(
  fragments:readonly string[],patterns:readonly string[],
):string[]{
  // "joined" catches tokens split by PDF text rendering; "spaced"
  // catches separate positioned chunks. Both intentionally favor excess
  // page deletion over falsely retaining a sensitive page.
  const joined=fragments.join('').toLowerCase();
  const spaced=fragments.join(' ').toLowerCase();
  return patterns.filter(pattern=>{
    const key=pattern.toLowerCase();
    return joined.includes(key)||spaced.includes(key);
  });
}

function assertUnsigned(pdf:PDFDocument):void{
  if(pdf.catalog.has(PDFName.of('Perms'))){
    throw new Error('Certified or rights-managed PDFs cannot be automatically redacted.');
  }
  const byteRange=PDFName.of('ByteRange'),ft=PDFName.of('FT'),type=PDFName.of('Type');
  const objects=pdf.context.enumerateIndirectObjects();
  if(objects.length>20_000){
    throw new Error('PDF exceeds the 20,000-object redaction safety limit.');
  }
  if(objects.some(([,obj])=>obj instanceof PDFDict&&(
    obj.has(byteRange)||obj.get(ft)?.toString()==='/Sig'||
    obj.get(type)?.toString()==='/Sig'
  ))){
    throw new Error('Signed PDFs cannot be automatically redacted or rewritten.');
  }
}

async function pngBytes(canvas:HTMLCanvasElement):Promise<Uint8Array>{
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>
    value?resolve(value):reject(new Error('Unable to encode retained PDF page.')),'image/png'));
  if(blob.size<57||blob.size>MAX_PNG_BYTES){
    throw new Error('Retained PDF page exceeds the 12 MB PNG safety limit.');
  }
  const bytes=new Uint8Array(await blob.arrayBuffer());
  if(!validatePngRaster(bytes)){
    throw new Error('Retained PDF page failed PNG integrity validation.');
  }
  return bytes;
}

export async function redactPdfPagesByText(
  source:Uint8Array,
  reader:Pick<PDFDocumentProxy,'numPages'|'getPage'>,
  patterns:readonly string[],
  options:PdfPageRedactionOptions={},
):Promise<PdfPageRedactionResult>{
  if(!(source instanceof Uint8Array)||source.length<5||
     source.length>PDF_AUTO_REDACT_MAX_INPUT_BYTES){
    throw new Error('Automatic page redaction requires a PDF of at most 32 MB.');
  }
  const validated=parsePdfAutoRedactPatterns(patterns.join('\n'));
  cancelled(options.signal);
  const inspected=await PDFDocument.load(source,{ignoreEncryption:false,updateMetadata:false});
  const count=inspected.getPageCount();
  if(count<1||count>PDF_AUTO_REDACT_MAX_PAGES||reader.numPages!==count){
    throw new Error('Automatic page redaction requires 1 to 20 consistently decoded pages.');
  }
  assertUnsigned(inspected);

  // Detect on ALL pages BEFORE producing output. Refuse unknown/empty text
  // layers instead of claiming that scanned-image pages contain no secrets.
  const matchedPages=new Map<number,string[]>();
  const found=new Set<string>();
  for(let number=1;number<=count;number++){
    cancelled(options.signal);
    const page=await reader.getPage(number);
    const text=await page.getTextContent();
    if(text.items.length>100_000){
      throw new Error('Page '+number+' exceeds the 100,000 text-item safety limit.');
    }
    const fragments=text.items.flatMap(item=>'str' in item?[item.str]:[]);
    if(!fragments.some(fragment=>fragment.trim())){
      throw new Error('Page '+number+' has no selectable text. Run OCR first or redact that page manually.');
    }
    const matches=pageMatchesPdfRedaction(fragments,validated);
    if(matches.length){
      matchedPages.set(number,matches);
      for(const phrase of matches)found.add(phrase);
    }
  }
  if(!matchedPages.size){
    throw new Error('No literal redaction phrases were found. The source PDF was not changed.');
  }
  // Fail closed if a requested phrase was not detected anywhere. Otherwise
  // a typo silently produces an incomplete set of redacted pages.
  const missing=validated.filter(pattern=>!found.has(pattern));
  if(missing.length){
    throw new Error('Not all redaction phrases were found ('+missing.length+' missing). No PDF was exported.');
  }

  const result=await PDFDocument.create();
  result.setCreator('MALENJO offline page-level redaction');
  result.setTitle('Redacted PDF copy');
  let pngTotal=0;
  const outputDimensions:Array<{width:number;height:number}>=[];
  for(let number=1;number<=count;number++){
    cancelled(options.signal);
    const page=await reader.getPage(number);
    const viewport=page.getViewport({scale:1});
    const width=Math.ceil(viewport.width),height=Math.ceil(viewport.height);
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||
       width<1||height<1||width*height>PDF_AUTO_REDACT_MAX_PIXELS||
       viewport.width<=0||viewport.height<=0||
       viewport.width>14400||viewport.height>14400){
      throw new Error('PDF page exceeds the 8-megapixel or page-geometry redaction limit.');
    }
    outputDimensions.push({width:viewport.width,height:viewport.height});
    if(matchedPages.has(number)){
      // No text/image data from this page is copied, rendered or embedded.
      const blank=result.addPage([viewport.width,viewport.height]);
      blank.drawRectangle({x:0,y:0,width:viewport.width,height:viewport.height,color:rgb(0,0,0)});
    }else{
      const canvas=document.createElement('canvas');
      canvas.width=width;canvas.height=height;
      try{
        const context=canvas.getContext('2d',{alpha:false});
        if(!context)throw new Error('PDF page redaction needs an offline 2D canvas.');
        const task=page.render({canvas,canvasContext:context,viewport});
        const abort=()=>task.cancel();
        options.signal?.addEventListener('abort',abort,{once:true});
        try{await task.promise;}
        catch(reason){cancelled(options.signal);throw reason;}
        finally{options.signal?.removeEventListener('abort',abort);}
        cancelled(options.signal);
        const png=await pngBytes(canvas);
        pngTotal+=png.length;
        if(pngTotal>MAX_IMAGE_TOTAL_BYTES){
          throw new Error('Retained PDF images exceed the 80 MB memory budget.');
        }
        const image=await result.embedPng(png);
        const destination=result.addPage([viewport.width,viewport.height]);
        destination.drawImage(image,{
          x:0,y:0,width:viewport.width,height:viewport.height,
        });
      }finally{
        canvas.width=0;canvas.height=0;
      }
    }
    options.onProgress?.(number,count);
  }
  cancelled(options.signal);
  const bytes=Uint8Array.from(await result.save({useObjectStreams:false}));
  if(bytes.length>PDF_AUTO_REDACT_MAX_OUTPUT_BYTES){
    throw new Error('Redacted PDF exceeds the 32 MB output limit.');
  }
  const reopened=await PDFDocument.load(bytes,{updateMetadata:false});
  if(reopened.getPageCount()!==count||
     reopened.getPages().some((p,i)=>
       Math.abs(p.getWidth()-outputDimensions[i].width)>0.01||
       Math.abs(p.getHeight()-outputDimensions[i].height)>0.01)){
    throw new Error('Redacted output PDF failed a page-count or size reopen check.');
  }
  cancelled(options.signal);
  return {bytes,redactedPages:[...matchedPages.keys()],matchedPatterns:validated,pageCount:count};
}
