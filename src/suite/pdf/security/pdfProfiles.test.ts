import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFHexString, PDFName, StandardFonts, rgb } from 'pdf-lib';
import { preflightPdf, preflightReportText } from './pdfProfiles';

const N = PDFName.of;
const XMP = (extra: string) => `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/" xmlns:dc="http://purl.org/dc/elements/1.1/">${extra}
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Annual report</rdf:li></rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

async function problematic() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 300]);
  page.drawText('Hello', { x: 20, y: 250, font: await pdf.embedFont(StandardFonts.Helvetica), color: rgb(1, 0, 0) });
  page.drawRectangle({ x: 20, y: 20, width: 100, height: 100, color: rgb(0, 0, 1), opacity: 0.5 });
  pdf.addJavaScript('init', 'app.alert(1)');
  await pdf.attach(new Uint8Array([1, 2, 3]), 'data.bin', { mimeType: 'application/octet-stream' });
  page.node.set(N('Annots'), pdf.context.obj([pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [0, 0, 10, 10] }))]));
  return pdf.save();
}
async function tidy() {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const page = pdf.addPage([400, 300]);
  // An embedded font (descriptor with a font program), grey and calibrated colour only, tagged, with metadata.
  const program = pdf.context.register(pdf.context.stream('font program', {}));
  const descriptor = pdf.context.register(pdf.context.obj({ Type: 'FontDescriptor', FontName: 'Demo', Flags: 32, FontBBox: [0, 0, 1000, 1000], ItalicAngle: 0, Ascent: 800, Descent: -200, CapHeight: 700, StemV: 80, FontFile2: program }));
  page.node.Resources()!.set(N('Font'), pdf.context.obj({ F1: pdf.context.register(pdf.context.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'Demo', FirstChar: 32, LastChar: 32, Widths: [250], FontDescriptor: descriptor })) }));
  page.node.set(N('Contents'), pdf.context.register(pdf.context.stream('0.5 g 10 10 50 50 re f BT /F1 12 Tf 20 200 Td (Hi) Tj ET')));
  page.node.set(N('TrimBox'), pdf.context.obj([10, 10, 390, 290]));
  const icc = pdf.context.register(pdf.context.stream('icc', { N: 3 }));
  pdf.catalog.set(N('OutputIntents'), pdf.context.obj([pdf.context.obj({ Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: PDFHexString.fromText('sRGB'), DestOutputProfile: icc })]));
  pdf.catalog.set(N('Metadata'), pdf.context.register(pdf.context.stream(XMP('<pdfaid:part>2</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance><pdfuaid:part>1</pdfuaid:part>'), { Type: 'Metadata', Subtype: 'XML' })));
  pdf.catalog.set(N('MarkInfo'), pdf.context.obj({ Marked: true }));
  const figure = pdf.context.register(pdf.context.obj({ Type: 'StructElem', S: 'Figure', Alt: PDFHexString.fromText('Chart') }));
  pdf.catalog.set(N('StructTreeRoot'), pdf.context.register(pdf.context.obj({ Type: 'StructTreeRoot', K: [figure] })));
  pdf.catalog.set(N('Lang'), PDFHexString.fromText('en-GB'));
  pdf.catalog.set(N('ViewerPreferences'), pdf.context.obj({ DisplayDocTitle: true }));
  const id = PDFHexString.of('0123456789abcdef0123456789abcdef'); pdf.context.trailerInfo.ID = pdf.context.obj([id, id]);
  return pdf.save({ useObjectStreams: false });
}

describe('Document preflight (MAL-068)', () => {
  it('fails the conditions a problematic file breaks, per profile, and says where', async () => {
    const [a2, x1a, ua] = await preflightPdf(await problematic(), ['pdfa-2b', 'pdfx-1a', 'pdfua-1']);
    const failed = (r: typeof a2) => Object.fromEntries(r.checks.filter((c) => !c.passed).map((c) => [c.id, c.details]));
    expect(a2.passed).toBe(false);
    expect(failed(a2)['fonts-embedded']).toEqual(['Helvetica (Page 1)']);
    expect(Object.keys(failed(a2))).toEqual(expect.arrayContaining(['output-intent', 'xmp', 'pdfa-id', 'no-scripts', 'attachments', 'annotation-appearance']));
    expect(failed(a2)['no-transparency']).toBeUndefined(); // PDF/A-2 allows transparency
    expect(failed(x1a)['no-transparency']?.[0]).toMatch(/Page 1: graphics state/);
    expect(failed(x1a)['cmyk-only']?.[0]).toBe('DeviceRGB: Page 1');
    expect(Object.keys(failed(x1a))).toEqual(expect.arrayContaining(['output-intent', 'trapped', 'trim-box']));
    expect(Object.keys(failed(ua))).toEqual(expect.arrayContaining(['tagged', 'language', 'title', 'pdfua-id', 'tab-order', 'fonts-embedded']));
    expect(preflightReportText([a2], 'bad.pdf')).toMatch(/PDF\/A-2b \(archiving\): FAILED[\s\S]*\[FAIL\] Fonts — Every font is embedded\n\s+Helvetica \(Page 1\)/);
  });

  it('passes a file that meets the checked conditions', async () => {
    const [a2, ua, a1] = await preflightPdf(await tidy(), ['pdfa-2b', 'pdfua-1', 'pdfa-1b']);
    expect(a2.checks.filter((c) => !c.passed)).toEqual([]);
    expect(ua.checks.filter((c) => !c.passed)).toEqual([]);
    expect(a1.checks.filter((c) => !c.passed).map((c) => c.id)).toEqual(['version', 'pdfa-id']); // pdf-lib writes 1.7 and the XMP says part 2
  });
});
