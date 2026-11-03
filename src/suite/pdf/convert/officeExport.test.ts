import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseDocx, parsePptx, parseXlsx, writeDocx } from '../../office/ooxml';
import { encodePng } from './imageCodecs';
import { pdfToDocx, pdfToPptx, pdfToXlsx } from './officeExport';
import { readPdfStructure } from './pdfStructure';

async function source() {
  const pdf = await PDFDocument.create();
  const [regular, bold] = [await pdf.embedFont(StandardFonts.Helvetica), await pdf.embedFont(StandardFonts.HelveticaBold)];
  const p = pdf.addPage([612, 792]);
  p.drawText('Quarterly Report', { x: 72, y: 720, size: 24, font: bold });
  p.drawText('Revenue grew in every region.', { x: 72, y: 690, size: 11, font: regular });
  ['• Faster delivery', '• Lower churn'].forEach((t, i) => p.drawText(t, { x: 72, y: 660 - i * 15, size: 11, font: regular }));
  ['1. Hire staff', '2. Open office'].forEach((t, i) => p.drawText(t, { x: 72, y: 620 - i * 15, size: 11, font: regular }));
  [['Region', 'Q1', 'Q2'], ['North', '1,000', '12.5'], ['South', '8', '9']].forEach((row, r) => row.forEach((c, k) => p.drawText(c, { x: 72 + k * 120, y: 570 - r * 16, size: 11, font: regular })));
  p.drawImage(await pdf.embedPng(encodePng({ width: 2, height: 1, data: Uint8ClampedArray.from([255, 0, 0, 255, 0, 0, 255, 255]) })), { x: 72, y: 380, width: 100, height: 50 });
  p.drawRectangle({ x: 300, y: 380, width: 100, height: 50, color: rgb(1, 0, 0) });
  pdf.addPage([612, 792]).drawText('Plain notes page', { x: 72, y: 700, size: 11, font: regular });
  return pdf.save();
}
async function structure(bytes: Uint8Array) {
  const loading = getDocument({ data: bytes.slice(), isOffscreenCanvasSupported: false, fontExtraProperties: true } as never);
  const doc = await loading.promise;
  try { return await readPdfStructure(doc, [1, 2], { images: true, ops: OPS as never }); } finally { await loading.destroy(); }
}
const part = (zip: Uint8Array, name: string) => strFromU8(unzipSync(zip)[name]);

describe('PDF to Office (MAL-037 – 039)', () => {
  it('writes an editable DOCX with headings, lists, tables and images', async () => {
    const pages = await structure(await source());
    const { files, notes } = pdfToDocx(pages, 'report');
    const docx = files[0].bytes;
    const xml = part(docx, 'word/document.xml');
    expect(xml).toContain('<w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">Quarterly Report</w:t>');
    expect(xml).toMatch(/<w:numId w:val="1"\/><\/w:numPr><\/w:pPr><w:r><w:t xml:space="preserve">Faster delivery/);
    expect(xml).toMatch(/<w:numId w:val="2"\/><\/w:numPr><\/w:pPr><w:r><w:t xml:space="preserve">Hire staff/);
    expect(xml).toMatch(/<w:tbl>[\s\S]*<w:b\/><\/w:rPr><w:t xml:space="preserve">Region[\s\S]*1,000[\s\S]*<\/w:tbl>/);
    expect(xml).toContain('<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">Plain notes page');
    expect(xml).not.toContain('<w:p/>');
    expect(xml).toContain('r:embed="rIdImg1"');
    expect(Object.keys(unzipSync(docx))).toContain('word/media/image1.png');
    expect(part(docx, 'word/numbering.xml')).toContain('w:numFmt w:val="decimal"');
    // The internal editor opens and edits it.
    const model = parseDocx(docx);
    expect(model.paragraphs).toContain('Revenue grew in every region.');
    const edited = writeDocx(docx, model.paragraphs.map((p) => (p === 'Revenue grew in every region.' ? 'Revenue grew everywhere.' : p)));
    expect(parseDocx(edited).paragraphs).toContain('Revenue grew everywhere.');
    expect(notes[0]).toMatch(/1 heading\(s\), 2 list\(s\), 1 table\(s\) and 1 image\(s\)/);
  });

  it('writes a PPTX with a slide per page, text boxes at their positions, pictures and rectangles', async () => {
    const bytes = await source();
    const { files } = await pdfToPptx(await structure(bytes), bytes, 'report');
    const pptx = files[0].bytes;
    const slide = part(pptx, 'ppt/slides/slide1.xml');
    expect(part(pptx, 'ppt/presentation.xml')).toContain('<p:sldSz cx="7772400" cy="10058400"/>');
    // "Quarterly Report" at x 72pt (914400 EMU), 24pt bold.
    expect(slide).toMatch(/<a:off x="914400" y="\d+"\/>[\s\S]*?sz="2400" b="1"[\s\S]*?<a:t>Quarterly Report<\/a:t>/);
    expect(slide).toMatch(/<p:sp><p:nvSpPr><p:cNvPr id="\d+" name="Rectangle \d+"\/>[\s\S]*?<a:off x="3810000" y="4597400"\/><a:ext cx="1270000" cy="635000"\/>[\s\S]*?<a:srgbClr val="FF0000"\/>/);
    expect(slide).toMatch(/<p:pic>[\s\S]*<a:off x="914400" y="4597400"\/><a:ext cx="1270000" cy="635000"\/>/);
    expect(parsePptx(pptx).slides.map((s) => s.texts.join(' '))).toEqual([expect.stringContaining('Quarterly Report'), 'Plain notes page']);
  });

  it('writes an XLSX with a sheet per table, numbers as numbers', async () => {
    const { files, notes } = pdfToXlsx(await structure(await source()), 'report');
    const model = parseXlsx(files[0].bytes);
    expect(model.sheets!.map((s) => s.name)).toEqual(['Page 1 table 1', 'Page 2']);
    expect(model.sheets![0].cells).toEqual([['Region', 'Q1', 'Q2'], ['North', '1000', '12.5'], ['South', '8', '9']]);
    expect(part(files[0].bytes, 'xl/worksheets/sheet1.xml')).toContain('<c r="B2"><v>1000</v></c>');
    expect(notes[1]).toMatch(/No table on page 2/);
  });
});
