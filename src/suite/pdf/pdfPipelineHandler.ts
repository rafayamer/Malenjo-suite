import {PDFDocument} from 'pdf-lib';
import {parseOfflinePdfPipeline,runOfflinePdfPipeline} from './pdfOfflinePipeline';

/**
 * MALENJO-owned binary pipeline transport. This deliberately does NOT call
 * the disabled Stirling /api/v1/pipeline/handleData Java endpoint. It is a
 * narrow in-process alternative for PDF page organization (rotate/delete/
 * move), with typed binary input, explicit content type and no HTTP or JS
 * evaluation. The user must invoke it for an open working PDF.
 */
export const LOCAL_PDF_PIPELINE_PROTOCOL='malenjo.pdf.pipeline.v1';
export interface LocalPdfPipelineInput{
  protocol:typeof LOCAL_PDF_PIPELINE_PROTOCOL;
  filename:string;
  contentType:'application/pdf';
  bytes:Uint8Array;
  planJson:string;
}
export interface LocalPdfPipelineOutput{
  protocol:typeof LOCAL_PDF_PIPELINE_PROTOCOL;
  filename:string;
  contentType:'application/pdf';
  bytes:Uint8Array;
  stepsExecuted:number;
  originalPageCount:number;
  resultPageCount:number;
}
function safeFilename(value:string):string{
  if(typeof value!=='string'||!value.length||value.length>180||
     /[/\\\u0000-\u001f\u007f]/.test(value)||
     !/\.pdf$/i.test(value)||value==='.'||value==='..'){
    throw new Error('Local PDF pipeline requires a safe .pdf input filename.');
  }
  return value;
}
export async function handleLocalPdfPipelineData(input:LocalPdfPipelineInput):Promise<LocalPdfPipelineOutput>{
  if(!input||input.protocol!==LOCAL_PDF_PIPELINE_PROTOCOL||
     input.contentType!=='application/pdf'){
    throw new Error('Unsupported MALENJO local PDF pipeline protocol or MIME type.');
  }
  const filename=safeFilename(input.filename);
  if(!(input.bytes instanceof Uint8Array)||input.bytes.length<5||
     input.bytes.length>32*1024*1024){
    throw new Error('Local PDF pipeline requires a nonempty PDF up to 32 MB.');
  }
  const steps=parseOfflinePdfPipeline(input.planJson);
  const original=await PDFDocument.load(input.bytes,{ignoreEncryption:false,updateMetadata:false});
  const originalPageCount=original.getPageCount();
  const output=await runOfflinePdfPipeline(input.bytes,steps);
  const reopened=await PDFDocument.load(output,{ignoreEncryption:false,updateMetadata:false});
  if(reopened.getPageCount()<1||reopened.getPageCount()>originalPageCount){
    throw new Error('Local PDF pipeline returned an unexpected page count.');
  }
  return {
    protocol:LOCAL_PDF_PIPELINE_PROTOCOL,
    filename:filename.replace(/\.pdf$/i,'')+'-pipeline.pdf',
    contentType:'application/pdf',
    bytes:output,
    stepsExecuted:steps.length,
    originalPageCount,
    resultPageCount:reopened.getPageCount(),
  };
}
