import type {PdfProviderOperationField} from './backend';

/** The desktop IPC currently serializes Uint8Array as number[] (not streams).
 * Keep UI uploads substantially below the native 512 MB limit so the JS
 * representation and duplicated Tauri payload do not exhaust renderer memory.
 */
export const PDF_PROVIDER_RENDERER_UPLOAD_LIMIT=32*1024*1024;
export function validatePdfUploadPlan(
  uploads:readonly {name:string;size:number}[],
  currentPdfBytes=0,
):void{
  if(!Number.isSafeInteger(currentPdfBytes)||currentPdfBytes<0){
    throw new Error('The current PDF has an invalid size.');
  }
  if(uploads.length>64)throw new Error('Select at most 64 files per local PDF request.');
  let total=currentPdfBytes;
  for(const input of uploads){
    if(!Number.isSafeInteger(input.size)||input.size<0){
      throw new Error('PDF upload file sizes must be finite nonnegative integers.');
    }
    if(input.name.length>512||!input.name.trim()){
      throw new Error('PDF upload file has an invalid name.');
    }
    total+=input.size;
    if(!Number.isSafeInteger(total)||total>PDF_PROVIDER_RENDERER_UPLOAD_LIMIT){
      throw new Error('The current PDF and uploaded files exceed the 32 MB safe renderer upload limit. Use a native streaming workflow for larger inputs.');
    }
  }
}
export function validatePdfOperationValue(
  field:PdfProviderOperationField,
  value:string,
):void{
  if(field.kind==='file'||field.kind==='files')return;
  if(field.required&&!value.trim())throw new Error(field.label+' is required.');
  if(!value.trim())return;
  if(value.length>1_000_000)throw new Error(field.label+' is too long.');
  if(field.enumValues?.length&&!field.enumValues.includes(value)){
    throw new Error(field.label+' is not a valid option.');
  }
  if(field.kind==='boolean'&&value!=='true'&&value!=='false'){
    throw new Error(field.label+' must be true or false.');
  }
  if(field.kind==='number'||field.kind==='integer'){
    const parsed=Number(value);
    if(!Number.isFinite(parsed)||(field.kind==='integer'&&!Number.isSafeInteger(parsed))){
      throw new Error(field.label+' requires a valid '+field.kind+'.');
    }
  }
  if(field.kind==='json'){
    try{JSON.parse(value);}
    catch{throw new Error(field.label+' must contain valid JSON.');}
  }
}
