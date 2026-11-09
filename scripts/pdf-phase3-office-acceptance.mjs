/* Phase 3 Office conversion acceptance (MAL-037 Word, MAL-038 PowerPoint, MAL-039 Excel,
 * MAL-045 batch conversion with profiles, fidelity reports and result editors) in real
 * Chromium. Each result opens in MALENJO's result editor, is edited there and exported; the
 * exported package is unzipped and its XML checked here.
 * Run: node scripts/pdf-phase3-office-acceptance.mjs   (needs `playwright`)
 */
import { deflateSync } from 'node:zlib';
import { strFromU8, unzipSync } from 'fflate';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { startHarness } from './lib/pdf-harness.mjs';

const h = await startHarness('PHASE3-OFFICE');
const { page, panel, expect, check, action, notice, openPdf, download } = h;

function crc(buf) { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; }
function png(w, hgt, color) {
  const raw = Buffer.alloc(hgt * (w * 3 + 1));
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) color(x, y).forEach((v, c) => { raw[y * (w * 3 + 1) + 1 + x * 3 + c] = v; });
  const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(hgt, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
async function source(title = 'Quarterly Report') {
  const pdf = await PDFDocument.create();
  const [regular, bold] = [await pdf.embedFont(StandardFonts.Helvetica), await pdf.embedFont(StandardFonts.HelveticaBold)];
  const p = pdf.addPage([612, 792]);
  p.drawText(title, { x: 72, y: 720, size: 24, font: bold });
  p.drawText('Revenue grew in every region.', { x: 72, y: 690, size: 11, font: regular });
  ['• Faster delivery', '• Lower churn'].forEach((t, i) => p.drawText(t, { x: 72, y: 660 - i * 15, size: 11, font: regular }));
  ['1. Hire staff', '2. Open office'].forEach((t, i) => p.drawText(t, { x: 72, y: 620 - i * 15, size: 11, font: regular }));
  [['Region', 'Q1', 'Q2'], ['North', '1,000', '12.5'], ['South', '8', '9']].forEach((row, r) => row.forEach((c, k) => p.drawText(c, { x: 72 + k * 120, y: 570 - r * 16, size: 11, font: regular })));
  p.drawImage(await pdf.embedPng(png(2, 1, (x) => (x ? [0, 0, 255] : [255, 0, 0]))), { x: 72, y: 380, width: 100, height: 50 });
  p.drawRectangle({ x: 300, y: 380, width: 100, height: 50, color: rgb(1, 0, 0) });
  return pdf.save();
}
const converter = () => page.getByRole('dialog', { name: 'Convert to Office' });
const part = (zip, name) => { const file = zip[name]; expect(file, `missing ${name}`); return strFromU8(file); };
async function convertWith(profile) {
  await action('Convert', 'Convert to Office…');
  await converter().waitFor();
  await converter().getByLabel('Conversion profile').selectOption(profile);
  await converter().getByRole('button', { name: 'Convert', exact: true }).click();
}
const tab = (name) => page.locator('.document-tab-main').filter({ hasText: name });
async function exportFromEditor() { return unzipSync(new Uint8Array(await download(() => panel().getByRole('button', { name: 'Export copy' }).click()))); }

try {
  await check('MAL-037 PDF to Word: headings, lists, table and image, opened in the Word editor, edited and exported', async () => {
    await openPdf(await source(), 'office.pdf');
    await convertWith('Word document (text and images)');
    await tab('office.docx').waitFor({ timeout: 30000 });
    const editor = panel().getByLabel('DOCX text editor');
    await editor.waitFor();
    const text = await editor.inputValue();
    expect(text.startsWith('Quarterly Report\n\nRevenue grew in every region.\n\nFaster delivery\n\nLower churn\n\nHire staff'), 'editor text ' + JSON.stringify(text.slice(0, 120)));
    await editor.fill(text.replace('Revenue grew in every region.', 'Revenue grew everywhere.'));
    const zip = await exportFromEditor();
    const xml = part(zip, 'word/document.xml');
    expect(xml.includes('<w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">Quarterly Report</w:t>'), 'heading style');
    expect(xml.includes('Revenue grew everywhere.') && !xml.includes('every region'), 'edit not saved');
    expect(/<w:numId w:val="1"\/>[\s\S]*Faster delivery/.test(xml) && /<w:numId w:val="2"\/>[\s\S]*Hire staff/.test(xml) && part(zip, 'word/numbering.xml').includes('w:val="decimal"'), 'lists');
    expect(/<w:tbl>[\s\S]*Region[\s\S]*1,000[\s\S]*12\.5[\s\S]*<\/w:tbl>/.test(xml), 'table');
    expect(xml.includes('r:embed="rIdImg1"') && zip['word/media/image1.png']?.subarray(1, 4).toString() === '80,78,71', 'image');
  });

  await check('MAL-038 PDF to PowerPoint: a slide per page with positioned text boxes, picture and shape, edited and exported', async () => {
    await page.locator('.document-tab-main').filter({ hasText: 'office.pdf' }).click();
    await convertWith('PowerPoint slides');
    await tab('office.pptx').waitFor({ timeout: 30000 });
    const title = panel().locator('.slide-title-input');
    await title.waitFor();
    expect(await title.inputValue() === 'Quarterly Report', 'first text ' + await title.inputValue());
    await title.fill('Quarterly Report 2026');
    const zip = await exportFromEditor();
    const slide = part(zip, 'ppt/slides/slide1.xml');
    expect(part(zip, 'ppt/presentation.xml').includes('<p:sldSz cx="7772400" cy="10058400"/>'), 'slide size');
    expect(/<a:off x="914400" y="\d+"\/>[\s\S]*?sz="2400" b="1"[\s\S]*?<a:t>Quarterly Report 2026<\/a:t>/.test(slide), 'title box/edit');
    expect(/name="Rectangle \d+"[\s\S]*?<a:off x="3810000" y="4597400"\/><a:ext cx="1270000" cy="635000"\/>[\s\S]*?val="FF0000"/.test(slide), 'rectangle');
    expect(/<p:pic>[\s\S]*<a:off x="914400" y="4597400"\/><a:ext cx="1270000" cy="635000"\/>/.test(slide) && Object.keys(zip).some((n) => n.startsWith('ppt/media/')), 'picture');
  });

  await check('MAL-039 PDF to Excel: the table as a sheet with numbers, edited and exported', async () => {
    await page.locator('.document-tab-main').filter({ hasText: 'office.pdf' }).click();
    await convertWith('Excel tables');
    await tab('office.xlsx').waitFor({ timeout: 30000 });
    const b2 = panel().getByLabel('Cell B2', { exact: true });
    await b2.waitFor();
    expect(await b2.inputValue() === '1000' && await panel().getByLabel('Cell A3', { exact: true }).inputValue() === 'South', 'grid values');
    await panel().getByLabel('Cell C3', { exact: true }).fill('10');
    const zip = await exportFromEditor();
    const workbook = part(zip, 'xl/workbook.xml');
    expect(workbook.includes('name="Page 1 table 1"'), 'sheet name ' + workbook);
    const sheet = part(zip, 'xl/worksheets/sheet1.xml');
    expect(/<c r="B2"[^>]*><v>1000<\/v><\/c>/.test(sheet) && /<c r="C2"[^>]*><v>12\.5<\/v><\/c>/.test(sheet), 'numbers ' + sheet.slice(0, 600));
    expect(/<c r="C3"[^>]*>(?:<v>10<\/v>|<is><t[^>]*>10<\/t><\/is>)<\/c>/.test(sheet), 'edited cell');
    expect(/<c r="A1"[^>]*>[\s\S]*?Region/.test(sheet), 'header');
  });

  await check('MAL-045 batch conversion with a saved profile, a fidelity report per file and results opened in editors', async () => {
    await page.locator('.document-tab-main').filter({ hasText: 'office.pdf' }).click();
    await action('Convert', 'Convert to Office…');
    const c = converter();
    await c.waitFor();
    await c.getByLabel('Convert to', { exact: true }).selectOption('docx');
    await c.getByLabel('Pages to convert').fill('1');
    await c.getByRole('checkbox', { name: 'Include images' }).uncheck();
    await c.getByLabel('New profile name').fill('Team Word');
    await c.getByRole('button', { name: 'Save profile' }).click();
    expect(await c.getByLabel('Conversion profile').inputValue() === 'Team Word', 'profile not saved');
    await c.getByLabel('PDFs to add').setInputFiles([
      { name: 'minutes.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await source('Board Minutes')) },
      { name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('this is not a PDF') },
    ]);
    await c.getByRole('list', { name: 'PDFs to convert' }).locator('li').nth(2).waitFor();
    await c.getByRole('button', { name: 'Convert', exact: true }).click();
    await notice(/Converted 2 of 3 PDFs to Word/);
    await tab('minutes.docx').waitFor({ timeout: 30000 });
    expect((await panel().getByLabel('DOCX text editor').inputValue()).startsWith('Board Minutes'), 'minutes editor');
    await page.locator('.document-tab-main').filter({ hasText: 'office.pdf' }).click();
    const report = converter().getByRole('region', { name: 'Conversion results' });
    await report.waitFor();
    const reportText = await report.innerText();
    expect(/office\.pdf: converted to office\.docx/.test(reportText) && /minutes\.pdf: converted to minutes\.docx/.test(reportText) && /broken\.pdf: failed/.test(reportText), 'report ' + reportText);
    expect(/0 image\(s\)/.test(reportText) && /not a valid PDF|encrypted, invalid or damaged/i.test(reportText), 'report details ' + JSON.stringify(reportText));
    const zip = unzipSync(new Uint8Array(await download(() => converter().getByRole('button', { name: 'Download results (ZIP)' }).click())));
    const summary = JSON.parse(strFromU8(zip['conversion-report.json']));
    expect(JSON.stringify(summary.files.map((f) => [f.source, f.status, f.output])) === JSON.stringify([['office.pdf', 'ok', 'office.docx'], ['minutes.pdf', 'ok', 'minutes.docx'], ['broken.pdf', 'failed', null]]), 'summary ' + JSON.stringify(summary.files));
    expect(summary.profile.target === 'docx' && summary.profile.images === false && summary.files[0].report.length > 0, 'profile in report');
    expect(zip['minutes.docx'] && strFromU8(unzipSync(zip['minutes.docx'])['word/document.xml']).includes('Board Minutes'), 'minutes docx');
  });
} finally {
  await h.finish();
}
