import { describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { extractPdfDocumentText, PDF_TEXT_EXPORT_MAX_PAGES } from './textExport';

type TestPage = { items: Array<{ str: string; hasEOL: boolean }> };

function pdf(pages: TestPage[]): Pick<PDFDocumentProxy, 'numPages' | 'getPage'> {
  return {
    numPages: pages.length,
    getPage: vi.fn(async (pageNumber: number) => ({
      getTextContent: async () => ({ items: pages[pageNumber - 1].items }),
    })),
  } as unknown as Pick<PDFDocumentProxy, 'numPages' | 'getPage'>;
}

describe('PDF selectable-text export', () => {
  it('retains page identifiers, reading order and PDF.js end-of-line markers', async () => {
    const document = pdf([
      { items: [{str:'Hello',hasEOL:false},{str:'world',hasEOL:true},{str:'New line',hasEOL:false}] },
      { items: [{str:'Second',hasEOL:false},{str:'page',hasEOL:false}] },
    ]);
    const progress = vi.fn();
    const text = await extractPdfDocumentText(document, { onProgress: progress });
    expect(text).toContain('Page 1 of 2\nHello world\nNew line');
    expect(text).toContain('Page 2 of 2\nSecond page');
    expect(progress).toHaveBeenNthCalledWith(1, 1, 2);
    expect(progress).toHaveBeenNthCalledWith(2, 2, 2);
  });

  it('does not fabricate text when a PDF has no selectable layer', async () => {
    const document = pdf([{ items: [] }, { items: [{str:'',hasEOL:false}] }]);
    await expect(extractPdfDocumentText(document)).rejects.toThrow(/Use OCR/i);
  });

  it('rejects oversized output instead of returning a partial document', async () => {
    const document = pdf([{ items: [{str:'A long page',hasEOL:false}] }]);
    await expect(extractPdfDocumentText(document, { maxChars: 10 })).rejects.toThrow(/no partial output/i);
  });

  it('honors cancellation without reading any PDF pages', async () => {
    const document = pdf([{ items: [{str:'Never read',hasEOL:false}] }]);
    const controller = new AbortController();
    controller.abort();
    await expect(extractPdfDocumentText(document, { signal: controller.signal })).rejects.toMatchObject({name:'AbortError'});
    expect(document.getPage).not.toHaveBeenCalled();
  });

  it('rejects excess page counts before parsing to avoid silent truncation', async () => {
    const document = { numPages: PDF_TEXT_EXPORT_MAX_PAGES + 1, getPage: vi.fn() } as unknown as Pick<PDFDocumentProxy, 'numPages' | 'getPage'>;
    await expect(extractPdfDocumentText(document)).rejects.toThrow(/silently truncate/i);
    expect(document.getPage).not.toHaveBeenCalled();
  });
});
