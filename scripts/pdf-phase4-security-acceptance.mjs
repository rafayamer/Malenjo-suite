/* Phase 4 security acceptance (MAL-061 protect, MAL-062 unlock, MAL-070 sanitize) in real Chromium.
 * Outputs are downloaded and inspected independently: PDF.js must refuse a protected copy without its
 * password and open it with either password, report the chosen permissions, and read what sanitizing left.
 * The unlock check uses a fixture protected by qpdf, an independent producer of AES-256 files.
 * Run: node scripts/pdf-phase4-security-acceptance.mjs   (needs `playwright`)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument, PDFHexString, PDFName, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { root, startHarness } from './lib/pdf-harness.mjs';

const h = await startHarness('PHASE4-SECURITY');
const { page, expect, check, action, notice, openPdf, download, save, undo } = h;
const tabFor = (name) => page.locator('.document-tab-main').filter({ hasText: name });

/** What an independent reader sees: page text, metadata, attachments, scripts, annotations and permissions. */
async function inspect(bytes, password) {
  const loading = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, ...(password === undefined ? {} : { password }),
    standardFontDataUrl: resolve(root, 'node_modules/pdfjs-dist/standard_fonts') + '/' });
  const doc = await loading.promise;
  try {
    const p = await doc.getPage(1);
    const meta = await doc.getMetadata();
    return {
      pages: doc.numPages, text: (await p.getTextContent()).items.map((i) => i.str).join('|'), title: meta.info.Title, xmp: meta.metadata,
      attachments: await doc.getAttachments(), js: await doc.getJSActions(), permissions: await doc.getPermissions(),
      annots: (await p.getAnnotations()).map((a) => `${a.subtype}:${a.contentsObj?.str ?? ''}`),
    };
  } finally { await loading.destroy(); }
}
async function refused(bytes, password) {
  try { await inspect(bytes, password); return false; } catch (error) { return error?.name === 'PasswordException'; }
}

async function plain() {
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 300]).drawText('Board minutes', { x: 30, y: 240, size: 16, font: await pdf.embedFont(StandardFonts.Helvetica) });
  pdf.setTitle('Minutes');
  return pdf.save();
}
/** One of each kind of content Sanitize looks for, with visible text and a visible note that must stay. */
async function loaded() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 300]);
  page.drawText('Visible report', { x: 20, y: 250, size: 14, font: await pdf.embedFont(StandardFonts.Helvetica) });
  pdf.setTitle('Internal draft'); pdf.setAuthor('A. Person');
  pdf.catalog.set(PDFName.of('Metadata'), pdf.context.register(pdf.context.stream('<x:xmpmeta>secret</x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' })));
  await pdf.attach(new TextEncoder().encode('payroll'), 'payroll.csv', { mimeType: 'text/csv' });
  pdf.addJavaScript('init', 'app.alert("hi")');
  const ocg = pdf.context.register(pdf.context.obj({ Type: 'OCG', Name: PDFHexString.fromText('Notes') }));
  pdf.catalog.set(PDFName.of('OCProperties'), pdf.context.obj({ OCGs: [ocg], D: { OFF: [ocg] } }));
  page.node.Resources().set(PDFName.of('Properties'), pdf.context.obj({ MC0: ocg }));
  const f = page.node.Resources().lookup(PDFName.of('Font')).keys()[0].decodeText();
  page.node.addContentStream(pdf.context.register(pdf.context.stream(`/OC /MC0 BDC BT /${f} 12 Tf 20 200 Td (Layer secret) Tj ET EMC BT 3 Tr /${f} 12 Tf 20 150 Td (OCR secret) Tj ET`)));
  const annot = (o) => pdf.context.register(pdf.context.obj({ Type: 'Annot', Rect: [10, 10, 60, 30], ...o }));
  page.node.set(PDFName.of('Annots'), pdf.context.obj([
    annot({ Subtype: 'Link', A: { S: 'URI', URI: PDFHexString.fromText('https://example.com/track') } }),
    annot({ Subtype: 'Text', F: 2, Contents: PDFHexString.fromText('Hidden note') }),
    annot({ Subtype: 'Text', Contents: PDFHexString.fromText('Visible note') }),
  ]));
  return pdf.save({ useObjectStreams: false });
}

try {
  await check('MAL-061 protect a PDF with AES-256, an open password, an owner password and permission flags', async () => {
    await openPdf(await plain(), 'minutes.pdf');
    await action('Protect', 'Protect PDF…');
    const d = page.getByRole('dialog', { name: 'Protect PDF' });
    await d.getByLabel('Open password (optional)').fill('read-it');
    await d.getByLabel('Owner password', { exact: true }).fill('own-it');
    await d.getByLabel('Owner password again').fill('own-it-typo');
    await d.getByRole('button', { name: 'Save protected copy' }).click();
    await d.getByText('The owner passwords do not match.').waitFor();
    await d.getByLabel('Owner password again').fill('own-it');
    await d.getByLabel('Printing').selectOption('low');
    await d.getByLabel('Copy text and images').setChecked(false);
    await d.getByLabel('Add comments and fill forms').setChecked(true);
    const bytes = await download(() => d.getByRole('button', { name: 'Save protected copy' }).click());
    await notice(/Saved minutes-protected\.pdf, protected with AES-256/);
    const raw = bytes.toString('latin1');
    expect(/\/V 5/.test(raw) && /\/R 6/.test(raw) && /\/CFM \/AESV3/.test(raw) && !raw.includes('Board minutes') && !raw.includes('Minutes'), 'not AES-256 or plaintext leaked');
    expect(await refused(bytes) && await refused(bytes, 'guess'), 'opens without the right password');
    const asReader = await inspect(bytes, 'read-it');
    expect(asReader.text === 'Board minutes' && asReader.title === 'Minutes', 'content with the open password ' + JSON.stringify(asReader.text));
    // Granted: print (bit 3), comments (6), fill forms (9), accessibility (10); denied: modify (4), copy (5), assemble (11), high-quality print (12).
    expect(JSON.stringify([...asReader.permissions].sort((a, b) => a - b)) === JSON.stringify([4, 32, 256, 512]), 'permissions ' + JSON.stringify(asReader.permissions));
    expect((await inspect(bytes, 'own-it')).text === 'Board minutes', 'owner password');
    await d.getByRole('button', { name: 'Close protect' }).click();
  });

  await check('MAL-062 remove protection with the owner password, refusing a password that does not permit it', async () => {
    const fixture = readFileSync(resolve(root, 'testing/suite/fixtures/pdf/encrypted-owner-restricted.pdf'));
    await openPdf(fixture, 'restricted.pdf');
    await action('Protect', 'Remove protection…');
    const d = page.getByRole('dialog', { name: 'Remove protection' });
    await d.getByText(/Protected with AES-256\. It opens without a password but restricts/).waitFor();
    await d.getByLabel('Owner password').fill('');
    await d.getByRole('button', { name: 'Remove protection', exact: true }).click();
    await d.getByRole('alert').filter({ hasText: /needs the owner \(permissions\) password/ }).waitFor();
    await d.getByLabel('Owner password').fill('wrong');
    await d.getByRole('button', { name: 'Remove protection', exact: true }).click();
    await d.getByRole('alert').filter({ hasText: /Incorrect password/ }).waitFor();
    await d.getByLabel('Owner password').fill('owner');
    await d.getByRole('button', { name: 'Remove protection', exact: true }).click();
    await tabFor('restricted-unlocked.pdf').waitFor({ timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('.document-session-panel.active .pdf-workspace')?.getAttribute('data-pdf-first-rendered') === 'true', null, { timeout: 60000 });
    const out = await save();
    expect(!out.toString('latin1').includes('/Encrypt'), 'still encrypted');
    const read = await inspect(out);
    expect(read.pages === 3 && read.permissions === null, 'unlocked copy ' + JSON.stringify({ pages: read.pages, permissions: read.permissions }));
  });

  await check('MAL-070 inspect and remove selected metadata, attachments, scripts, links and hidden content', async () => {
    await openPdf(await loaded(), 'draft.pdf');
    await action('Protect', 'Sanitize…');
    const d = page.getByRole('dialog', { name: 'Sanitize PDF' });
    for (const text of [/Title \(“Internal draft”\)/, /Embedded file “payroll\.csv”/, /Document JavaScript “init”/, /https:\/\/example\.com\/track/, /1 block\(s\) in layers that are off/, /1 invisible text object/, /Text hidden from view/]) await d.getByText(text).first().waitFor();
    await d.getByLabel(/^Links to web addresses and files/).setChecked(false);
    await d.getByRole('button', { name: 'Remove selected' }).click();
    await notice(/Removed \d+ item\(s\): metadata, attachments, scripts and actions, hidden content/);
    const read = await inspect(await save());
    expect(read.text === 'Visible report', 'hidden text left ' + read.text);
    expect(read.title === undefined && read.xmp === null && read.attachments === null && read.js === null, 'metadata/attachments/scripts left');
    expect(JSON.stringify(read.annots) === JSON.stringify(['Link:', 'Text:Visible note']), 'annotations ' + JSON.stringify(read.annots));
    await undo();
    const restored = await inspect(await save());
    expect(restored.title === 'Internal draft' && restored.attachments !== null, 'undo did not restore');
  });
} finally {
  await h.finish();
}
