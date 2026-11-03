import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { parsePageRanges, splitPdfByRanges, splitPdfBySize } from './pdfSplitModes';

/** Page n is (300 + n) points wide, so each part's pages can be identified after reopening. */
async function numberedDoc(pages: number, heavyPages: number[] = []) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pages; n++) {
    const page = pdf.addPage([300 + n, 400]);
    page.drawText(`Page ${n}`, { x: 20, y: 360, font, size: 14 });
    // "Heavy" pages carry a lot of uncompressible-looking text to grow their size.
    if (heavyPages.includes(n)) for (let line = 0; line < 400; line++) page.drawText(`${n}-${line}-${Math.random().toString(36).slice(2)}`, { x: 5, y: 5 + (line % 39) * 9, font, size: 4 });
  }
  return pdf.save();
}

async function partPages(archive: Uint8Array) {
  const files = unzipSync(archive);
  const out: Record<string, number[]> = {};
  for (const [name, data] of Object.entries(files)) {
    const pdf = await PDFDocument.load(data);
    out[name] = pdf.getPages().map((page) => Math.round(page.getWidth()) - 300);
  }
  return out;
}

describe('parsePageRanges (MAL-002)', () => {
  it('parses single pages, closed and open-ended ranges', () => {
    expect(parsePageRanges('1-3, 5, 8-', 10)).toEqual([[1, 2, 3], [5], [8, 9, 10]]);
    expect(parsePageRanges(' 2 - 2 ', 4)).toEqual([[2]]);
  });
  it('rejects empty, malformed, out-of-range and backwards input in plain language', () => {
    expect(() => parsePageRanges('  ', 5)).toThrow(/at least one page/);
    expect(() => parsePageRanges('1-x', 5)).toThrow(/not a page or range/);
    expect(() => parsePageRanges('0-2', 5)).toThrow(/outside pages 1–5/);
    expect(() => parsePageRanges('4-9', 5)).toThrow(/outside pages 1–5/);
    expect(() => parsePageRanges('4-2', 5)).toThrow(/runs backwards/);
  });
});

describe('split modes (MAL-002)', () => {
  it('splits by page ranges into named standalone PDFs', async () => {
    const result = await splitPdfByRanges(await numberedDoc(8), '1-3, 5, 7-');
    expect(result.parts.map((part) => part.filename)).toEqual([
      'part-001-pages-1-3.pdf', 'part-002-page-5.pdf', 'part-003-pages-7-8.pdf',
    ]);
    expect(await partPages(result.archive)).toEqual({
      'part-001-pages-1-3.pdf': [1, 2, 3], 'part-002-page-5.pdf': [5], 'part-003-pages-7-8.pdf': [7, 8],
    });
  });

  it('splits by size threshold, keeping every part within the limit except a single oversized page', async () => {
    const source = await numberedDoc(6, [4]);
    const single = (await splitPdfByRanges(source, '1')).parts[0].bytes;
    const heavy = (await splitPdfByRanges(source, '4')).parts[0].bytes;
    const limit = Math.max(10 * 1024, single * 2 + 600);
    expect(heavy).toBeGreaterThan(limit);
    const result = await splitPdfBySize(source, limit);
    const pages = Object.values(await partPages(result.archive));
    expect(pages.flat()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.oversizedPages).toEqual([4]);
    expect(pages).toContainEqual([4]);
    for (const part of result.parts) if (!result.oversizedPages.includes(part.pages[0])) expect(part.bytes).toBeLessThanOrEqual(limit);
  });

  it('refuses unusable size limits and invalid PDFs', async () => {
    const source = await numberedDoc(2);
    await expect(splitPdfBySize(source, 100)).rejects.toThrow(/at least 10 KB/);
    await expect(splitPdfByRanges(new TextEncoder().encode('%PDF-nope'), '1')).rejects.toThrow(/could not be split/);
  });

  it('refuses before retaining more output than the budget (repeated ranges, desktop limit)', async () => {
    const source = await numberedDoc(3, [1, 2, 3]);
    const one = (await splitPdfByRanges(source, '1-3')).parts[0].bytes;
    // 50 copies of the whole document cannot fit a budget of ~3 copies.
    const repeated = Array.from({ length: 50 }, () => '1-3').join(',');
    await expect(splitPdfByRanges(source, repeated, one * 3)).rejects.toThrow(/would exceed/);
    await expect(splitPdfBySize(source, 10 * 1024, 2048)).rejects.toThrow(/would exceed/);
    await expect(splitPdfByRanges(source, '1', 10)).rejects.toThrow(/budget must be between/);
    expect((await splitPdfByRanges(source, '1-3,1-3', one * 3)).parts).toHaveLength(2);
  });
});
