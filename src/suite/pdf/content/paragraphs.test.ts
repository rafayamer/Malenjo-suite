import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { listPdfParagraphs, reflowPdfParagraph, ParagraphOverflowError, type ParagraphStyle } from './paragraphs';
import { GlyphUnavailableError } from './textEdit';

async function sample() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([600, 800]);
  page.drawText('Quarterly report', { x: 72, y: 720, size: 24, font: bold });
  const lines = ['Revenue grew in every region during the', 'quarter, led by strong demand for the new', 'product line and steady renewals.'];
  lines.forEach((line, i) => page.drawText(line, { x: 72, y: 660 - i * 18, size: 14, font }));
  page.drawText('Page 1', { x: 280, y: 40, size: 10, font });
  return pdf.save();
}
const base: ParagraphStyle = { align: 'left', size: 14, lineHeight: 18 / 14, charSpacing: 0, wordSpacing: 0, font: 'keep' };

async function shownText(bytes: Uint8Array) {
  const loading = getDocument({ data: bytes.slice(), useSystemFonts: true });
  const doc = await loading.promise;
  const page = await doc.getPage(1);
  const items = (await page.getTextContent()).items.flatMap((i) => ('str' in i && i.str.trim() ? [{ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, font: i.fontName }] : []));
  await loading.destroy();
  return items;
}

describe('paragraphs (MAL-012, MAL-013)', () => {
  it('groups lines into paragraphs with font, size, line height and alignment', async () => {
    const paragraphs = await listPdfParagraphs(await sample(), 1);
    expect(paragraphs.map((p) => p.lines)).toEqual([1, 3, 1]);
    const body = paragraphs[1];
    expect(body.text).toBe('Revenue grew in every region during the\nquarter, led by strong demand for the new\nproduct line and steady renewals.');
    expect([body.fontName, body.embedded, body.size, body.lineHeight, body.align]).toEqual(['Helvetica', false, 14, 1.29, 'left']);
    expect(paragraphs[0].fontName).toBe('Helvetica-Bold');
  });

  it('reflows new text inside the original width, keeps the font, aligns and justifies', async () => {
    const source = await sample();
    const [, body] = await listPdfParagraphs(source, 1);
    const text = 'Revenue grew in all regions, led by demand for the new product line.';
    const result = await reflowPdfParagraph(source, 1, body.id, body.text, text, { ...base, align: 'right' }, false);
    expect([result.lines, result.overflow, result.substitution]).toEqual([2, false, null]);
    const items = await shownText(result.bytes);
    const lines = items.filter((i) => i.y > 600 && i.y < 700);
    expect(lines.map((l) => l.str).join(' ')).toBe(text);
    // Right aligned: every line ends at the paragraph's right edge.
    expect(new Set(lines.map((l) => Math.round(l.x + l.w))).size).toBe(1);
    expect(items.some((i) => i.str === 'Quarterly report') && items.some((i) => i.str === 'Page 1')).toBe(true);

    const justified = await reflowPdfParagraph(source, 1, body.id, body.text, text + ' Renewals were steady.', { ...base, align: 'justify' }, false);
    // PDF.js splits justified lines at wide gaps: compare each line's right edge (all lines but the last are full).
    const byLine = new Map<number, number>();
    for (const i of (await shownText(justified.bytes)).filter((i) => i.y > 600 && i.y < 700)) byLine.set(Math.round(i.y), Math.max(byLine.get(Math.round(i.y)) ?? 0, i.x + i.w));
    const rights = [...byLine.entries()].sort((a, b) => b[0] - a[0]).map(([, right]) => right);
    expect(justified.lines).toBe(rights.length);
    expect(Math.abs(rights[0] - rights[1])).toBeLessThan(1.5);
  });

  it('detects overflow, refuses missing glyphs, and reports font substitution', async () => {
    const source = await sample();
    const [, body] = await listPdfParagraphs(source, 1);
    const long = Array.from({ length: 12 }, () => 'This sentence makes the paragraph much longer than before.').join(' ');
    await expect(reflowPdfParagraph(source, 1, body.id, body.text, long, base, false)).rejects.toBeInstanceOf(ParagraphOverflowError);
    const grown = await reflowPdfParagraph(source, 1, body.id, body.text, long, base, true);
    expect(grown.overflow).toBe(true);
    await expect(reflowPdfParagraph(source, 1, body.id, body.text, 'Привет мир', base, false)).rejects.toBeInstanceOf(GlyphUnavailableError);
    const bold = await reflowPdfParagraph(source, 1, body.id, body.text, 'Bold summary text.', { ...base, size: 16, font: 'helvetica-bold' }, false);
    expect(bold.substitution).toBe('“Helvetica” was replaced by Helvetica-Bold.');
    const items = await shownText(bold.bytes);
    expect(items.find((i) => i.str === 'Bold summary text.')).toBeTruthy();
    await expect(reflowPdfParagraph(source, 1, body.id, 'stale text', 'x', base, false)).rejects.toThrow(/changed since/);
  });
});

describe('paragraph edge cases', () => {
  async function shared() {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 800]);
    const key = page.node.newFontDictionary('H', font.ref).decodeText();
    // Paragraph A: a word drawn in two pieces, then a second line moved with ' ; paragraph B after a relative Td.
    page.node.addContentStream(pdf.context.register(pdf.context.stream(
      `BT /${key} 12 Tf 14 TL 72 700 Td (Hel) Tj (lo world) Tj (second line here) ' 0 -40 Td (Other paragraph) Tj ET`)));
    return pdf.save();
  }
  it('keeps words drawn in pieces whole, and leaves the rest of the text object in place', async () => {
    const bytes = await shared();
    const [a] = await listPdfParagraphs(bytes, 1);
    expect(a.text).toBe('Hello world\nsecond line here');
    const before = (await shownText(bytes)).find((i) => i.str === 'Other paragraph')!;
    const result = await reflowPdfParagraph(bytes, 1, a.id, a.text, 'Hi there', { ...base, size: 12, lineHeight: 14 / 12 }, true);
    const after = (await shownText(result.bytes)).find((i) => i.str === 'Other paragraph')!;
    expect([after.x, after.y]).toEqual([before.x, before.y]);
  });
  it('refuses a word wider than the paragraph unless growing is allowed', async () => {
    const bytes = await sample();
    const p = (await listPdfParagraphs(bytes, 1)).find((x) => x.text.startsWith('Revenue'))!;
    const long = 'Supercalifragilisticexpialidocious'.repeat(4);
    await expect(reflowPdfParagraph(bytes, 1, p.id, p.text, long, base, false)).rejects.toThrow(/wider than the paragraph/);
    const grown = await reflowPdfParagraph(bytes, 1, p.id, p.text, long, base, true);
    const width = p.box[2] - p.box[0];
    const pieces = (await shownText(grown.bytes)).filter((i) => i.str.startsWith('Super') || /^[a-z]+$/.test(i.str));
    expect(grown.lines).toBeGreaterThan(1);
    expect(pieces.every((i) => i.w <= width + 1)).toBe(true);
  });
});
