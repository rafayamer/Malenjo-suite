/* Phase 2 organize acceptance (MAL-001 merge, MAL-002 split) in real Chromium.
 * Each check drives the real UI, saves the output and reopens it independently.
 * Run: node scripts/pdf-phase2-organize-acceptance.mjs   (needs `playwright`)
 */
import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { addBookmarks, addStickyNote, labelledDoc, outlineEntries, pageAnnotations, pageTexts, startHarness } from './lib/pdf-harness.mjs';

const h = await startHarness('PHASE2-ORGANIZE');
const { page, panel, expect, check, action, notice, openPdf, download, save, undo } = h;
const tag = (texts) => texts.map((t) => t.match(/^(\w+) (\d+)/)?.slice(1).join('') ?? '?').join(',');

async function mergeSources() {
  const a = addBookmarks(await labelledDoc('A', 2), [{ title: 'A intro', page: 2 }]);
  a.setTitle('Alpha annual report'); a.setAuthor('Alpha author');
  const b = addBookmarks(await labelledDoc('B', 2), [{ title: 'B start', page: 1 }]);
  const c = addStickyNote(await labelledDoc('C', 1), 1, 'C review note');
  return { a: await a.save(), b: await b.save(), c: await c.save() };
}

async function openMergeDialog() {
  await action('Organize', 'Merge PDFs…');
  return page.getByRole('dialog', { name: 'Merge PDFs' });
}

async function addToMerge(dialog, files) {
  const chooser = page.waitForEvent('filechooser', { timeout: 10000 });
  await dialog.getByRole('button', { name: 'Add PDFs…' }).click();
  await (await chooser).setFiles(files.map(([name, bytes]) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) })));
  await dialog.locator('.pdf-merge-list li').nth(files.length).waitFor({ timeout: 10000 });
}

try {
  await check('MAL-001 merge files in a user-chosen order, keeping pages, annotations, bookmarks and metadata', async () => {
    const { a, b, c } = await mergeSources();
    await openPdf(a, 'alpha.pdf');
    const dialog = await openMergeDialog();
    await addToMerge(dialog, [['bravo.pdf', b], ['charlie.pdf', c]]);
    // User-selected order: alpha, charlie, bravo.
    await dialog.getByRole('button', { name: 'Move charlie.pdf up' }).click();
    const order = await dialog.locator('.pdf-merge-name').allTextContents();
    expect(order[1].includes('charlie.pdf') && order[2].includes('bravo.pdf'), 'reorder failed: ' + order.join(' | '));
    await dialog.getByRole('button', { name: /^Merge 3 PDFs/ }).click();
    await notice(/Merged 3 PDFs into 5 pages/);
    const bytes = await save();
    expect(tag(await pageTexts(bytes)) === 'A1,A2,C1,B1,B2', 'page order ' + tag(await pageTexts(bytes)));
    expect((await pageAnnotations(bytes))[2].includes('Text'), 'C sticky note lost');
    const outline = JSON.stringify(await outlineEntries(bytes));
    expect(outline === JSON.stringify([['A intro', 2], ['B start', 4]]), 'bookmarks ' + outline);
    const merged = await PDFDocument.load(bytes);
    expect(merged.getTitle() === 'Alpha annual report' && merged.getAuthor() === 'Alpha author', 'metadata not from first file');
    await undo();
    expect(tag(await pageTexts(await save())) === 'A1,A2', 'undo did not restore the original');
  });

  await check('MAL-001 merge options: bookmarks grouped by file, no document information', async () => {
    const { a, b } = await mergeSources();
    await openPdf(a, 'alpha-options.pdf');
    const dialog = await openMergeDialog();
    await addToMerge(dialog, [['bravo.pdf', b]]);
    await dialog.getByLabel('Merged bookmarks').selectOption('per-file');
    await dialog.getByLabel('Merged document information').selectOption('none');
    await dialog.getByRole('button', { name: /^Merge 2 PDFs/ }).click();
    await notice(/Merged 2 PDFs into 4 pages/);
    const bytes = await save();
    const outline = JSON.stringify(await outlineEntries(bytes));
    expect(outline === JSON.stringify([['alpha-options', 1], ['A intro', 2], ['bravo', 3], ['B start', 3]]), 'grouped bookmarks ' + outline);
    expect((await PDFDocument.load(bytes)).getTitle() === undefined, 'document information should be empty');
  });

  async function splitWith(configure) {
    await action('Organize', 'Split…');
    const dialog = page.getByRole('dialog', { name: 'Split PDF' });
    await configure(dialog);
    const zip = await download(() => dialog.getByRole('button', { name: 'Split and save ZIP' }).click());
    const parts = [];
    for (const [name, data] of Object.entries(unzipSync(new Uint8Array(zip))).sort(([x], [y]) => x.localeCompare(y))) {
      parts.push([name, tag(await pageTexts(data))]);
    }
    return parts;
  }

  await check('MAL-002 split by page ranges', async () => {
    await openPdf(await (await labelledDoc('P', 8)).save(), 'ranges.pdf');
    const parts = await splitWith(async (d) => { await d.getByLabel('Page ranges to split').fill('1-3, 5, 7-'); });
    expect(JSON.stringify(parts.map(([, pages]) => pages)) === JSON.stringify(['P1,P2,P3', 'P5', 'P7,P8']), 'parts ' + JSON.stringify(parts));
    await notice(/Split into 3 PDF part/);
    expect(tag(await pageTexts(await save())) === 'P1,P2,P3,P4,P5,P6,P7,P8', 'the open document changed');
  });

  await check('MAL-002 split every N pages', async () => {
    await openPdf(await (await labelledDoc('P', 7)).save(), 'count.pdf');
    const parts = await splitWith(async (d) => { await d.getByRole('radio', { name: 'Every N pages' }).check(); await d.getByLabel('Pages per part').fill('3'); });
    expect(JSON.stringify(parts.map(([, pages]) => pages)) === JSON.stringify(['P1,P2,P3', 'P4,P5,P6', 'P7']), 'parts ' + JSON.stringify(parts));
  });

  await check('MAL-002 split by top-level bookmarks', async () => {
    const doc = addBookmarks(await labelledDoc('P', 6), [{ title: 'One', page: 1 }, { title: 'Two', page: 3 }, { title: 'Three', page: 5 }]);
    await openPdf(await doc.save(), 'chapters.pdf');
    const parts = await splitWith(async (d) => { await d.getByRole('radio', { name: 'By top-level bookmarks' }).check(); });
    expect(JSON.stringify(parts.map(([, pages]) => pages)) === JSON.stringify(['P1,P2', 'P3,P4', 'P5,P6']), 'parts ' + JSON.stringify(parts));
  });

  await check('MAL-002 split by size threshold', async () => {
    // Text-dense pages of a few KB each; a 0.01 MB (10 KB) limit forces several parts.
    const doc = await labelledDoc('P', 8);
    const font = await doc.embedFont('Helvetica');
    doc.getPages().forEach((p, i) => { for (let l = 0; l < 120; l++) p.drawText(`${i}-${l}-${Math.random().toString(36).slice(2, 12)}`, { x: 40, y: 30 + (l % 60) * 11, size: 6, font }); });
    await openPdf(await doc.save(), 'size.pdf');
    const parts = await splitWith(async (d) => { await d.getByRole('radio', { name: 'By file size' }).check(); await d.getByLabel('Maximum part size in MB').fill('0.01'); });
    expect(parts.length >= 2, 'expected several parts, got ' + parts.length);
    expect(parts.map(([, pages]) => pages).join(',') === 'P1,P2,P3,P4,P5,P6,P7,P8', 'pages lost or reordered ' + JSON.stringify(parts));
  });
} finally {
  await h.finish();
}
