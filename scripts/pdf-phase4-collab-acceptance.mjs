/* Phase 4 collaboration acceptance (MAL-056 threaded comments and mentions, MAL-066 electronic signature requests) in
 * real Chromium. Comment threads are reopened with PDF.js and pdf-lib; the completed signing request is validated by
 * pyHanko as well as in the app. Run: node scripts/pdf-phase4-collab-acceptance.mjs (needs playwright, openssl, pyhanko)
 */
import { join } from 'node:path';
import { resolve } from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { root, startHarness } from './lib/pdf-harness.mjs';
import { PKI, pyhankoAdes, startTestTsa } from './lib/test-tsa.mjs';

const tsa = await startTestTsa();
const h = await startHarness('PHASE4-COLLAB');
const { page, panel, expect, check, action, notice, openPdf, download, save } = h;
const N = PDFName.of;
const tabFor = (name) => page.locator('.document-tab-main').filter({ hasText: name });
const canvasBox = () => panel().locator('[id$="-page-1"] canvas').first().boundingBox();
const setName = (name) => page.evaluate((n) => localStorage.setItem('malenjo.pdf.reviewer-name', n), name);
async function document(title) {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]).drawText(title, { x: 72, y: 720, size: 18, font: await pdf.embedFont(StandardFonts.Helvetica) });
  return pdf.save();
}
async function rendered() { await page.waitForFunction(() => document.querySelector('.document-session-panel.active .pdf-workspace')?.getAttribute('data-pdf-first-rendered') === 'true', null, { timeout: 60000 }); }

try {
  await check('MAL-056 asynchronous comment threads with replies, mentions, resolution and notifications', async () => {
    await setName('Sam Lee');
    await openPdf(await document('Quarterly figures'), 'figures.pdf');
    await action('Review', 'Comment threads…');
    let d = page.getByRole('dialog', { name: 'Comment threads' });
    expect(await d.getByLabel('Your name').inputValue() === 'Sam Lee', 'name');
    await d.getByLabel('Comment', { exact: true }).fill('Is this total right, @Dana?');
    await d.getByRole('button', { name: 'Place on the page' }).click();
    const b = await canvasBox(); await page.mouse.click(b.x + 0.12 * b.width, b.y + 0.15 * b.height);
    await notice('Added a comment on page 1.');
    await d.getByRole('article', { name: 'Thread by Sam Lee on page 1' }).getByText('Is this total right, @Dana?').waitFor();
    const fromSam = await save();
    // Dana opens the file: she is told about the mention.
    await setName('Dana Reviewer');
    await openPdf(fromSam, 'figures-for-dana.pdf');
    await notice('1 new comment notification for Dana Reviewer: open Review, Comment threads… to read it.');
    await action('Review', 'Comment threads…');
    d = page.getByRole('dialog', { name: 'Comment threads' });
    const forYou = d.getByRole('region', { name: 'For you' });
    await forYou.getByText('For you (1 new)').waitFor();
    await forYou.getByText(/Sam Lee mentioned you — “Is this total right, @Dana\?”/).waitFor();
    await d.getByLabel('Reply to Sam Lee on page 1').fill('Yes, it matches the ledger. @[Sam Lee] see the note.');
    await d.getByRole('button', { name: 'Reply', exact: true }).click();
    await notice('Replied to Sam Lee on page 1.');
    await d.getByLabel('Status of the thread by Sam Lee on page 1').selectOption('Completed');
    await notice('Marked the thread on page 1 resolved.');
    await forYou.getByRole('button', { name: 'Mark all as seen' }).click();
    await forYou.getByText('For you (0 new)').waitFor();
    const fromDana = await save();
    // Any reader sees the thread: replies point at the comment, and the status is a review state.
    const loading = getDocument({ data: new Uint8Array(fromDana), isEvalSupported: false, standardFontDataUrl: resolve(root, 'node_modules/pdfjs-dist/standard_fonts') + '/' });
    const annots = await (await (await loading.promise).getPage(1)).getAnnotations(); await loading.destroy();
    const rootNote = annots.find((a) => !a.inReplyTo);
    expect(rootNote?.contentsObj?.str === 'Is this total right, @Dana?' && annots.filter((a) => a.inReplyTo === rootNote.id).length === 2, 'PDF.js thread ' + JSON.stringify(annots.map((a) => [a.id, a.inReplyTo, a.contentsObj?.str])));
    const doc = await PDFDocument.load(fromDana);
    const dicts = doc.getPage(0).node.lookup(N('Annots'), PDFArray).asArray().map((r) => doc.context.lookup(r));
    const state = dicts.find((x) => x instanceof PDFDict && x.has(N('State')));
    expect(state?.lookup(N('State')).decodeText() === 'Completed' && state.lookup(N('StateModel')).decodeText() === 'Review' && state.lookup(N('T')).decodeText() === 'Dana Reviewer', 'review state');
    // Sam opens Dana's copy: her reply mentions him.
    await setName('Sam Lee');
    await openPdf(fromDana, 'figures-for-sam.pdf');
    await notice('1 new comment notification for Sam Lee: open Review, Comment threads… to read it.');
    await action('Review', 'Comment threads…');
    d = page.getByRole('dialog', { name: 'Comment threads' });
    await d.getByRole('region', { name: 'For you' }).getByText(/Dana Reviewer mentioned you/).waitFor();
    await d.getByRole('article', { name: 'Thread by Sam Lee on page 1' }).locator('header strong').getByText('Resolved', { exact: true }).waitFor();
    await d.getByRole('button', { name: 'Close comment threads' }).click();
  });

  await check('MAL-066 signing workflow with recipient assignment, signing status and audit evidence', async () => {
    await openPdf(await document('Supply contract'), 'contract.pdf');
    // Trust the test root so the status can say the signatures are valid.
    await action('Protect', 'Digital signatures…');
    let s = page.getByRole('dialog', { name: 'Digital signatures' });
    await s.locator('input[type="file"][accept^=".cer"]').setInputFiles(join(PKI, 'ca.pem'));
    await s.getByRole('list', { name: 'Trusted certificates' }).getByText(/MALENJO Test Root CA/).waitFor();
    await s.getByRole('button', { name: 'Close digital signatures' }).click();
    await action('Protect', 'Signing requests…');
    let d = page.getByRole('dialog', { name: 'Signing requests' });
    await d.getByLabel('Title').fill('Supply contract 2026');
    await d.getByLabel('Message to recipients').fill('Please sign in order.');
    await d.getByLabel('Recipient 1 name').fill('Dana Signer'); await d.getByLabel('Recipient 1 email').fill('dana@example.com');
    await d.getByRole('button', { name: 'Add recipient' }).click();
    await d.getByLabel('Recipient 2 name').fill('Erin EC Signer');
    await d.getByRole('button', { name: 'Prepare request' }).click();
    await notice('Prepared “Supply contract 2026” for 2 recipient(s). Save the PDF and send it to Dana Signer first.');
    const table = d.getByRole('table', { name: 'Recipients and signing status' });
    await table.getByText('Ready to sign').waitFor(); await table.getByText('Waiting for earlier recipients').waitFor();
    const signAs = async (who, p12, file) => {
      await d.getByRole('button', { name: `Sign as ${who}…` }).click();
      s = page.getByRole('dialog', { name: 'Digital signatures' });
      await s.getByText(`Signing the field “${file}” prepared by the signing request.`).waitFor();
      await s.locator('input[type="file"][accept^=".p12"]').setInputFiles(join(PKI, p12));
      await s.getByLabel('Certificate password').fill('test-pass');
      await s.getByRole('button', { name: 'Open certificate' }).click();
      await s.getByLabel('PAdES profile').selectOption('B-T');
      await s.getByLabel('Timestamp authority (RFC 3161)').fill(tsa.url);
      return download(() => s.getByRole('button', { name: 'Sign and save a copy' }).click());
    };
    await signAs('Dana Signer', 'signer.p12', 'Sign 1 - Dana Signer');
    await notice(/Signed by Dana Signer at PAdES B-T; saved contract-signed\.pdf and opened it in a new tab\./);
    await tabFor('contract-signed.pdf').waitFor(); await rendered();
    await action('Protect', 'Signing requests…');
    d = page.getByRole('dialog', { name: 'Signing requests' });
    await d.getByRole('table', { name: 'Recipients and signing status' }).getByText(/^Signed by Dana Signer \d{4}-\d\d-\d\d \d\d:\d\d UTC — valid$/).waitFor();
    const final = await signAs('Erin EC Signer', 'signer-ec.p12', 'Sign 2 - Erin EC Signer');
    await notice(/Signed by Erin EC Signer at PAdES B-T; saved contract-signed-signed\.pdf/);
    await tabFor('contract-signed-signed.pdf').waitFor(); await rendered();
    await action('Protect', 'Signing requests…');
    d = page.getByRole('dialog', { name: 'Signing requests' });
    await d.getByText(/Supply contract 2026: completed — everyone has signed\./).waitFor();
    const report = (await download(() => d.getByRole('button', { name: 'Save audit report (HTML)' }).click())).toString('utf8');
    expect(report.includes('COMPLETED — every recipient has signed') && /Dana Signer — valid; PAdES B-T; trusted time/.test(report) && /Erin EC Signer — valid; PAdES B-T; trusted time/.test(report)
      && (report.match(/<tr><td>[\d,]+ bytes<\/td>/g) ?? []).length === 2 && report.includes('dana@example.com'), 'audit report');
    const verdict = pyhankoAdes(final, tsa.work);
    expect((verdict.match(/The signature is judged VALID\./g) ?? []).length === 2, 'pyHanko: ' + verdict);
  });
} finally {
  await h.finish();
  tsa.close();
}
