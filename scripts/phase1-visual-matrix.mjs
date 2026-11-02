/* Phase 1 visual matrix: every screen x both themes x the six required sizes.
 *   node scripts/phase1-visual-matrix.mjs
 * Writes .build/phase1-visual-matrix/: one PNG per screen/theme/size,
 * contact sheets per theme and size for human review, and summary.json with
 * the automated findings. Fails when a capture shows horizontal page
 * overflow, a clipped top bar / ribbon / status control, text below WCAG AA
 * contrast against its rendered background, or a browser error.
 * PORT overrides the Vite port (default 1420, as in CI).
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { measureTextContrast } from './phase1-contrast.mjs';

const root = resolve(import.meta.dirname, '..');
const port = Number(process.env.PORT || 1420);
const base = `http://127.0.0.1:${port}`;
const out = resolve(root, '.build/phase1-visual-matrix');
const SIZES = [[1920, 1080], [1440, 900], [1366, 768], [1024, 768], [768, 600], [390, 844]];
const THEMES = ['dark', 'light'];
let vite, browser;

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch { /* Vite is still starting. */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw Error(`Vite did not start on port ${port}.`);
}

async function samplePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= 3; index++) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`MALENJO visual review — page ${index}`, { x: 60, y: 720, size: 22, font });
    page.drawRectangle({ x: 60, y: 520, width: 300, height: 140, color: rgb(0.15, 0.45, 0.85) });
    page.drawText('Text that must stay readable and selectable.', { x: 60, y: 480, size: 14, font });
  }
  return Buffer.from(await pdf.save());
}

const layoutCheck = () => {
  const de = document.documentElement;
  const overflowX = Math.max(de.scrollWidth, document.body.scrollWidth) - de.clientWidth;
  const clipped = [...document.querySelectorAll(
    '.topbar button, .topbar input, .suite-ribbon-tabs [role=tab], .document-tab-main, .ml-bottom-statusbar > *')]
    .filter((node) => node.getClientRects().length && !node.closest('[inert],[aria-hidden="true"]'))
    .filter((node) => { const r = node.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1; })
    .map((node) => (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 40));
  return { overflowX, clipped: [...new Set(clipped)] };
};

async function main() {
  vite = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'),
    '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  vite.stderr.on('data', (data) => process.stderr.write(data));
  await waitForServer();
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const pdfBytes = await samplePdf();
  const findings = [];
  const shots = [];

  for (const theme of THEMES) {
    for (const [width, height] of SIZES) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.getByRole('tab', { name: 'Home', exact: true }).waitFor({ timeout: 15000 });
      if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) {
        await page.locator('.theme-toggle').click();
      }
      const dir = resolve(out, theme, `${width}x${height}`);
      await mkdir(dir, { recursive: true });
      const capture = async (name, scope = 'body') => {
        // Lazy workspaces show a Suspense placeholder first: capture the real
        // screen, never the loading state.
        await page.waitForFunction(() => ![...document.querySelectorAll('.ml-open-feedback[role="status"]')]
          .some((node) => /^Opening /.test(node.textContent.trim())), null, { timeout: 20000 });
        await page.waitForTimeout(350);
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        const file = resolve(dir, `${name}.png`);
        await page.screenshot({ path: file });
        const layout = await page.evaluate(layoutCheck);
        const lowContrast = (await measureTextContrast(page, scope))
          .filter((item) => item.ratio < item.required)
          .map(({ text, ratio, required }) => ({ text, ratio, required }));
        const record = { theme, size: `${width}x${height}`, screen: name, file, ...layout, lowContrast, errors: [...errors] };
        shots.push(record);
        if (layout.overflowX > 0 || layout.clipped.length || lowContrast.length || errors.length) findings.push(record);
        errors.length = 0;
      };
      const tools = page.getByRole('button', { name: 'All tools', exact: true });
      const openTools = async () => {
        if (await tools.getAttribute('aria-expanded') !== 'true') await tools.click();
        await page.locator('.ml-tools-popup.is-open').waitFor();
      };

      await capture('00-home');
      await openTools();
      const workspaces = await page.locator('.ml-tools-popup.is-open .nav-item')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
      await capture('01-workspaces-menu', '.ml-tools-popup');
      await page.keyboard.press('Escape');
      for (const [index, name] of workspaces.entries()) {
        await openTools();
        await page.locator(`.ml-tools-popup.is-open .nav-item[aria-label="${name}"]`).click();
        await capture(`${String(index + 10).padStart(2, '0')}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
      }
      await openTools();
      await page.locator('.ml-tools-popup.is-open .nav-item[aria-label="Home"]').click();
      await page.keyboard.press('Control+k');
      await page.getByRole('dialog', { name: 'MALENJO command palette' }).waitFor();
      await capture('02-command-palette', '.command-palette');
      await page.keyboard.press('Escape');
      const more = page.getByRole('button', { name: 'More PDF tools' });
      if (await more.isVisible()) {
        await more.click();
        await capture('03-more-pdf-tools', '.ml-command-catalog');
        await page.keyboard.press('Escape');
      }
      await page.locator('.workspace > input[type="file"]').setInputFiles({
        name: 'visual-review.pdf', mimeType: 'application/pdf', buffer: pdfBytes,
      });
      await page.locator('.document-tab-main').first().waitFor({ timeout: 15000 });
      await page.waitForFunction(() =>
        document.querySelector('.document-session-panel.active [id$="-page-1"]')?.dataset.pdfRendered === 'true',
      null, { timeout: 20000 });
      await capture('04-pdf-document');
      await page.getByRole('button', { name: 'MALENJO AI', exact: true }).click();
      await page.locator('#ml-ai-assistant.is-open').waitFor({ timeout: 15000 });
      await capture('05-pdf-with-ai-drawer');
      await page.keyboard.press('Escape');
      await page.close();
      console.log(`captured ${theme} ${width}x${height}`);
    }
  }

  await writeFile(resolve(out, 'summary.json'), JSON.stringify({ captures: shots.length, findings }, null, 2));
  // Contact sheets: one per theme and size, for a quick human pass.
  const sheet = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  for (const theme of THEMES) {
    for (const [width, height] of SIZES) {
      const size = `${width}x${height}`;
      const items = shots.filter((shot) => shot.theme === theme && shot.size === size);
      const html = `<!doctype html><meta charset="utf-8"><style>
        body{margin:12px;font:13px system-ui;background:#eef1f5;color:#111}
        h1{font-size:16px;margin:0 0 10px}
        .grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}
        figure{margin:0;background:#fff;border:1px solid #ccd;padding:4px}
        img{width:100%;display:block} figcaption{padding-top:3px}
      </style><h1>MALENJO Phase 1 — ${theme} — ${size} — ${items.length} screens</h1><div class="grid">${
        items.map((item) => `<figure><img src="${pathToFileURL(item.file)}"><figcaption>${item.screen}</figcaption></figure>`).join('')
      }</div>`;
      const htmlFile = resolve(out, `sheet-${theme}-${size}.html`);
      await writeFile(htmlFile, html);
      await sheet.goto(pathToFileURL(htmlFile).href);
      await sheet.waitForLoadState('load');
      await sheet.screenshot({ path: resolve(out, `sheet-${theme}-${size}.png`), fullPage: true });
    }
  }
  console.log(`PHASE1 visual matrix: ${shots.length} captures, ${findings.length} with layout or contrast problems`);
  if (findings.length) {
    for (const finding of findings) console.log(JSON.stringify({ ...finding, file: undefined }));
    throw Error('Phase 1 visual matrix found layout or contrast problems');
  }
  console.log('Phase 1 visual matrix (both themes, six sizes, every screen): PASS');
}
try { await main(); }
catch (error) { console.error(error); process.exitCode = 1; }
finally {
  if (browser) await browser.close();
  if (vite) vite.kill('SIGTERM');
}
