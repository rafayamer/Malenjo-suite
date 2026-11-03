import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { compressPdfLossless } from './pdfCompress';

// 2x1 red PNG.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDAAAAQBQEAzYPXwAAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

async function bloated() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontName = 'F1';
  for (let n = 1; n <= 3; n++) {
    const page = pdf.addPage([600, 800]);
    page.node.newFontDictionary(fontName, font.ref);
    const ops = Array.from({ length: 200 }, (_, i) => `BT /${fontName} 8 Tf 40 ${780 - (i % 90) * 8} Td (Line ${i} of page ${n}) Tj ET`).join('\n');
    const content = pdf.context.register(pdf.context.stream(ops)); // stored without a filter
    page.node.set(PDFName.of('Contents'), pdf.context.obj([content]));
    const image = await pdf.embedPng(PNG); // the same image embedded once per page
    page.drawImage(image, { x: 400, y: 600, width: 40, height: 20 });
  }
  pdf.context.register(pdf.context.stream('orphan '.repeat(500))); // unreachable
  return pdf.save({ useObjectStreams: false });
}

async function texts(bytes: Uint8Array) {
  const loading = getDocument({ data: bytes.slice(), useSystemFonts: true });
  const doc = await loading.promise;
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) out.push((await (await doc.getPage(p)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('|'));
  await loading.destroy();
  return out;
}

describe('compressPdfLossless (MAL-024)', () => {
  it('compresses unfiltered streams, merges duplicates and drops unused objects without changing pages', async () => {
    const source = await bloated();
    const result = await compressPdfLossless(source);
    expect(result.unchanged).toBe(false);
    expect(result.after).toBeLessThan(result.before * 0.5);
    expect(result.streamsCompressed).toBeGreaterThanOrEqual(3);
    expect(result.duplicatesMerged).toBeGreaterThanOrEqual(2);
    expect(result.unusedRemoved).toBeGreaterThanOrEqual(1);
    expect(await texts(result.bytes)).toEqual(await texts(source));
    const out = await PDFDocument.load(result.bytes);
    const images = out.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype'))?.toString() === '/Image');
    expect(images).toHaveLength(1);
  });

  it('returns the input unchanged when nothing can be saved, and refuses invalid input', async () => {
    const once = await compressPdfLossless(await bloated());
    const twice = await compressPdfLossless(once.bytes);
    expect(twice.unchanged || twice.after <= once.after).toBe(true);
    if (twice.unchanged) expect(twice.bytes).toBe(once.bytes);
    await expect(compressPdfLossless(new TextEncoder().encode('%PDF-1.7 nope'))).rejects.toThrow(/could not be compressed/);
  });
});
