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
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

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
