import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildSearchablePdf } from './searchablePdf';

// Independent real 1x1 RGB PNG with valid CRCs, not a mocked image decoder.
const WHITE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';

function image(): Blob {
  return new Blob([Uint8Array.from(atob(WHITE_PNG), (char) => char.charCodeAt(0))], { type: 'image/png' });
}

describe('Scanner searchable-PDF artifact integrity', () => {
  it('exports two genuine image pages with searchable accent text independently decoded by PDF.js', async () => {
    const source = image();
    const sourceBytes = new Uint8Array(await source.arrayBuffer());
    const exported = await buildSearchablePdf([
      { image: source, text: 'Café résumé fiancé' },
      { image: image(), text: 'Invoice TOTAL 2040' },
    ]);
    const pdfLibReopened = await PDFDocument.load(exported);
    expect(pdfLibReopened.getPageCount()).toBe(2);
    // Distinct implementation from the writer performs the actual text read.
    const loading = getDocument({ data: exported.slice(), useSystemFonts: true });
    const independent = await loading.promise;
    try {
      expect(independent.numPages).toBe(2);
      const first = await (await independent.getPage(1)).getTextContent();
      const second = await (await independent.getPage(2)).getTextContent();
      expect(first.items.map((item) => 'str' in item ? item.str : '').join(' ')).toContain('Café résumé fiancé');
      expect(second.items.map((item) => 'str' in item ? item.str : '').join(' ')).toContain('Invoice TOTAL 2040');
    } finally {
      await loading.destroy();
    }
    expect(new Uint8Array(await source.arrayBuffer())).toEqual(sourceBytes);
  });

  it('rejects scripts not representable by the built-in font instead of silently erasing OCR text', async () => {
    const source = image();
    const initial = new Uint8Array(await source.arrayBuffer());
    await expect(buildSearchablePdf([{ image: source, text: 'مرحبا بالعالم' }]))
      .rejects.toThrow(/unsupported by the PDF font/);
    expect(new Uint8Array(await source.arrayBuffer())).toEqual(initial);
  });

  it('rejects over-budget text, empty page collections and invalid image data', async () => {
    await expect(buildSearchablePdf([])).rejects.toThrow(/at least one scan page/);
    await expect(buildSearchablePdf([{ image: image(), text: 'x'.repeat(20_001) }]))
      .rejects.toThrow(/20,000-character/);
    await expect(buildSearchablePdf([{ image: new Blob([new Uint8Array([0,1,2])], { type: 'image/png' }), text: 'hello' }]))
      .rejects.toThrow();
  });
});
