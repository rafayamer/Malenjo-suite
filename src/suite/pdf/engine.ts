import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfLoadResult {
  document: PDFDocumentProxy;
  loadingTask: PDFDocumentLoadingTask;
}

export async function loadPdfBytes(data: ArrayBuffer | Uint8Array): Promise<PdfLoadResult> {
  // PDF.js may transfer the supplied typed-array buffer to its worker, which
  // detaches that ArrayBuffer in the calling realm. MALENJO retains its own
  // working copy for history/edit/export, so PDF.js must receive a dedicated
  // clone that it is free to transfer.
  const bytes = data instanceof Uint8Array
    ? Uint8Array.from(data)
    : new Uint8Array(data.slice(0));

  const loadingTask = getDocument({
    data: bytes,
    useSystemFonts: true,
  });

  const document = await loadingTask.promise;
  return { document, loadingTask };
}

export async function disposePdf(result: PdfLoadResult | null): Promise<void> {
  if (!result) return;
  await result.loadingTask.destroy();
}
