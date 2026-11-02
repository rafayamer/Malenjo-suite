import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from 'pdfjs-dist';
// Bundle the PDF.js worker as a Vite worker asset. A plain ?url import can
// resolve to a module endpoint that is not importable via Codespaces forwarding.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';

GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfLoadResult {
  document: PDFDocumentProxy;
  loadingTask: PDFDocumentLoadingTask;
}

/**
 * Thrown when a PDF needs a user password to open. `incorrect` is true when a
 * password was supplied but rejected. The password itself is never stored.
 */
export class PdfPasswordRequiredError extends Error {
  readonly incorrect: boolean;
  constructor(incorrect: boolean) {
    super(incorrect
      ? 'Incorrect password. Check it and try again.'
      : 'This PDF is password-protected. Enter its password to open it.');
    this.name = 'PdfPasswordRequiredError';
    this.incorrect = incorrect;
  }
}

// PDF.js PasswordResponses: 1 = NEED_PASSWORD, 2 = INCORRECT_PASSWORD.
const PDFJS_INCORRECT_PASSWORD = 2;

export function toPdfPasswordError(reason: unknown): PdfPasswordRequiredError | null {
  if (reason instanceof PdfPasswordRequiredError) return reason;
  if (typeof reason === 'object' && reason !== null && (reason as { name?: unknown }).name === 'PasswordException') {
    return new PdfPasswordRequiredError((reason as { code?: unknown }).code === PDFJS_INCORRECT_PASSWORD);
  }
  return null;
}

export interface PdfLoadOptions {
  /** User password for an encrypted PDF. Passed straight to PDF.js; not retained. */
  password?: string;
}

export async function loadPdfBytes(data: ArrayBuffer | Uint8Array, options: PdfLoadOptions = {}): Promise<PdfLoadResult> {
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
    ...(options.password === undefined ? {} : { password: options.password }),
  });

  try {
    const document = await loadingTask.promise;
    return { document, loadingTask };
  } catch (reason) {
    // A failed parse/worker startup must not leave a live PDF.js task behind.
    // Preserve the original failure even if worker teardown also fails.
    try {
      await loadingTask.destroy();
    } catch {
      // The parse error is the actionable failure for the caller.
    }
    throw toPdfPasswordError(reason) ?? reason;
  }
}

export async function disposePdf(result: PdfLoadResult | null): Promise<void> {
  if (!result) return;
  await result.loadingTask.destroy();
}
