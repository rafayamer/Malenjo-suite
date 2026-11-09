import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { findRedactionText, redactPdf, redactionTerms, type RedactionMark } from './pdfRedact';
import { pdfjsImageDecoder } from './redactImages';

const N = PDFName.of;
const JPEG = Uint8Array.from(atob('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAIBAQEBAQIBAQECAgICAgQDAgICAgUEBAMEBgUGBgYFBgYGBwkIBgcJBwYGCAsICQoKCgoKBggLDAsKDAkKCgr/2wBDAQICAgICAgUDAwUKBwYHCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgr/wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDcrPrQrPrH6In/ADOv+5b/ANznzf0y/wDmRf8Ac1/7rn//2Q=='), (c) => c.charCodeAt(0));
const decodeImage = pdfjsImageDecoder(getDocument as never, OPS.paintImageXObject);

/** Everything the file holds, every stream decompressed: what someone digging through the bytes would find. */
async function everything(bytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  let out = new TextDecoder('latin1').decode(bytes);
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream) { try { out += new TextDecoder('latin1').decode(decodePDFRawStream(object).decode()); } catch { /* image data */ } }
  }
  return out;
}
/** Literal or hex-encoded (as text strings are often written). */
const holds = (raw: string, s: string) => {
  const hex = Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('');
  return raw.includes(s) || raw.toLowerCase().replace(/\s/g, '').includes(hex);
};
async function read(bytes: Uint8Array) {
  const loading = getDocument({ data: bytes.slice(), isOffscreenCanvasSupported: false, isImageDecoderSupported: false } as never);
  const doc = await loading.promise;
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const items = ((await page.getTextContent()).items as { str: string; transform: number[] }[]).filter((i) => i.str.trim());
      pages.push({ text: items.map((i) => i.str).join('|'), items, annots: (await page.getAnnotations()).map((a: { subtype: string }) => a.subtype) });
    }
    return { pages, info: (await doc.getMetadata()).info as Record<string, unknown>, outline: ((await doc.getOutline()) ?? []).map((o: { title: string }) => o.title) };
  } finally { await loading.destroy(); }
}
const fontKey = (page: { node: { Resources(): PDFDict | undefined } }) => (page.node.Resources()!.lookup(N('Font')) as PDFDict).keys()[0].decodeText();

async function letter() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([400, 300]);
  page.drawText('Patient: John Smith, born 1980', { x: 30, y: 250, size: 12, font });
  page.drawText('Diagnosis follows below', { x: 30, y: 236, size: 12, font });
  const f = fontKey(page);
  // Kerned text, invisible (OCR) text and replacement text over a name.
  page.node.addContentStream(pdf.context.register(pdf.context.stream(
    `BT /${f} 12 Tf 30 200 Td [(Contact J) -15 (ane Doe) 10 ( today)] TJ ET BT 3 Tr /${f} 12 Tf 30 180 Td (OCR Jane Doe) Tj ET /Span <</ActualText (Jane Doe)>> BDC BT /${f} 12 Tf 30 160 Td (Jane Doe) Tj ET EMC`)));
  pdf.setTitle('Notes on John Smith'); pdf.setAuthor('Clinic');
  const outline = pdf.context.register(pdf.context.obj({ Title: PDFHexString.fromText('John Smith history'), Parent: null as never }));
  const outlines = pdf.context.register(pdf.context.obj({ Type: 'Outlines', First: outline, Last: outline, Count: 1 }));
  (pdf.context.lookup(outline) as PDFDict).set(N('Parent'), outlines);
  pdf.catalog.set(N('Outlines'), outlines);
  return pdf;
}

describe('Permanent redaction (MAL-063)', () => {
  it('removes marked text and the same words elsewhere, keeping the rest in place', async () => {
    const pdf = await letter();
    const source = await pdf.save();
    const before = await read(source);
    const matches = [...await findRedactionText(source, 'John Smith'), ...await findRedactionText(source, 'Jane Doe')];
    expect(matches.map((m) => m.text)).toEqual(['John Smith', 'Jane Doe', 'Jane Doe', 'Jane Doe']);
    const { bytes, report } = await redactPdf(source, { marks: matches.flatMap((m) => m.marks) });
    const after = await read(bytes);
    expect(after.pages[0].text).not.toMatch(/John|Smith|Jane|Doe/);
    expect(after.pages[0].text).toContain('Patient:'); expect(after.pages[0].text).toContain('born 1980');
    expect(after.pages[0].text).toContain('Diagnosis follows below'); expect(after.pages[0].text).toContain('today');
    // Text around the removed words keeps its position.
    const at = (r: Awaited<ReturnType<typeof read>>, s: string) => r.pages[0].items.find((i) => i.str.includes(s))!.transform.slice(4, 6).map(Math.round);
    expect(at(after, 'Diagnosis')).toEqual(at(before, 'Diagnosis'));
    const born = after.pages[0].items.find((i) => i.str.includes('born'))!;
    const bornBefore = before.pages[0].items.find((i) => i.str.includes('born'))!;
    expect(born.transform[4] + 0).toBeGreaterThan(bornBefore.transform[4] - 1);
    expect(after.info.Title).toBe('Notes on [REDACTED]'); expect(after.outline).toEqual(['[REDACTED] history']);
    expect(report.glyphs).toBeGreaterThanOrEqual(30); expect(report.markedContent).toBe(1);
    expect(report.elsewhere).toEqual(expect.arrayContaining(['Document information: Title', 'Bookmark: Title']));
    const raw = await everything(bytes);
    for (const secret of ['John', 'Smith', 'Jane', 'Doe', 'ane D']) expect(holds(raw, secret)).toBe(false);
    expect(holds(raw, 'Patient:')).toBe(true);
  });

  it('blacks out only the marked pixels of a Flate image and of a JPEG, leaving no copy of the original', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([300, 200]);
    const pixels = new Uint8Array(10 * 10 * 3).map((_, i) => 60 + (i % 3) * 50);
    const flate = pdf.context.register(pdf.context.flateStream(pixels, { Type: 'XObject', Subtype: 'Image', Width: 10, Height: 10, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }));
    page.node.setXObject(N('Flat'), flate);
    page.drawImage(await pdf.embedJpg(JPEG), { x: 150, y: 50, width: 100, height: 100 });
    page.node.addContentStream(pdf.context.register(pdf.context.stream('q 100 0 0 100 20 50 cm /Flat Do Q')));
    const source = await pdf.save();
    // Left half of each image.
    const marks: RedactionMark[] = [{ pageNumber: 1, box: [10, 40, 70, 160] }, { pageNumber: 1, box: [140, 40, 200, 160] }];
    const { bytes, report } = await redactPdf(source, { marks, decodeImage });
    expect(report.imagesEdited).toBe(2); expect(report.imagesRemoved).toBe(0);
    const out = await PDFDocument.load(bytes);
    const images = [...out.context.enumerateIndirectObjects()].map(([, o]) => o).filter((o): o is PDFRawStream => o instanceof PDFRawStream && o.dict.get(N('Subtype'))?.toString() === '/Image');
    expect(images.length).toBe(2);
    expect(images.every((i) => i.dict.get(N('Filter'))?.toString() === '/FlateDecode')).toBe(true); // the JPEG is gone
    for (const image of images) {
      const w = (image.dict.lookup(N('Width')) as never as { asNumber(): number }).asNumber();
      const data = decodePDFRawStream(image).decode();
      const px = (x: number, y: number) => Array.from(data.subarray((y * w + x) * 3, (y * w + x) * 3 + 3));
      expect(px(0, 0)).toEqual([0, 0, 0]); expect(px(Math.floor(w / 2) - 1, w - 1)).toEqual([0, 0, 0]);
      expect(Math.max(...px(w - 1, 0))).toBeGreaterThan(30); expect(Math.max(...px(w - 1, w - 1))).toBeGreaterThan(30);
    }
  });

  it('removes an image it cannot decode, inline images, paths with points inside, and keeps a frame around the area', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([300, 200]);
    page.drawImage(await pdf.embedJpg(JPEG), { x: 20, y: 20, width: 40, height: 40 });
    page.node.addContentStream(pdf.context.register(pdf.context.stream(
      'q 1 0 0 RG 5 5 290 190 re S Q q 0 0 1 rg 100 100 m 120 140 l 140 100 l f Q q 0 1 0 rg 200 20 30 30 re f Q q 40 0 0 40 20 120 cm BI /W 2 /H 2 /CS /G /BPC 8 ID \x00\xff\xff\x00 EI Q q 250 150 m 290 150 l 290 190 l h W n 0 g 240 140 60 60 re f Q')));
    const source = await pdf.save();
    const { bytes, report } = await redactPdf(source, { marks: [{ pageNumber: 1, box: [10, 10, 150, 170] }, { pageNumber: 1, box: [280, 160, 293, 193] }] });
    expect(report.imagesRemoved).toBe(2); // the JPEG without a decoder, and the inline image
    expect(report.paths).toBe(2); // the triangle and the clip; the page frame and the green square stay
    const content = await everything(bytes);
    expect(content).toContain('5 5 290 190 re'); expect(content).toContain('200 20 30 30 re');
    expect(content).not.toContain('120 140 l'); expect(content).not.toContain(' BI ');
    expect(content).toContain('250 150 40 40 re'); // the clip is now its bounding rectangle
    expect(content).not.toContain('DCTDecode');
  });

  it('redacts inside a form XObject as a private copy and removes annotations and fields in the area', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const [p1, p2] = [pdf.addPage([300, 200]), pdf.addPage([300, 200])];
    p1.drawText('x', { x: 0, y: 0, size: 1, font });
    const f = fontKey(p1);
    const form = pdf.context.register(pdf.context.stream(`BT /${f} 14 Tf 10 10 Td (Account 12345678) Tj ET`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 40], Resources: { Font: { [f]: (p1.node.Resources()!.lookup(N('Font')) as PDFDict).get(N(f)) } } }));
    for (const page of [p1, p2]) { page.node.setXObject(N('Fm0'), form); page.node.addContentStream(pdf.context.register(pdf.context.stream('q 1 0 0 1 20 100 cm /Fm0 Do Q'))); }
    const field = pdf.getForm().createTextField('account');
    field.setText('12345678'); field.addToPage(p1, { x: 20, y: 20, width: 100, height: 20 });
    const note = pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [200, 110, 220, 130], Contents: PDFHexString.fromText('see 12345678') }));
    p1.node.set(N('Annots'), pdf.context.obj([...(p1.node.lookup(N('Annots'), PDFArray)?.asArray() ?? []), note]));
    const source = await pdf.save();
    const marks = (await findRedactionText(source, '12345678')).filter((m) => m.pageNumber === 1).flatMap((m) => m.marks);
    const { bytes, report } = await redactPdf(source, { marks: [...marks, { pageNumber: 1, box: [15, 15, 130, 45] }, { pageNumber: 1, box: [195, 105, 225, 135] }] });
    expect(report.forms).toBe(1); expect(report.fields).toBe(1); expect(report.annotations).toBe(1);
    const after = await read(bytes);
    expect(after.pages[0].text).toContain('Account'); expect(after.pages[0].text).not.toContain('12345678');
    expect(after.pages[1].text).toContain('Account 12345678'); // the other page still draws the shared original
    expect(after.pages[0].annots).toEqual([]);
    expect((await PDFDocument.load(bytes)).getForm().getFields()).toHaveLength(0);
  });

  it('draws the box colour and label, refuses signed PDFs, and builds scrub terms', async () => {
    const pdf = await letter();
    const source = await pdf.save();
    const { bytes } = await redactPdf(source, { marks: [{ pageNumber: 1, box: [80, 245, 160, 262] }], fill: '#ffffff', label: '(b)(6)' });
    expect((await read(bytes)).pages[0].text).toContain('(b)(6)');
    await expect(redactPdf(source, { marks: [] })).rejects.toThrow('Mark at least one area');
    await expect(redactPdf(source, { marks: [{ pageNumber: 2, box: [0, 0, 10, 10] }] })).rejects.toThrow('not in this PDF');
    const signedDoc = await PDFDocument.load(source);
    const sig = signedDoc.context.register(signedDoc.context.obj({ FT: 'Sig', T: PDFHexString.fromText('S'), V: signedDoc.context.obj({ Type: 'Sig' }), Kids: [] }));
    signedDoc.catalog.set(N('AcroForm'), signedDoc.context.obj({ Fields: [sig] }));
    await expect(redactPdf(await signedDoc.save(), { marks: [{ pageNumber: 1, box: [0, 0, 10, 10] }] })).rejects.toThrow('digitally signed');
    expect(redactionTerms(['John Smith,', 'on', 'acct 12345678'])).toEqual(expect.arrayContaining(['John Smith,', 'John', 'Smith', '12345678']));
    expect(redactionTerms(['on'])).toEqual([]);
  });
});
