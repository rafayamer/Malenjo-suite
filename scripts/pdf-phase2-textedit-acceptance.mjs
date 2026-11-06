/* Phase 2 text editing acceptance (MAL-011 native inline text editing,
 * MAL-023 search, replace and revision history) in real Chromium. Saved
 * output is reopened independently with PDF.js and pdf-lib.
 * Run: node scripts/pdf-phase2-textedit-acceptance.mjs   (needs `playwright`)
 */
import { PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { pageAnnotations, pageTexts, startHarness } from './lib/pdf-harness.mjs';

const h = await startHarness('PHASE2-TEXTEDIT');
const { page, panel, expect, check, action, notice, openPdf, download, save } = h;

async function invoice() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const p = pdf.addPage([612, 792]);
  p.drawText('Invoice total: 120 EUR', { x: 72, y: 700, size: 20, font });
  p.drawText('Shipping: 15 EUR', { x: 72, y: 660, size: 20, font });
  p.drawText('Thank you for your order', { x: 72, y: 620, size: 20, font });
  return pdf.save();
}
/** The same invoice drawn with an embedded subset font: only the characters already used can be drawn natively. */
async function subsetInvoice() {
  const pdf = await PDFDocument.load(await invoice());
  const fontDicts = pdf.getPage(0).node.Resources().lookup(PDFName.of('Font'), PDFDict);
  for (const key of fontDicts.keys()) {
    const font = fontDicts.lookup(key, PDFDict);
    font.set(PDFName.of('BaseFont'), PDFName.of('ABCDEF+Helvetica'));
    font.set(PDFName.of('FontDescriptor'), pdf.context.obj({ Type: 'FontDescriptor', FontName: 'ABCDEF+Helvetica', Flags: 32,
      FontBBox: [-166, -225, 1000, 931], ItalicAngle: 0, Ascent: 718, Descent: -207, CapHeight: 718, StemV: 88,
      FontFile2: pdf.context.register(pdf.context.stream('not a font program')) }));
  }
  return pdf.save();
}
const fonts = (pdf) => pdf.getPage(0).node.Resources().lookup(PDFName.of('Font'), PDFDict).keys().length;

async function openTextEdit() {
  await action('Edit', 'Edit text…');
  const tools = page.getByRole('dialog', { name: 'Edit text' });
  await tools.waitFor();
  await panel().getByRole('button', { name: /^Edit text: / }).first().waitFor({ timeout: 30000 });
  return tools;
}

try {
  await check('MAL-011 edit existing text in place, in its own font, by clicking it on the page', async () => {
    const source = await invoice();
    await openPdf(source, 'invoice.pdf');
    const tools = await openTextEdit();
    await panel().getByRole('button', { name: 'Edit text: Invoice total: 120 EUR' }).click();
    const input = tools.getByLabel('New text');
    expect(await input.inputValue() === 'Invoice total: 120 EUR', 'selected text not loaded');
    // Select, delete and insert characters: replace "120" with "145.50".
    await input.fill('Invoice total: 145.50 EUR');
    await tools.getByRole('button', { name: 'Replace text' }).click();
    await notice(/in the original font \(Helvetica\)/);
    const bytes = await save();
    const texts = (await pageTexts(bytes))[0];
    expect(texts === 'Invoice total: 145.50 EUR Shipping: 15 EUR Thank you for your order', 'text ' + texts);
    expect((await pageAnnotations(bytes))[0].length === 0, 'an annotation was added (overlay)');
    const [before, after] = [await PDFDocument.load(source), await PDFDocument.load(bytes)];
    expect(fonts(after) === fonts(before), 'fonts were added');
  });

  await check('MAL-011 characters missing from the font are refused, and an overlay is offered and labelled', async () => {
    let tools = page.getByRole('dialog', { name: 'Edit text' });
    // Cyrillic: neither the PDF's font nor an overlay's built-in font can draw it, so no overlay is offered.
    await panel().getByRole('button', { name: 'Edit text: Shipping: 15 EUR' }).click();
    await tools.getByLabel('New text').fill('Доставка: 15 EUR');
    await tools.getByRole('button', { name: 'Replace text' }).click();
    await tools.getByRole('alert').filter({ hasText: /has no glyph for.*An overlay cannot show these characters either/ }).waitFor();
    expect(await tools.getByRole('button', { name: 'Use an overlay text box instead (labelled)' }).count() === 0, 'an overlay was offered for text it would show as ?');
    await tools.getByRole('button', { name: 'Close edit text' }).click();
    // A subset font without "D": native editing is refused, and the labelled overlay can show the text.
    await openPdf(await subsetInvoice(), 'invoice-subset.pdf');
    tools = await openTextEdit();
    await panel().getByRole('button', { name: 'Edit text: Shipping: 15 EUR' }).click();
    await tools.getByLabel('New text').fill('Shipping: 15 USD');
    await tools.getByRole('button', { name: 'Replace text' }).click();
    await tools.getByRole('alert').filter({ hasText: /has no glyph for “D”/ }).waitFor();
    await tools.getByRole('button', { name: 'Use an overlay text box instead (labelled)' }).click();
    await notice(/This is an overlay annotation: the original text is still in the file/);
    const bytes = await save();
    expect((await pageTexts(bytes))[0].includes('Shipping: 15 EUR'), 'original text should remain under an overlay');
    expect((await pageAnnotations(bytes))[0].includes('FreeText'), 'overlay text box missing');
    await tools.getByRole('button', { name: 'Close edit text' }).click();
  });

  await check('MAL-023 find and replace in place across the document', async () => {
    await openPdf(await invoice(), 'invoice-replace.pdf');
    await action('Edit', 'Find and replace…');
    const dialog = page.getByRole('dialog', { name: 'Find and replace' });
    await dialog.getByLabel('Find text').fill('EUR');
    await dialog.getByRole('button', { name: 'Find all' }).click();
    await dialog.getByText('2 match(es)').waitFor();
    await dialog.getByLabel('Replace with').fill('USD');
    await dialog.getByRole('button', { name: 'Replace all' }).click();
    await notice(/Replaced 2 occurrence\(s\) of “EUR” in place/);
    const texts = (await pageTexts(await save()))[0];
    expect(texts === 'Invoice total: 120 USD Shipping: 15 USD Thank you for your order', 'text ' + texts);
  });

  await check('MAL-023 revision history: restore an earlier revision, save any revision, undo and redo', async () => {
    const dialog = page.getByRole('dialog', { name: 'Find and replace' });
    await dialog.getByLabel('Find text').fill('Thank you');
    await dialog.getByLabel('Replace with').fill('Thanks');
    await dialog.getByRole('button', { name: 'Replace all' }).click();
    await notice(/Replaced 1 occurrence/);
    await dialog.getByText(/2\. Replaced “Thank you”\..*\(current\)/).waitFor();
    // Save revision 1 (after the first replacement) without leaving the current one.
    const saved = await download(() => dialog.getByRole('button', { name: 'Save revision 1 as a PDF' }).click());
    expect((await pageTexts(saved))[0] === 'Invoice total: 120 USD Shipping: 15 USD Thank you for your order', 'revision 1 content');
    // Restore the document as opened, then redo forward.
    await dialog.getByRole('button', { name: 'Go back to revision 0' }).click();
    await notice(/Restored the document as it was opened/);
    expect((await pageTexts(await save()))[0] === 'Invoice total: 120 EUR Shipping: 15 EUR Thank you for your order', 'restore to opened');
    await page.getByRole('button', { name: 'Redo PDF edit', exact: true }).click();
    await notice(/Redid:/);
    expect((await pageTexts(await save()))[0].includes('120 USD'), 'redo after restore');
  });
} finally {
  await h.finish();
}
