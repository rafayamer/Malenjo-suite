/* Phase 2 document properties and navigation acceptance (MAL-021 metadata,
 * MAL-022 bookmarks, links, destinations and generated contents) in real
 * Chromium. Each check drives the real UI, saves the output and reopens it
 * independently with PDF.js (and pdf-lib where structure matters).
 * Run: node scripts/pdf-phase2-navigation-acceptance.mjs   (needs `playwright`)
 */
import { resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { addBookmarks, labelledDoc, pageTexts, root, startHarness } from './lib/pdf-harness.mjs';

const h = await startHarness('PHASE2-NAVIGATION');
const { page, expect, check, action, notice, openPdf, save } = h;

async function withPdf(bytes, fn) {
  const loading = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, standardFontDataUrl: resolve(root, 'node_modules/pdfjs-dist/standard_fonts') + '/' });
  const doc = await loading.promise;
  try { return await fn(doc); } finally { await loading.destroy(); }
}
const metadata = (bytes) => withPdf(bytes, (doc) => doc.getMetadata());
/** Outline as nested [title, page, children] resolved by PDF.js. */
const outline = (bytes) => withPdf(bytes, async (doc) => {
  const walk = async (items) => Promise.all((items || []).map(async (item) => {
    const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
    const pageNumber = Array.isArray(dest) && dest[0] ? (await doc.getPageIndex(dest[0])) + 1 : null;
    const children = await walk(item.items);
    return children.length ? [item.title, pageNumber, children] : [item.title, pageNumber];
  }));
  return walk(await doc.getOutline());
});
/** Link annotations per page as "url:..." or "page:N", resolved by PDF.js. */
const links = (bytes) => withPdf(bytes, async (doc) => {
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    for (const a of await (await doc.getPage(p)).getAnnotations()) {
      if (a.subtype !== 'Link') continue;
      if (a.url) out.push(`${p}>url:${a.url}`);
      else if (a.dest) {
        const dest = typeof a.dest === 'string' ? await doc.getDestination(a.dest) : a.dest;
        out.push(`${p}>page:${(await doc.getPageIndex(dest[0])) + 1}`);
      }
    }
  }
  return out;
});

async function openDialog(button, name) {
  await action('Edit', button);
  const dialog = page.getByRole('dialog', { name });
  await dialog.waitFor();
  return dialog;
}

try {
  await check('MAL-021 inspect, modify and save Info and XMP metadata with custom properties', async () => {
    const doc = await labelledDoc('P', 2);
    doc.setTitle('Draft title'); doc.setAuthor('First Author');
    await openPdf(await doc.save(), 'properties.pdf');
    const dialog = await openDialog('Document properties…', 'Document properties');
    await dialog.getByLabel('Title', { exact: true }).waitFor();
    expect(await dialog.getByLabel('Title', { exact: true }).inputValue() === 'Draft title', 'existing title not shown');
    expect(await dialog.getByLabel('Author', { exact: true }).inputValue() === 'First Author', 'existing author not shown');
    expect(await dialog.getByText('This PDF has no XMP metadata.').isVisible(), 'XMP status not shown');
    await dialog.getByLabel('Title', { exact: true }).fill('Final budget 2026');
    await dialog.getByLabel('Author', { exact: true }).fill('Ada Lovelace');
    await dialog.getByLabel('Subject', { exact: true }).fill('Annual budget');
    await dialog.getByLabel('Keywords', { exact: true }).fill('budget, finance');
    await dialog.getByRole('button', { name: 'Add custom property' }).click();
    await dialog.getByLabel('Custom property 1 name').fill('Department');
    await dialog.getByLabel('Custom property 1 value').fill('Finance');
    await dialog.getByRole('button', { name: 'Save properties' }).click();
    await notice(/Saved document properties and matching XMP/);
    const meta = await metadata(await save());
    expect(meta.info.Title === 'Final budget 2026' && meta.info.Author === 'Ada Lovelace' && meta.info.Subject === 'Annual budget', 'Info ' + JSON.stringify(meta.info));
    expect(meta.info.Keywords === 'budget, finance', 'keywords ' + meta.info.Keywords);
    expect(meta.info.Custom?.get?.('Department') === 'Finance' || meta.info.Custom?.Department === 'Finance', 'custom property missing');
    expect(meta.metadata?.get('dc:title') === 'Final budget 2026', 'XMP title ' + meta.metadata?.get('dc:title'));
    expect(JSON.stringify(meta.metadata?.get('dc:creator')) === '["Ada Lovelace"]', 'XMP creator ' + JSON.stringify(meta.metadata?.get('dc:creator')));
    // The dialog re-reads the saved document and now reports its XMP.
    await dialog.getByText(/This PDF has XMP metadata/).waitFor();
  });

  await check('MAL-021 remove XMP, then clear every property', async () => {
    const dialog = page.getByRole('dialog', { name: 'Document properties' });
    await dialog.getByLabel('XMP metadata when saving').selectOption('remove');
    await dialog.getByRole('button', { name: 'Save properties' }).click();
    await notice(/XMP metadata removed/);
    const noXmp = await metadata(await save());
    expect(noXmp.metadata === null && noXmp.info.Title === 'Final budget 2026', 'XMP should be gone, Info kept');
    await dialog.getByRole('button', { name: 'Clear all properties' }).click();
    await notice(/Cleared all document properties/);
    const cleared = await metadata(await save());
    expect(cleared.metadata === null, 'XMP not cleared');
    expect(!cleared.info.Title && !cleared.info.Author && !cleared.info.Keywords && !cleared.info.Custom, 'Info not cleared ' + JSON.stringify(cleared.info));
    await dialog.getByRole('button', { name: 'Close document properties' }).click();
  });

  await check('MAL-022 bookmarks: create, nest, rename, retarget, reorder and remove', async () => {
    await openPdf(await (await labelledDoc('P', 5)).save(), 'bookmarks.pdf');
    const dialog = await openDialog('Navigation…', 'Navigation');
    const add = async (title, pageNumber) => {
      await dialog.getByLabel('Bookmark title').fill(title);
      await dialog.getByLabel('Bookmark page').fill(String(pageNumber));
      await dialog.getByRole('button', { name: 'Add bookmark' }).click();
      await dialog.getByRole('radio', { name: new RegExp(`^${title} —`) }).waitFor();
    };
    await add('Intro', 1); await add('Method', 3); await add('Results', 4); await add('Extra', 5);
    await dialog.getByRole('radio', { name: /^Results —/ }).check();
    await dialog.getByRole('button', { name: 'Indent' }).click();
    await notice(/Nested “Results”/);
    await dialog.getByRole('radio', { name: /^Method —/ }).check();
    await dialog.getByLabel('Bookmark title').fill('Methods');
    await dialog.getByRole('button', { name: 'Rename' }).click();
    await notice(/Renamed to “Methods”/);
    await dialog.getByRole('radio', { name: /^Methods —/ }).check();
    await dialog.getByLabel('Bookmark page').fill('2');
    await dialog.getByRole('button', { name: 'Set page' }).click();
    await notice(/now opens page 2/);
    await dialog.getByRole('radio', { name: /^Extra —/ }).check();
    await dialog.getByRole('button', { name: 'Move up' }).click();
    await notice(/Moved “Extra” up/);
    await dialog.getByRole('radio', { name: /^Intro —/ }).check();
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await notice(/Deleted “Intro”/);
    const tree = JSON.stringify(await outline(await save()));
    expect(tree === JSON.stringify([['Extra', 5], ['Methods', 2, [['Results', 4]]]]), 'outline ' + tree);
  });

  await check('MAL-022 links: add web and page links, change a destination, remove a link', async () => {
    const dialog = page.getByRole('dialog', { name: 'Navigation' });
    await dialog.getByRole('tab', { name: 'Links' }).click();
    await dialog.getByLabel('Link web address').fill('https://example.org/report');
    await dialog.getByLabel('Link on page').fill('1');
    await dialog.getByRole('button', { name: 'Add link' }).click();
    await notice(/Added a link on page 1/);
    await dialog.getByLabel('Link destination type').selectOption('page');
    await dialog.getByLabel('Link target page').fill('4');
    await dialog.getByLabel('Link on page').fill('2');
    await dialog.getByRole('button', { name: 'Add link' }).click();
    await notice(/Added a link on page 2/);
    let found = await links(await save());
    expect(JSON.stringify(found) === JSON.stringify(['1>url:https://example.org/report', '2>page:4']), 'links ' + JSON.stringify(found));
    await dialog.getByRole('radio', { name: /^Page 2:/ }).check();
    await dialog.getByLabel('Link target page').fill('5');
    await dialog.getByRole('button', { name: 'Change destination' }).click();
    await notice(/Changed the link destination/);
    await dialog.getByRole('radio', { name: /^Page 1:/ }).check();
    await dialog.getByRole('button', { name: 'Remove link' }).click();
    await notice(/Removed a link on page 1/);
    found = await links(await save());
    expect(JSON.stringify(found) === JSON.stringify(['2>page:5']), 'links after edits ' + JSON.stringify(found));
    await dialog.getByRole('button', { name: 'Close navigation' }).click();
  });

  await check('MAL-022 generated table of contents from bookmarks, with working links', async () => {
    const doc = addBookmarks(await labelledDoc('P', 6), [{ title: 'Overview', page: 1 }, { title: 'Analysis', page: 3 }, { title: 'Appendix', page: 6 }]);
    await openPdf(await doc.save(), 'contents.pdf');
    const dialog = await openDialog('Navigation…', 'Navigation');
    await dialog.getByRole('tab', { name: 'Table of contents' }).click();
    await dialog.getByRole('button', { name: 'Generate table of contents' }).click();
    await notice(/Inserted 1 contents page\(s\) with 3 linked entries/);
    const bytes = await save();
    const texts = await pageTexts(bytes);
    expect(texts.length === 7 && /^Contents Overview[ .]+1 Analysis[ .]+3 Appendix[ .]+6$/.test(texts[0]), 'contents page ' + texts[0]);
    expect(texts[1] === 'P 1', 'content shifted wrongly: ' + texts[1]);
    const found = await links(bytes);
    expect(JSON.stringify(found) === JSON.stringify(['1>page:2', '1>page:4', '1>page:7']), 'contents links ' + JSON.stringify(found));
    const labels = await withPdf(bytes, (d) => d.getPageLabels());
    expect(JSON.stringify(labels) === JSON.stringify(['i', '1', '2', '3', '4', '5', '6']), 'labels ' + JSON.stringify(labels));
    await dialog.getByRole('button', { name: 'Close navigation' }).click();
  });
} finally {
  await h.finish();
}
