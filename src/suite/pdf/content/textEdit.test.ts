import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { tokenizeContent } from './contentLexer';
import { fontCodec } from './fontCodec';
import { GlyphUnavailableError, listPdfTextRuns, replacePdfText, replacePdfTextRun, searchPdfText } from './textEdit';

async function texts(bytes: Uint8Array) {
  const loading = getDocument({ data: bytes.slice(), useSystemFonts: true });
  const pdf = await loading.promise;
  const out: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) out.push((await (await pdf.getPage(p)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).filter((s) => s.trim()).join('|'));
  await loading.destroy();
  return out;
}

async function sample() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([600, 800]);
  page.drawText('Invoice total: 120 EUR', { x: 50, y: 700, size: 14, font });
  page.drawText('Due in 30 days', { x: 50, y: 680, size: 14, font });
  // A kerned TJ run and a ' run, written directly.
  const name = page.node.newFontDictionary('K', font.ref);
  const extra = pdf.context.flateStream(`BT /${name.decodeText()} 12 Tf 14 TL 50 640 Td [(Ke) -40 (rned line)] TJ (Next line) ' ET`);
  page.node.set(PDFName.of('Contents'), pdf.context.obj([...(page.node.Contents() as never as { asArray(): never[] }).asArray(), pdf.context.register(extra)]));
  return pdf.save();
}

describe('content lexer', () => {
  it('tokenizes operators, strings, arrays, dictionaries and inline images', () => {
    const ops = tokenizeContent(new TextEncoder().encode('q 1 0 0 1 5 5 cm BT /F1 12 Tf (a\\(b\\)c\\101) Tj [<4142> -20 (C)] TJ ET BI /W 1 /H 1 ID \u0001\u0002 EI Q /P <</MCID 3>> BDC EMC'));
    expect(ops.map((o) => o.op)).toEqual(['q', 'cm', 'BT', 'Tf', 'Tj', 'TJ', 'ET', 'BI', 'Q', 'BDC', 'EMC']);
    const tj = ops[4].operands[0];
    expect(tj.type === 'string' && new TextDecoder().decode(tj.bytes)).toBe('a(b)cA');
  });
});

describe('native text editing (MAL-011)', () => {
  it('lists runs and replaces one in place, in its own font, without an overlay', async () => {
    const source = await sample();
    const runs = await listPdfTextRuns(source, 1);
    expect(runs.map((r) => r.text)).toEqual(['Invoice total: 120 EUR', 'Due in 30 days', 'Kerned line', 'Next line']);
    expect(runs.every((r) => r.editable && r.fontName === 'Helvetica')).toBe(true);
    // First run starts at (50, 700) on a 600 x 800 page: shown x = 50/600, baseline 100/800 from the top.
    expect(runs[0].shown.x).toBeCloseTo(50 / 600, 3);
    expect(runs[0].shown.y + runs[0].shown.height).toBeGreaterThan(100 / 800);
    expect(runs[0].shown.y).toBeLessThan(100 / 800);
    const edited = await replacePdfTextRun(source, 1, runs[0].id, 'Invoice total: 120 EUR', 'Invoice total: 145 EUR');
    expect(await texts(edited)).toEqual(['Invoice total: 145 EUR|Due in 30 days|Kerned line|Next line']);
    const pdf = await PDFDocument.load(edited);
    // Still one font on the page and no new XObjects (no overlay).
    const xobjects = pdf.getPage(0).node.Resources()!.lookupMaybe(PDFName.of('XObject'), PDFDict);
    expect(xobjects?.entries().length ?? 0).toBe(0);
    const kerned = await replacePdfTextRun(edited, 1, runs[2].id, 'Kerned line', 'Kerned row');
    expect((await texts(kerned))[0]).toContain('Kerned row');
    await expect(replacePdfTextRun(edited, 1, runs[0].id, 'Invoice total: 120 EUR', 'x')).rejects.toThrow(/changed since/);
  });

  it('refuses characters the font cannot draw, naming them', async () => {
    const source = await sample();
    const [run] = await listPdfTextRuns(source, 1);
    const error = await replacePdfTextRun(source, 1, run.id, run.text, 'Итого 145 EUR').catch((e) => e);
    expect(error).toBeInstanceOf(GlyphUnavailableError);
    expect((error as GlyphUnavailableError).missing).toEqual(['И', 'т', 'о', 'г']);
  });

  it('allows only already-used codes in subset fonts, and encodes Type0 text through ToUnicode', async () => {
    const pdf = await PDFDocument.create();
    const subset = pdf.context.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'ABCDEF+Fancy', FirstChar: 32, LastChar: 126, Widths: Array(95).fill(500),
      FontDescriptor: pdf.context.obj({ Type: 'FontDescriptor', FontName: 'ABCDEF+Fancy', FontFile2: pdf.context.register(pdf.context.stream('x')) }), Encoding: 'WinAnsiEncoding' });
    const codec = fontCodec(pdf, 'F', subset as never);
    for (const ch of 'Hello') codec.used.add(ch.charCodeAt(0));
    expect(codec.encode('hole')).toEqual({ missing: ['h'] });
    expect('bytes' in codec.encode('Hello') && Array.from((codec.encode('Hello') as { bytes: Uint8Array }).bytes)).toEqual([72, 101, 108, 108, 111]);

    const toUnicode = pdf.context.stream('/CIDInit /ProcSet findresource begin 2 beginbfchar <0003> <0041> <0004> <0042> endbfchar 1 beginbfrange <0010> <0012> <0430> endbfrange endcmap');
    const type0 = pdf.context.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'GHIJKL+Cyr', Encoding: 'Identity-H', ToUnicode: pdf.context.register(toUnicode),
      DescendantFonts: [pdf.context.obj({ Type: 'Font', Subtype: 'CIDFontType2', BaseFont: 'GHIJKL+Cyr', DW: 600, FontDescriptor: pdf.context.obj({ FontFile2: pdf.context.register(pdf.context.stream('x')) }) })] });
    const cid = fontCodec(pdf, 'C', type0 as never);
    [3, 4, 0x10, 0x11, 0x12].forEach((c) => cid.used.add(c));
    expect([cid.unicode(3), cid.unicode(0x11)]).toEqual(['A', 'б']);
    expect(Array.from((cid.encode('Bав') as { bytes: Uint8Array }).bytes)).toEqual([0, 4, 0, 0x10, 0, 0x12]);
    expect(cid.encode('Z')).toEqual({ missing: ['Z'] });
  });
});

describe('search and replace (MAL-023)', () => {
  it('finds and replaces text natively across pages and reports what it cannot change', async () => {
    let bytes = await sample();
    const matches = await searchPdfText(bytes, 'line');
    expect(matches.map((m) => m.context)).toEqual(['Kerned line', 'Next line']);
    const report = await replacePdfText(bytes, 'line', 'row');
    expect([report.replaced, report.runs, report.refused]).toEqual([2, 2, []]);
    bytes = report.bytes;
    expect(await texts(bytes)).toEqual(['Invoice total: 120 EUR|Due in 30 days|Kerned row|Next row']);
    const partial = await replacePdfText(bytes, 'days', 'днів');
    expect(partial.replaced).toBe(0);
    expect(partial.refused[0].reason).toMatch(/no glyph/);
    await expect(replacePdfText(bytes, 'absent', 'x')).rejects.toThrow(/was not found/);
  });
});

describe('signed documents', () => {
  it('refuses to edit text, paragraphs or objects of a signed PDF, but still lists them', async () => {
    const { listPdfParagraphs, reflowPdfParagraph } = await import('./paragraphs');
    const { deletePdfObject, listPdfPageObjects } = await import('./objectEdit');
    const pdf = await PDFDocument.load(await sample());
    pdf.context.register(pdf.context.obj({ FT: 'Sig', V: pdf.context.obj({ Type: 'Sig', ByteRange: [0, 1, 2, 3] }) }));
    const signed = await pdf.save();
    const [run] = await listPdfTextRuns(signed, 1);
    await expect(replacePdfTextRun(signed, 1, run.id, run.text, 'x')).rejects.toThrow(/signed; editing it would invalidate the signature/);
    await expect(replacePdfText(signed, 'line', 'row')).rejects.toThrow(/signed/);
    expect((await searchPdfText(signed, 'line')).length).toBeGreaterThan(0);
    const [paragraph] = await listPdfParagraphs(signed, 1);
    await expect(reflowPdfParagraph(signed, 1, paragraph.id, paragraph.text, 'x', { align: 'left', size: 12, lineHeight: 1.2, charSpacing: 0, wordSpacing: 0, font: 'keep' }, true)).rejects.toThrow(/signed/);
    await listPdfPageObjects(signed, 1);
    await expect(deletePdfObject(signed, 1, 'path', 0)).rejects.toThrow(/signed/);
  });
});
