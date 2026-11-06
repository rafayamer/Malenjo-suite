import { describe, expect, it } from 'vitest';
import { unzlibSync } from 'fflate';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { cropRgba, encodePng, encodeTiff, removeBackground, setJpegDensity, type Rgba } from './imageCodecs';
import { blocksOf, documentHeadingSizes, pageText, readPdfStructure } from './pdfStructure';
import { pdfToHtml, pdfToMarkdown, pdfToPlainText } from './textFormats';
import { pdfToSvg } from './svgExport';

const text = (b: Uint8Array) => new TextDecoder().decode(b);
const image = (w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): Rgba => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
};
const QUAD: [number, number, number, number][] = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255]];

/** Parses our PNG output back to pixels (IHDR, pHYs, IDAT with Sub filter). */
function readPng(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset);
  let o = 8; const chunks: Record<string, Uint8Array> = {}; const idat: Uint8Array[] = [];
  while (o < png.length) { const len = view.getUint32(o); const type = text(png.subarray(o + 4, o + 8)); const data = png.subarray(o + 8, o + 8 + len); if (type === 'IDAT') idat.push(data); else chunks[type] = data; o += 12 + len; }
  const ih = new DataView(chunks.IHDR.buffer, chunks.IHDR.byteOffset);
  const width = ih.getUint32(0), height = ih.getUint32(4), channels = chunks.IHDR[9] === 6 ? 4 : 3;
  const raw = unzlibSync(Uint8Array.from(idat.flatMap((c) => [...c])));
  const px: number[][] = [];
  for (let y = 0; y < height; y++) { const row = raw.subarray(y * (width * channels + 1) + 1, (y + 1) * (width * channels + 1)); const out = Uint8Array.from(row); for (let i = channels; i < out.length; i++) out[i] = (out[i] + out[i - channels]) & 255; for (let x = 0; x < width; x++) px.push([...out.subarray(x * channels, x * channels + channels)]); }
  const ph = new DataView(chunks.pHYs.buffer, chunks.pHYs.byteOffset);
  return { width, height, channels, px, dpi: Math.round(ph.getUint32(0) * 0.0254) };
}

describe('image codecs (MAL-029, MAL-036)', () => {
  it('writes PNG with alpha and resolution, and removes a background colour with a soft edge', () => {
    const img = image(3, 2, (x) => (x === 0 ? [255, 255, 255, 255] : x === 1 ? [250, 250, 250, 255] : [10, 20, 30, 255]));
    const opaque = readPng(encodePng(img, 300));
    expect([opaque.channels, opaque.dpi, opaque.px[2]]).toEqual([3, 300, [10, 20, 30]]);
    const cut = readPng(encodePng(removeBackground(img, [255, 255, 255], 2), 150));
    expect(cut.channels).toBe(4);
    expect(cut.px[0][3]).toBe(0);
    expect(cut.px[1][3]).toBeGreaterThan(0); expect(cut.px[1][3]).toBeLessThan(255);
    expect(cut.px[2]).toEqual([10, 20, 30, 255]);
    expect(cropRgba(img, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 })).toMatchObject({ width: 2, height: 1 });
  });

  it('writes baseline TIFF pages (uncompressed and Deflate) and JPEG density', () => {
    const a = image(2, 1, () => [1, 2, 3, 255]), b = image(1, 1, () => [9, 8, 7, 128]);
    for (const compression of ['none', 'deflate'] as const) {
      const tiff = encodeTiff([a, b], { dpi: 200, compression });
      const v = new DataView(tiff.buffer);
      expect(text(tiff.subarray(0, 2))).toBe('II'); expect(v.getUint16(2, true)).toBe(42);
      const ifd = (at: number) => { const n = v.getUint16(at, true); const tags: Record<number, number> = {}; for (let i = 0; i < n; i++) { const e = at + 2 + i * 12; const type = v.getUint16(e + 2, true); tags[v.getUint16(e, true)] = type === 3 && v.getUint32(e + 4, true) === 1 ? v.getUint16(e + 8, true) : v.getUint32(e + 8, true); } return { tags, next: v.getUint32(at + 2 + n * 12, true) }; };
      const first = ifd(v.getUint32(4, true)), second = ifd(first.next);
      expect([first.tags[256], first.tags[257], first.tags[277], first.tags[259]]).toEqual([2, 1, 3, compression === 'deflate' ? 8 : 1]);
      expect([second.tags[277], second.tags[338], second.next]).toEqual([4, 2, 0]);
      const strip = tiff.subarray(first.tags[273], first.tags[273] + first.tags[279]);
      expect([...(compression === 'deflate' ? unzlibSync(strip) : strip)]).toEqual([1, 2, 3, 1, 2, 3]);
      expect(v.getUint32(first.tags[282], true)).toBe(200);
    }
    const jfif = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    expect([...setJpegDensity(jfif, 300).subarray(13, 18)]).toEqual([1, 1, 44, 1, 44]);
  });
});

async function report() {
  const pdf = await PDFDocument.create();
  const [regular, bold] = [await pdf.embedFont(StandardFonts.Helvetica), await pdf.embedFont(StandardFonts.HelveticaBold)];
  const p = pdf.addPage([612, 792]);
  p.drawText('Quarterly Report', { x: 72, y: 720, size: 24, font: bold });
  p.drawText('Overview', { x: 72, y: 680, size: 16, font: bold });
  p.drawText('Revenue grew in every region during the quarter and', { x: 72, y: 655, size: 11, font: regular });
  p.drawText('costs stayed flat.', { x: 72, y: 641, size: 11, font: regular });
  ['• Faster delivery', '• Lower churn'].forEach((t, i) => p.drawText(t, { x: 72, y: 610 - i * 15, size: 11, font: regular }));
  ['1. Hire staff', '2. Open office'].forEach((t, i) => p.drawText(t, { x: 72, y: 570 - i * 15, size: 11, font: regular }));
  [['Region', 'Q1', 'Q2'], ['North', '10', '12'], ['South', '8', '9']].forEach((row, r) => row.forEach((c, k) => p.drawText(c, { x: 72 + k * 120, y: 520 - r * 16, size: 11, font: regular })));
  p.drawImage(await pdf.embedPng(encodePng(image(2, 2, (x, y) => QUAD[y * 2 + x]))), { x: 72, y: 380, width: 100, height: 60 });
  p.drawRectangle({ x: 300, y: 380, width: 100, height: 50, color: rgb(1, 0, 0), borderColor: rgb(0, 0, 1), borderWidth: 2 });
  const two = pdf.addPage([612, 792]);
  two.drawText('Left one', { x: 72, y: 700, size: 11, font: regular }); two.drawText('Right one', { x: 340, y: 700, size: 11, font: regular });
  two.drawText('Left two', { x: 72, y: 685, size: 11, font: regular }); two.drawText('Right two', { x: 340, y: 685, size: 11, font: regular });
  two.drawText('Left three', { x: 72, y: 670, size: 11, font: regular }); two.drawText('Right three', { x: 340, y: 670, size: 11, font: regular });
  two.setRotation(degrees(0));
  return pdf.save();
}
async function structure(bytes: Uint8Array) {
  const loading = getDocument({ data: bytes.slice(), isOffscreenCanvasSupported: false, fontExtraProperties: true, useSystemFonts: false } as never);
  const doc = await loading.promise;
  try { return await readPdfStructure(doc, [1, 2], { images: true, ops: OPS as never }); } finally { await loading.destroy(); }
}

describe('structured text formats (MAL-041, 042, 044)', () => {
  it('rebuilds headings, paragraphs, lists, tables and images', async () => {
    const pages = await structure(await report());
    const blocks = blocksOf(pages[0], documentHeadingSizes(pages));
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'heading', 'paragraph', 'list', 'list', 'table', 'image']);
    expect(blocks[0]).toMatchObject({ level: 1, text: 'Quarterly Report' });
    expect(blocks[1]).toMatchObject({ level: 2, text: 'Overview' });
    expect(blocks[2]).toMatchObject({ text: 'Revenue grew in every region during the quarter and costs stayed flat.' });
    expect(blocks[3]).toMatchObject({ ordered: false, items: ['Faster delivery', 'Lower churn'] });
    expect(blocks[4]).toMatchObject({ ordered: true, items: ['Hire staff', 'Open office'] });
    expect(blocks[5]).toMatchObject({ rows: [['Region', 'Q1', 'Q2'], ['North', '10', '12'], ['South', '8', '9']] });
    expect(pages[0].images[0].image).toMatchObject({ width: 2, height: 2 });
  });

  it('writes Markdown and HTML with image files, and plain text in each reading order', async () => {
    const pages = await structure(await report());
    const md = pdfToMarkdown(pages, { images: true, title: 'report' });
    const mdText = text(md.files[0].bytes);
    expect(mdText).toContain('# Quarterly Report\n\n## Overview\n\nRevenue grew');
    expect(mdText).toContain('- Faster delivery\n- Lower churn');
    expect(mdText).toContain('1. Hire staff\n2. Open office');
    expect(mdText).toContain('| Region | Q1 | Q2 |\n| --- | --- | --- |\n| North | 10 | 12 |');
    expect(mdText).toContain('![Page 1 image 1](assets/page-1-image-1.png)');
    expect(md.files.map((f) => f.name)).toEqual(['report.md', 'assets/page-1-image-1.png']);
    expect(readPng(md.files[1].bytes).px).toEqual([[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]]);
    const html = text(pdfToHtml(pages, { images: true, title: 'report', layout: 'semantic' }).files[0].bytes);
    expect(html).toContain('<h1>Quarterly Report</h1>');
    expect(html).toContain('<table><thead><tr><th>Region</th><th>Q1</th><th>Q2</th></tr></thead><tbody><tr><td>North</td>');
    expect(html).toContain('<ul><li>Faster delivery</li><li>Lower churn</li></ul>');
    expect(html).toContain('<img src="assets/page-1-image-1.png"');
    const positioned = text(pdfToHtml(pages, { images: false, title: 'report', layout: 'positioned' }).files[0].bytes);
    expect(positioned).toMatch(/<span style="left:72pt;top:[\d.]+pt;font-size:24pt;font-weight:bold">Quarterly Report<\/span>/);
    expect(pageText(pages[1], 'columns')).toBe('Left one\nLeft two\nLeft three\nRight one\nRight two\nRight three');
    expect(pageText(pages[1], 'rows')).toBe('Left one\tRight one\nLeft two\tRight two\nLeft three\tRight three');
    const plain = text(pdfToPlainText(pages, 2, { order: 'rows', separator: 'custom', template: '=== Page {n} of {total} ===', title: 'r' }).files[0].bytes);
    expect(plain.startsWith('=== Page 1 of 2 ===\nQuarterly Report')).toBe(true);
    expect(plain).toContain('\n=== Page 2 of 2 ===\nLeft one');
    expect(text(pdfToPlainText(pages, 2, { order: 'stored', separator: 'formfeed', template: '', title: 'r' }).files[0].bytes)).toContain('\f');
  });
});

describe('SVG export (MAL-043)', () => {
  it('keeps paths, text and images as SVG elements', async () => {
    const result = await pdfToSvg(await report(), [1], 'report');
    const svg = text(result.files[0].bytes);
    expect(svg).toMatch(/<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="612pt" height="792pt"/);
    expect(svg).toMatch(/<path d="M0 0L0 50L100 50L100 0Z" transform="matrix\(1 0 0 1 300 380\)" fill="#ff0000" stroke="#0000ff" stroke-width="2"\/>/);
    expect(svg).toMatch(/<text transform="matrix\(24 0 0 24 72 720\) scale\(1 -1\)" font-size="1" font-family="Helvetica, sans-serif" font-weight="bold" fill="#000000" textLength="[\d.]+" lengthAdjust="spacingAndGlyphs" xml:space="preserve">Quarterly Report<\/text>/);
    expect(svg).toMatch(/<image width="1" height="1" preserveAspectRatio="none" transform="matrix\(100 0 0 60 72 380\) matrix\(1 0 0 -1 0 1\)" href="data:image\/png;base64,/);
    expect(svg).toContain('<g transform="matrix(1 0 0 -1 0 792)">');
    expect(result.notes).toEqual(['Every graphic on these pages was converted.']);
  });

  it('leaves invisible text out of the SVG and outlines stroked text', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([300, 300]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const key = page.node.newFontDictionary('F', font.ref).decodeText();
    page.node.addContentStream(pdf.context.register(pdf.context.stream(`BT 3 Tr /${key} 12 Tf 20 200 Td (Hidden OCR) Tj ET BT 1 Tr 0 0 1 RG /${key} 12 Tf 20 100 Td (Outlined) Tj ET`)));
    const svg = text((await pdfToSvg(await pdf.save(), [1], 'modes')).files[0].bytes);
    expect(svg).not.toContain('Hidden OCR');
    expect(svg).toMatch(/fill="none" stroke="#0000ff"[^>]*>Outlined</);
  });
});

describe('multi-page TIFF budget', () => {
  it('counts every page kept for a multi-page TIFF against the 400 MB limit', async () => {
    const { pdfToImages } = await import('./rasterExport');
    const canvas = () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: { length: w * h * 4 } }) }) });
    const original = globalThis.document;
    (globalThis as { document?: unknown }).document = { createElement: canvas };
    try {
      const doc = { getPage: async () => ({ getViewport: () => ({ width: 6000, height: 6000 }), render: () => ({ promise: Promise.resolve() }), cleanup() {} }) };
      const options = { format: 'tiff' as const, dpi: 72, quality: 0.9, transparent: false, removeColor: null, region: null, tiffMultipage: true, tiffCompression: 'none' as const };
      await expect(pdfToImages(doc as never, [1, 2, 3], options as never, 'big')).rejects.toThrow(/exceed 400 MB/);
    } finally { (globalThis as { document?: unknown }).document = original; }
  });

describe('region export rotation', () => {
  it('renders a region with the view rotation it was drawn in', async () => {
    const { pdfToImages } = await import('./rasterExport');
    const seen: unknown[] = [];
    const canvas = () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) }) });
    const original = globalThis.document;
    (globalThis as { document?: unknown }).document = { createElement: canvas };
    try {
      const doc = { getPage: async () => ({ rotate: 90, getViewport: (o: unknown) => { seen.push(o); return { width: 20, height: 10 }; }, render: () => ({ promise: Promise.resolve() }), cleanup() {} }) };
      const options = { format: 'png' as const, dpi: 72, quality: 0.9, transparent: false, removeColor: null, region: { pageNumber: 1, x: 0, y: 0, width: 0.5, height: 0.5, viewRotation: 180 }, tiffMultipage: false, tiffCompression: 'none' as const };
      await pdfToImages(doc as never, [1], options as never, 'r');
      expect(seen).toEqual([{ scale: 1, rotation: 270 }]);
    } finally { (globalThis as { document?: unknown }).document = original; }
  });
});
});
