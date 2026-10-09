import {asciiSafe,renderOfflineTextLines,type TextLine} from './markdownToPdf';

/**
 * Offline UTF-8 .txt -> searchable PDF pages. Treat input as literal text,
 * never Markdown or HTML. Non-WinAnsi glyphs are represented by visible
 * reversible escape sequences; no network or installed Office is required.
 */
export const TEXT_TO_PDF_MAX_INPUT_BYTES=2*1024*1024;
export const TEXT_TO_PDF_MAX_CHARACTERS=500_000;
export function parsePlainPdfLines(input:Uint8Array):TextLine[]{
  if(!(input instanceof Uint8Array)||input.length<1||
     input.length>TEXT_TO_PDF_MAX_INPUT_BYTES){
    throw new Error('Plain text to PDF requires a UTF-8 file of at most 2 MB.');
  }
  let source:string;
  try{source=new TextDecoder('utf-8',{fatal:true}).decode(input);}
  catch{throw new Error('Plain text to PDF requires valid UTF-8.');}
  if(source.length>TEXT_TO_PDF_MAX_CHARACTERS){
    throw new Error('Plain text to PDF exceeds the 500,000-character safety limit.');
  }
  const lines=source.replace(/\r\n?/g,'\n')
    .split('\n').map(line=>({text:asciiSafe(line),style:'body' as const}));
  if(!lines.some(line=>line.text.trim())){
    throw new Error('Plain text input has no printable content.');
  }
  return lines;
}
export async function convertPlainTextToPdf(input:Uint8Array):Promise<Uint8Array>{
  return renderOfflineTextLines(parsePlainPdfLines(input),'Plain text document');
}
