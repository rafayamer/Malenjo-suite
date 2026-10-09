import {unzipSync} from 'fflate';
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
export function verifyPdfBatchZip(bytes:number[]):void{
  if(bytes.length>MAX_ZIP_BYTES)throw new Error('ZIP export exceeds 32 MB inspection limit.');
  let total=0,files=0;
  let archive:Record<string,Uint8Array>;
  try{
    archive=unzipSync(Uint8Array.from(bytes),{
      filter:(file)=>{
        if(file.name.endsWith('/'))return false;
        if(!file.name.toLowerCase().endsWith('.pdf'))throw new Error('Archive contains a non-PDF member.');
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
  if(!entries.length||entries.length!==files||entries.some(v=>v.length<5||v[0]!==37||v[1]!==80||v[2]!==68||v[3]!==70||v[4]!==45)){
    throw new Error('PDF ZIP export contains no valid PDF entries.');
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
export function classifyPdfBatchOutput(
  workflow:PdfBatchWorkflow, response:PdfProviderResponse,
  isPdf:(response:PdfProviderResponse)=>boolean,
):PdfProviderResultAction{
  const generic=classifyPdfProviderResult(response,workflow.path,isPdf);
  const pdf=isPdf(response);
  if(workflow.output==='pdf'||workflow.output==='copy'){
    if(!pdf)throw new Error(workflow.label+' returned non-PDF data; original preserved.');
    return workflow.output==='copy'?'save-pdf-copy':'apply-pdf';
  }
  if(pdf)throw new Error(workflow.label+' unexpectedly returned PDF data; original preserved.');
  if(workflow.output==='zip'){
    if(!isZip(response.bytes))throw new Error(workflow.label+' did not return ZIP data.');
    verifyPdfBatchZip(response.bytes);
  }
  if(workflow.output==='image'&&!isZip(response.bytes)&&!isImage(response.bytes)){
    throw new Error(workflow.label+' did not return a supported image/ZIP export.');
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
