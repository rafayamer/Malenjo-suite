/* Phase 2 layout acceptance (MAL-009 N-up, MAL-010 batch assembly) in real Chromium.
 * Each check drives the real UI, saves the output and reopens it independently.
 * Run: node scripts/pdf-phase2-layout-acceptance.mjs   (needs `playwright`)
 */
import { createHash } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { labelledDoc, pageTextItems, pageTexts, startHarness } from './lib/pdf-harness.mjs';

const h = await startHarness('PHASE2-LAYOUT');
const { page, expect, check, action, notice, openPdf, download, save, undo } = h;
const tag = (texts) => texts.map((t) => t.match(/^(\w+) (\d+)/)?.slice(1).join('') ?? '?').join(',');
const sheetTags = (sheet) => sheet.items.map((i) => i.str.replace(' ', '')).join(',');
const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance;
const MM = 72 / 25.4;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function nup(configure) {
  await action('Organize', 'Pages per sheet…');
  const dialog = page.getByRole('dialog', { name: 'Pages per sheet (N-up)' });
  await configure(dialog);
  await dialog.getByRole('button', { name: 'Arrange pages' }).click();
  await notice(/Arranged \d+ pages per sheet/);
}

async function openBatch(files) {
  await action('Organize', 'Batch organize…');
  const dialog = page.getByRole('dialog', { name: 'Batch organize PDFs' });
  const chooser = page.waitForEvent('filechooser', { timeout: 10000 });
  await dialog.getByRole('button', { name: 'Add PDFs…' }).click();
  await (await chooser).setFiles(files.map(([name, bytes]) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) })));
  await dialog.getByRole('list', { name: 'PDFs in the batch' }).locator('li').nth(files.length).waitFor({ timeout: 10000 });
  return dialog;
}

async function addRule(dialog, kind, fill = {}) {
  await dialog.getByLabel('Rule type').selectOption(kind);
  if (fill.pages !== undefined) await dialog.getByLabel('Rule pages').fill(fill.pages);
  if (fill.angle) await dialog.getByLabel('Rotation angle').selectOption(String(fill.angle));
  if (fill.perSheet) await dialog.getByLabel('Batch pages per sheet').selectOption(String(fill.perSheet));
  await dialog.getByRole('button', { name: 'Add rule' }).click();
}

try {
  await check('MAL-009 N-up: 4 pages per portrait Letter sheet, left to right then down, undoable', async () => {
    await openPdf(await (await labelledDoc('P', 6)).save(), 'nup-four.pdf');
    await nup(async (d) => { await d.getByLabel('Pages per sheet', { exact: true }).selectOption('4'); });
    const sheets = await pageTextItems(await save());
    expect(sheets.length === 2, 'sheets ' + sheets.length);
    expect(near(sheets[0].width, 612) && near(sheets[0].height, 792), `sheet size ${sheets[0].width}x${sheets[0].height}`);
    expect(sheetTags(sheets[0]) === 'P1,P2,P3,P4' && sheetTags(sheets[1]) === 'P5,P6', 'sheet contents ' + sheets.map(sheetTags).join(' | '));
    const [one, two, three, four] = sheets[0].items;
    expect(two.x > one.x + 100 && near(two.y, one.y), 'page 2 is not to the right of page 1');
    expect(three.y < one.y - 100 && near(three.x, one.x) && near(four.x, two.x), 'page 3 is not below page 1');
    await undo();
    expect(tag(await pageTexts(await save())) === 'P1,P2,P3,P4,P5,P6', 'undo did not restore the original pages');
  });

  await check('MAL-009 N-up: 6 pages per landscape A4 sheet, top to bottom order, chosen spacing', async () => {
    await openPdf(await (await labelledDoc('P', 6)).save(), 'nup-six.pdf');
    await nup(async (d) => {
      await d.getByLabel('Pages per sheet', { exact: true }).selectOption('6');
      await d.getByLabel('Sheet size').selectOption('a4');
      await d.getByLabel('Sheet orientation').selectOption('landscape');
      await d.getByLabel('Page order').selectOption('columns');
      await d.getByLabel('Sheet margin in mm').fill('6');
      await d.getByLabel('Spacing between pages in mm').fill('20');
    });
    const [sheet, ...rest] = await pageTextItems(await save());
    expect(!rest.length, 'expected one sheet');
    expect(near(sheet.width, 841.89) && near(sheet.height, 595.28), `sheet size ${sheet.width}x${sheet.height}`);
    expect(sheetTags(sheet) === 'P1,P2,P3,P4,P5,P6', 'sheet contents ' + sheetTags(sheet));
    const [one, two, three] = sheet.items;
    // Column order: page 2 below page 1, page 3 starts the next column.
    const columnStep = (sheet.width - 2 * 6 * MM + 20 * MM) / 3;
    const rowStep = (sheet.height - 2 * 6 * MM + 20 * MM) / 2;
    expect(near(two.x, one.x) && near(one.y - two.y, rowStep), `row step ${one.y - two.y} vs ${rowStep}`);
    expect(near(three.x - one.x, columnStep) && near(three.y, one.y), `column step ${three.x - one.x} vs ${columnStep}`);
  });

  await check('MAL-010 batch: rules applied across several files with a JSON and CSV manifest', async () => {
    const alpha = await (await labelledDoc('A', 5)).save();
    const bravo = await (await labelledDoc('B', 3)).save();
    await openPdf(alpha, 'alpha.pdf');
    const dialog = await openBatch([['bravo.pdf', bravo], ['broken.pdf', new TextEncoder().encode('%PDF-1.7 not really')]]);
    await addRule(dialog, 'remove', { pages: '1' });
    await addRule(dialog, 'rotate', { pages: '1', angle: 90 });
    const zip = unzipSync(new Uint8Array(await download(() => dialog.getByRole('button', { name: /^Run on 3 PDFs/ }).click())));
    await notice(/Batch finished: 2 succeeded, 1 failed/);
    expect(JSON.stringify(Object.keys(zip).sort()) === JSON.stringify(['manifest.csv', 'manifest.json', 'results/alpha.pdf', 'results/bravo.pdf']), 'zip ' + Object.keys(zip));
    expect(tag(await pageTexts(zip['results/alpha.pdf'])) === 'A2,A3,A4,A5', 'alpha pages');
    expect(tag(await pageTexts(zip['results/bravo.pdf'])) === 'B2,B3', 'bravo pages');
    const rotated = await PDFDocument.load(zip['results/bravo.pdf']);
    expect(rotated.getPage(0).getRotation().angle === 90 && rotated.getPage(1).getRotation().angle === 0, 'rotation rule');
    const manifest = JSON.parse(strFromU8(zip['manifest.json']));
    const [a, b, broken] = manifest.entries;
    expect(a.source === 'alpha.pdf' && a.status === 'ok' && a.inputPages === 5 && a.outputPages === 4, 'alpha entry ' + JSON.stringify(a));
    expect(a.inputSha256 === sha(alpha) && a.outputSha256 === sha(zip['results/alpha.pdf']), 'alpha digests');
    expect(b.inputSha256 === sha(bravo) && b.outputSha256 === sha(zip['results/bravo.pdf']), 'bravo digests');
    expect(broken.status === 'failed' && /damaged/.test(broken.message) && broken.output === null, 'broken entry ' + JSON.stringify(broken));
    const csv = strFromU8(zip['manifest.csv']).trim().split('\r\n');
    expect(csv.length === 4 && csv[1].includes(sha(alpha)) && csv[3].includes('"failed"'), 'csv ' + csv.join(' / '));
    const table = await dialog.getByRole('table', { name: 'Batch results' }).innerText();
    expect(/broken\.pdf\s+Failed/.test(table) && /alpha\.pdf\s+Done\s+5 → 4/.test(table), 'results table ' + table);
    await dialog.getByRole('button', { name: 'Close batch' }).click();
    expect(tag(await pageTexts(await save())) === 'A1,A2,A3,A4,A5', 'the open document changed');
  });

  await check('MAL-010 batch: keep-range and N-up rules', async () => {
    await openPdf(await (await labelledDoc('K', 6)).save(), 'keep.pdf');
    const dialog = await openBatch([['other.pdf', await (await labelledDoc('M', 5)).save()]]);
    await addRule(dialog, 'keep', { pages: '1-4' });
    await addRule(dialog, 'nup', { perSheet: 2 });
    const zip = unzipSync(new Uint8Array(await download(() => dialog.getByRole('button', { name: /^Run on 2 PDFs/ }).click())));
    const keep = await pageTextItems(zip['results/keep.pdf']);
    expect(keep.map(sheetTags).join(' | ') === 'K1,K2 | K3,K4', 'keep sheets ' + keep.map(sheetTags).join(' | '));
    expect(keep[0].width > keep[0].height, '2-up sheets should be landscape');
    expect((await pageTextItems(zip['results/other.pdf'])).map(sheetTags).join(' | ') === 'M1,M2 | M3,M4', 'other sheets');
    const manifest = JSON.parse(strFromU8(zip['manifest.json']));
    expect(JSON.stringify(manifest.rules) === JSON.stringify(['Keep only pages 1-4', '2 pages per sheet']), 'rules ' + manifest.rules);
  });
} finally {
  await h.finish();
}
