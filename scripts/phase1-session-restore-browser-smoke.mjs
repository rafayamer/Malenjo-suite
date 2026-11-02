/* Phase 1 regression: session restore and recovery in the real mounted app.
 *   node scripts/phase1-session-restore-browser-smoke.mjs
 * PORT overrides the Vite port (default 1420, as in CI).
 *
 * Browser/Codespaces: temporary files are not kept across a reload; the user
 * is told once, and no document data is written to browser storage.
 * Desktop: exercised through a stubbed Tauri IPC bridge (a fake local library
 * and real PDF bytes). Native Windows behaviour remains a separate gate.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';

const root = resolve(import.meta.dirname, '..');
const port = Number(process.env.PORT || 1420);
const base = `http://127.0.0.1:${port}`;
const STORAGE_KEY = 'malenjo.workspace.v1';
let vite, browser;
function check(ok, message) {
  if (!ok) throw Error('Phase 1 session restore acceptance: ' + message);
}
async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch { /* Vite is still starting. */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw Error(`Vite did not start on port ${port}.`);
}
async function makePdf(label, pages) {
  const pdf = await PDFDocument.create();
  for (let index = 1; index <= pages; index++) pdf.addPage().drawText(`${label} page ${index}`);
  return Array.from(await pdf.save());
}

async function browserScenario() {
  const page = await browser.newPage({ viewport: { width: 1366, height: 850 } });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Home', exact: true }).waitFor({ timeout: 15000 });
  await page.locator('.workspace > input[type="file"]').setInputFiles({
    name: 'temporary.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await makePdf('temp', 2)),
  });
  await page.locator('.document-tab-main', { hasText: 'temporary.pdf' }).waitFor({ timeout: 15000 });
  const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  check(stored && JSON.parse(stored).temporaryCount === 1 && JSON.parse(stored).tabs.length === 0,
    'Browser session did not record exactly one temporary file and no restorable tabs: ' + stored);
  check(!/temp page|%PDF|temporary\.pdf/.test(stored), 'Document name or content leaked into browser storage');
  page.on('dialog', (dialog) => dialog.accept());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Home', exact: true }).waitFor({ timeout: 15000 });
  const notice = page.locator('.ml-open-feedback', { hasText: 'temporary browser file was not kept' });
  await notice.waitFor({ timeout: 10000 });
  check(await page.locator('.document-tab-main').count() === 0, 'A temporary browser tab was restored');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Home', exact: true }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  check(await page.locator('.ml-open-feedback', { hasText: 'temporary browser file' }).count() === 0,
    'The temporary-file notice repeated on a later start');
  await page.close();
  console.log('PHASE1 browser session: temporary files explained once, nothing stored: PASS');
}

async function desktopScenario() {
  const library = [
    { id: 'doc-a', name: 'Alpha.pdf', pages: 6 },
    { id: 'doc-b', name: 'Bravo.pdf', pages: 2 },
  ];
  const fixtures = {};
  for (const item of library) fixtures[item.id] = await makePdf(item.name, item.pages);
  const context = await browser.newContext({ viewport: { width: 1366, height: 850 } });
  // Fake desktop bridge: a local library and real PDF bytes. Unknown native
  // commands resolve to null so unrelated startup work stays inert.
  await context.addInitScript(({ library, fixtures }) => {
    window.isTauri = true;
    let callbackId = 1;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: () => callbackId++,
      unregisterCallback: () => {},
      convertFileSrc: (path) => path,
      invoke: async (cmd, args) => {
        if (cmd === 'list_library_documents') {
          return library.map((item) => ({
            id: item.id, name: item.name, extension: 'pdf', kind: 'pdf', sizeBytes: fixtures[item.id].length,
            modifiedMs: 1, addedMs: 1, lastOpenedMs: 1, available: true, locationLabel: 'C:/Users/test/Documents',
          }));
        }
        if (cmd === 'read_pdf_document') return new Uint8Array(fixtures[args.documentId]).buffer;
        if (cmd === 'plugin:event|listen') return callbackId++;
        return null;
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  }, { library, fixtures });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // A previous session: Alpha on page 4 (active), a document since deleted, Bravo.
  await page.addInitScript((key) => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(key, JSON.stringify({
        version: 1,
        tabs: [{ documentId: 'doc-a', page: 4 }, { documentId: 'doc-deleted' }, { documentId: 'doc-b' }],
        activeDocumentId: 'doc-a', temporaryCount: 0,
      }));
    }
  }, STORAGE_KEY);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  const tabs = page.locator('.document-tab-main');
  await tabs.nth(1).waitFor({ timeout: 20000 });
  check(JSON.stringify(await tabs.allTextContents()).includes('Alpha.pdf') &&
    (await tabs.nth(0).textContent()).includes('Alpha.pdf') && (await tabs.nth(1).textContent()).includes('Bravo.pdf'),
    'Restored tabs are missing or out of order: ' + JSON.stringify(await tabs.allTextContents()));
  check(await page.locator('.document-tab-main[aria-selected="true"]').textContent().then((t) => t.includes('Alpha.pdf')),
    'The previously active tab was not reselected');
  await page.locator('.ml-open-feedback', { hasText: '1 document from your last session is no longer available' })
    .waitFor({ timeout: 10000 });
  const status = page.locator('.ml-status-pdf-view');
  await page.waitForFunction(() => document.querySelector('.ml-status-pdf-view')?.textContent?.includes('Page 4 / 6'),
    null, { timeout: 20000 }).catch(() => {});
  check((await status.textContent())?.includes('Page 4 / 6'),
    'Restored PDF did not reopen on its saved page: ' + await status.textContent());

  // Recovery after a restart: the newly viewed page is what comes back.
  const pageInput = page.locator('.document-session-panel.active input[aria-label="Current PDF page"]');
  await pageInput.fill('6');
  await pageInput.press('Enter');
  await page.waitForFunction(() => document.querySelector('.ml-status-pdf-view')?.textContent?.includes('Page 6 / 6'),
    null, { timeout: 20000 });
  await tabs.nth(1).click();
  await page.waitForTimeout(500);
  const saved = JSON.parse(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY));
  check(saved.activeDocumentId === 'doc-b' && saved.tabs.length === 2 && saved.tabs[0].page === 6,
    'Current session was not saved for recovery: ' + JSON.stringify(saved));
  check(!JSON.stringify(saved).includes('C:/Users'), 'File paths leaked into browser storage');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await tabs.nth(1).waitFor({ timeout: 20000 });
  check((await page.locator('.document-tab-main[aria-selected="true"]').textContent()).includes('Bravo.pdf'),
    'Recovery after restart did not reselect the last active tab');
  await tabs.nth(0).click();
  await page.waitForFunction(() => document.querySelector('.ml-status-pdf-view')?.textContent?.includes('Page 6 / 6'),
    null, { timeout: 20000 }).catch(() => {});
  check((await status.textContent())?.includes('Page 6 / 6'),
    'Recovery after restart lost the last viewed page: ' + await status.textContent());
  check(await page.locator('.ml-open-feedback', { hasText: 'no longer available' }).count() === 0,
    'The unavailable-document notice repeated after it was resolved');

  // Corrupted saved state must not break startup.
  await page.evaluate((key) => localStorage.setItem(key, '{not json'), STORAGE_KEY);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Home', exact: true }).waitFor({ timeout: 15000 });
  check(errors.length === 0, 'Unexpected browser errors: ' + errors.join('; '));
  await context.close();
  console.log('PHASE1 desktop session restore, recovery after restart and corrupt-state startup: PASS');
}

async function main() {
  vite = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'),
    '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  vite.stdout.on('data', (data) => process.stdout.write(data));
  vite.stderr.on('data', (data) => process.stderr.write(data));
  await waitForServer();
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  await browserScenario();
  await desktopScenario();
  console.log('Phase 1 session restore Chromium regression: PASS');
}
try { await main(); }
catch (error) { console.error(error); process.exitCode = 1; }
finally {
  if (browser) await browser.close();
  if (vite) vite.kill('SIGTERM');
}
