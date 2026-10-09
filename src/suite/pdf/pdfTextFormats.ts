import type {PDFDocumentProxy} from 'pdfjs-dist';
import type {PdfDocumentInfo} from './pdfInfo';
import {exportPdfStructuredJson,type PdfStructuredJson} from './pdfToJson';

/** Bounded local selectable-text exports, not full graphical/OCR/table parity. */
export type PdfTextFormat='markdown'|'html'|'csv';
export const PDF_TEXT_FORMAT_MAX_BYTES=16_000_000;

function escapeHtml(value:string):string{
  return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'\uFFFD');
}
function escapeMarkdown(value:string):string{
  return value.replace(/\\/g,'\\\\')
    .replace(/([\x60*_{}\[\]()#+.!|>~-])/g,'\\$1')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'\uFFFD');
}
function safeCsvValue(value:string):string{
  // Protect spreadsheet consumers against formula injection from PDF text.
  const safe=/^[\s\uFEFF]*[=+\-@\t\r]/u.test(value)?"'"+value:value;
  return '"'+safe.replace(/"/g,'""').replace(/\u0000/g,'')+'"';
}
function encodeBounded(value:string):Uint8Array{
  const bytes=new TextEncoder().encode(value);
  if(bytes.byteLength>PDF_TEXT_FORMAT_MAX_BYTES){
    throw new Error('PDF text conversion exceeds the 16 MB output safety limit.');
  }
  return bytes;
}
export function serializePdfTextFormat(
  data:PdfStructuredJson,format:PdfTextFormat,
):Uint8Array{
  if(data.pageCount!==data.pages.length||data.pageCount<1||
     data.pages.some((page,index)=>page.page!==index+1)){
    throw new Error('PDF text export page order is inconsistent.');
  }
  if(!data.pages.some(page=>page.text.trim())){
    throw new Error('No selectable text exists for this export; use OCR first.');
  }
  const title=data.metadata.title?.trim()||'PDF document';
  if(format==='markdown'){
    const parts=[
      '# '+escapeMarkdown(title),'',
      '> Text-only PDF export. Does not preserve graphics, complex reading order, tables, or layout.','',
    ];
    for(const page of data.pages){
      parts.push('## Page '+page.page,'',escapeMarkdown(page.text),'');
    }
    return encodeBounded(parts.join('\n')+'\n');
  }
  if(format==='html'){
    const parts=[
      '<!doctype html>','<html lang="en">','<head>',
      '<meta charset="utf-8">',
      '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;">',
      '<title>'+escapeHtml(title)+'</title>',
      '<style>body{font-family:system-ui,sans-serif;max-width:75ch;margin:2rem auto;padding:0 1rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}section{border-top:1px solid #ccc;padding:1rem 0}</style>',
      '</head>','<body>','<h1>'+escapeHtml(title)+'</h1>',
      '<p>Selectable-text-only export. Original graphics, reading order, tables and layout are not guaranteed.</p>',
    ];
    for(const page of data.pages){
      parts.push('<section aria-label="Page '+page.page+'">',
        '<h2>Page '+page.page+'</h2>','<pre>'+escapeHtml(page.text)+'</pre>','</section>');
    }
    parts.push('</body>','</html>','');
    return encodeBounded(parts.join('\n'));
  }
  if(format==='csv'){
    // Page-indexed selectable-text CSV, not inferred PDF tables.
    const lines=['"page","text"'];
    for(const page of data.pages){
      lines.push(safeCsvValue(String(page.page))+','+safeCsvValue(page.text));
    }
    return encodeBounded('\uFEFF'+lines.join('\r\n')+'\r\n');
  }
  throw new Error('Unsupported PDF text export format.');
}
export async function exportPdfTextFormat(
  document:Pick<PDFDocumentProxy,'numPages'|'getPage'|'getOutline'>,
  metadata:PdfDocumentInfo,
  format:PdfTextFormat,
  options:{signal?:AbortSignal;onProgress?:(done:number,total:number)=>void}={},
):Promise<Uint8Array>{
  const source=await exportPdfStructuredJson(document,metadata,options);
  if(options.signal?.aborted){
    const error=new Error('PDF text export cancelled.');
    error.name='AbortError';
    throw error;
  }
  return serializePdfTextFormat(
    JSON.parse(new TextDecoder().decode(source)) as PdfStructuredJson,format,
  );
}
