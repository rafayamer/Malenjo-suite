import type {PDFDocumentProxy} from 'pdfjs-dist';
import {exportPdfPagesAsPngZip,type PdfPngExportOptions} from './pageImageExport';
import {verifyPdfBatchZip} from './pdfTwentyWorkflows';

/** CBZ consists of PNG images in an ordered ZIP. This rasterizes pages and
 * necessarily loses PDF text selection, attachments, forms and vectors.
 * Limits: 50 pages, 16 MP/page, 100 MB PNG source budget, 32 MB final ZIP.
 */
export async function validatePdfCbzArchive(bytes:Uint8Array):Promise<void>{
  await verifyPdfBatchZip(Array.from(bytes),'image');
}
export async function exportPdfCbz(
  document:Pick<PDFDocumentProxy,'numPages'|'getPage'>,
  options:PdfPngExportOptions={},
):Promise<Uint8Array>{
  const archive=await exportPdfPagesAsPngZip(document,options);
  if(options.signal?.aborted){
    const error=new Error('PDF to CBZ conversion cancelled.');
    error.name='AbortError';
    throw error;
  }
  await validatePdfCbzArchive(archive);
  return archive;
}
