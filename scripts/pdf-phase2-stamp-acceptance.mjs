/* Phase 2 stamping acceptance (MAL-017 headers/footers, MAL-018 page numbers,
 * MAL-019 text watermarks, MAL-020 image watermarks) in real Chromium.
 * Each check drives the real UI, saves the output and reopens it independently.
 * Run: node scripts/pdf-phase2-stamp-acceptance.mjs   (needs `playwright`)
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, decodePDFRawStream, degrees } from 'pdf-lib';
import { labelledDoc, pageTextItems, pageTexts, startHarness } from './lib/pdf-harness.mjs';

const h = await startHarness('PHASE2-STAMP');
const { page, expect, check, action, notice, openPdf, save, undo } = h;
const near = (a, b, tolerance = 2) => Math.abs(a - b) <= tolerance;
const item = (sheet, str) => {
  const found = sheet.items.find((i) => i.str === str);
  if (!found) throw Error(`“${str}” not found; page has ${sheet.items.map((i) => i.str).join(' | ')}`);
  return found;
};
// 2x1 red PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDAAAAQBQEAzYPXwAAAAABJRU5ErkJggg==', 'base64');

/** Decoded content streams of a page, in drawing order. */
function contentStreams(pdf, index) {
  const raw = pdf.getPage(index).node.get(PDFName.of('Contents'));
  const refs = raw instanceof PDFArray ? raw.asArray() : [raw];
  return refs.map((ref) => new TextDecoder().decode(decodePDFRawStream(pdf.context.lookup(ref)).decode()));
}
/** Fill opacities of the page's ExtGState resources. */
function opacities(pdf, index) {
  const states = pdf.getPage(index).node.Resources()?.lookupMaybe(PDFName.of('ExtGState'), PDFDict);
  return states ? states.keys().map((key) => states.lookup(key, PDFDict).lookupMaybe(PDFName.of('ca'), PDFNumber)?.asNumber()) : [];
}
function fontNames(pdf, index) {
  const fonts = pdf.getPage(index).node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
  return fonts ? fonts.keys().map((key) => fonts.lookup(key, PDFDict).get(PDFName.of('BaseFont'))?.toString()) : [];
}

async function stamp(button, dialogName, configure) {
  await action('Edit', button);
  const dialog = page.getByRole('dialog', { name: dialogName });
  await configure(dialog);
  await dialog.getByRole('button', { name: `Apply ${dialogName.toLowerCase()}` }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 30000 });
}

async function labelledSource() {
  const doc = await labelledDoc('P', 4);
  doc.setTitle('Field report'); doc.setAuthor('Ada Author');
  // Page labels: i, ii, then 1, 2.
  const nums = doc.context.obj([0, doc.context.obj({ S: PDFName.of('r') }), 2, doc.context.obj({ S: PDFName.of('D') })]);
  doc.catalog.set(PDFName.of('PageLabels'), doc.context.obj({ Nums: nums }));
  doc.getPage(3).setRotation(degrees(90));
  return doc.save();
}

try {
  await check('MAL-017 headers and footers with file name, date, page label, document fields and custom text', async () => {
    await openPdf(await labelledSource(), 'quarterly.pdf');
    await stamp('Header & footer…', 'Header and footer', async (d) => {
      await d.getByLabel('Header left').fill('{file}');
      await d.getByLabel('Header center').fill('{title} by {author}');
      await d.getByLabel('Header right').fill('Printed {date}');
      await d.getByLabel('Footer left').fill('Internal draft');
      await d.getByLabel('Footer center').fill('Page {label} ({page} of {pages})');
      await d.getByLabel('Footer right').fill('');
    });
    await notice(/Added the header and footer to 4 page/);
    const pages = await pageTextItems(await save());
    const today = new Date(); const pad = (n) => String(n).padStart(2, '0');
    const date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const second = pages[1];
    expect(item(second, 'quarterly.pdf').vx < 60 && item(second, 'quarterly.pdf').vy < 60, 'file name not at top left');
    const titled = item(second, 'Field report by Ada Author');
    expect(titled.vx > 150 && titled.vx < 350 && titled.vy < 60, 'title/author not centred in the header');
    expect(item(second, `Printed ${date}`).vx > 400, 'date not at top right');
    expect(item(second, 'Internal draft').vy > second.height - 60, 'custom text not in footer');
    expect(!!item(second, 'Page ii (2 of 4)') && !!item(pages[2], 'Page 1 (3 of 4)'), 'page labels not used');
    // Rotated page 4: the header still reads at the top of the page as shown.
    const rotated = pages[3];
    expect(rotated.width > rotated.height && item(rotated, 'quarterly.pdf').vy < 60, 'header not upright on the rotated page');
    expect(!!item(pages[0], 'P 1'), 'page content lost');
    await undo();
    expect((await pageTexts(await save()))[1] === 'P 2', 'undo did not remove the header and footer');
  });

  await check('MAL-018 page numbers: roman format with prefix, suffix, total, alignment and margins', async () => {
    await openPdf(await (await labelledDoc('P', 4)).save(), 'numbers-roman.pdf');
    await stamp('Page numbers…', 'Page numbers', async (d) => {
      await d.getByLabel('Number format').selectOption('roman-upper');
      await d.getByLabel('Number prefix').fill('Sheet ');
      await d.getByLabel('Number suffix').fill(' *');
      await d.getByRole('checkbox', { name: 'Show “of total”' }).check();
      await d.getByLabel('Position').selectOption('bottom-right');
      await d.getByLabel('Side margin in points').fill('50');
      await d.getByLabel('Top and bottom margin in points').fill('40');
    });
    await notice(/Numbered 4 page/);
    const pages = await pageTextItems(await save());
    const third = item(pages[2], 'Sheet III of IV *');
    expect(near(third.vy, 792 - 40, 12) && third.vx > 400 && third.vx < 612 - 50, `position ${third.vx},${third.vy}`);
    expect(!!item(pages[0], 'Sheet I of IV *') && !!item(pages[3], 'Sheet IV of IV *'), 'numbering sequence');
  });

  await check('MAL-018 page numbers: start number, letters, top-left, first page skipped', async () => {
    await openPdf(await (await labelledDoc('P', 3)).save(), 'numbers-alpha.pdf');
    await stamp('Page numbers…', 'Page numbers', async (d) => {
      await d.getByLabel('Number format').selectOption('alpha-lower');
      await d.getByLabel('Start number').fill('3');
      await d.getByLabel('Position').selectOption('top-left');
      await d.getByRole('checkbox', { name: 'Skip the first page' }).check();
    });
    const pages = await pageTextItems(await save());
    expect(pages[0].items.map((i) => i.str).join() === 'P 1', 'first page should not be numbered');
    const c = item(pages[1], 'c');
    expect(near(c.vx, 36, 2) && c.vy < 50, `top-left position ${c.vx},${c.vy}`);
    expect(!!item(pages[2], 'd'), 'second number');
  });

  await check('MAL-019 text watermark: typography, orientation, transparency, position and page scope', async () => {
    await openPdf(await (await labelledDoc('P', 3)).save(), 'watermark-text.pdf');
    await stamp('Text watermark…', 'Text watermark', async (d) => {
      await d.getByLabel('Watermark text').fill('SAMPLE');
      await d.getByLabel('Font', { exact: true }).selectOption('times-bold');
      await d.getByLabel('Font size (pt)').fill('48');
      await d.getByLabel('Rotation in degrees').fill('30');
      await d.getByLabel('Opacity percent').fill('25');
      await d.getByLabel('Position').selectOption('top-right');
      await d.getByLabel('Pages to stamp').fill('2-3');
    });
    await notice(/text watermark to 2 page/);
    const bytes = await save();
    const pages = await pageTextItems(bytes);
    expect(!pages[0].items.some((i) => i.str === 'SAMPLE'), 'page 1 is outside the scope');
    const mark = item(pages[1], 'SAMPLE');
    expect(mark.vx > 300 && mark.vy < 300, `not near the top right: ${mark.vx},${mark.vy}`);
    const pdf = await PDFDocument.load(bytes);
    expect(fontNames(pdf, 1).includes('/Times-Bold'), 'font ' + fontNames(pdf, 1));
    expect(opacities(pdf, 1).includes(0.25), 'opacity ' + opacities(pdf, 1));
    const ours = contentStreams(pdf, 1).find((t) => /MalenjoGS/.test(t) && / Tf/.test(t));
    const [a, b] = ours.match(/gs\s+(\S+) (\S+) /).slice(1).map(Number);
    expect(near(Math.atan2(b, a) * 180 / Math.PI, 30, 0.01), 'orientation is not 30°: ' + ours.slice(0, 160));
    expect(/ 48 Tf/.test(ours), 'size 48 missing');
  });

  await check('MAL-020 image watermark: scaling, position, transparency and layer order', async () => {
    await openPdf(await (await labelledDoc('P', 2)).save(), 'watermark-image.pdf');
    await stamp('Image watermark…', 'Image watermark', async (d) => {
      const chooser = page.waitForEvent('filechooser', { timeout: 10000 });
      await d.getByRole('button', { name: 'Choose image…' }).click();
      await (await chooser).setFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
      await d.getByRole('button', { name: 'Image: logo.png' }).waitFor();
      await d.getByLabel('Image width as percent of page width').fill('50');
      await d.getByLabel('Position').selectOption('bottom-left');
      await d.getByLabel('Rotation in degrees').fill('0');
      await d.getByLabel('Opacity percent').fill('40');
      await d.getByLabel('Watermark margin in points').fill('20');
      await d.getByLabel('Layer order').selectOption('below');
    });
    await notice(/image watermark to 2 page/);
    const pdf = await PDFDocument.load(await save());
    const streams = contentStreams(pdf, 0);
    const body = streams.findIndex((t) => /Tj/.test(t) && !/Malenjo/.test(t));
    const mark = streams.findIndex((t) => /Malenjo\S* Do/.test(t));
    // Below: drawn before the page content; 306 = 50% of 612, 153 = half that (2:1 image), at the 20 pt margin.
    expect(mark >= 0 && mark < body, `image not below the content (image ${mark}, content ${body})`);
    expect(/306 0 0 153 20 20 cm/.test(streams[mark]), 'not at the requested size and position: ' + streams[mark].slice(0, 160));
    expect(opacities(pdf, 0).includes(0.4), 'opacity ' + opacities(pdf, 0));
    expect((await pageTexts(await pdf.save()))[0] === 'P 1', 'page text lost');

    await stamp('Image watermark…', 'Image watermark', async (d) => {
      const chooser = page.waitForEvent('filechooser', { timeout: 10000 });
      await d.getByRole('button', { name: 'Choose image…' }).click();
      await (await chooser).setFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
      await d.getByRole('button', { name: 'Image: logo.png' }).waitFor();
      await d.getByLabel('Layer order').selectOption('above');
    });
    const above = await PDFDocument.load(await save());
    const aboveStreams = contentStreams(above, 0);
    const aboveBody = aboveStreams.findIndex((t) => /Tj/.test(t) && !/Malenjo/.test(t));
    const marks = aboveStreams.flatMap((t, i) => /Malenjo\S* Do/.test(t) ? [i] : []);
    expect(marks.length === 2 && marks[0] < aboveBody && marks[1] > aboveBody, `layer order: images at ${marks}, content at ${aboveBody}`);
  });
} finally {
  await h.finish();
}
