import type { PDFDocumentProxy } from 'pdfjs-dist';

export const PDF_COMPARE_MAX_PAGES = 250;
export const PDF_COMPARE_MAX_PAGE_CHARS = 60_000;
export const PDF_COMPARE_MAX_TOTAL_CHARS = 2_000_000;

export type PdfTextPageResult = 'same-text' | 'changed-text' | 'added-page' | 'removed-page' | 'unverifiable';
export interface PdfTextPageComparison {
  page: number;
  result: PdfTextPageResult;
  leftChars: number;
  rightChars: number;
  before: string;
  after: string;
}
export interface PdfTextComparison {
  leftPages: number;
  rightPages: number;
  comparedPages: number;
  sameText: number;
  changedText: number;
  addedPages: number;
  removedPages: number;
  unverifiable: number;
  pages: PdfTextPageComparison[];
}
export interface PdfCompareOptions {
  signal?: AbortSignal;
  onProgress?: (completedPages: number, totalPages: number) => void;
}

function abortIfRequested(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('PDF comparison cancelled.');
  error.name = 'AbortError';
  throw error;
}

/** Selectable text only: PDF.js content order is not guaranteed to match visual reading order. */
async function readPageText(
  document: Pick<PDFDocumentProxy, 'getPage'>,
  pageNumber: number,
  signal?: AbortSignal,
): Promise<string> {
  abortIfRequested(signal);
  const page = await document.getPage(pageNumber);
  abortIfRequested(signal);
  const content = await page.getTextContent();
  abortIfRequested(signal);
  let combined = '';
  for (const item of content.items) {
    if (!('str' in item)) continue;
    // Retain meaningful boundaries while normalizing presentation whitespace.
    const fragment = item.str.replace(/\u0000/g, '').replace(/\s+/g, ' ').trim();
    if (fragment) combined += (combined && !combined.endsWith('\n') ? ' ' : '') + fragment;
    if (item.hasEOL && combined) combined += '\n';
    if (combined.length > PDF_COMPARE_MAX_PAGE_CHARS) {
      throw new Error('PDF comparison page ' + pageNumber + ' exceeds the 60,000-character limit. No partial comparison was produced.');
    }
  }
  return combined.trim().replace(/[ \t]*\n[ \t]*/g, '\n').replace(/[ \t]{2,}/g, ' ');
}

function differenceExcerpts(left: string, right: string): [string, string] {
  let index = 0;
  const length = Math.min(left.length, right.length);
  while (index < length && left[index] === right[index]) index += 1;
  const start = Math.max(0, index - 60);
  const render = (value: string) => {
    const end = Math.min(value.length, index + 160);
    const span = value.slice(start, end).replace(/\n/g, ' ⏎ ');
    return (start ? '…' : '') + span + (end < value.length ? '…' : '');
  };
  return [render(left), render(right)];
}

/**
 * Compare page-aligned, selectable text from two PDFs. Does NOT compare
 * pixels, fonts, vectors, images, layout, signatures or PDF byte identity.
 * Empty text layers are marked unverifiable, never "identical".
 */
export async function comparePdfSelectableText(
  left: Pick<PDFDocumentProxy, 'numPages' | 'getPage'>,
  right: Pick<PDFDocumentProxy, 'numPages' | 'getPage'>,
  options: PdfCompareOptions = {},
): Promise<PdfTextComparison> {
  const leftPages = left.numPages;
  const rightPages = right.numPages;
  for (const count of [leftPages, rightPages]) {
    if (!Number.isSafeInteger(count) || count < 1 || count > PDF_COMPARE_MAX_PAGES) {
      throw new Error('PDF comparison supports 1–250 pages per document; no partial comparison was produced.');
    }
  }
  abortIfRequested(options.signal);
  const totalPages = leftPages + rightPages;
  let completed = 0;
  let totalChars = 0;
  const combined: PdfTextPageComparison[] = [];
  const maxPages = Math.max(leftPages, rightPages);

  for (let page = 1; page <= maxPages; page += 1) {
    abortIfRequested(options.signal);
    let before = '';
    let after = '';
    if (page <= leftPages) {
      before = await readPageText(left, page, options.signal);
      totalChars += before.length;
      options.onProgress?.(++completed, totalPages);
    }
    if (page <= rightPages) {
      after = await readPageText(right, page, options.signal);
      totalChars += after.length;
      options.onProgress?.(++completed, totalPages);
    }
    if (totalChars > PDF_COMPARE_MAX_TOTAL_CHARS) {
      throw new Error('PDF comparison exceeds the 2-million-character limit; no partial result was produced.');
    }
    abortIfRequested(options.signal);
    let result: PdfTextPageResult;
    if (page > leftPages) result = 'added-page';
    else if (page > rightPages) result = 'removed-page';
    else if (!before && !after) result = 'unverifiable';
    else result = before === after ? 'same-text' : 'changed-text';
    const [oldExcerpt, newExcerpt] = result === 'changed-text'
      ? differenceExcerpts(before, after)
      : result === 'added-page' || result === 'removed-page'
        ? [before.slice(0, 220), after.slice(0, 220)]
        : ['', ''];
    combined.push({
      page, result, leftChars: before.length, rightChars: after.length,
      before: oldExcerpt, after: newExcerpt,
    });
  }

  return {
    leftPages, rightPages, comparedPages: maxPages,
    sameText: combined.filter(item => item.result === 'same-text').length,
    changedText: combined.filter(item => item.result === 'changed-text').length,
    addedPages: combined.filter(item => item.result === 'added-page').length,
    removedPages: combined.filter(item => item.result === 'removed-page').length,
    unverifiable: combined.filter(item => item.result === 'unverifiable').length,
    pages: combined,
  };
}

export function formatPdfTextComparison(
  comparison: PdfTextComparison,
  leftName: string,
  rightName: string,
): string {
  const lines = [
    'MALENJO PDF — SELECTABLE TEXT COMPARISON',
    'Original: ' + leftName,
    'Comparison: ' + rightName,
    'Original pages: ' + comparison.leftPages,
    'Comparison pages: ' + comparison.rightPages,
    'Matching selectable-text pages: ' + comparison.sameText,
    'Changed selectable-text pages: ' + comparison.changedText,
    'Added pages: ' + comparison.addedPages,
    'Removed pages: ' + comparison.removedPages,
    'Unverifiable (no text layer): ' + comparison.unverifiable,
    '',
    'LIMITATION: This is a page-aligned selectable-text comparison, NOT a visual,',
    'pixel, image, layout, object, metadata, signature, or security comparison.',
    'Matching selectable text does not prove PDFs are visually or byte identical.',
    'The excerpts below are shortened; they are not a complete text diff.',
    '',
  ];
  for (const page of comparison.pages) {
    lines.push('Page ' + page.page + ': ' + page.result +
      ' (original ' + page.leftChars + ', comparison ' + page.rightChars + ' chars)');
    if (page.before) lines.push('  Original excerpt: ' + page.before);
    if (page.after) lines.push('  Comparison excerpt: ' + page.after);
  }
  return lines.join('\n') + '\n';
}
