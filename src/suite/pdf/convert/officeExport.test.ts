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

  it('declares every table column in the DOCX grid', async () => {
    const xml = part(pdfToDocx(await structure(await source()), 'report').files[0].bytes, 'word/document.xml');
    const grid = /<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/.exec(xml)![1];
    expect(grid).toMatch(/^(<w:gridCol w:w="\d+"\/>){3}$/);
  });

  it('keeps identifiers with leading zeros or too many digits as text in XLSX', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const p = pdf.addPage([612, 792]);
    [['Account', 'Code', 'Qty'], ['1234567890123456789', '001234', '42'], ['9876543210987654321', '000777', '7']]
      .forEach((row, r) => row.forEach((c, k) => p.drawText(c, { x: 72 + k * 160, y: 700 - r * 16, size: 11, font })));
    pdf.addPage([612, 792]).drawText('Notes', { x: 72, y: 700, size: 11, font });
    const { files } = pdfToXlsx(await structure(await pdf.save()), 'ids');
    const sheet = part(files[0].bytes, 'xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<t xml:space="preserve">1234567890123456789</t>');
    expect(sheet).toContain('<t xml:space="preserve">001234</t>');
    expect(sheet).toMatch(/<c r="C2"><v>42<\/v><\/c>/);
  });
});

describe('PowerPoint paint order and text colour', () => {
  it('writes shapes in paint order and keeps the text colour', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([400, 300]);
    const png = await pdf.embedPng(encodePng({ width: 2, height: 2, data: new Uint8ClampedArray(16).fill(200) }));
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    // A photograph, then a black panel over part of it, then white text on the panel.
    page.drawImage(png, { x: 20, y: 20, width: 360, height: 260 });
    page.drawRectangle({ x: 50, y: 100, width: 200, height: 60, color: rgb(0, 0, 0) });
    page.drawText('Callout text', { x: 60, y: 120, size: 18, font, color: rgb(1, 1, 1) });
    const bytes = await pdf.save();
    const loading = getDocument({ data: bytes.slice(), isOffscreenCanvasSupported: false, fontExtraProperties: true } as never);
    const doc = await loading.promise;
    let pages;
    try { pages = await readPdfStructure(doc, [1], { images: true, ops: OPS as never }); } finally { await loading.destroy(); }
    const { files } = await pdfToPptx(pages, bytes, 'callout');
    const slide = part(files[0].bytes, 'ppt/slides/slide1.xml');
    const [pic, rect, text] = ['<p:pic>', 'name="Rectangle', 'Callout text'].map((needle) => slide.indexOf(needle));
    expect(pic).toBeGreaterThan(0);
    expect(pic).toBeLessThan(rect); expect(rect).toBeLessThan(text);
    expect(slide).toMatch(/<a:solidFill><a:srgbClr val="FFFFFF"\/><\/a:solidFill><a:latin typeface="Arial"\/><\/a:rPr><a:t>Callout text/);
  });
});

describe('PowerPoint text boxes around a shape', () => {
  it('keeps lines painted on either side of a rectangle in separate boxes', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([400, 300]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText('Before', { x: 60, y: 200, size: 14, font });
    page.drawRectangle({ x: 50, y: 170, width: 200, height: 22, color: rgb(1, 1, 0) });
    page.drawText('After', { x: 60, y: 180, size: 14, font });
    const bytes = await pdf.save();
    const loading = getDocument({ data: bytes.slice(), isOffscreenCanvasSupported: false, fontExtraProperties: true } as never);
    const doc = await loading.promise;
    let pages;
    try { pages = await readPdfStructure(doc, [1], { images: true, ops: OPS as never }); } finally { await loading.destroy(); }
    const slide = part((await pdfToPptx(pages, bytes, 'straddle')).files[0].bytes, 'ppt/slides/slide1.xml');
    const [before, rect, after] = ['>Before<', 'name="Rectangle', '>After<'].map((needle) => slide.indexOf(needle));
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(rect); expect(rect).toBeLessThan(after);
  });
});
