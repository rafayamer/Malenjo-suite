import {unzipSync,unzlibSync} from 'fflate';
import {PDFDocument} from 'pdf-lib';
import {loadPdfBytes,disposePdf} from './engine';
import type {PdfProviderOperation,PdfProviderResponse} from './backend';
import {classifyPdfProviderResult,type PdfProviderResultAction} from './providerResultGuard';

/** Source-pinned workflow selectors: availability is determined solely from live
 * OpenAPI and component-gated capabilities, NEVER the presence of a manifest row.
 * Separate Windows and output/reopen acceptance remains required.
 */
export type PdfBatchOutput='pdf'|'copy'|'zip'|'image'|'csv';
export interface PdfBatchWorkflow{id:string;label:string;path:string;output:PdfBatchOutput}
export const PDF_TWENTY_WORKFLOWS:readonly PdfBatchWorkflow[]=[
  {id:'crop',label:'Crop pages',path:'/api/v1/general/crop',output:'pdf'},
  {id:'scale-pages',label:'Scale pages',path:'/api/v1/general/scale-pages',output:'pdf'},
  {id:'pdf-to-single-page',label:'Single large page',path:'/api/v1/general/pdf-to-single-page',output:'pdf'},
  {id:'multi-page-layout',label:'Multi-page layout',path:'/api/v1/general/multi-page-layout',output:'pdf'},
  {id:'overlay-pdf',label:'Overlay PDF',path:'/api/v1/general/overlay-pdfs',output:'pdf'},
  {id:'split-pdf-by-sections',label:'Split sections',path:'/api/v1/general/split-pdf-by-sections',output:'zip'},
  {id:'split-pdf-by-chapters',label:'Split chapters',path:'/api/v1/general/split-pdf-by-chapters',output:'zip'},
  {id:'auto-split-pdf',label:'Auto split',path:'/api/v1/misc/auto-split-pdf',output:'zip'},
  {id:'pdf-to-img',label:'PDF to images',path:'/api/v1/convert/pdf/img',output:'image'},
  {id:'pdf-to-csv',label:'PDF to CSV',path:'/api/v1/convert/pdf/csv',output:'csv'},
  {id:'add-password',label:'Add password',path:'/api/v1/security/add-password',output:'copy'},
  {id:'remove-password',label:'Remove password',path:'/api/v1/security/remove-password',output:'pdf'},
  {id:'add-stamp',label:'Add stamp',path:'/api/v1/misc/add-stamp',output:'pdf'},
  {id:'sanitize-pdf',label:'Sanitize copy',path:'/api/v1/security/sanitize-pdf',output:'copy'},
  {id:'extract-images',label:'Extract images',path:'/api/v1/misc/extract-images',output:'image'},
  {id:'remove-image-pdf',label:'Remove images',path:'/api/v1/general/remove-image-pdf',output:'pdf'},
  {id:'remove-blanks',label:'Remove blank pages',path:'/api/v1/misc/remove-blanks',output:'pdf'},
  {id:'repair',label:'Repair PDF',path:'/api/v1/misc/repair',output:'pdf'},
  {id:'add-image',label:'Add image',path:'/api/v1/misc/add-image',output:'pdf'},
  {id:'compress-pdf',label:'Compress PDF',path:'/api/v1/misc/compress-pdf',output:'pdf'},
];
export function findPdfBatchOperation(
  workflow:PdfBatchWorkflow, live:readonly PdfProviderOperation[],
):PdfProviderOperation|null{
  const matches=live.filter(item=>item.method==='POST'&&item.path===workflow.path);
  return matches.length===1?matches[0]:null;
}
function isZip(bytes:number[]):boolean{
  return bytes.length>=4&&bytes[0]===80&&bytes[1]===75&&
    ((bytes[2]===3&&bytes[3]===4)||(bytes[2]===5&&bytes[3]===6)||(bytes[2]===7&&bytes[3]===8));
}
const MAX_ZIP_BYTES=32*1024*1024;
const MAX_EXTRACTED_BYTES=128*1024*1024;
function imageMemberIsComplete(bytes:Uint8Array):boolean{
  // PNG only until JPEG/TIFF can be validated by a complete decoder.
  // Rejecting unsupported members is safer than exporting corrupt archives.
  if(bytes.length<57||![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return false;
  const uint=(pos:number)=>((bytes[pos]*0x1000000)+(bytes[pos+1]<<16)+(bytes[pos+2]<<8)+bytes[pos+3])>>>0;
  const crc=(begin:number,end:number)=>{
    let c=0xffffffff;
    for(let i=begin;i<end;i++){c^=bytes[i];for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}
    return (c^0xffffffff)>>>0;
  };
  let pos=8,seenHeader=false,seenImage=false,seenEnd=false,seenPalette=false,width=0,height=0,depth=0,color=0,channels=0;
  const payload:Uint8Array[]=[];
  while(pos+12<=bytes.length&&!seenEnd){
    const length=uint(pos),end=pos+12+length;
    if(length>MAX_EXTRACTED_BYTES||end>bytes.length)return false;
    const type=String.fromCharCode(...bytes.subarray(pos+4,pos+8));
    if(crc(pos+4,pos+8+length)!==uint(pos+8+length))return false;
    if(type==='IHDR'){
      if(seenHeader||pos!==8||length!==13)return false;
      width=uint(pos+8);height=uint(pos+12);
      depth=bytes[pos+16];color=bytes[pos+17];
      const validDepths:Record<number,number[]>={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
      if(!validDepths[color]?.includes(depth)||bytes[pos+18]!==0||bytes[pos+19]!==0||bytes[pos+20]!==0)return false;
      channels=color===0?1:color===2?3:color===4?2:4;
      if(!width||!height||width>32768||height>32768)return false;
      seenHeader=true;
    }else if(type==='PLTE'){
      if(!seenHeader||seenImage||seenPalette||color===0||color===4||length<3||length>768||length%3!==0)return false;
      if(color===3&&length/3>2**depth)return false;
      seenPalette=true;
    }else if(type==='IDAT'){
      if(!seenHeader||seenEnd||(color===3&&!seenPalette))return false;
      payload.push(bytes.subarray(pos+8,pos+8+length));seenImage=true;
    }else if(type==='IEND'){
      if(!seenHeader||!seenImage||length!==0)return false;
      seenEnd=true;
    }else if(!seenHeader||type[0]===type[0].toUpperCase())return false;
    pos=end;
  }
  if(!seenEnd||pos!==bytes.length)return false;
  const rowBytes=Math.ceil(width*channels*depth/8);
  const expected=(rowBytes+1)*height;
  if(expected>MAX_EXTRACTED_BYTES)return false;
  const compressed=new Uint8Array(payload.reduce((n,x)=>n+x.length,0));
  let offset=0;for(const block of payload){compressed.set(block,offset);offset+=block.length;}
  try{
    const decoded=unzlibSync(compressed,{out:new Uint8Array(expected)});
    if(decoded.length!==expected)return false;
    for(let y=0;y<height;y++)if(decoded[y*(rowBytes+1)]>4)return false;
    return true;
  }catch{return false;}
}


/** Validate the complete marker envelope and scan bounds of common JPEG files. */
function jpegIsComplete(bytes:Uint8Array):boolean{
  if(bytes.length<32||bytes[0]!==255||bytes[1]!==216)return false;
  let pos=2,hasFrame=false,hasScan=false,scanBytes=0,frameComponents=0;
  while(pos<bytes.length){
    if(bytes[pos++]!==255)return false;
    while(pos<bytes.length&&bytes[pos]===255)pos++;
    if(pos>=bytes.length)return false;
    const marker=bytes[pos++];
    if(marker===217)return pos===bytes.length&&hasFrame&&hasScan&&scanBytes>0;
    if(marker===216||marker===0||(marker>=208&&marker<=215))return false;
    if(marker===1)continue;
    if(pos+2>bytes.length)return false;
    const length=bytes[pos]*256+bytes[pos+1];
    if(length<2||pos+length>bytes.length)return false;
    if((marker>=192&&marker<=207)&&![196,200,204].includes(marker)){
      if(length<11)return false;
      const componentCount=bytes[pos+7];
      if(componentCount<1||componentCount>4||length!==8+3*componentCount)return false;
      const height=bytes[pos+3]*256+bytes[pos+4];
      const width=bytes[pos+5]*256+bytes[pos+6];
      if(!width||!height||width>32768||height>32768)return false;
      hasFrame=true;frameComponents=componentCount;
    }
    if(marker===218){
      const scanComponents=bytes[pos+2];
      if(!hasFrame||length<8||scanComponents<1||scanComponents>frameComponents||length!==6+2*scanComponents)return false;
      hasScan=true;pos+=length;
      while(pos<bytes.length){
        if(bytes[pos]!==255){scanBytes++;pos++;continue;}
        if(pos+1>=bytes.length)return false;
        const next=bytes[pos+1];
        if(next===0||(next>=208&&next<=215)){scanBytes++;pos+=2;continue;}
        break;
      }
    }else pos+=length;
  }
  return false;
}
/** Validate standard TIFF IFDs, dimensions and on-disk strip/tile extents. */
function tiffIsComplete(bytes:Uint8Array):boolean{
  if(bytes.length<40)return false;
  const le=bytes[0]===73&&bytes[1]===73;
  if(!le&&!(bytes[0]===77&&bytes[1]===77))return false;
  const u16=(p:number)=>p+2<=bytes.length?(le?bytes[p]+bytes[p+1]*256:bytes[p]*256+bytes[p+1]):-1;
  const u32=(p:number)=>p+4<=bytes.length?(le?
    (bytes[p]+bytes[p+1]*256+bytes[p+2]*65536+bytes[p+3]*16777216)>>>0:
    (bytes[p]*16777216+bytes[p+1]*65536+bytes[p+2]*256+bytes[p+3])>>>0):-1;
  if(u16(2)!==42)return false;
  let offset=u32(4),pages=0;
  const seen=new Set<number>();
  while(offset!==0){
    if(offset<8||seen.has(offset)||++pages>100||offset+6>bytes.length)return false;
    seen.add(offset);
    const count=u16(offset),end=offset+2+count*12;
    if(count<=0||count>4096||end+4>bytes.length)return false;
    const tags=new Map<number,number[]>();
    for(let i=0;i<count;i++){
      const p=offset+2+i*12,tag=u16(p),type=u16(p+2),items=u32(p+4);
      if(![3,4].includes(type)||items<=0||items>8192)continue;
      const unit=type===3?2:4,span=unit*items;
      const start=span<=4?p+8:u32(p+8);
      if(start<0||start+span>bytes.length)return false;
      if([256,257,258,259,273,277,278,279,284,324,325].includes(tag)){
        const values:number[]=[];
        for(let j=0;j<items;j++)values.push(type===3?u16(start+j*2):u32(start+j*4));
        tags.set(tag,values);
      }
    }
    const width=tags.get(256)?.[0],height=tags.get(257)?.[0];
    if(!width||!height||width>32768||height>32768)return false;
    const compression=tags.get(259)?.[0]??1;
    const samples=tags.get(277)?.[0]??1;
    const planar=tags.get(284)?.[0]??1;
    const bits=tags.get(258)??[1];
    if(samples<1||samples>8||![1,2].includes(planar)||bits.some(v=>![1,2,4,8,16,32].includes(v)))return false;
    // Without a dedicated codec, compressed TIFF integrity is not provable.
    // Reject it rather than accepting byte ranges as decoded raster evidence.
    if(compression!==1)return false;
    const rowBits=planar===1?bits.reduce((a,b)=>a+b,0)*width:
      bits.reduce((a,b)=>a+Math.ceil(width*b/8)*8,0);
    const requiredRaster=Math.ceil(rowBits/8)*height;
    if(!Number.isSafeInteger(requiredRaster)||requiredRaster>MAX_EXTRACTED_BYTES)return false;
    const offsets=tags.get(273)??tags.get(324);
    const counts=tags.get(279)??tags.get(325);
    if(!offsets||!counts||offsets.length!==counts.length||offsets.length>8192)return false;
    let written=0;
    for(let i=0;i<offsets.length;i++){
      if(!counts[i]||offsets[i]<8||offsets[i]+counts[i]>bytes.length)return false;
      written+=counts[i];
    }
    if(written<requiredRaster)return false;
    offset=u32(end);
    if(offset<0)return false;
  }
  return pages>0;
}
function verifiedImage(bytes:Uint8Array):boolean{
  return imageMemberIsComplete(bytes)||jpegIsComplete(bytes)||tiffIsComplete(bytes);
}

export async function verifyPdfBatchZip(bytes:number[],kind:'pdf'|'image'='pdf'):Promise<void>{
  if(bytes.length>MAX_ZIP_BYTES)throw new Error('ZIP export exceeds 32 MB inspection limit.');
  let total=0,files=0;
  let archive:Record<string,Uint8Array>;
  try{
    archive=unzipSync(Uint8Array.from(bytes),{
      filter:(file)=>{
        if(file.name.endsWith('/'))return false;
        if(kind==='pdf'?!file.name.toLowerCase().endsWith('.pdf'):!/(\.png|\.jpe?g|\.tiff?)$/.test(file.name.toLowerCase()))throw new Error('Archive contains an unexpected file type.');
        if(file.originalSize<=0||file.originalSize>MAX_EXTRACTED_BYTES-total){
          throw new Error('Archive extraction exceeds 128 MB budget.');
        }
        total+=file.originalSize;
        files++;
        if(files>2000)throw new Error('Archive contains too many PDF files.');
        return true;
      },
    });
  }catch(reason){
    throw new Error('PDF ZIP export is invalid or unsafe: '+(reason instanceof Error?reason.message:String(reason)));
  }
  const entries=Object.values(archive);
  if(!entries.length||entries.length!==files)throw new Error('ZIP export contains no valid entries.');
  for(const entry of entries){
    if(kind==='pdf'){
      try{const doc=await PDFDocument.load(entry,{ignoreEncryption:false,updateMetadata:false});if(doc.getPageCount()<1)throw new Error('Empty PDF');}
      catch{throw new Error('ZIP export contains a damaged or unreadable PDF.');}
    }else if(!verifiedImage(entry))throw new Error('Image ZIP export contains an incomplete or unsupported image.');
  }
}
function isImage(bytes:number[]):boolean{
  const png=bytes.length>=8&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b);
  const jpg=bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const tiff=bytes.length>=4&&((bytes[0]===73&&bytes[1]===73&&bytes[2]===42&&bytes[3]===0)||
    (bytes[0]===77&&bytes[1]===77&&bytes[2]===0&&bytes[3]===42));
  return png||jpg||tiff;
}
/** Validate provider bytes, not just its claimed MIME or HTTP status.
 * Header checks are a preflight, not a substitute for PDF/ZIP reopening.
 */
export async function classifyPdfBatchOutput(
  workflow:PdfBatchWorkflow, response:PdfProviderResponse,
  isPdf:(response:PdfProviderResponse)=>boolean,
):Promise<PdfProviderResultAction>{
  const generic=classifyPdfProviderResult(response,workflow.path,isPdf);
  const pdf=isPdf(response);
  if(workflow.output==='pdf'||workflow.output==='copy'){
    if(!pdf)throw new Error(workflow.label+' returned non-PDF data; original preserved.');
    if(workflow.output==='copy'){
      const data=Uint8Array.from(response.bytes);
      if(workflow.id==='sanitize-pdf'){
        try{
          const parsed=await PDFDocument.load(data,{ignoreEncryption:false,updateMetadata:false});
          if(parsed.getPageCount()<1)throw new Error('empty document');
        }catch{throw new Error('Sanitized PDF output cannot be reopened.');}
      }else if(workflow.id==='add-password'){
        // An encrypted PDF cannot be opened normally by pdf-lib. PDF.js parses
        // the complete cross-reference/Encrypt structure before requesting
        // a password; a plain header or corrupt file must never pass.
        let encrypted=false;
        try{
          const opened=await loadPdfBytes(data);
          await disposePdf(opened);
        }catch(reason){
          const error=reason as {name?:string;code?:number};
          if(error?.name==='PasswordException'&&error?.code===1)encrypted=true;
          else throw new Error('Protected PDF output is unreadable or damaged.');
        }
        if(!encrypted)throw new Error('Password protection was not verified on the provider output.');
      }
      return 'save-pdf-copy';
    }
    return 'apply-pdf';
  }
  if(pdf)throw new Error(workflow.label+' unexpectedly returned PDF data; original preserved.');
  if(workflow.output==='zip'){
    if(!isZip(response.bytes))throw new Error(workflow.label+' did not return ZIP data.');
    await verifyPdfBatchZip(response.bytes,'pdf');
  }
  if(workflow.output==='image'&&isZip(response.bytes))await verifyPdfBatchZip(response.bytes,'image');
  if(workflow.output==='image'&&!isZip(response.bytes)&&!verifiedImage(Uint8Array.from(response.bytes))){
    throw new Error('Image export contains an incomplete or unsupported image.');
  }
  if(workflow.output==='csv'){
    if(/text\/html|application\/json|application\/pdf/i.test(response.contentType??'')){
      throw new Error('CSV export returned an unexpected content type.');
    }
    try{
      const text=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(response.bytes));
      if(text.includes('\u0000'))throw new Error('binary');
    }catch{throw new Error('CSV export is not valid UTF-8 text.');}
  }
  if(generic!=='save-file')throw new Error('An export workflow must never mutate the open document.');
  return 'save-file';
}
