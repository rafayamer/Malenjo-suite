/* Shared real-Chromium harness for MALENJO PDF acceptance scripts.
 *
 * Every check drives the real UI and inspects outputs independently with
 * PDF.js and pdf-lib. Nothing is mocked. Used by the per-slice Phase 2
 * acceptance scripts (scripts/pdf-phase2-*-acceptance.mjs).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PDFDocument, PDFHexString, PDFName, PDFNumber, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { chromium } from 'playwright';

export const root = resolve(import.meta.dirname, '../..');

export async function startHarness(prefix) {
  const port = Number(process.env.PORT || 1420);
  const base = `http://127.0.0.1:${port}`;
  const shots = resolve(root, `.build/${prefix.toLowerCase()}-browser`);
  const server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', (buf) => { const text = String(buf); if (/error/i.test(text) && !/11434|proxy error/.test(text)) process.stderr.write(text); });
  for (let i = 0; i < 120; i++) { try { if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'All tools', exact: true }).waitFor({ timeout: 60000 });

  let passes = 0; const failures = [];
  const expect = (ok, message) => { if (!ok) throw Error(message); };
  async function check(name, fn) {
    try { await fn(); passes++; console.log(`${prefix} ${name}: PASS`); }
    catch (error) {
      failures.push(name);
      console.error(`${prefix} ${name}: FAIL :: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`);
      try { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: join(shots, 'fail-' + name.replace(/[^a-z0-9]+/gi, '-') + '.png') }); } catch {}
    }
  }
  async function finish() {
    if (pageErrors.length) failures.push('uncaught page errors: ' + pageErrors.join(' | '));
    console.log(`${prefix} browser acceptance: ${passes} passed, ${failures.length} failed` + (failures.length ? ' — ' + failures.join('; ') : ''));
    await browser.close(); server.kill('SIGTERM');
    process.exitCode = failures.length ? 1 : 0;
  }

  // ---- UI helpers ----
  const panel = () => page.locator('.document-session-panel.active');
  async function openModule(name) {
    const trigger = page.getByRole('button', { name: 'All tools', exact: true });
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
    await page.locator('.sidebar nav .nav-item').filter({ hasText: name }).first().click({ timeout: 15000 });
  }
  let docCounter = 0;
  async function openPdf(bytes, name = `${prefix.toLowerCase()}-${++docCounter}.pdf`) {
    await openModule('PDF Workspace');
    await page.locator('main.workspace > .pdf-workspace > input[type="file"][accept="application/pdf,.pdf"]').first()
      .setInputFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
    await page.locator('.document-tab-main').filter({ hasText: name }).waitFor({ timeout: 30000 });
    await page.waitForFunction(() => {
      const p = document.querySelector('.document-session-panel.active .pdf-workspace');
      return p?.getAttribute('data-pdf-first-rendered') === 'true' && p.querySelector('[id$="-page-1"]')?.dataset.pdfRendered === 'true';
    }, null, { timeout: 60000 });
    return name;
  }
  async function tab(name) { await panel().locator('[aria-label="PDF task categories"]').getByRole('tab', { name, exact: true }).click(); }
  async function action(tabName, label) {
    await tab(tabName);
    const button = panel().locator(`.pdf-task-toolbar button[aria-label="${label}"]`).first();
    // Open More only when closed, and retry while the toolbar settles after a document loads.
    for (let attempt = 0; attempt < 4 && !(await button.isVisible().catch(() => false)); attempt++) {
      const more = panel().locator('.pdf-task-overflow').first();
      if (await more.count() && !(await more.evaluate((node) => node.open).catch(() => true))) await more.locator('summary').click();
      await button.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    }
    await button.click({ timeout: 10000 });
  }
  async function notice(pattern, timeout = 30000) {
    await page.waitForFunction((source) => [...document.querySelectorAll('.pdf-notice,[role="alert"],[role="status"]')]
      .some((node) => new RegExp(source, 'i').test(node.textContent || '')), pattern.source, { timeout });
  }
  async function download(trigger) {
    const pending = page.waitForEvent('download', { timeout: 60000 });
    await trigger();
    const file = join(mkdtempSync(join(tmpdir(), 'malenjo-accept-')), 'out');
    await (await pending).saveAs(file);
    return readFileSync(file);
  }
  async function save() {
    const bytes = await download(() => page.getByRole('button', { name: 'Save PDF copy', exact: true }).click());
    expect(bytes.subarray(0, 5).toString() === '%PDF-', 'saved file is not a PDF');
    return bytes;
  }
  async function undo() { await page.getByRole('button', { name: 'Undo PDF edit', exact: true }).click(); await notice(/Undid:/); }

  return { page, panel, expect, check, finish, openModule, openPdf, tab, action, notice, download, save, undo };
}

// ---- independent output inspection ----
async function withPdfJs(bytes, fn) {
  const doc = await getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false,
    standardFontDataUrl: resolve(root, 'node_modules/pdfjs-dist/standard_fonts') + '/' }).promise;
  try { return await fn(doc); } finally { await (doc.destroy ? doc.destroy() : doc.cleanup?.()); }
}
export const pageTexts = (bytes) => withPdfJs(bytes, async (doc) => {
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const t = await (await doc.getPage(i)).getTextContent();
    out.push(t.items.map((x) => x.str).join(' ').replace(/\s+/g, ' ').trim());
  }
  return out;
});
export const pageAnnotations = (bytes) => withPdfJs(bytes, async (doc) => {
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) out.push((await (await doc.getPage(i)).getAnnotations()).map((a) => a.subtype));
  return out;
});
/** Outline as [title, 1-based page] in reading order, resolved by PDF.js. */
export const outlineEntries = (bytes) => withPdfJs(bytes, async (doc) => {
  const out = [];
  const walk = async (items) => {
    for (const item of items) {
      let pageNumber = null;
      const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
      if (Array.isArray(dest) && dest[0]) pageNumber = (await doc.getPageIndex(dest[0])) + 1;
      out.push([item.title, pageNumber]);
      await walk(item.items || []);
    }
  };
  await walk((await doc.getOutline()) || []);
  return out;
});

// ---- synthetic documents (generated here; redistributable) ----
export async function labelledDoc(label, pages, size = [612, 792]) {
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) d.addPage(size).drawText(`${label} ${i}`, { x: 48, y: size[1] - 64, size: 20, font: f });
  return d;
}
/** Adds flat top-level bookmarks [{title, page}] with explicit destinations. */
export function addBookmarks(doc, marks) {
  const pages = doc.getPages();
  const root = doc.context.obj({ Type: PDFName.of('Outlines') });
  const rootRef = doc.context.register(root);
  const refs = marks.map(({ title, page }) => {
    const dict = doc.context.obj({ Title: PDFHexString.fromText(title), Parent: rootRef, Dest: doc.context.obj([pages[page - 1].ref, PDFName.of('Fit')]) });
    return { dict, ref: doc.context.register(dict) };
  });
  refs.forEach(({ dict }, i) => {
    if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1].ref);
    if (i < refs.length - 1) dict.set(PDFName.of('Next'), refs[i + 1].ref);
  });
  root.set(PDFName.of('First'), refs[0].ref); root.set(PDFName.of('Last'), refs[refs.length - 1].ref);
  root.set(PDFName.of('Count'), PDFNumber.of(refs.length));
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
  return doc;
}
export function addStickyNote(doc, pageNumber, text) {
  const annot = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [60, 60, 80, 80], Contents: PDFHexString.fromText(text) }));
  doc.getPage(pageNumber - 1).node.set(PDFName.of('Annots'), doc.context.obj([annot]));
  return doc;
}
