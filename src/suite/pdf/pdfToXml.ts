import type {PDFDocumentProxy} from 'pdfjs-dist';
import type {PdfDocumentInfo} from './pdfInfo';
import {exportPdfStructuredJson,type PdfStructuredJson} from './pdfToJson';

/**
 * Read-only XML representation of the bounded local selectable-text export.
 * This is not an object-level PDF-to-XML converter: it deliberately excludes
 * images, graphics, XMP, annotations and PDF reading-order guarantees.
 */
export const PDF_XML_MAX_OUTPUT_BYTES=16_000_000;

function xmlEscape(value:string):string{
  let result='';
  for(const character of value){
    const code=character.codePointAt(0)!;
    // XML 1.0 disallows most C0 controls and unpaired surrogates.
    // Replace them visibly rather than emitting an invalid XML document.
    if((code<0x20&&code!==0x09&&code!==0x0a&&code!==0x0d)||
       (code>=0xd800&&code<=0xdfff)||code===0xfffe||code===0xffff){
      result+='\uFFFD';
    }else if(character==='&')result+='&amp;';
    else if(character==='<')result+='&lt;';
    else if(character==='>')result+='&gt;';
    // Preserve literal whitespace in XML attributes and content on reparse.
    else if(character==='\r')result+='&#13;';
    else if(character==='\n')result+='&#10;';
    else if(character==='\t')result+='&#9;';
    else if(character==='"')result+='&quot;';
    else if(character==="'")result+='&apos;';
    else result+=character;
  }
  return result;
}

export function serializePdfStructuredXml(data:PdfStructuredJson):Uint8Array{
  const lines=[
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<malenjo-pdf schema-version="1" extraction="local-selectable-text" page-count="'+data.pageCount+'">',
    '  <metadata>',
  ];
  const fields=[
    'title','author','subject','keywords','creator','producer','createdAt','modifiedAt',
  ] as const;
  for(const field of fields){
    const value=data.metadata[field];
    if(value!==null&&value!==undefined){
      lines.push('    <'+field+'>'+xmlEscape(value)+'</'+field+'>');
    }
  }
  lines.push('  </metadata>','  <pages>');
  for(const page of data.pages){
    lines.push(
      '    <page number="'+page.page+'" width-pt="'+page.widthPt+
      '" height-pt="'+page.heightPt+'" rotation-degrees="'+page.rotationDegrees+
      '" selectable-text-items="'+page.selectableTextItems+'">',
      '      <text xml:space="preserve">'+xmlEscape(page.text)+'</text>',
      '    </page>',
    );
  }
  lines.push('  </pages>','  <bookmarks>');
  for(const bookmark of data.bookmarks){
    lines.push('    <bookmark depth="'+bookmark.depth+'" title="'+xmlEscape(bookmark.title)+'"/>');
  }
  lines.push(
    '  </bookmarks>',
    '  <warning>'+xmlEscape(data.warning)+' XML-invalid characters are replaced with U+FFFD.</warning>',
    '</malenjo-pdf>',
    '',
  );
  const bytes=new TextEncoder().encode(lines.join('\n'));
  if(bytes.byteLength>PDF_XML_MAX_OUTPUT_BYTES){
    throw new Error('PDF to XML output exceeds the 16 MB safety limit.');
  }
  return bytes;
}

/** PDF.js text/outline reads and pdf-lib metadata reads happen locally. */
export async function exportPdfStructuredXml(
  document:Pick<PDFDocumentProxy,'numPages'|'getPage'|'getOutline'>,
  info:PdfDocumentInfo,
  options:{signal?:AbortSignal;onProgress?:(done:number,total:number)=>void}={},
):Promise<Uint8Array>{
  const jsonBytes=await exportPdfStructuredJson(document,info,options);
  if(options.signal?.aborted){
    const error=new Error('PDF to XML export cancelled.');
    error.name='AbortError';
    throw error;
  }
  const extracted=JSON.parse(new TextDecoder().decode(jsonBytes)) as PdfStructuredJson;
  return serializePdfStructuredXml(extracted);
}
