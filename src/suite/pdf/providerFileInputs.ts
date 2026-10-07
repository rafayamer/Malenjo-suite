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
