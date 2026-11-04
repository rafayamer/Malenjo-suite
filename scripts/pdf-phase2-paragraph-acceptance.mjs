/* Phase 2 paragraph acceptance (MAL-012 paragraph reflow and reconstruction,
 * MAL-013 font, typography and styles) in real Chromium. Saved output is
 * reopened independently with PDF.js and pdf-lib.
 * Run: node scripts/pdf-phase2-paragraph-acceptance.mjs   (needs `playwright`)
 */
import { resolve } from 'node:path';
import { PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { root, startHarness } from './lib/pdf-harness.mjs';

const h = await startHarness('PHASE2-PARAGRAPH');
const { page, panel, expect, check, action, notice, openPdf, save } = h;
const near = (a, b, t = 1) => Math.abs(a - b) <= t;

async function source() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const p = pdf.addPage([612, 792]);
  p.drawText('Annual summary', { x: 72, y: 720, size: 24, font: await pdf.embedFont(StandardFonts.HelveticaBold) });
  ['Revenue grew in every region during the', 'quarter, led by strong demand for the new', 'product line and steady renewals.'].forEach((line, i) => p.drawText(line, { x: 72, y: 660 - i * 18, size: 14, font }));
  ['Costs stayed flat while headcount grew', 'slightly in support and engineering.'].forEach((line, i) => p.drawText(line, { x: 72, y: 560 - i * 18, size: 14, font }));
  return pdf.save();
}
/** Text lines (y, left, right, text) by PDF.js. */
async function lines(bytes) {
  const loading = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, standardFontDataUrl: resolve(root, 'node_modules/pdfjs-dist/standard_fonts') + '/' });
  const doc = await loading.promise;
  try {
    const items = (await (await doc.getPage(1)).getTextContent()).items.filter((i) => i.str.trim());
    const byY = new Map();
    for (const i of items) {
      const key = Math.round(i.transform[5] * 10) / 10;
      const line = byY.get(key) ?? { y: key, left: Infinity, right: -Infinity, parts: [] };
      line.left = Math.min(line.left, i.transform[4]); line.right = Math.max(line.right, i.transform[4] + i.width); line.parts.push([i.transform[4], i.str]);
      byY.set(key, line);
    }
    return [...byY.values()].sort((a, b) => b.y - a.y).map((l) => ({ ...l, text: l.parts.sort((a, b) => a[0] - b[0]).map((p) => p[1]).join(' ').replace(/\s+/g, ' ').trim() }));
  } finally { await loading.destroy(); }
}
const fontsOnPage = async (bytes) => { const pdf = await PDFDocument.load(bytes); const fonts = pdf.getPage(0).node.Resources().lookup(PDFName.of('Font'), PDFDict); return fonts.keys().map((k) => fonts.lookup(k, PDFDict).get(PDFName.of('BaseFont')).toString()); };

async function openParagraphs() {
  await action('Edit', 'Paragraphs…');
  const tools = page.getByRole('dialog', { name: 'Paragraphs' });
  await tools.waitFor();
  await panel().getByRole('button', { name: /^Edit paragraph: Revenue grew/ }).waitFor({ timeout: 30000 });
  return tools;
}

try {
  await check('MAL-012 rewrite a paragraph: reflow inside its width, centred, other text untouched', async () => {
    await openPdf(await source(), 'paragraph.pdf');
    const tools = await openParagraphs();
    await panel().getByRole('button', { name: /^Edit paragraph: Revenue grew/ }).click();
    await tools.getByLabel('Paragraph text', { exact: true }).fill('Revenue grew in all regions this quarter, led by demand for the new product line.');
    await tools.getByLabel('Paragraph alignment').selectOption('center');
    await tools.getByRole('button', { name: 'Apply to paragraph' }).click();
    await notice(/Rewrote the paragraph on page 1 in 2 line/);
    const all = await lines(await save());
    const body = all.filter((l) => l.y < 700 && l.y > 600);
    expect(body.map((l) => l.text).join(' ') === 'Revenue grew in all regions this quarter, led by demand for the new product line.', 'text ' + body.map((l) => l.text).join(' | '));
    // Centred inside the original paragraph box (72 .. 72 + widest original line).
    const centres = body.map((l) => (l.left + l.right) / 2);
    expect(centres.every((c) => near(c, centres[0], 1.5)) && body.every((l) => l.left >= 71 && l.right <= 72 + 300), 'centring ' + JSON.stringify(body));
    expect(near(body[0].y - body[1].y, 18, 0.6), 'line spacing ' + (body[0].y - body[1].y));
    expect(all.some((l) => l.text === 'Annual summary') && all.some((l) => l.text.startsWith('Costs stayed flat')), 'other text changed');
  });

  await check('MAL-012 overflow is detected, and growing is an explicit choice', async () => {
    const tools = page.getByRole('dialog', { name: 'Paragraphs' });
    await panel().getByRole('button', { name: /^Edit paragraph: Costs stayed/ }).click();
    const long = Array.from({ length: 5 }, () => 'Costs stayed flat while headcount grew slightly in support.').join(' ');
    await tools.getByLabel('Paragraph text', { exact: true }).fill(long);
    await tools.getByRole('button', { name: 'Apply to paragraph' }).click();
    await tools.getByRole('alert').filter({ hasText: /needs \d+ lines but the paragraph has room for 2/ }).waitFor();
    await tools.getByRole('checkbox', { name: 'Allow the text to grow beyond its box' }).check();
    await tools.getByRole('button', { name: 'Apply to paragraph' }).click();
    await notice(/It now extends beyond its original box/);
    const body = (await lines(await save())).filter((l) => l.y < 580);
    expect(body.length > 2 && body.map((l) => l.text).join(' ') === long, 'grown text ' + body.length);
  });

  await check('MAL-013 font detection, substitution warning, size, weight, spacing, line height and reusable styles', async () => {
    await openPdf(await source(), 'paragraph-type.pdf');
    const tools = await openParagraphs();
    await panel().getByRole('button', { name: /^Edit paragraph: Revenue grew/ }).click();
    await tools.getByText('Font: Helvetica (standard, not embedded) · 14 pt · 3 line(s)').waitFor();
    await tools.getByLabel('Paragraph font').selectOption('helvetica-bold');
    await tools.getByLabel('Paragraph text size').fill('16');
    await tools.getByLabel('Paragraph line height').fill('1.5');
    await tools.getByLabel('Paragraph letter spacing').fill('0.5');
    await tools.getByLabel('New style name').fill('Lead');
    await tools.getByRole('button', { name: 'Save style' }).click();
    // Larger, airier text needs more room than the box: growing is chosen explicitly.
    await tools.getByRole('checkbox', { name: 'Allow the text to grow beyond its box' }).check();
    await tools.getByRole('button', { name: 'Apply to paragraph' }).click();
    await notice(/Font substitution: “Helvetica” was replaced by Helvetica-Bold/);
    let bytes = await save();
    expect((await fontsOnPage(bytes)).includes('/Helvetica-Bold'), 'bold font missing');
    let body = (await lines(bytes)).filter((l) => l.y < 700 && l.y > 590);
    expect(body.length >= 2 && near(body[0].y - body[1].y, 24, 0.6), 'line height ' + body.map((l) => l.y));
    // The saved style applies to another paragraph.
    await panel().getByRole('button', { name: /^Edit paragraph: Costs stayed/ }).click();
    await tools.getByLabel('Saved paragraph style').selectOption('Lead');
    expect(await tools.getByLabel('Paragraph text size').inputValue() === '16' && await tools.getByLabel('Paragraph font').inputValue() === 'helvetica-bold', 'style not applied to the controls');
    await tools.getByRole('button', { name: 'Apply to paragraph' }).click();
    await notice(/Rewrote the paragraph/);
    bytes = await save();
    // The second paragraph hangs from the top of its original box: at 16 pt its first baseline is
    // 560 + 0.85 × 14 − 0.85 × 16 = 558.3. The first paragraph has grown down to about 610.
    body = (await lines(bytes)).filter((l) => l.y <= 560.5);
    expect(body.length >= 2 && near(body[0].y, 558.3, 0.6) && near(body[0].y - body[1].y, 24, 0.6), 'style line height ' + body.map((l) => l.y));
  });
} finally {
  await h.finish();
}
