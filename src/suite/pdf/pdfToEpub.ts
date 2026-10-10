import {zipSync,unzipSync} from 'fflate';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import type {PdfDocumentInfo} from './pdfInfo';
import {exportPdfStructuredJson,type PdfStructuredJson} from './pdfToJson';

/**
 * Offline EPUB 3 reflowable e-book built from actual selectable PDF text.
 * Preserves Unicode and page boundaries, not PDF graphics, rich layout or OCR.
 */
export const PDF_EPUB_MAX_BYTES=16_000_000;
const utf8=(value:string)=>new TextEncoder().encode(value);
const decode=(value:Uint8Array)=>new TextDecoder('utf-8',{fatal:true}).decode(value);

function xml(value:string):string{
  let out='';
  for(const char of value){
    const c=char.codePointAt(0)!;
    if(!(c===9||c===10||c===13||
      (c>=32&&c<=0xd7ff)||(c>=0xe000&&c<=0xfffd)||
      (c>=0x10000&&c<=0x10ffff))){out+='\uFFFD';continue;}
    if(char==='&')out+='&amp;';
    else if(char==='<')out+='&lt;';
    else if(char==='>')out+='&gt;';
    else if(char==='"')out+='&quot;';
    else if(char==="'")out+='&apos;';
    else out+=char;
  }
  return out;
}
function limited(value:string):Uint8Array{
  const data=utf8(value);
  if(data.byteLength>PDF_EPUB_MAX_BYTES)throw new Error('EPUB XHTML exceeds the 16 MB safety limit.');
  return data;
}
function idFor(data:PdfStructuredJson):string{
  let hash=2166136261;
  const text=(data.metadata.title??'PDF')+':'+data.pageCount+':'+data.pages.map(p=>p.text).join('');
  for(let i=0;i<text.length;i++){
    hash=Math.imul(hash^text.charCodeAt(i),16777619);
  }
  return 'urn:malenjo:pdf-text:'+String(hash>>>0).padStart(10,'0');
}
function validate(data:PdfStructuredJson){
  if(!Number.isInteger(data.pageCount)||data.pageCount<1||
     data.pageCount!==data.pages.length||
     data.pages.some((p,i)=>p.page!==i+1)){
    throw new Error('EPUB requires an ordered PDF page inventory.');
  }
  if(!data.pages.some(p=>p.text.trim()))throw new Error('No selectable PDF text exists; use OCR first.');
}
export function serializePdfEpub(data:PdfStructuredJson):Uint8Array{
  validate(data);
  const title=xml(data.metadata.title?.trim()||'PDF document');
  const paragraphs=data.pages.map(page=>{
    const lines=page.text.split(/\r\n|\r|\n/);
    return '<section epub:type="chapter" id="page-'+page.page+'">'+
      '<h2>Page '+page.page+'</h2>'+
      lines.map(line=>'<p>'+xml(line)+'</p>').join('')+
      '</section>';
  }).join('');
  const content=limited('<?xml version="1.0" encoding="UTF-8"?>'+
    '<!DOCTYPE html>'+
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">'+
    '<head><meta charset="utf-8"/><title>'+title+'</title>'+
    '<style>body{font-family:serif;line-height:1.55}p{white-space:pre-wrap;overflow-wrap:break-word}section{page-break-before:always}</style>'+
    '</head><body><h1>'+title+'</h1>'+paragraphs+'</body></html>');
  const nav=limited('<?xml version="1.0" encoding="UTF-8"?>'+
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">'+
    '<head><title>Contents</title></head><body>'+
    '<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>'+
    data.pages.map(p=>'<li><a href="text.xhtml#page-'+p.page+'">Page '+p.page+'</a></li>').join('')+
    '</ol></nav></body></html>');
  const packageXml=limited('<?xml version="1.0" encoding="UTF-8"?>'+
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="en">'+
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'+
    '<dc:identifier id="uid">'+idFor(data)+'</dc:identifier>'+
    '<dc:title>'+title+'</dc:title>'+
    '<dc:language>en</dc:language>'+
    '<meta property="dcterms:modified">1970-01-01T00:00:00Z</meta>'+
    '</metadata><manifest>'+
    '<item id="text" href="text.xhtml" media-type="application/xhtml+xml"/>'+
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'+
    '</manifest><spine><itemref idref="text"/></spine></package>');
  const container=limited('<?xml version="1.0" encoding="UTF-8"?>'+
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'+
    '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>'+
    '</container>');
  // EPUB OCF requires an uncompressed 'mimetype' entry first, no ZIP prefix.
  const epub=zipSync({
    mimetype:[utf8('application/epub+zip'),{level:0}],
    'META-INF/container.xml':[container,{level:6}],
    'OEBPS/content.opf':[packageXml,{level:6}],
    'OEBPS/nav.xhtml':[nav,{level:6}],
    'OEBPS/text.xhtml':[content,{level:6}],
  });
  if(epub.byteLength>PDF_EPUB_MAX_BYTES)throw new Error('EPUB archive exceeds the 16 MB safety limit.');
  return epub;
}
/** Reject bad container envelopes before offering files to third-party readers. */
export function inspectPdfEpubArchive(bytes:Uint8Array):{
  pageLinks:number;hasText:boolean;
}{
  if(bytes.length<38||bytes.length>PDF_EPUB_MAX_BYTES||
     bytes[0]!==80||bytes[1]!==75||bytes[2]!==3||bytes[3]!==4||
     bytes[8]!==0||bytes[9]!==0){
    throw new Error('EPUB must be a bounded ZIP with an uncompressed mimetype first.');
  }
  const nameSize=bytes[26]+bytes[27]*256;
  const firstName=decode(bytes.slice(30,30+nameSize));
  if(firstName!=='mimetype')throw new Error('EPUB first archive member must be mimetype.');
  const files=unzipSync(bytes);
  if(Object.keys(files).length!==5||
     !['mimetype','META-INF/container.xml','OEBPS/content.opf',
       'OEBPS/nav.xhtml','OEBPS/text.xhtml'].every(name=>name in files)){
    throw new Error('EPUB package has missing or unexpected members.');
  }
  if(decode(files.mimetype)!=='application/epub+zip')throw new Error('EPUB MIME marker is incorrect.');
  const container=decode(files['META-INF/container.xml']);
  const opf=decode(files['OEBPS/content.opf']);
  const nav=decode(files['OEBPS/nav.xhtml']);
  const body=decode(files['OEBPS/text.xhtml']);
  if(!container.includes('full-path="OEBPS/content.opf"')||
     !opf.includes('version="3.0"')||!opf.includes('properties="nav"')||
     !nav.includes('epub:type="toc"')||!body.includes('xmlns="http://www.w3.org/1999/xhtml"')){
    throw new Error('EPUB reading order or navigation metadata is invalid.');
  }
  return {pageLinks:(nav.match(/href="text\.xhtml#page-/g)??[]).length,hasText:body.includes('<p>')};
}
export async function exportPdfEpub(
  document:Pick<PDFDocumentProxy,'numPages'|'getPage'|'getOutline'>,
  info:PdfDocumentInfo,
  options:{signal?:AbortSignal;onProgress?:(done:number,total:number)=>void}={},
):Promise<Uint8Array>{
  const source=await exportPdfStructuredJson(document,info,options);
  if(options.signal?.aborted){
    const error=new Error('PDF to EPUB export cancelled.');error.name='AbortError';throw error;
  }
  return serializePdfEpub(JSON.parse(decode(source)) as PdfStructuredJson);
}
