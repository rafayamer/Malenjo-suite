import type { PdfProviderOperationField } from './backend';

export function fieldAcceptsActivePdf(field:PdfProviderOperationField):boolean{
  if(field.kind!=='file'&&field.kind!=='files')return false;
  const accept=(field.accept??'').trim().toLowerCase();
  if(!accept)return true;
  return accept
    .split(',')
    .map((part)=>part.trim())
    .some((part)=>part==='.pdf'||part==='application/pdf'||part==='application/*'||part==='*/*');
}

import type { PdfProviderInputFile,PdfProviderOperation } from './backend';
import { requirePdfUnsignedForMutation } from './signatureIntegrity';

/**
 * Content sniffing supplements file extension and MIME (both are controlled
 * by the imported file). This runs BEFORE provider.run, not after conversion
 * has already discarded signatures. Non-PDF image/office inputs are excluded.
 */
export function isPdfProviderInput(file:Pick<PdfProviderInputFile,'filename'|'contentType'|'bytes'>):boolean{
  if(/\.pdf$/i.test(file.filename.trim())||
     file.contentType?.split(';')[0].trim().toLowerCase()==='application/pdf')return true;
  const bytes=file.bytes;
  // Match the full 1,024-byte header prefix tolerated by PDF parsers,
  // without treating arbitrary embedded "%PDF-" prose as a PDF. A renamed
  // PDF can have a BOM and hundreds of leading whitespace bytes.
  const MAX_PDF_HEADER_PREFIX=1024;
  let index=bytes[0]===239&&bytes[1]===187&&bytes[2]===191?3:0;
  while(index<bytes.length&&index<MAX_PDF_HEADER_PREFIX&&
        (bytes[index]===32||bytes[index]===9||bytes[index]===10||bytes[index]===13||
         bytes[index]===0||bytes[index]===12)){
    index++;
  }
  return bytes[index]===37&&bytes[index+1]===80&&bytes[index+2]===68&&
    bytes[index+3]===70&&bytes[index+4]===45;
}

export async function requireUnsignedPdfProviderInputs(
  files:ReadonlyArray<PdfProviderInputFile>,
):Promise<void>{
  for(const file of files){
    if(!isPdfProviderInput(file))continue;
    if(file.bytes.length>512*1024*1024){
      throw new Error('Provider PDF input exceeds the 512 MB safety limit.');
    }
    await requirePdfUnsignedForMutation(Uint8Array.from(file.bytes));
  }
}

/**
 * The local provider's signature validator reads rather than reserializes
 * the document. This is an explicit allowlist (not a substring match); every
 * other provider operation is treated as potentially rewriting imported PDFs.
 */
export function providerOperationMayRewritePdfInputs(
  operation:Pick<PdfProviderOperation,'id'|'category'>,
):boolean{
  return !(operation.category==='sign'&&
    /^(?:ValidateSignature|validateSignature)$/i.test(operation.id));
}
