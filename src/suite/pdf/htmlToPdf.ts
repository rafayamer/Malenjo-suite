import {asciiSafe,renderOfflineTextLines,type TextLine} from './markdownToPdf';

/**
 * Intentionally restricted, offline HTML -> selectable-text PDF.
 * It parses an inert text/heading/list subset without DOM insertion, a WebView,
 * CSS, images, links, scripts or resource fetches. Unsupported markup is
 * rejected rather than silently dropping potentially meaningful content.
 */
export const HTML_TO_PDF_MAX_INPUT_BYTES=1024*1024;
export const HTML_TO_PDF_MAX_CHARS=250_000;
const permitted=new Set([
  'html','head','title','body','main','article','section','p','div',
  'span','strong','em','b','i','pre','code','ul','ol','li',
  'blockquote','h1','h2','h3','h4','h5','h6','br','hr',
]);
const blocks=new Set([
  'body','main','article','section','p','div','pre','ul','ol','li',
  'blockquote','h1','h2','h3','h4','h5','h6',
]);
function decodeEntities(value:string):string{
  const named:Record<string,string>={
    amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',
    ndash:'–',mdash:'—',hellip:'…',copy:'©',reg:'®',trade:'™',
  };
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]+);/gi,(_,item:string)=>{
    if(item.startsWith('#')){
      const hex=/^#x/i.test(item);
      const n=parseInt(item.slice(hex?2:1),hex?16:10);
      if(!Number.isInteger(n)||n<1||n>0x10ffff||
         (n>=0xd800&&n<=0xdfff)||n===0xfffe||n===0xffff){
        return '\uFFFD';
      }
      return String.fromCodePoint(n);
    }
    return named[item.toLowerCase()]??'&'+item+';';
  });
}
function isBlock(tag:string):boolean{return blocks.has(tag);}
function lineStyle(stack:string[]):TextLine['style']{
  for(let i=stack.length-1;i>=0;i--){
    const tag=stack[i];
    if(tag==='h1')return 'heading1';
    if(tag==='h2')return 'heading2';
    if(/^h[3-6]$/.test(tag))return 'heading3';
    if(tag==='li')return 'list';
    if(tag==='blockquote')return 'quote';
    if(tag==='pre'||tag==='code')return 'code';
  }
  return 'body';
}
export function parseOfflineHtml(source:Uint8Array):TextLine[]{
  if(!(source instanceof Uint8Array)||!source.length||
     source.length>HTML_TO_PDF_MAX_INPUT_BYTES){
    throw new Error('Offline HTML conversion requires a UTF-8 file of at most 1 MB.');
  }
  let text:string;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(source);}
  catch{throw new Error('HTML conversion requires valid UTF-8.');}
  if(text.length>HTML_TO_PDF_MAX_CHARS){
    throw new Error('HTML exceeds the 250,000-character source limit.');
  }
  const tokens=/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][a-z0-9]*\b[^>]*>|[^<]+/gi;
  const stack:string[]=[];
  const lines:TextLine[]=[];
  let pending='',pos=0,visible=0;
  const flush=()=>{
    const result=pending.trim();
    pending='';
    if(result)lines.push({text:asciiSafe(result),style:lineStyle(stack)});
    if(lines.length>10_000)throw new Error('HTML exceeds the 10,000-paragraph limit.');
  };
  for(const match of text.matchAll(tokens)){
    if(match.index!==pos)throw new Error('HTML has malformed markup or unsafe less-than syntax.');
    const token=match[0];pos+=token.length;
    if(token.startsWith('<!--'))continue;
    if(/^<!doctype html\s*>$/i.test(token))continue;
    if(token.startsWith('<!'))throw new Error('HTML declarations and external entities are not allowed.');
    if(token.startsWith('<')){
      const parts=/^<(\/?)([a-z][a-z0-9]*)([\s\S]*?)>$/i.exec(token);
      if(!parts)throw new Error('HTML tag is malformed.');
      const [,closing,name,extra]=parts;
      const tag=name.toLowerCase();
      if(!permitted.has(tag))throw new Error('HTML element <'+tag+'> requires a reviewed renderer.');
      // No attributes: blocks CSS, URL references, handlers and external files.
      if(extra.trim()&&extra.trim()!=='/'){
        throw new Error('HTML attributes, images, styling and external resources are not supported in offline text mode.');
      }
      if(tag==='br'||tag==='hr'){
        if(closing)throw new Error('Unexpected closing HTML void tag.');
        flush();
        if(tag==='hr')lines.push({text:'--------------------------------',style:'body'});
        continue;
      }
      if(closing){
        if(stack.at(-1)!==tag)throw new Error('HTML has mismatched or unclosed markup.');
        if(isBlock(tag))flush();
        stack.pop();
      }else{
        if(stack.length>=32)throw new Error('HTML nesting exceeds 32 levels.');
        if(isBlock(tag))flush();
        stack.push(tag);
      }
      continue;
    }
    // Head/title metadata isn't document body; never leak style or resource
    // declarations into the rendered text.
    if(stack.includes('head')||stack.includes('title'))continue;
    const value=decodeEntities(token);
    visible+=value.length;
    if(visible>HTML_TO_PDF_MAX_CHARS)throw new Error('HTML readable text exceeds 250,000 characters.');
    if(stack.includes('pre')){
      for(const [index,line] of value.replace(/\r\n?/g,'\n').split('\n').entries()){
        if(index)flush();
        pending+=line;
      }
    }else pending+=value.replace(/\s+/g,' ');
  }
  if(pos!==text.length||stack.length)throw new Error('HTML document has incomplete or unclosed markup.');
  flush();
  if(!lines.some(line=>line.text.trim())){
    throw new Error('HTML contains no safely convertible visible text.');
  }
  return lines;
}
export async function convertHtmlToPdf(source:Uint8Array):Promise<Uint8Array>{
  return renderOfflineTextLines(parseOfflineHtml(source),'HTML text document (offline)');
}
