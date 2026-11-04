import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
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

describe('paragraph fonts and spacing', () => {
  it('refuses to flatten mixed fonts, keeps TJ word gaps, and escapes font names', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([600, 800]);
    const [regular, bold] = [await pdf.embedFont(StandardFonts.Helvetica), await pdf.embedFont(StandardFonts.HelveticaBold)];
    const fonts = pdf.context.obj({}) as PDFDict;
    fonts.set(PDFName.of('F#1'), regular.ref); fonts.set(PDFName.of('B'), bold.ref);
    page.node.set(PDFName.of('Resources'), pdf.context.obj({ Font: fonts }));
    page.node.addContentStream(pdf.context.register(pdf.context.stream(
      'BT /F#231 12 Tf 72 700 Td [(Hello) -300 (world)] TJ ET BT /F#231 12 Tf 72 600 Td (Plain ) Tj /B 12 Tf (bold) Tj ET')));
    const bytes = await pdf.save();
    const [spaced, mixed] = await listPdfParagraphs(bytes, 1);
    expect(spaced.text).toBe('Hello world');
    await expect(reflowPdfParagraph(bytes, 1, mixed.id, mixed.text, mixed.text, { ...base, size: 12 }, true)).rejects.toThrow(/mixes fonts/);
    const out = await reflowPdfParagraph(bytes, 1, spaced.id, spaced.text, 'Hello there world', { ...base, size: 12, align: 'center' }, true);
    expect((await shownText(out.bytes)).map((i) => i.str).join(' ')).toContain('Hello there world');
    const { pageContentBytes } = await import('./contentModel');
    expect(new TextDecoder('latin1').decode(pageContentBytes(await PDFDocument.load(out.bytes), 0))).toContain('/F#231 12 Tf');
  });

  it('keeps two columns apart when one baseline sits slightly higher', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([600, 800]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText('Left column', { x: 72, y: 700, size: 12, font });
    page.drawText('Right column', { x: 320, y: 701, size: 12, font });
    const paragraphs = await listPdfParagraphs(await pdf.save(), 1);
    expect(paragraphs.map((p) => p.text).sort()).toEqual(['Left column', 'Right column']);
  });

  it('keeps invisible OCR text invisible and refuses outlined text', async () => {
    const make = async (mode: number) => {
      const pdf = await PDFDocument.create();
      const page = pdf.addPage([600, 800]);
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      page.node.set(PDFName.of('Resources'), pdf.context.obj({ Font: { F1: font.ref } }));
      page.node.addContentStream(pdf.context.register(pdf.context.stream(`BT /F1 12 Tf ${mode} Tr 72 700 Td (Scanned words here) Tj ET`)));
      return pdf.save();
    };
    const hidden = await make(3);
    const [ocr] = await listPdfParagraphs(hidden, 1);
    const out = await reflowPdfParagraph(hidden, 1, ocr.id, ocr.text, 'Scanned words', { ...base, size: 12 }, true);
    const { pageContentBytes, documentModels } = await import('./contentModel');
    expect(new TextDecoder('latin1').decode(pageContentBytes(await PDFDocument.load(out.bytes), 0))).toMatch(/3 Tr/);
    const runs = documentModels(await PDFDocument.load(out.bytes))[0].runs.filter((r) => r.text.trim());
    expect(runs.every((r) => r.render === 3)).toBe(true);
    const outlined = await make(1);
    const [stroked] = await listPdfParagraphs(outlined, 1);
    await expect(reflowPdfParagraph(outlined, 1, stroked.id, stroked.text, 'Other', { ...base, size: 12 }, true)).rejects.toThrow(/outlined or clipping/);
  });

  it('keeps the paragraph under content drawn over it, and spaces two-byte fonts with TJ', async () => {
    const { pageContentBytes } = await import('./contentModel');
    const text = async (bytes: Uint8Array) => new TextDecoder('latin1').decode(pageContentBytes(await PDFDocument.load(bytes), 0));
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([600, 800]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText('Covered words here', { x: 72, y: 700, size: 12, font });
    page.node.addContentStream(pdf.context.register(pdf.context.stream('1 1 1 rg 60 690 300 30 re f')));
    const covered = await pdf.save();
    const [paragraph] = await listPdfParagraphs(covered, 1);
    const out = await reflowPdfParagraph(covered, 1, paragraph.id, paragraph.text, 'Covered words', { ...base, size: 12 }, true);
    const content = await text(out.bytes);
    expect(content.lastIndexOf(' Tm')).toBeLessThan(content.indexOf('60 690 300 30 re'));

    const wide = await PDFDocument.create();
    const wpage = wide.addPage([600, 800]);
    const toUnicode = wide.context.stream('/CIDInit /ProcSet findresource begin 3 beginbfchar <0003> <0041> <0004> <0042> <0005> <0020> endbfchar endcmap');
    const type0 = wide.context.register(wide.context.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'GHIJKL+Cyr', Encoding: 'Identity-H', ToUnicode: wide.context.register(toUnicode),
      DescendantFonts: [wide.context.obj({ Type: 'Font', Subtype: 'CIDFontType2', BaseFont: 'GHIJKL+Cyr', DW: 600, FontDescriptor: wide.context.obj({ FontFile2: wide.context.register(wide.context.stream('x')) }) })] }));
    wpage.node.set(PDFName.of('Resources'), wide.context.obj({ Font: { C: type0 } }));
    wpage.node.addContentStream(wide.context.register(wide.context.stream('BT /C 12 Tf 72 700 Td <0003000500040005000300050004000500030005> Tj ET')));
    const wbytes = await wide.save();
    const [cid] = await listPdfParagraphs(wbytes, 1);
    const spaced = await reflowPdfParagraph(wbytes, 1, cid.id, cid.text, 'A B', { ...base, size: 12, wordSpacing: 2 }, true);
    expect(await text(spaced.bytes)).toMatch(/\[<00030005> -166\.6667 <0004>\] TJ/);
  });

  it('refuses a paragraph that mixes text colours', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([600, 800]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.node.set(PDFName.of('Resources'), pdf.context.obj({ Font: { F1: font.ref } }));
    page.node.addContentStream(pdf.context.register(pdf.context.stream('BT /F1 12 Tf 72 700 Td (Read the ) Tj 1 0 0 rg (linked page) Tj ET')));
    const bytes = await pdf.save();
    const [mixed] = await listPdfParagraphs(bytes, 1);
    await expect(reflowPdfParagraph(bytes, 1, mixed.id, mixed.text, mixed.text, { ...base, size: 12 }, true)).rejects.toThrow(/mixes text colours/);
  });

  it('reports a single line made taller than its box as overflow', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([600, 800]).drawText('A single wide line of ordinary body text', { x: 72, y: 700, size: 12, font });
    const bytes = await pdf.save();
    const [line] = await listPdfParagraphs(bytes, 1);
    await expect(reflowPdfParagraph(bytes, 1, line.id, line.text, 'Hi', { ...base, size: 48 }, false)).rejects.toBeInstanceOf(ParagraphOverflowError);
    expect((await reflowPdfParagraph(bytes, 1, line.id, line.text, 'Hi', { ...base, size: 48 }, true)).overflow).toBe(true);
    expect((await reflowPdfParagraph(bytes, 1, line.id, line.text, 'Short line', { ...base, size: 12 }, false)).overflow).toBe(false);
  });

  it('keeps a colour set through cs and sc when reflowing', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([600, 800]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.node.set(PDFName.of('Resources'), pdf.context.obj({ Font: { F1: font.ref } }));
    page.node.addContentStream(pdf.context.register(pdf.context.stream('/DeviceRGB cs 1 0 0 sc BT /F1 12 Tf 72 700 Td (Red words here) Tj ET')));
    const bytes = await pdf.save();
    const [red] = await listPdfParagraphs(bytes, 1);
    const out = await reflowPdfParagraph(bytes, 1, red.id, red.text, 'Red words', { ...base, size: 12, align: 'right' }, true);
    const { documentModels } = await import('./contentModel');
    const runs = documentModels(await PDFDocument.load(out.bytes))[0].runs.filter((r) => r.text.trim());
    expect(runs.map((r) => [r.text, r.fill])).toEqual([['Red words', '#ff0000']]);
  });
});

