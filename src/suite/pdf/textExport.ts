import type { PDFDocumentProxy } from 'pdfjs-dist';

export const PDF_TEXT_EXPORT_MAX_PAGES = 2_000;
export const PDF_TEXT_EXPORT_MAX_CHARS = 8_000_000;

export interface PdfTextExportOptions {
  signal?: AbortSignal;
  onProgress?: (completedPages: number, totalPages: number) => void;
  /** A lower per-export limit may be used for tests or constrained environments. */
  maxChars?: number;
}

function checkCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('PDF text export was cancelled.');
  error.name = 'AbortError';
  throw error;
}

/**
 * Extracts the existing selectable text layer, not OCR or visually positioned
 * text. Page markers are retained so readers can trace the exported content.
 * Reject rather than silently truncating a large or textless PDF.
 */
export async function extractPdfDocumentText(
  document: Pick<PDFDocumentProxy, 'numPages' | 'getPage'>,
  options: PdfTextExportOptions = {},
): Promise<string> {
  const count = document.numPages;
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('The PDF does not contain any pages.');
  }
  if (count > PDF_TEXT_EXPORT_MAX_PAGES) {
    throw new Error(`PDF text export supports up to ${PDF_TEXT_EXPORT_MAX_PAGES} pages; refusing to silently truncate ${count} pages.`);
  }

  const requestedLimit = options.maxChars ?? PDF_TEXT_EXPORT_MAX_CHARS;
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit <= 0) {
    throw new Error('PDF text export character limit must be a positive integer.');
  }
  const charLimit = Math.min(requestedLimit, PDF_TEXT_EXPORT_MAX_CHARS);
  const output: string[] = [];
  let totalChars = 0;
  let foundText = false;

  for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
    checkCancelled(options.signal);
    const page = await document.getPage(pageNumber);
    checkCancelled(options.signal);
    const content = await page.getTextContent();
    checkCancelled(options.signal);

    const fragments: string[] = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const part = item.str.replace(/\u0000/g, '').trim();
      if (part) fragments.push(part);
      if (item.hasEOL) fragments.push('\n');
    }
    const pageText = fragments.join(' ').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
    if (pageText) foundText = true;
    const block = `Page ${pageNumber} of ${count}\n${pageText}\n`;
    totalChars += block.length + 1;
    if (totalChars > charLimit) {
      throw new Error(`PDF text export exceeds the ${charLimit.toLocaleString()}-character safety limit; no partial output was saved.`);
    }
    output.push(block);
    options.onProgress?.(pageNumber, count);
  }

  if (!foundText) {
    throw new Error('No selectable text was found in the PDF. Use OCR for scanned or image-only pages.');
  }
  return output.join('\n');
}
