import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFName, PDFStream, StandardFonts, decodePDFRawStream, degrees, type PDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { setPdfPageLabelRange } from './pageLabels';
import {
  applyHeaderFooter, applyImageWatermark, applyPageNumbers, applyTextWatermark, fillTemplate, formatNumber,
  type HeaderFooterSpec, type StampScope,
} from './pdfStamp';

const all: StampScope = { pages: 'all', skipFirst: false };
const text = { font: 'helvetica' as const, size: 12, color: '#202020' };

async function doc(pages: number, opts: { rotate?: Record<number, number>; crop?: number; title?: string } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pages; n++) {
    const page = pdf.addPage([600, 800]);
    page.drawText(`Body${n}`, { x: 280, y: 400, size: 12, font });
    if (opts.rotate?.[n]) page.setRotation(degrees(opts.rotate[n]));
    if (opts.crop) page.setCropBox(opts.crop, opts.crop, 600 - 2 * opts.crop, 800 - 2 * opts.crop);
  }
  if (opts.title) { pdf.setTitle(opts.title); pdf.setAuthor('Ada'); }
  return pdf.save();
}

/** Text items per page in viewer coordinates (origin top-left of the shown page). */
async function shown(bytes: Uint8Array) {
  const loading = getDocument({ data: bytes.slice(), useSystemFonts: true });
  const pdf = await loading.promise;
  const out: { width: number; height: number; items: { str: string; x: number; y: number }[] }[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const items = (await page.getTextContent()).items.flatMap((item) => {
      if (!('str' in item) || !item.str.trim()) return [];
      const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
      return [{ str: item.str.trim(), x, y }];
    });
    out.push({ width: viewport.width, height: viewport.height, items });
  }
  await loading.destroy();
  return out;
}
const find = (page: { items: { str: string; x: number; y: number }[] }, str: string) => {
  const hit = page.items.find((item) => item.str === str);
  if (!hit) throw new Error(`${str} not found in ${page.items.map((i) => i.str).join(' | ')}`);
  return hit;
};

function streams(pdf: PDFDocument, index: number): string[] {
  const contents = pdf.getPage(index).node.lookup(PDFName.of('Contents'), PDFArray);
  return contents.asArray().map((ref) => {
    const stream = pdf.context.lookup(ref) as PDFStream;
    return new TextDecoder().decode(decodePDFRawStream(stream as PDFRawStream).decode());
  });
}

const hfSpec = (over: Partial<HeaderFooterSpec> = {}): HeaderFooterSpec => ({
  header: { left: '{file}', center: '{title}', right: 'Page {page} of {pages}' },
  footer: { left: '{date}', center: 'Label {label}', right: '{author}' },
  text, marginX: 36, marginY: 30, scope: all, fileName: 'C:\\docs\\Report.pdf', now: new Date(2026, 10, 3, 9, 5), ...over,
});

describe('formatting', () => {
  it('formats numbers and fills templates', () => {
    expect([4, 9, 14, 1990].map((n) => formatNumber(n, 'roman-upper'))).toEqual(['IV', 'IX', 'XIV', 'MCMXC']);
    expect(formatNumber(14, 'roman-lower')).toBe('xiv');
    expect([1, 26, 27, 53].map((n) => formatNumber(n, 'alpha-upper'))).toEqual(['A', 'Z', 'AA', 'AAA']);
    const values = { page: '2', pages: '9', label: 'ii', file: 'a.pdf', title: 'T', author: 'A', subject: '', date: 'D', time: 'H' };
    expect(fillTemplate('{PAGE}/{pages} {label}', values)).toBe('2/9 ii');
    expect(() => fillTemplate('{nope}', values)).toThrow(/not a known field/);
  });
});

describe('applyHeaderFooter (MAL-017)', () => {
  it('fills file, date, page, label and document fields in six positions, inside the visible frame', async () => {
    let bytes = await doc(3, { title: 'Annual report' });
    bytes = await setPdfPageLabelRange(bytes, { startPage: 1, style: 'r', prefix: '', startNumber: 1 });
    const result = await applyHeaderFooter(bytes, hfSpec());
    expect(result.pages).toBe(3);
    const [first, second] = await shown(result.bytes);
    expect(find(second, 'Report.pdf').x).toBeCloseTo(36, 0);
    expect(find(second, 'Page 2 of 3').x).toBeGreaterThan(450);
    expect(find(second, 'Annual report').y).toBeLessThan(50);
    expect(find(second, '2026-11-03').y).toBeGreaterThan(750);
    expect(find(second, 'Label ii')).toBeTruthy();
    expect(find(first, 'Ada')).toBeTruthy();
    expect(find(first, 'Body1')).toBeTruthy();
  });

  it('places headers upright on rotated and cropped pages, and honours the page scope', async () => {
    const result = await applyHeaderFooter(await doc(3, { rotate: { 2: 90 }, crop: 50 }),
      hfSpec({ header: { left: '', center: 'TOP', right: '' }, footer: { left: '', center: '', right: '' }, scope: { pages: '2-3', skipFirst: false } }));
    const pages = await shown(result.bytes);
    expect(pages[0].items.map((i) => i.str)).toEqual(['Body1']);
    const rotated = pages[1];
    expect(rotated.width).toBeCloseTo(700, 0); // 800 - 2*50 shown sideways
    const top = find(rotated, 'TOP');
    expect(top.y).toBeLessThan(60);
    expect(Math.abs(top.x - rotated.width / 2)).toBeLessThan(30);
    expect(find(pages[2], 'TOP').y).toBeLessThan(60);
  });

  it('skips the first page and rejects unknown fields and empty input', async () => {
    const result = await applyHeaderFooter(await doc(2), hfSpec({ scope: { pages: 'all', skipFirst: true } }));
    const pages = await shown(result.bytes);
    expect(pages[0].items.map((i) => i.str)).toEqual(['Body1']);
    await expect(applyHeaderFooter(await doc(1), hfSpec({ header: { left: '{oops}', center: '', right: '' } }))).rejects.toThrow(/not a known field/);
    await expect(applyHeaderFooter(await doc(1), hfSpec({ header: { left: '', center: '', right: '' }, footer: { left: '', center: '', right: '' } })))
      .rejects.toThrow(/at least one/);
    await expect(applyHeaderFooter(await doc(1), hfSpec({ header: { left: 'Привет', center: '', right: '' } }))).rejects.toThrow(/cannot show/);
  });
});

describe('indirect content arrays', () => {
  it('keeps the original page content when /Contents is an indirect array', async () => {
    const pdf = await PDFDocument.load(await doc(1));
    const node = pdf.getPage(0).node;
    const array = node.get(PDFName.of('Contents'));
    const list = array instanceof PDFArray ? array : pdf.context.obj([array as never]);
    node.set(PDFName.of('Contents'), pdf.context.register(list));
    const result = await applyTextWatermark(await pdf.save(), { text: 'MARK', style: text, position: 'center', margin: 0, rotation: 0, opacity: 1, layer: 'above', scope: all });
    const [page] = await shown(result.bytes);
    expect(page.items.map((i) => i.str).sort()).toEqual(['Body1', 'MARK']);
  });
});

describe('signed documents', () => {
  it('refuses to stamp signed or certified PDFs, but allows unsigned signature placeholders', async () => {
    const mark = { text: 'MARK', style: text, position: 'center' as const, margin: 0, rotation: 0, opacity: 1, layer: 'above' as const, scope: all };
    const make = async (change: (pdf: PDFDocument) => void) => { const pdf = await PDFDocument.load(await doc(1)); change(pdf); return pdf.save(); };
    const signed = await make((pdf) => { pdf.context.register(pdf.context.obj({ FT: 'Sig', T: 'S', V: pdf.context.obj({ Type: 'Sig', ByteRange: [0, 1, 2, 3] }) })); });
    await expect(applyTextWatermark(signed, mark)).rejects.toThrow(/signed; stamping it would invalidate/);
    const certified = await make((pdf) => { pdf.catalog.set(PDFName.of('Perms'), pdf.context.obj({})); });
    await expect(applyTextWatermark(certified, mark)).rejects.toThrow(/certified/);
    const placeholder = await make((pdf) => { pdf.context.register(pdf.context.obj({ FT: 'Sig', T: 'S' })); });
    await expect(applyTextWatermark(placeholder, mark)).resolves.toBeTruthy();
  });
});

describe('applyPageNumbers (MAL-018)', () => {
  it('numbers chosen pages with format, prefix, suffix, start, total, alignment and margins', async () => {
    const result = await applyPageNumbers(await doc(4), {
      format: 'roman-upper', prefix: 'p. ', suffix: '', start: 3, showTotal: true, position: 'bottom-right',
      marginX: 40, marginY: 24, text, scope: { pages: 'all', skipFirst: true },
    });
    expect([result.pages, result.first, result.last]).toEqual([3, 'p. III of V', 'p. V of V']);
    const pages = await shown(result.bytes);
    expect(pages[0].items.map((i) => i.str)).toEqual(['Body1']);
    const label = find(pages[1], 'p. III of V');
    expect(label.y).toBeGreaterThan(800 - 24 - 14);
    expect(label.x).toBeGreaterThan(450);
    expect(find(pages[3], 'p. V of V')).toBeTruthy();
  });
});

describe('watermarks (MAL-019, MAL-020)', () => {
  it('draws rotated, translucent text above or below the content', async () => {
    const above = await applyTextWatermark(await doc(2), {
      text: 'CONFIDENTIAL', style: { font: 'helvetica-bold', size: 60, color: '#cc0000' }, position: 'center', margin: 20,
      rotation: 45, opacity: 0.3, layer: 'above', scope: { pages: '2', skipFirst: false },
    });
    const pages = await shown(above.bytes);
    expect(pages[0].items.map((i) => i.str)).toEqual(['Body1']);
    expect(find(pages[1], 'CONFIDENTIAL')).toBeTruthy();
    const pdf = await PDFDocument.load(above.bytes);
    const content = streams(pdf, 1);
    const ours = content[content.length - 1];
    expect(ours).toMatch(/MalenjoGS/);
    expect(content[0].trim()).toBe('q');
    const gs = pdf.getPage(1).node.Resources()!.lookup(PDFName.of('ExtGState'));
    expect(String(gs)).toMatch(/\/ca 0\.3/);
    // 45° rotation in the text matrix.
    expect(ours).toMatch(/0\.70710\d* 0\.70710\d* -0\.70710\d* 0\.70710\d* /);

    const below = await applyTextWatermark(await doc(1), {
      text: 'DRAFT', style: { font: 'times', size: 40, color: '#888888' }, position: 'top-left', margin: 20,
      rotation: 0, opacity: 1, layer: 'below', scope: all,
    });
    const belowDoc = await PDFDocument.load(below.bytes);
    expect(streams(belowDoc, 0)[0]).toMatch(/DRAFT|\(|</);
    const shownBelow = (await shown(below.bytes))[0];
    expect(find(shownBelow, 'DRAFT').x).toBeCloseTo(20, 0);
  });

  it('places a scaled, translucent image watermark with layer order and rejects non-images', async () => {
    // 2x1 red PNG.
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDAAAAQBQEAzYPXwAAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const result = await applyImageWatermark(await doc(1, { rotate: { 1: 90 } }), {
      image: png, scalePercent: 50, position: 'bottom-left', margin: 10, rotation: 0, opacity: 0.5, layer: 'below', scope: all,
    });
    const pdf = await PDFDocument.load(result.bytes);
    const first = streams(pdf, 0)[0];
    // Width 50% of the shown width (800 on a 90° page) = 400 x 200, mapped into the rotated page space.
    expect(first).toMatch(/MalenjoIm-?\d+ Do/);
    expect(first).toMatch(/0 400 -200 0 /);
    await expect(applyImageWatermark(await doc(1), { image: new Uint8Array([1, 2, 3, 4]), scalePercent: 50, position: 'center', margin: 0, rotation: 0, opacity: 1, layer: 'above', scope: all }))
      .rejects.toThrow(/PNG or JPEG/);
    await expect(applyTextWatermark(await doc(1), { text: 'X', style: text, position: 'center', margin: 0, rotation: 0, opacity: 0, layer: 'above', scope: all }))
      .rejects.toThrow(/Opacity/);
  });
});
