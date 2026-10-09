import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';

/**
 * Offline, resource-free Markdown -> PDF renderer. Recognizes headings,
 * paragraphs, ordered/unordered bullets, quotations and fenced code blocks.
 * No HTML interpreter, local file access, image fetch, remote URLs or JS.
 * Unsupported glyphs become explicit Unicode escape sequences instead of
 * disappearing or crashing pdf-lib's bundled WinAnsi fonts.
 */
export const MARKDOWN_TO_PDF_MAX_INPUT_BYTES=2*1024*1024;
export const MARKDOWN_TO_PDF_MAX_CHARACTERS=500_000;
export const MARKDOWN_TO_PDF_MAX_PAGES=100;
export const MARKDOWN_TO_PDF_MAX_OUTPUT_BYTES=16*1024*1024;
type LineStyle='body'|'heading1'|'heading2'|'heading3'|'list'|'code'|'quote';
export interface TextLine{text:string;style:LineStyle}
export function asciiSafe(input:string):string{
  let text='';
  for(let i=0;i<input.length;i++){
    const code=input.charCodeAt(i);
    if(code===9){text+='    ';continue;}
    if(code===0||code===0x7f||code<32||code>126){
      text+='\\u'+code.toString(16).padStart(4,'0');
    }else text+=input[i];
  }
  return text;
}
export function parseOfflineMarkdown(source:Uint8Array):TextLine[]{
  if(!source.length||source.length>MARKDOWN_TO_PDF_MAX_INPUT_BYTES){
    throw new Error('Markdown conversion supports nonempty UTF-8 files up to 2 MB.');
  }
  let text:string;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(source);}
  catch{throw new Error('Markdown conversion requires valid UTF-8.');}
  if(text.length>MARKDOWN_TO_PDF_MAX_CHARACTERS){
    throw new Error('Markdown input exceeds the 500,000-character limit.');
  }
  const output:TextLine[]=[];
  let fenced=false;
  const fence=new RegExp('^(?:'+String.fromCharCode(96)+'{3,}|~{3,})');
  for(const original of text.replace(/\r\n?/g,'\n').split('\n')){
    const trim=original.trim();
    if(fence.test(trim)){fenced=!fenced;continue;}
    if(!trim){output.push({text:'',style:'body'});continue;}
    if(fenced){output.push({text:asciiSafe(original),style:'code'});continue;}
    const heading=original.match(/^ {0,3}(#{1,6})\s+(.+)$/);
    if(heading){
      const style:LineStyle=heading[1].length===1?'heading1':
        heading[1].length===2?'heading2':'heading3';
      output.push({text:asciiSafe(heading[2]),style});continue;
    }
    if(/^ {0,3}(?:[-*_]\s*){3,}$/.test(original)){
      output.push({text:'-'.repeat(45),style:'body'});continue;
    }
    const list=original.match(/^ {0,8}([-*+]|\d{1,3}[.)])\s+(.+)$/);
    if(list){output.push({text:asciiSafe(list[1]+' '+list[2]),style:'list'});continue;}
    const quote=original.match(/^ {0,3}>\s?(.*)$/);
    if(quote){output.push({text:asciiSafe('| '+quote[1]),style:'quote'});continue;}
    output.push({text:asciiSafe(original),style:'body'});
  }
  if(!output.some(line=>line.text.trim())){
    throw new Error('Markdown input has no visible content to render.');
  }
  return output;
}
export async function renderOfflineTextLines(
  lines:readonly TextLine[],title='Markdown report',
):Promise<Uint8Array>{
  const doc=await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator('MALENJO offline Markdown to PDF');
  const body=await doc.embedFont(StandardFonts.Helvetica);
  const bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const mono=await doc.embedFont(StandardFonts.Courier);
  const pageWidth=612,pageHeight=792,margin=42;
  let page=doc.addPage([pageWidth,pageHeight]);
  let y=pageHeight-margin;
  const pageBreak=()=>{
    if(doc.getPageCount()>=MARKDOWN_TO_PDF_MAX_PAGES){
      throw new Error('Markdown output exceeds the 100-page safety limit.');
    }
    page=doc.addPage([pageWidth,pageHeight]);y=pageHeight-margin;
  };
  for(const line of lines){
    const size=line.style==='heading1'?18:line.style==='heading2'?15:
      line.style==='heading3'?12:line.style==='code'?9:10;
    const font=line.style.startsWith('heading')?bold:
      line.style==='code'?mono:body;
    const spacing=line.style==='heading1'?7:line.style==='heading2'?6:4;
    const leading=size+4;
    if(!line.text){y-=leading*0.45;if(y<margin+leading)pageBreak();continue;}
    const words=line.text.split(/(\s+)/).filter(Boolean);
    const wrapped:string[]=[];
    let current='';
    for(const token of words){
      const fits=(candidate:string)=>
        font.widthOfTextAtSize(candidate,size)<=pageWidth-2*margin;
      if(fits(current+token)){
        current+=token;continue;
      }
      if(current.trim()){wrapped.push(current.trimEnd());current='';}
      if(fits(token)){current=token.trimStart();continue;}
      let fragment='';
      for(const char of token){
        if(fragment&&!fits(fragment+char)){
          wrapped.push(fragment);
          fragment='';
        }
        fragment+=char;
      }
      current=fragment;
    }
    if(current.trim())wrapped.push(current.trimEnd());
    for(const segment of wrapped){
      if(y<margin+leading)pageBreak();
      page.drawText(segment,{x:margin,y,size,font,color:rgb(0.12,0.14,0.2)});
      y-=leading;
    }
    y-=spacing;
  }
  const result=Uint8Array.from(await doc.save());
  if(result.length>MARKDOWN_TO_PDF_MAX_OUTPUT_BYTES){
    throw new Error('Markdown PDF exceeds the 16 MB output safety limit.');
  }
  const reopened=await PDFDocument.load(result,{updateMetadata:false});
  if(!reopened.getPageCount()||reopened.getPageCount()>MARKDOWN_TO_PDF_MAX_PAGES){
    throw new Error('Markdown PDF output could not be reopened safely.');
  }
  return result;
}

export async function convertMarkdownToPdf(source:Uint8Array):Promise<Uint8Array>{
  return renderOfflineTextLines(parseOfflineMarkdown(source));
}
