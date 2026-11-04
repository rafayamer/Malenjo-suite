import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { addPdfDrawing, addPdfTextMarkup, deletePdfMarkupAnnotation, listPdfMarkupAnnotations, updatePdfMarkupAnnotation, type MarkupStyle } from './pdfMarkup';

const style: MarkupStyle = { color: '#ffcc00', opacity: 0.6, width: 2 };

async function doc(rotate = 0) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([600, 800]);
  page.drawText('Quarterly results', { x: 100, y: 600, size: 20, font });
  if (rotate) page.setRotation(degrees(rotate));
  pdf.addPage([600, 800]);
  return pdf.save();
}

async function annotations(bytes: Uint8Array, pageNumber = 1) {
  const loading = getDocument({ data: bytes.slice(), useSystemFonts: true });
  const pdf = await loading.promise;
  const page = await pdf.getPage(pageNumber);
  const list = await page.getAnnotations();
  const text = (await page.getTextContent()).items.map((i) => 'str' in i ? { str: i.str, x: i.transform[4], y: i.transform[5], w: i.width } : null).filter(Boolean);
  const viewport = page.getViewport({ scale: 1 });
  await loading.destroy();
  return { list: list as Record<string, unknown>[], text, viewport };
}

/** Shown-page fraction rectangle around page-space text at (100,600), 20 pt, width w, on an unrotated 600x800 page. */
const textRect = (w: number) => ({ x: 100 / 600, y: (800 - 600 - 16) / 800, width: w / 600, height: 22 / 800 });

describe('text markup (MAL-054)', () => {
  it('stores highlight quads over the selected text, with colour, opacity and an appearance', async () => {
    const source = await doc();
    const { text } = await annotations(source);
    const word = text[0]!;
    const bytes = await addPdfTextMarkup(source, { pageNumber: 1, viewRotation: 0, kind: 'Highlight', rects: [textRect(word.w)], text: 'Quarterly results', note: '', author: 'Ada', style });
    const { list } = await annotations(bytes);
    const highlight = list.find((a) => a.subtype === 'Highlight')!;
    expect(highlight.contentsObj).toMatchObject({ str: 'Quarterly results' });
    expect(Array.from(highlight.color as Uint8ClampedArray)).toEqual([255, 204, 0]);
    expect(highlight.hasAppearance).toBe(true);
    const quad = (highlight.quadPoints as Float32Array);
    const xs = [quad[0], quad[2]]; const ys = [quad[1], quad[5]];
    expect(Math.min(...xs)).toBeCloseTo(word.x, 0);
    expect(Math.max(...xs)).toBeCloseTo(word.x + word.w, 0);
    expect(Math.min(...ys)).toBeLessThan(word.y);
    expect(Math.max(...ys)).toBeGreaterThan(word.y + 12);
  });

  it('maps a selection on a rotated page into page space and supports underline, strikeout and squiggly', async () => {
    const source = await doc(90);
    // On a 90° page the text runs downward; the shown frame is 800 wide x 600 high. Page +y points right and
    // page +x points down, so text at page x 100..260, y 598..620 appears at shown x 598..620, y 100..260 from the top.
    let bytes = source;
    for (const kind of ['Underline', 'StrikeOut', 'Squiggly'] as const) {
      bytes = await addPdfTextMarkup(bytes, { pageNumber: 1, viewRotation: 0, kind, rects: [{ x: 598 / 800, y: 100 / 600, width: 22 / 800, height: 160 / 600 }], text: 'Quarterly results', note: 'check', author: 'Ada', style });
    }
    const { list } = await annotations(bytes);
    expect(list.map((a) => a.subtype)).toEqual(['Underline', 'StrikeOut', 'Squiggly']);
    const quad = list[0].quadPoints as Float32Array;
    const xs = [quad[0], quad[2], quad[4], quad[6]]; const ys = [quad[1], quad[3], quad[5], quad[7]];
    expect(Math.min(...xs)).toBeCloseTo(100, 0);
    expect(Math.max(...xs)).toBeCloseTo(260, 0);
    expect(Math.min(...ys)).toBeCloseTo(598, 0);
    expect(Math.max(...ys)).toBeCloseTo(620, 0);
    // The quad's first edge (top-left -> top-right) runs along the text baseline (page x), not across it.
    expect(quad[2] - quad[0]).toBeCloseTo(160, 0);
    expect(quad[3]).toBeCloseTo(quad[1], 3);
  });
});

describe('drawings and notes (MAL-055)', () => {
  it('creates freehand, arrow, rectangle, ellipse, text box, callout and sticky note annotations', async () => {
    let bytes = await doc();
    const base = { pageNumber: 2, viewRotation: 0, author: 'Ada', style: { color: '#cc0000', opacity: 1, width: 3 } };
    bytes = await addPdfDrawing(bytes, { ...base, kind: 'Ink', points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.15 }, { x: 0.3, y: 0.1 }] });
    bytes = await addPdfDrawing(bytes, { ...base, kind: 'Arrow', points: [{ x: 0.1, y: 0.5 }, { x: 0.5, y: 0.5 }] });
    bytes = await addPdfDrawing(bytes, { ...base, kind: 'Square', rect: { x: 0.5, y: 0.1, width: 0.2, height: 0.1 } });
    bytes = await addPdfDrawing(bytes, { ...base, kind: 'Circle', rect: { x: 0.5, y: 0.3, width: 0.2, height: 0.1 } });
    bytes = await addPdfDrawing(bytes, { ...base, kind: 'FreeText', rect: { x: 0.1, y: 0.7, width: 0.4, height: 0.1 }, text: 'Please review' });
    bytes = await addPdfDrawing(bytes, { ...base, kind: 'Callout', points: [{ x: 0.8, y: 0.8 }], rect: { x: 0.55, y: 0.6, width: 0.3, height: 0.08 }, text: 'Totals here' });
    bytes = await addPdfDrawing(bytes, { ...base, kind: 'Note', points: [{ x: 0.9, y: 0.05 }], text: 'Sticky remark' });
    const { list } = await annotations(bytes, 2);
    expect(list.map((a) => a.subtype)).toEqual(['Ink', 'Line', 'Square', 'Circle', 'FreeText', 'FreeText', 'Text']);
    expect(list.every((a) => a.hasAppearance)).toBe(true);
    const ink = list[0].inkLists as Float32Array[];
    expect(Array.from(ink[0]).slice(0, 2).map(Math.round)).toEqual([60, 720]);
    expect(Array.from(list[1].lineCoordinates as Float32Array).map(Math.round)).toEqual([60, 400, 300, 400]);
    expect(Array.from(list[2].rect as number[]).map(Math.round)).toEqual([299, 639, 422, 722]); // 300..420 x 640..720 plus half the 3 pt line
    expect(list[4].contentsObj).toMatchObject({ str: 'Please review' });
    expect(list[6].contentsObj).toMatchObject({ str: 'Sticky remark' });

    const items = await listPdfMarkupAnnotations(bytes);
    expect(items.map((i) => i.label)).toEqual(['Freehand', 'Arrow', 'Rectangle', 'Ellipse', 'Text box', 'Callout', 'Sticky note']);
  });

  it('draws a sticky note in its chosen colour, and recolours it on edit', async () => {
    const ap = async (b: Uint8Array) => { const p = await PDFDocument.load(b); const a = p.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict); return new TextDecoder().decode(decodePDFRawStream(p.context.lookup(a.lookup(PDFName.of('AP'), PDFDict).get(PDFName.of('N'))) as PDFRawStream).decode()); };
    let bytes = await addPdfDrawing(await doc(), { pageNumber: 1, viewRotation: 0, author: 'Ada', style: { ...style, color: '#3366ff' }, kind: 'Note', points: [{ x: 0.5, y: 0.5 }], text: 'Blue note' });
    expect(await ap(bytes)).toMatch(/\n0\.2 0\.4 1 rg [\d.]+ [\d.]+ 20 20 re f 0\.07 0\.14 0\.35 RG/);
    const [note] = await listPdfMarkupAnnotations(bytes);
    bytes = await updatePdfMarkupAnnotation(bytes, note, { color: '#00aa44' });
    expect(await ap(bytes)).toMatch(/\n0 0\.66\d* 0\.26\d* rg [\d.]+ [\d.]+ 20 20 re f 0 0\.23\d* 0\.09\d* RG/);
  });

  it('keeps an imported shape\'s interior colour when its style changes, and refuses signed PDFs', async () => {
    const pdf = await PDFDocument.load(await doc());
    const square = pdf.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [100, 100, 200, 160], C: [0, 0, 1], IC: [1, 1, 0], BS: { W: 2 } });
    pdf.getPage(0).node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(square)]));
    let bytes = await pdf.save();
    const [item] = await listPdfMarkupAnnotations(bytes);
    bytes = await updatePdfMarkupAnnotation(bytes, item, { opacity: 0.5 });
    const p2 = await PDFDocument.load(bytes);
    const annot = p2.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict);
    const ap = new TextDecoder().decode(decodePDFRawStream(p2.context.lookup(annot.lookup(PDFName.of('AP'), PDFDict).get(PDFName.of('N'))) as PDFRawStream).decode());
    expect(ap).toMatch(/1 1 0 rg [\d. ]+ re B/);
    const signed = await PDFDocument.load(bytes);
    signed.context.register(signed.context.obj({ FT: 'Sig', V: signed.context.obj({ Type: 'Sig', ByteRange: [0, 1, 2, 3] }) }));
    const signedBytes = await signed.save();
    await expect(updatePdfMarkupAnnotation(signedBytes, item, { opacity: 1 })).rejects.toThrow(/signed; changing its markup/);
    await expect(addPdfDrawing(signedBytes, { pageNumber: 1, viewRotation: 0, author: 'A', style, kind: 'Square', rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } })).rejects.toThrow(/signed/);
    expect(await listPdfMarkupAnnotations(signedBytes)).toHaveLength(1); // reading is still allowed
  });

  it('grows a freehand stroke\'s box when its line gets thicker', async () => {
    let bytes = await addPdfDrawing(await doc(), { pageNumber: 1, viewRotation: 0, author: 'Ada', style: { ...style, width: 2 }, kind: 'Ink', points: [{ x: 0.1, y: 0.5 }, { x: 0.5, y: 0.5 }] });
    const [ink] = await listPdfMarkupAnnotations(bytes);
    bytes = await updatePdfMarkupAnnotation(bytes, ink, { width: 24 });
    const { list } = await annotations(bytes);
    const rect = list[0].rect as number[];
    expect(rect[3] - rect[1]).toBeGreaterThanOrEqual(48);
  });

  it('edits colour and text, rebuilds the appearance, and deletes markup', async () => {
    let bytes = await addPdfDrawing(await doc(), { pageNumber: 1, viewRotation: 0, author: 'Ada', style, kind: 'FreeText', rect: { x: 0.1, y: 0.1, width: 0.4, height: 0.1 }, text: 'Draft' });
    let [item] = await listPdfMarkupAnnotations(bytes);
    bytes = await updatePdfMarkupAnnotation(bytes, item, { color: '#0000ff', contents: 'Final' });
    [item] = await listPdfMarkupAnnotations(bytes);
    expect([item.color, item.contents]).toEqual(['#0000ff', 'Final']);
    // A text box drawn in a 90° view keeps its orientation when its style is edited.
    let turned = await addPdfDrawing(await doc(), { pageNumber: 1, viewRotation: 90, author: 'Ada', style, kind: 'FreeText', rect: { x: 0.1, y: 0.1, width: 0.4, height: 0.1 }, text: 'Turned' });
    const ap = async (b: Uint8Array) => { const p = await PDFDocument.load(b); const a = p.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict); return new TextDecoder().decode(decodePDFRawStream(p.context.lookup(a.lookup(PDFName.of('AP'), PDFDict).get(PDFName.of('N'))) as PDFRawStream).decode()); };
    const before = (await ap(turned)).match(/q ([-\d. ]+) cm/)![1];
    const [turnedItem] = await listPdfMarkupAnnotations(turned);
    turned = await updatePdfMarkupAnnotation(turned, turnedItem, { color: '#ff0000' });
    expect((await ap(turned)).match(/q ([-\d. ]+) cm/)![1]).toBe(before);
    bytes = await deletePdfMarkupAnnotation(bytes, item);
    expect(await listPdfMarkupAnnotations(bytes)).toEqual([]);
    await expect(updatePdfMarkupAnnotation(bytes, item, { color: '#000000' })).rejects.toThrow(/changed or was removed/);
    await expect(addPdfDrawing(bytes, { pageNumber: 1, viewRotation: 0, author: '', style, kind: 'FreeText', rect: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 }, text: '' })).rejects.toThrow(/Enter the text/);
  });
});
