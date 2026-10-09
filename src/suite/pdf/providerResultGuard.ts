import type {PdfProviderResponse} from './backend';

export type PdfProviderResultAction='apply-pdf'|'save-pdf-copy'|'save-file';

export const PDF_PROVIDER_MAX_OUTPUT_BYTES=512*1024*1024;

/**
 * Never trust server-reported MIME alone to replace an active PDF. An
 * encrypted output is exported as a separate copy because the active editor
 * cannot reopen it without a password.
 *
 * The caller MUST confirm the workspace accepted 'apply-pdf' before reporting
 * success. This classifier does not claim to validate an entire PDF document.
 */
export function classifyPdfProviderResult(
  response:PdfProviderResponse,
  operationPath:string,
  isPdf:(result:PdfProviderResponse)=>boolean,
):PdfProviderResultAction{
  if(!Number.isInteger(response.status)||response.status<200||response.status>=300){
    throw new Error('Local PDF provider returned an unsuccessful response ('+response.status+'). The working document was not changed.');
  }
  if(!Array.isArray(response.bytes)||!response.bytes.length||
     response.bytes.length>PDF_PROVIDER_MAX_OUTPUT_BYTES){
    throw new Error('Local PDF provider output is missing or exceeds the 512 MB safety limit. No changes were made.');
  }
  const pdf=isPdf(response);
  if((response.contentType??'').toLowerCase().includes('application/pdf')&&!pdf){
    throw new Error('Local provider labelled invalid output as a PDF. The working document was not changed.');
  }
  if(!pdf)return 'save-file';
  if(operationPath.toLowerCase().endsWith('/add-password'))return 'save-pdf-copy';
  return 'apply-pdf';
}

/**
 * An export-as-copy must not reuse the provider-supplied Content-Disposition
 * filename. Otherwise a provider returning "document.pdf" can cause the
 * save dialog to suggest overwriting the still-open original PDF.
 */
export function safePdfCopyResponse(response:PdfProviderResponse):PdfProviderResponse{
  return {...response,contentDisposition:null};
}
