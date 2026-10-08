import { describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  comparePdfSelectableText, formatPdfTextComparison, PDF_COMPARE_MAX_PAGES,
} from './textCompare';

function source(pages: string[]): Pick<PDFDocumentProxy, 'numPages' | 'getPage'> {
  return {
    numPages: pages.length,
    getPage: vi.fn(async (number: number) => ({
      getTextContent: async () => ({
        items: pages[number-1].split('\n').map(line => ({str: line, hasEOL: true})),
      }),
    })),
  } as unknown as Pick<PDFDocumentProxy, 'numPages' | 'getPage'>;
}

describe('PDF selectable-text comparison', () => {
  it('reports same text, changed text and absent pages without conflating them', async () => {
    const original = source(['Introduction', 'The price is 12', 'Closing']);
    const revised = source(['Introduction', 'The price is 15']);
    const progress = vi.fn();
    const result = await comparePdfSelectableText(original, revised, {onProgress: progress});
    expect(result).toMatchObject({
      leftPages:3, rightPages:2, comparedPages:3,
      sameText:1, changedText:1, removedPages:1, addedPages:0, unverifiable:0,
    });
    expect(result.pages.map(x => x.result)).toEqual(['same-text', 'changed-text', 'removed-page']);
    expect(result.pages[1].before).toContain('12');
    expect(result.pages[1].after).toContain('15');
    expect(progress).toHaveBeenLastCalledWith(5, 5);
    const report = formatPdfTextComparison(result, 'first.pdf', 'second.pdf');
    expect(report).toContain('Page 2: changed-text');
    expect(report).toContain('Matching selectable text does not prove PDFs are visually');
  });

  it('identifies added pages and refuses to call empty image-only pages identical', async () => {
    const result = await comparePdfSelectableText(source(['', 'Text']), source(['', 'Text', 'New']));
    expect(result).toMatchObject({sameText:1, addedPages:1, unverifiable:1});
    expect(result.pages.map(x => x.result)).toEqual(['unverifiable','same-text','added-page']);
  });

  it('rejects unbounded PDFs before parsing either document', async () => {
    const left = {numPages:PDF_COMPARE_MAX_PAGES+1,getPage:vi.fn()} as unknown as Pick<PDFDocumentProxy,'numPages'|'getPage'>;
    const right = source(['ok']);
    await expect(comparePdfSelectableText(left,right)).rejects.toThrow(/no partial comparison/i);
    expect(left.getPage).not.toHaveBeenCalled();
    expect(right.getPage).not.toHaveBeenCalled();
  });

  it('rejects excessive per-page text rather than silently truncating', async () => {
    await expect(comparePdfSelectableText(source(['A'.repeat(60_100)]),source(['A'])))
      .rejects.toThrow(/no partial comparison/i);
  });

  it('supports cancellation and does not read more pages once aborted', async () => {
    const controller = new AbortController();
    const left = source(['One','Two','Three']);
    const right = source(['One','Two','Three']);
    await expect(comparePdfSelectableText(left,right,{
      signal:controller.signal,
      onProgress:(done) => { if(done===1) controller.abort(); },
    })).rejects.toMatchObject({name:'AbortError'});
    expect(left.getPage).toHaveBeenCalledTimes(1);
    expect(right.getPage).not.toHaveBeenCalled();
  });

  it('does not claim image or layout identity for matching text', async () => {
    const r = await comparePdfSelectableText(source(['Contract']),source(['Contract']));
    const report = formatPdfTextComparison(r,'original.pdf','revised.pdf');
    expect(r.sameText).toBe(1);
    expect(report).toContain('NOT a visual');
  });
});
