import {unzipSync,zipSync} from 'fflate';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import type {PdfDocumentInfo} from './pdfInfo';
import {exportPdfStructuredJson,type PdfStructuredJson} from './pdfToJson';

/**
 * Genuine DOCX/RTF containers containing selectable PDF text. These are
 * intentionally not positioned, editable-layout reconstructions.
 * Both reject image-only scans (OCR first), preserve original PDFs and enforce
 * the structured text extraction limits and a separate output budget.
 */
export type PdfOfficeTextFormat='docx'|'odt'|'rtf';
export const PDF_OFFICE_TEXT_MAX_BYTES=16_000_000;
const encode=(value:string):Uint8Array=>new TextEncoder().encode(value);

function bounded(value:string):Uint8Array{
  const bytes=encode(value);
  if(bytes.byteLength>PDF_OFFICE_TEXT_MAX_BYTES){
    throw new Error('Office text export exceeds the 16 MB output safety limit.');
  }
  return bytes;
}

/** XML 1.0 character rules; never render PDF-supplied markup as XML. */
function xmlEscape(value:string):string{
  let result='';
  for(const char of value){
    const code=char.codePointAt(0)!;
    if(code===0x9||code===0xa||code===0xd||
       (code>=0x20&&code<=0xd7ff)||
       (code>=0xe000&&code<=0xfffd)||
       (code>=0x10000&&code<=0x10ffff)){
      if(char==='&')result+='&amp;';
      else if(char==='<')result+='&lt;';
      else if(char==='>')result+='&gt;';
      else if(char==='"')result+='&quot;';
      else if(char==="'")result+='&apos;';
      else result+=char;
    }else result+='\uFFFD';
  }
  return result;
}
function checkPages(data:PdfStructuredJson):void{
  if(!Number.isInteger(data.pageCount)||data.pageCount<1||
     data.pageCount!==data.pages.length||
     data.pages.some((page,index)=>page.page!==index+1)){
    throw new Error('Office text export has an invalid PDF page sequence.');
  }
  if(!data.pages.some(page=>page.text.trim())){
    throw new Error('No selectable PDF text exists; use OCR before Office export.');
  }
}
function wordParagraph(line:string):string{
  // Tab stops become actual Word tabs rather than literal control characters.
  const segments=line.split('\t');
  return '<w:p><w:r>'+segments.map((part,index)=>
    (index?'<w:tab/>':'')+'<w:t xml:space="preserve">'+xmlEscape(part)+'</w:t>'
  ).join('')+'</w:r></w:p>';
}
export function serializePdfDocx(data:PdfStructuredJson):Uint8Array{
  checkPages(data);
  const body:string[]=[];
  for(let index=0;index<data.pages.length;index++){
    if(index)body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    // Deliberate line/page boundaries, not inferred PDF text layout.
    const lines=data.pages[index].text.split(/\r\n|\r|\n/);
    for(const line of lines)body.push(wordParagraph(line));
  }
  const xml=bounded(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+
    '<w:body>'+body.join('')+'<w:sectPr/></w:body></w:document>',
  );
  const contentTypes=encode('<?xml version="1.0" encoding="UTF-8"?>'+
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
    '<Default Extension="xml" ContentType="application/xml"/>'+
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'+
    '</Types>');
  const relationships=encode('<?xml version="1.0" encoding="UTF-8"?>'+
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'+
    '</Relationships>');
  const result=zipSync({
    '[Content_Types].xml':contentTypes,
    '_rels/.rels':relationships,
    'word/document.xml':xml,
  },{level:6});
  if(result.byteLength>PDF_OFFICE_TEXT_MAX_BYTES){
    throw new Error('DOCX archive exceeds the 16 MB output safety limit.');
  }
  return result;
}

/** OpenDocument Text 1.3 ZIP, with uncompressed mimetype as the first entry. */
function odtTextLine(line:string):string{
  return line.split(/(\t| {2,})/g).map(part=>{
    if(part==='\t')return '<text:tab/>';
    if(/^ {2,}$/.test(part))return '<text:s text:c="'+part.length+'"/>';
    return xmlEscape(part);
  }).join('');
}
export function serializePdfOdt(data:PdfStructuredJson):Uint8Array{
  checkPages(data);
  const paras:string[]=[];
  for(let index=0;index<data.pages.length;index++){
    for(const [lineIndex,line] of data.pages[index].text.split(/\r\n|\r|\n/).entries()){
      const style=index>0&&lineIndex===0?' text:style-name="PageBreak"':'';
      paras.push('<text:p'+style+'>'+odtTextLine(line)+'</text:p>');
    }
  }
  const document=bounded('<?xml version="1.0" encoding="UTF-8"?>'+
    '<office:document-content '+
    'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '+
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '+
    'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '+
    'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.3">'+
    '<office:automatic-styles>'+
    '<style:style style:name="PageBreak" style:family="paragraph">'+
    '<style:paragraph-properties fo:break-before="page"/>'+
    '</style:style></office:automatic-styles>'+
    '<office:body><office:text>'+paras.join('')+
    '</office:text></office:body></office:document-content>');
  const styles=bounded('<?xml version="1.0" encoding="UTF-8"?>'+
    '<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.3">'+
    '<office:styles/></office:document-styles>');
  const manifest=bounded('<?xml version="1.0" encoding="UTF-8"?>'+
    '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">'+
    '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>'+
    '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'+
    '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>'+
    '</manifest:manifest>');
  const bytes=zipSync({
    mimetype:[encode('application/vnd.oasis.opendocument.text'),{level:0}],
    'content.xml':[document,{level:6}],
    'styles.xml':[styles,{level:6}],
    'META-INF/manifest.xml':[manifest,{level:6}],
  });
  if(bytes.length>PDF_OFFICE_TEXT_MAX_BYTES){
    throw new Error('ODT archive exceeds the 16 MB output safety limit.');
  }
  return bytes;
}
export function inspectPdfTextOdt(bytes:Uint8Array):{
  paragraphCount:number;hasPageBreak:boolean;
}{
  if(bytes.length<38||bytes.length>PDF_OFFICE_TEXT_MAX_BYTES||
     bytes[0]!==80||bytes[1]!==75||bytes[2]!==3||bytes[3]!==4||
     bytes[8]!==0||bytes[9]!==0){
    throw new Error('ODT must start with an uncompressed ZIP mimetype entry.');
  }
  const length=bytes[26]+bytes[27]*256;
  const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.slice(30,30+length));
  if(name!=='mimetype')throw new Error('ODT mimetype must be the first archive member.');
  const files=unzipSync(bytes);
  if(Object.keys(files).length!==4||
     !['mimetype','content.xml','styles.xml','META-INF/manifest.xml'].every(name=>name in files)){
    throw new Error('ODT is missing required package members.');
  }
  for(const entry of Object.values(files)){
    if(entry.length>PDF_OFFICE_TEXT_MAX_BYTES)throw new Error('ODT member is too large.');
  }
  const read=(key:string)=>new TextDecoder('utf-8',{fatal:true}).decode(files[key]);
  const content=read('content.xml');
  if(read('mimetype')!=='application/vnd.oasis.opendocument.text'||
     !read('META-INF/manifest.xml').includes('manifest:full-path="/"')||
     !content.includes('<office:document-content ')||
     !content.includes('</office:document-content>')){
    throw new Error('ODT document content or manifest is invalid.');
  }
  return {
    paragraphCount:(content.match(/<text:p(?:\s|>)/g)??[]).length,
    hasPageBreak:content.includes('text:style-name="PageBreak"'),
  };
}

/** RTF supports UTF-16 signed \uN code units with an ASCII fallback. */
function rtfEscape(value:string):string{
  let output='';
  for(let index=0;index<value.length;index++){
    const c=value.charCodeAt(index);
    if(c===0x5c||c===0x7b||c===0x7d){
      output+='\\'+String.fromCharCode(c);
    }else if(c===9)output+='\\tab ';
    else if(c===10)output+='\\line ';
    else if(c===13)continue;
    else if(c<0x20||c===0xfffe||c===0xffff||
      (c>=0xd800&&c<=0xdbff&&!(index+1<value.length&&value.charCodeAt(index+1)>=0xdc00&&value.charCodeAt(index+1)<=0xdfff))||
      (c>=0xdc00&&c<=0xdfff&&!(index>0&&value.charCodeAt(index-1)>=0xd800&&value.charCodeAt(index-1)<=0xdbff))){
      output+='?';
    }else if(c>0x7e){
      output+='\\u'+(c>32767?c-65536:c)+'?';
    }else output+=String.fromCharCode(c);
  }
  return output;
}
export function serializePdfRtf(data:PdfStructuredJson):Uint8Array{
  checkPages(data);
  const pages=data.pages.map((page,index)=>
    (index?'\\page\n':'')+
    rtfEscape(page.text).replace(/\\line /g,'\\par\n')+'\\par\n',
  );
  return bounded('{\\rtf1\\ansi\\deff0\\uc1\n'+
    '{\\fonttbl{\\f0 Arial;}}\n'+
    '\\f0\\fs22\n'+pages.join('')+'}\n');
}
export function serializePdfOfficeText(
  data:PdfStructuredJson,format:PdfOfficeTextFormat,
):Uint8Array{
  if(format==='docx')return serializePdfDocx(data);
  if(format==='odt')return serializePdfOdt(data);
  if(format==='rtf')return serializePdfRtf(data);
  throw new Error('Unsupported PDF Office text format.');
}
export async function exportPdfOfficeText(
  document:Pick<PDFDocumentProxy,'numPages'|'getPage'|'getOutline'>,
  info:PdfDocumentInfo,
  format:PdfOfficeTextFormat,
  options:{signal?:AbortSignal;onProgress?:(done:number,total:number)=>void}={},
):Promise<Uint8Array>{
  const json=await exportPdfStructuredJson(document,info,options);
  if(options.signal?.aborted){
    const error=new Error('PDF Office text export cancelled.');
    error.name='AbortError';
    throw error;
  }
  const data=JSON.parse(new TextDecoder().decode(json)) as PdfStructuredJson;
  return serializePdfOfficeText(data,format);
}

/** Inspect bounded DOCX output, including required OpenXML package parts. */
export function inspectPdfTextDocx(bytes:Uint8Array):{
  paragraphCount:number;hasPageBreak:boolean;
}{
  if(bytes.length>PDF_OFFICE_TEXT_MAX_BYTES)throw new Error('DOCX archive too large.');
  const files=unzipSync(bytes);
  const keys=Object.keys(files);
  if(keys.length!==3||keys.some(name=>!['[Content_Types].xml','_rels/.rels','word/document.xml'].includes(name))){
    throw new Error('Unexpected DOCX archive member.');
  }
  for(const entry of Object.values(files)){
    if(entry.length>PDF_OFFICE_TEXT_MAX_BYTES)throw new Error('DOCX member exceeds safety limit.');
  }
  const decoded=new TextDecoder('utf-8',{fatal:true}).decode(files['word/document.xml']);
  if(!decoded.includes('<w:document xmlns:w=')||!decoded.includes('</w:document>')||
     !new TextDecoder().decode(files['[Content_Types].xml']).includes('officedocument.wordprocessingml.document.main+xml')||
     !new TextDecoder().decode(files['_rels/.rels']).includes('Target="word/document.xml"')){
    throw new Error('DOCX OpenXML package is incomplete.');
  }
  return {paragraphCount:decoded.split('<w:p>').length-1,hasPageBreak:decoded.includes('w:type="page"')};
}
