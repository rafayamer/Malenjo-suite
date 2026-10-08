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

import type { PdfProviderInputFile } from './backend';
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
  // A PDF header may be preceded by junk in imported PDFs. Bound sniffing to
  // the first 1,024 bytes; the structural guard still does the full inspection.
  for(let i=0;i+4<bytes.length&&i<1024;i++){
    if(bytes[i]===37&&bytes[i+1]===80&&bytes[i+2]===68&&
       bytes[i+3]===70&&bytes[i+4]===45)return true;
  }
  return false;
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
