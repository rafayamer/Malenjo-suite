import {OPS} from 'pdfjs-dist';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import {zipSync} from 'fflate';

/** Strict local PDF selectable-text -> genuine SVG text element export.
 * Does not embed raster screenshots or claim full graphical vector fidelity.
 * Refuses any image and painted path operations rather than silently omitting them.
 * Native fonts may differ from the original PDF subset/embedded typeface.
 */
export const PDF_TEXT_VECTOR_MAX_PAGES=10;
export const PDF_TEXT_VECTOR_MAX_SOURCE_BYTES=16*1024*1024;
export const PDF_TEXT_VECTOR_MAX_OUTPUT_BYTES=8*1024*1024;
export const PDF_TEXT_VECTOR_MAX_ITEMS_PER_PAGE=5000;
export interface PdfTextVectorResult{archive:Uint8Array;pageCount:number;textItems:number}
export interface PdfTextVectorOptions{
  signal?:AbortSignal;onProgress?:(done:number,total:number)=>void;
}
const unsupportedOps=new Set([
  'constructPath','stroke','closeStroke','fill','eoFill',
  'fillStroke','eoFillStroke','closeFillStroke','closeEOFillStroke',
  'shadingFill','paintImageXObject','paintImageXObjectRepeat',
  'paintInlineImageXObject','paintInlineImageXObjectGroup',
  'paintJpegXObject','paintImageMaskXObject','paintFormXObjectBegin',
].map(key=>(OPS as Record<string,number>)[key]).filter((n):n is number=>Number.isInteger(n)));
function xml(value:string):string{
  let out='';
  for(const char of value){
    const n=char.codePointAt(0)!;
    if(!(n===9||n===10||n===13||
         (n>=32&&n<=0xd7ff)||(n>=0xe000&&n<=0xfffd)||
         (n>=0x10000&&n<=0x10ffff))){
      out+='\uFFFD';continue;
    }
    if(char==='&')out+='&amp;';
    else if(char==='<')out+='&lt;';
    else if(char==='>')out+='&gt;';
    else if(char==='"')out+='&quot;';
    else if(char==="'")out+='&apos;';
    else out+=char;
  }
  return out;
}
function finiteNumber(number:number):string{
  if(!Number.isFinite(number)||Math.abs(number)>100000){
    throw new Error('PDF text vector export has invalid glyph geometry.');
  }
  return String(Math.round(number*1000)/1000);
}
export function buildPdfTextOnlySvg(
  width:number,height:number,items:readonly {str:string;transform:readonly number[]}[],
):string{
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||
     width>14400||height>14400)throw new Error('Unsupported SVG page dimensions.');
  if(items.length>PDF_TEXT_VECTOR_MAX_ITEMS_PER_PAGE){
    throw new Error('PDF vector text page exceeds the 5,000-fragment limit.');
  }
  let body='';
  for(const item of items){
    if(!item.str||!item.str.trim())continue;
    const t=item.transform;
    if(t.length!==6||!t.every(Number.isFinite))throw new Error('Malformed PDF text transform.');
    // Only horizontal LTR text; transformed/skewed glyphs cannot be
    // reproduced correctly without an embedded font and contour converter.
    if(t[0]<=0||t[3]<=0||Math.abs(t[1])>0.01||Math.abs(t[2])>0.01){
      throw new Error('Rotated, mirrored or sheared PDF text requires a reviewed SVG font renderer.');
    }
    const size=finiteNumber(t[3]),x=finiteNumber(t[4]),y=finiteNumber(height-t[5]);
    body+='<text x="'+x+'" y="'+y+'" font-size="'+size+
      '" font-family="sans-serif" xml:space="preserve">'+xml(item.str)+'</text>\n';
  }
  if(!body)throw new Error('PDF page has no safely exportable selectable vector text.');
  return '<?xml version="1.0" encoding="UTF-8"?>\n'+
    '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="'+finiteNumber(width)+
    'pt" height="'+finiteNumber(height)+'pt" viewBox="0 0 '+finiteNumber(width)+' '+
    finiteNumber(height)+'">\n'+
    '<desc>Offline selectable-text SVG only. Original fonts, images, annotations, vectors, links and advanced text shaping are not reproduced.</desc>\n'+
    body+'</svg>\n';
}
function check(signal?:AbortSignal){
  if(!signal?.aborted)return;
  const error=new Error('PDF to text SVG export cancelled.');error.name='AbortError';throw error;
}
export async function exportPdfTextOnlySvgZip(
  reader:Pick<PDFDocumentProxy,'numPages'|'getPage'>,
  options:PdfTextVectorOptions={},
):Promise<PdfTextVectorResult>{
  if(reader.numPages<1||reader.numPages>PDF_TEXT_VECTOR_MAX_PAGES||
     !Number.isSafeInteger(reader.numPages)){
    throw new Error('PDF-to-SVG text export supports 1 to 10 pages.');
  }
  check(options.signal);
  const files:Record<string,Uint8Array>={};
  let total=0,textItems=0;
  for(let number=1;number<=reader.numPages;number++){
    check(options.signal);
    const page=await reader.getPage(number);
    const operators=await page.getOperatorList();
    if(operators.fnArray.length>200000||operators.fnArray.some(op=>unsupportedOps.has(op))){
      throw new Error('Page '+number+' contains graphical paths or images; text-only SVG would lose content.');
    }
    // Current SVG subset is not rotation-aware; fail instead of misrepresenting
    // the physical page orientation in exported output.
    if(((page.rotate??0)%360+360)%360!==0)
      throw new Error('Rotated PDF pages require rotation-aware SVG; export refused.');
    const content=await page.getTextContent();
    if(content.items.length>PDF_TEXT_VECTOR_MAX_ITEMS_PER_PAGE){
      throw new Error('PDF vector text page exceeds the 5,000-fragment limit.');
    }
    const items=content.items.flatMap(item=>'str' in item?[{
      str:item.str,transform:item.transform,
    }]:[]);
    const viewport=page.getViewport({scale:1,rotation:0});
    const svg=buildPdfTextOnlySvg(viewport.width,viewport.height,items);
    const bytes=new TextEncoder().encode(svg);
    total+=bytes.length;
    if(total>PDF_TEXT_VECTOR_MAX_OUTPUT_BYTES){
      throw new Error('SVG text archive exceeds the 8 MB export budget.');
    }
    files['page-'+String(number).padStart(4,'0')+'.svg']=bytes;
    textItems+=items.filter(x=>x.str.trim()).length;
    options.onProgress?.(number,reader.numPages);
  }
  check(options.signal);
  const archive=zipSync(files,{level:6});
  if(archive.length>PDF_TEXT_VECTOR_MAX_OUTPUT_BYTES){
    throw new Error('Compressed SVG archive exceeds the 8 MB export limit.');
  }
  return {archive,pageCount:reader.numPages,textItems};
}
