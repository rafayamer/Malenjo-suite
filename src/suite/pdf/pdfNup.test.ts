import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, StandardFonts, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { nupCell, nupGrid, nupPdf, type NupOptions } from './pdfNup';

const base: NupOptions = { perSheet: 4, sheet: 'letter', orientation: 'portrait', margin: 18, gap: 9, order: 'rows', borders: false };

async function labelled(pages: number, rotate: Record<number, number> = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pages; n++) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`Label${n}`, { x: 60, y: 700, size: 40, font });
    if (rotate[n]) page.setRotation(degrees(rotate[n]));
  }
  return pdf.save();
}

/** Text items per sheet with their position (via PDF.js), to check placement. */
async function sheetLabels(bytes: Uint8Array) {
  const loading = getDocument({ data: bytes.slice(), useSystemFonts: true });
  const doc = await loading.promise;
  const out: { sheet: number; text: string; x: number; y: number; w: number; h: number }[] = [];
  for (let s = 1; s <= doc.numPages; s++) {
    const page = await doc.getPage(s);
    const { width, height } = page.getViewport({ scale: 1 });
    for (const item of (await page.getTextContent()).items as { str: string; transform: number[] }[]) {
      if (item.str.trim()) out.push({ sheet: s, text: item.str.trim(), x: item.transform[4], y: item.transform[5], w: width, h: height });
    }
  }
  await loading.destroy();
  return out;
}

describe('N-up grid and order (MAL-009)', () => {
  it('chooses grids by count and orientation', () => {
    expect(nupGrid(2, 'landscape')).toEqual({ columns: 2, rows: 1 });
    expect(nupGrid(2, 'portrait')).toEqual({ columns: 1, rows: 2 });
    expect(nupGrid(6, 'portrait')).toEqual({ columns: 2, rows: 3 });
    expect(nupGrid(6, 'landscape')).toEqual({ columns: 3, rows: 2 });
    expect(nupGrid(9, 'portrait')).toEqual({ columns: 3, rows: 3 });
    expect(nupGrid(16, 'landscape')).toEqual({ columns: 4, rows: 4 });
  });
  it('orders slots by rows or by columns', () => {
    expect([0, 1, 2, 3].map((s) => nupCell(s, 2, 2, 'rows'))).toEqual([
      { column: 0, row: 0 }, { column: 1, row: 0 }, { column: 0, row: 1 }, { column: 1, row: 1 }]);
    expect([0, 1, 2, 3].map((s) => nupCell(s, 2, 2, 'columns'))).toEqual([
      { column: 0, row: 0 }, { column: 0, row: 1 }, { column: 1, row: 0 }, { column: 1, row: 1 }]);
  });
});

describe('nupPdf (MAL-009)', () => {
  it('places 4 pages per portrait Letter sheet in row order, as vector text', async () => {
    const result = await nupPdf(await labelled(6), base);
    expect(result.sheets).toBe(2);
    const labels = await sheetLabels(result.bytes);
    const sheet1 = labels.filter((l) => l.sheet === 1);
    expect(sheet1.map((l) => l.text)).toEqual(['Label1', 'Label2', 'Label3', 'Label4']);
    const [one, two, three] = sheet1;
    expect(two.x).toBeGreaterThan(one.x + 100); // same row, to the right
    expect(Math.abs(two.y - one.y)).toBeLessThan(2);
    expect(three.y).toBeLessThan(one.y - 100); // next row, below
    expect(labels.filter((l) => l.sheet === 2).map((l) => l.text)).toEqual(['Label5', 'Label6']);
    expect(sheet1[0].w).toBeCloseTo(612, 0);
    expect(sheet1[0].h).toBeCloseTo(792, 0);
  });

  it('honours landscape A4, column order, and spacing', async () => {
    const result = await nupPdf(await labelled(6), { ...base, perSheet: 6, sheet: 'a4', orientation: 'landscape', order: 'columns', gap: 36 });
    expect([result.columns, result.rows, result.sheets]).toEqual([3, 2, 1]);
    const labels = await sheetLabels(result.bytes);
    expect(labels[0].w).toBeGreaterThan(labels[0].h);
    const [one, two, three] = labels;
    expect(Math.abs(two.x - one.x)).toBeLessThan(2); // columns: page 2 below page 1
    expect(two.y).toBeLessThan(one.y);
    expect(three.x).toBeGreaterThan(one.x + 100);
  });

  it('honours each source page rotation', async () => {
    const plain = await sheetLabels((await nupPdf(await labelled(1), { ...base, perSheet: 2 })).bytes);
    const rotated = await sheetLabels((await nupPdf(await labelled(1, { 1: 90 }), { ...base, perSheet: 2 })).bytes);
    expect(plain[0].text).toBe('Label1');
    expect(rotated[0].text).toBe('Label1');
    // A page rotated 90° clockwise shows its text running downward, not across.
    expect(Math.abs(rotated[0].x - plain[0].x) + Math.abs(rotated[0].y - plain[0].y)).toBeGreaterThan(20);
  });

  it('places only the visible crop box and keeps a slot for blank pages', async () => {
    const pdf = await PDFDocument.load(await labelled(2));
    // Page 1: crop to the top-left quarter, which holds the label at (60, 700).
    pdf.getPage(0).setCropBox(0, 396, 306, 396);
    const blank = pdf.insertPage(1, [612, 792]);
    blank.node.delete(PDFName.of('Contents'));
    const result = await nupPdf(await pdf.save(), { ...base, perSheet: 4 });
    expect(result.sheets).toBe(1);
    const labels = await sheetLabels(result.bytes);
    expect(labels.map((l) => l.text)).toEqual(['Label1', 'Label2']);
    // Cells are 283.5 x 373.5. The 306 x 396 crop scales by 0.9265, so its label (x 60) lands at 18 + 60 * 0.9265 = 73.6;
    // the uncropped 612 x 792 page scales by 0.4632, so its label lands at 18 + 60 * 0.4632 = 45.8.
    const [cropped, plain] = labels;
    expect(cropped.x).toBeCloseTo(73.6, 0);
    expect(plain.x).toBeCloseTo(45.8, 0);
    // Label2 is page 3, in slot 3 (second row, first column).
    expect(plain.y).toBeLessThan(cropped.y - 100);
  });

  it('rejects impossible layouts and invalid input in plain language', async () => {
    await expect(nupPdf(await labelled(2), { ...base, perSheet: 16, margin: 140, gap: 140 })).rejects.toThrow(/no room|between 0 and 50/);
    await expect(nupPdf(new TextEncoder().encode('%PDF-nope'), base)).rejects.toThrow(/could not be arranged/);
    await expect(nupPdf(new TextEncoder().encode('%PDF-1.7 nope'), base)).rejects.toThrow(/could not be arranged/);
  });
});
