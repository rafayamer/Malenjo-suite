/* Phase 4 review and compliance acceptance (MAL-057 dynamic stamps, MAL-058 measurement, MAL-059 compare, MAL-068
 * preflight) in real Chromium. Outputs are saved and reopened with PDF.js and pdf-lib.
 * Run: node scripts/pdf-phase4-review-acceptance.mjs   (needs `playwright`)
 */
import { resolve } from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, StandardFonts, rgb } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { root, startHarness } from './lib/pdf-harness.mjs';

const h = await startHarness('PHASE4-REVIEW');
const { page, panel, expect, check, action, notice, openPdf, download, save } = h;
const N = PDFName.of;

async function annotations(bytes) {
  const loading = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, standardFontDataUrl: resolve(root, 'node_modules/pdfjs-dist/standard_fonts') + '/' });
  const doc = await loading.promise;
  try { return (await (await doc.getPage(1)).getAnnotations()).map((a) => ({ subtype: a.subtype, contents: a.contentsObj?.str ?? '', title: a.titleObj?.str ?? '' })); }
  finally { await loading.destroy(); }
}
const canvasBox = () => panel().locator('[id$="-page-1"] canvas').first().boundingBox();
/** Clicks a point given in page space of an upright 612 x 792 page. */
async function clickAt(x, y) { const b = await canvasBox(); await page.mouse.click(b.x + (x / 612) * b.width, b.y + (1 - y / 792) * b.height); }
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function plain(lines) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const pageLines of lines) { const p = pdf.addPage([612, 792]); pageLines.forEach((l, i) => p.drawText(l, { x: 72, y: 700 - i * 24, size: 14, font })); }
  return pdf.save();
}

try {
  await check('MAL-057 reusable stamps with date, time, user, document identifier and approval-state variables', async () => {
    await openPdf(await plain([['Contract']]), 'contract.pdf');
    await action('Review', 'Stamps…');
    let d = page.getByRole('dialog', { name: 'Stamps' });
    await d.getByLabel('Your name on stamps').fill('Dana Reviewer');
    await d.getByRole('button', { name: 'New stamp…' }).click();
    await d.getByLabel('Stamp name').fill('Legal sign-off');
    await d.getByLabel('Status line').fill('APPROVED BY LEGAL');
    await d.getByLabel('Detail line').fill('{user} · {date} {time} · Doc {docid}');
    await d.getByRole('button', { name: 'Save stamp' }).click();
    await d.getByText('Saved the stamp “Legal sign-off” to your library.').waitFor();
    await d.getByLabel('Stamp preview').getByText(new RegExp(`Dana Reviewer · ${today()} \\d\\d:\\d\\d · Doc [0-9A-F]{12}`)).waitFor();
    await d.getByRole('button', { name: 'Place on the page' }).click();
    await clickAt(110, 700);
    await notice(/Placed the stamp “APPROVED BY LEGAL — Dana Reviewer · \d{4}-\d\d-\d\d \d\d:\d\d · Doc [0-9A-F]{12}” on page 1\./);
    const [stamp] = await annotations(await save());
    expect(stamp?.subtype === 'Stamp' && stamp.title === 'Dana Reviewer' && new RegExp(`^APPROVED BY LEGAL — Dana Reviewer · ${today()} \\d\\d:\\d\\d · Doc [0-9A-F]{12}$`).test(stamp.contents), 'stamp ' + JSON.stringify(stamp));
    // Reusable: the library survives a restart of the app.
    await page.reload();
    await openPdf(await plain([['Second document']]), 'second.pdf');
    await action('Review', 'Stamps…');
    d = page.getByRole('dialog', { name: 'Stamps' });
    await d.getByRole('list', { name: 'Stamp library' }).getByText('Legal sign-off (yours)').waitFor();
    expect(await d.getByLabel('Your name on stamps').inputValue() === 'Dana Reviewer', 'user name not kept');
    await d.getByRole('button', { name: 'Close stamps' }).click();
  });

  await check('MAL-058 calibrated distance, angle, area and perimeter measurements with units and scale factors', async () => {
    // A 1.5 in by 7/9 in rectangle near the top left, clear of the dialog.
    const [x0, y0, x1, y1] = [36, 700, 144, 756];
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]).drawRectangle({ x: x0, y: y0, width: x1 - x0, height: y1 - y0, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    await openPdf(await pdf.save(), 'plan.pdf');
    await action('Review', 'Measure…');
    const d = page.getByRole('dialog', { name: 'Measure' });
    // Calibrate: the rectangle's 1.5 in top edge is 15 ft, so 1 in is 10 ft.
    await d.getByLabel('Measuring tool').selectOption('calibrate');
    await d.getByRole('button', { name: 'Place points on the page' }).click();
    await clickAt(x0, y1); await clickAt(x1, y1);
    await d.getByLabel('Known length', { exact: true }).fill('15');
    await d.getByLabel('Known length unit').selectOption('ft');
    await d.getByRole('button', { name: 'Use this scale' }).click();
    await d.getByText(/Scale set: \d+(\.\d+)? pt = 15 ft\./).waitFor();
    const value = (s) => Number(/: ([\d,.]+)/.exec(s)[1].replace(/,/g, ''));
    const ft = (pt) => (pt / 72) * 10;
    await d.getByRole('button', { name: 'Place points on the page' }).click();
    await clickAt(x0, y0); await clickAt(x0, y1);
    await notice(/Added Distance: [\d.]+ ft on page 1\./);
    for (const [tool, label] of [['area', 'Area'], ['perimeter', 'Perimeter']]) {
      await d.getByLabel('Measuring tool').selectOption(tool);
      await d.getByRole('button', { name: 'Place points on the page' }).click();
      for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) await clickAt(x, y);
      await d.getByRole('button', { name: 'Finish shape' }).click();
      await notice(new RegExp(`Added ${label}: [\\d.,]+ (sq )?ft on page 1\\.`));
    }
    await d.getByLabel('Measuring tool').selectOption('angle');
    await d.getByRole('button', { name: 'Place points on the page' }).click();
    await clickAt(x1, y0); await clickAt(x0, y0); await clickAt(x0, y1);
    await notice(/Added Angle: [\d.]+° on page 1\./);
    const out = await save();
    const found = await annotations(out);
    expect(JSON.stringify(found.map((a) => a.subtype)) === JSON.stringify(['Line', 'Polygon', 'PolyLine', 'PolyLine']), 'subtypes ' + JSON.stringify(found));
    const [distance, area, perimeter, angle] = found.map((a) => a.contents);
    const near = (v, target, share) => Math.abs(v - target) <= Math.abs(target) * share;
    expect(/ft$/.test(distance) && near(value(distance), ft(y1 - y0), 0.03), 'distance ' + distance);
    expect(/sq ft$/.test(area) && near(value(area), ft(x1 - x0) * ft(y1 - y0), 0.04), 'area ' + area);
    expect(near(value(perimeter), 2 * (ft(x1 - x0) + ft(y1 - y0)), 0.03), 'perimeter ' + perimeter);
    expect(/°$/.test(angle) && near(value(angle), 90, 0.015), 'angle ' + angle);
    const doc = await PDFDocument.load(out);
    const line = doc.context.lookup(doc.getPage(0).node.lookup(N('Annots'), PDFArray).get(0));
    const measure = line.lookup(N('Measure'), PDFDict);
    expect(/pt = 15 ft$/.test(measure.lookup(N('R')).decodeText()) && line.get(N('IT')).toString() === '/LineDimension', 'measure dictionary');
    await d.getByRole('list', { name: 'Measurements in this PDF' }).getByText(/Page 1: Angle/).waitFor();
  });

  await check('MAL-059 compare revisions side by side, by text differences and as a visual overlay', async () => {
    const before = await plain([['Statement for March', 'Total due 120'], ['Terms unchanged']]);
    await openPdf(await plain([['Statement for April', 'Total due 120 paid'], ['Terms unchanged']]), 'statement-v2.pdf');
    await action('Review', 'Compare…');
    const d = page.getByRole('dialog', { name: 'Compare' });
    await d.locator('input[type="file"]').setInputFiles({ name: 'statement-v1.pdf', mimeType: 'application/pdf', buffer: Buffer.from(before) });
    await d.getByText('Before: statement-v1.pdf. 1 of 2 pages have text changes; 2 word(s) added, 1 removed.').waitFor({ timeout: 30000 });
    await d.getByRole('img', { name: 'Before, page 1' }).waitFor(); await d.getByRole('img', { name: 'After, page 1' }).waitFor();
    const changed = async () => Number(await d.locator('canvas').first().getAttribute('data-changed-pixels'));
    expect(await changed() > 100, 'page 1 shows no pixel change');
    await d.getByRole('tab', { name: 'Overlay' }).click();
    await d.getByRole('img', { name: /Overlay of page 1/ }).waitFor();
    await d.getByLabel('Compared page').selectOption('2');
    await d.getByRole('img', { name: /Overlay of page 2/ }).waitFor();
    await d.getByText('This page looks the same.').waitFor();
    await d.getByRole('tab', { name: 'Text changes' }).click();
    for (const line of ['Removed: March', 'Added: April', 'Added: paid']) await d.getByText(line, { exact: true }).waitFor();
    const report = (await download(() => d.getByRole('button', { name: 'Save comparison report (HTML)' }).click())).toString('utf8');
    expect(report.includes('<del>March</del> <ins>April</ins>') && report.includes('<ins>paid</ins>'), 'report');
  });

  await check('MAL-068 preflight against selected PDF/A, PDF/X and PDF/UA profiles', async () => {
    const pdf = await PDFDocument.create();
    const p = pdf.addPage([612, 792]);
    p.drawText('Unembedded font, RGB colour', { x: 72, y: 700, size: 14, font: await pdf.embedFont(StandardFonts.Helvetica), color: rgb(1, 0, 0) });
    p.drawRectangle({ x: 72, y: 500, width: 100, height: 100, color: rgb(0, 0, 1), opacity: 0.4 });
    pdf.addJavaScript('init', 'app.alert(1)');
    pdf.catalog.set(N('Lang'), PDFHexString.fromText('en'));
    await openPdf(await pdf.save(), 'brochure.pdf');
    await action('Protect', 'Preflight…');
    const d = page.getByRole('dialog', { name: 'Preflight' });
    await d.getByLabel('PDF/X-1a (print, CMYK and spot only)').check();
    await d.getByLabel('PDF/UA-1 (accessibility)').check();
    await d.getByRole('button', { name: 'Run preflight' }).click();
    const a = d.getByRole('region', { name: 'PDF/A-2b (archiving) results' });
    await a.getByText(/^PDF\/A-2b \(archiving\): failed \d+ of \d+ checks$/).waitFor();
    for (const line of ['Failed: Fonts — Every font is embedded', 'Helvetica (Page 1)', 'Failed: Actions and content — No JavaScript, launch or multimedia actions, and no XFA', 'Failed: Metadata — XMP metadata is present', 'Passed: Structure — The file is not encrypted'])
      await a.getByText(line, { exact: true }).waitFor();
    const x = d.getByRole('region', { name: 'PDF/X-1a (print, CMYK and spot only) results' });
    for (const line of ['Failed: Transparency — No transparency (soft masks, opacity, blend modes, transparency groups)', 'DeviceRGB: Page 1', 'Failed: Page boxes — Every page has a TrimBox or ArtBox'])
      await x.getByText(line, { exact: true }).first().waitFor();
    const ua = d.getByRole('region', { name: 'PDF/UA-1 (accessibility) results' });
    for (const line of ['Failed: Tagging — The document is tagged', 'Passed: Metadata — The document language is set']) await ua.getByText(line, { exact: true }).waitFor();
    const report = (await download(() => d.getByRole('button', { name: 'Save report' }).click())).toString('utf8');
    expect(/PDF\/A-2b \(archiving\): FAILED/.test(report) && report.includes('[FAIL] Fonts — Every font is embedded') && report.includes('not a certified validator'), 'report');
  });
} finally {
  await h.finish();
}
