import {PDFDict,PDFDocument,PDFName,PDFSignature} from 'pdf-lib';

/**
 * Clear the AcroForm ReadOnly field flag on an explicitly opened, unencrypted
 * PDF. This does NOT remove passwords or cryptographic document permissions.
 * We deliberately refuse XFA, signature fields, document-level signature
 * permissions, and documents with implausibly large form inventories.
 */
export const PDF_FORM_UNLOCK_MAX_INPUT_BYTES=32*1024*1024;
export const PDF_FORM_UNLOCK_MAX_FIELDS=5000;
export interface PdfFormUnlockResult{bytes:Uint8Array;unlockedFields:string[]}

export async function unlockReadOnlyPdfFormFields(
  source:Uint8Array,
):Promise<PdfFormUnlockResult>{
  if(!(source instanceof Uint8Array)||source.length<5||
     source.length>PDF_FORM_UNLOCK_MAX_INPUT_BYTES){
    throw new Error('Offline PDF form unlock supports PDF files up to 32 MB.');
  }
  // PDFDocument.load enforces encryption instead of bypassing permissions.
  const pdf=await PDFDocument.load(source,{
    ignoreEncryption:false,updateMetadata:false,
  });
  if(pdf.getPageCount()<1||pdf.getPageCount()>2000){
    throw new Error('PDF form unlock supports 1 to 2,000 pages.');
  }
  const formObject=pdf.catalog.lookupMaybe(PDFName.of('AcroForm'),PDFDict);
  if(!formObject){
    throw new Error('PDF has no AcroForm fields to unlock.');
  }
  if(formObject.has(PDFName.of('XFA'))){
    throw new Error('XFA or hybrid forms cannot be safely unlocked.');
  }
  if(pdf.catalog.has(PDFName.of('Perms'))){
    throw new Error('PDF document permissions or certification signatures prevent safe rewriting.');
  }
  const fields=pdf.getForm().getFields();
  if(!fields.length)throw new Error('PDF has no AcroForm fields to unlock.');
  if(fields.length>PDF_FORM_UNLOCK_MAX_FIELDS){
    throw new Error('PDF exceeds the 5,000-field form safety limit.');
  }
  if(fields.some(field=>field instanceof PDFSignature||
    field.acroField.dict.get(PDFName.of('FT'))?.toString()==='/Sig')){
    throw new Error('PDF contains signature fields; unlocking could invalidate signatures.');
  }
  const targets=fields.filter(field=>field.isReadOnly());
  if(!targets.length){
    throw new Error('All existing AcroForm fields are already editable.');
  }
  for(const field of targets)field.disableReadOnly();
  const bytes=Uint8Array.from(await pdf.save({
    useObjectStreams:false,updateFieldAppearances:false,
  }));
  if(bytes.length>PDF_FORM_UNLOCK_MAX_INPUT_BYTES){
    throw new Error('Unlocked PDF exceeds the 32 MB output safety limit.');
  }
  const reopened=await PDFDocument.load(bytes,{
    ignoreEncryption:false,updateMetadata:false,
  });
  const reloadedFields=reopened.getForm().getFields();
  if(reloadedFields.length!==fields.length||reloadedFields.some(field=>field.isReadOnly())){
    throw new Error('Unlocked PDF cannot be reopened with every form field editable.');
  }
  return {bytes,unlockedFields:targets.map(field=>field.getName())};
}
