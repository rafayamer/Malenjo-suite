import {asciiSafe,renderOfflineTextLines,type TextLine} from './markdownToPdf';

/**
 * Offline .eml -> searchable PDF for text/plain messages.
 * MIME attachments are refused, never executed or silently discarded.
 * HTML-only mail is refused rather than rendered with network access.
 */
export const EML_TO_PDF_MAX_BYTES=2*1024*1024;
export const EML_TO_PDF_MAX_PARTS=32;
export const EML_TO_PDF_MAX_TEXT_CHARS=250_000;

type Headers=Map<string,string>;
interface MimePart{headers:Headers;body:string}
function splitPart(raw:string):MimePart{
  const match=/\r?\n\r?\n/.exec(raw);
  if(!match)throw new Error('EML requires a complete RFC 5322 header and message body.');
  const block=raw.slice(0,match.index);
  if(block.length>64_000)throw new Error('EML header section exceeds 64 KB.');
  const result:Headers=new Map();
  let previous='';
  for(const row of block.split(/\r?\n/)){
    if(/^[ \t]/.test(row)){
      if(!previous)throw new Error('EML begins with a malformed folded header.');
      result.set(previous,result.get(previous)!+' '+row.trim());
      continue;
    }
    const found=/^([A-Za-z][A-Za-z0-9-]{0,80}):[ \t]*(.*)$/.exec(row);
    if(!found)throw new Error('EML has malformed mail headers.');
    previous=found[1].toLowerCase();
    // Duplicate sensitive MIME fields must not silently override each other.
    if(result.has(previous)&&['content-type','content-transfer-encoding','content-disposition','mime-version'].includes(previous)){
      throw new Error('EML contains ambiguous duplicate MIME headers.');
    }
    result.set(previous,found[2]);
  }
  return {headers:result,body:raw.slice(match.index+match[0].length)};
}
function mimeParam(value:string,name:string):string|null{
  const regex=new RegExp('(?:^|;)\\s*'+name+'\\s*=\\s*(?:"([^"]{1,120})"|([^;\\s]{1,120}))','i');
  const found=regex.exec(value);
  return found?(found[1]??found[2]):null;
}
function asBytes(encoded:string,transfer:string):Uint8Array{
  const method=transfer.trim().toLowerCase();
  if(!method||method==='7bit'||method==='8bit'||method==='binary'){
    return new TextEncoder().encode(encoded);
  }
  if(method==='base64'){
    const packed=encoded.replace(/[\r\n \t]/g,'');
    if(packed.length>4*EML_TO_PDF_MAX_BYTES/3+16||!packed.length||
       !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(packed)){
      throw new Error('EML has malformed or oversized base64 MIME content.');
    }
    try{return Uint8Array.from(atob(packed),character=>character.charCodeAt(0));}
    catch{throw new Error('EML contains invalid MIME base64 data.');}
  }
  if(method==='quoted-printable'){
    if(/=(?![A-Fa-f0-9]{2}|\r?\n)/.test(encoded)){
      throw new Error('EML has malformed quoted-printable content.');
    }
    const collapsed=encoded.replace(/=\r?\n/g,'');
    const output:number[]=[];
    for(let i=0;i<collapsed.length;i++){
      if(collapsed[i]==='='){
        output.push(parseInt(collapsed.slice(i+1,i+3),16));i+=2;
      }else{
        const code=collapsed.charCodeAt(i);
        if(code>127)throw new Error('Quoted-printable MIME body contains raw non-ASCII data.');
        output.push(code);
      }
      if(output.length>EML_TO_PDF_MAX_BYTES){
        throw new Error('EML decoded body exceeds 2 MB.');
      }
    }
    return Uint8Array.from(output);
  }
  throw new Error('Unsupported EML transfer encoding: '+method);
}
function decodePart(part:MimePart):string{
  const contentType=part.headers.get('content-type')??'text/plain; charset=utf-8';
  const charset=(mimeParam(contentType,'charset')??'utf-8').toLowerCase();
  if(!['utf-8','utf8','us-ascii','iso-8859-1'].includes(charset)){
    throw new Error('EML character set is not supported safely: '+charset);
  }
  const data=asBytes(part.body,part.headers.get('content-transfer-encoding')??'7bit');
  if(data.byteLength>EML_TO_PDF_MAX_BYTES)throw new Error('Decoded EML body is too large.');
  let value:string;
  try{value=new TextDecoder(charset==='utf8'?'utf-8':charset,{fatal:true}).decode(data);}
  catch{throw new Error('EML body has invalid text encoding.');}
  if(value.length>EML_TO_PDF_MAX_TEXT_CHARS){
    throw new Error('EML message body exceeds 250,000 characters.');
  }
  return value;
}
function extractText(part:MimePart,budget:{parts:number},depth=0):string|null{
  if(++budget.parts>EML_TO_PDF_MAX_PARTS||depth>4){
    throw new Error('EML exceeds the safe MIME part/depth limit.');
  }
  const disposition=part.headers.get('content-disposition')??'';
  if(/^\s*attachment\b/i.test(disposition)||/;\s*filename\*?\s*=/i.test(disposition)){
    throw new Error('EML contains an attachment; attachment-preserving conversion is not available.');
  }
  const type=(part.headers.get('content-type')??'text/plain').split(';',1)[0].trim().toLowerCase();
  if(type.startsWith('multipart/')){
    const boundary=mimeParam(part.headers.get('content-type')??'','boundary');
    if(!boundary||!/^[A-Za-z0-9'()+_,./:=?-]{1,70}$/.test(boundary)){
      throw new Error('EML multipart boundary is invalid.');
    }
    const delimiter='--'+boundary;
    const lines=part.body.replace(/\r\n/g,'\n').split('\n');
    const children:string[]=[];
    let open=false,ended=false,acc:string[]=[];
    for(const line of lines){
      if(line===delimiter||line===delimiter+'--'){
        if(open){children.push(acc.join('\n'));acc=[];}
        if(line===delimiter+'--'){ended=true;open=false;break;}
        open=true;continue;
      }
      if(open)acc.push(line);
    }
    if(!ended||!children.length)throw new Error('EML multipart body is incomplete.');
    let plain:string|null=null;
    for(const child of children){
      const result=extractText(splitPart(child),budget,depth+1);
      if(result!==null&&plain===null)plain=result;
      else if(result!==null&&type==='multipart/mixed'){
        // No silent loss of additional independent text body parts.
        throw new Error('Multiple MIME bodies require an explicit merge review.');
      }
    }
    return plain;
  }
  if(type==='text/html'){
    // HTML-only mail must not be rendered, since remote resources/scripts
    // and complex CSS cannot be safely preserved in this native fallback.
    return null;
  }
  if(type!=='text/plain'){
    throw new Error('EML includes unsupported MIME content: '+type);
  }
  return decodePart(part);
}
function safeHeader(value:string|undefined):string{
  if(!value)return '(not provided)';
  if(value.length>2048)throw new Error('EML message header is too large.');
  return asciiSafe(value.replace(/[\r\n\u0000-\u001f]+/g,' ').trim());
}
export function parseEmlPdfLines(bytes:Uint8Array):TextLine[]{
  if(!(bytes instanceof Uint8Array)||!bytes.byteLength||bytes.length>EML_TO_PDF_MAX_BYTES){
    throw new Error('EML to PDF accepts nonempty email files up to 2 MB.');
  }
  let raw:string;
  try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch{throw new Error('EML requires a valid UTF-8 or ASCII MIME envelope.');}
  const mail=splitPart(raw);
  const body=extractText(mail,{parts:0});
  if(!body?.trim())throw new Error('EML has no convertible text/plain body; HTML-only emails require a separate reviewed renderer.');
  const headerLines:TextLine[]=[
    {text:'Email message',style:'heading1'},
    ...(['from','to','date','subject'] as const).map(name=>({
      text:name[0].toUpperCase()+name.slice(1)+': '+safeHeader(mail.headers.get(name)),
      style:'body' as const,
    })),
    {text:'',style:'body'},
    {text:'Message',style:'heading2'},
  ];
  const bodyLines:TextLine[]=body.replace(/\r\n?/g,'\n').split('\n')
    .map(line=>({text:asciiSafe(line),style:'body' as const}));
  return [...headerLines,...bodyLines];
}
export async function convertEmlToPdf(bytes:Uint8Array):Promise<Uint8Array>{
  return renderOfflineTextLines(parseEmlPdfLines(bytes),'Email message (offline text-only)');
}
