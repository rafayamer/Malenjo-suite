/* Phase 1 accessibility regression: every command-palette launcher restores focus.
 * Execute with real Chromium: node scripts/command-palette-opener-focus-browser-smoke.mjs
 * This is a regression detector, not a claim that the current app passes.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const base = 'http://127.0.0.1:1420';
let vite, browser;
function assert(condition, message) {
  if (!condition) throw Error('Palette launcher focus: ' + message);
}
async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch { /* Vite is starting. */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw Error('Vite did not start on 127.0.0.1:1420');
}
async function main() {
  vite = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  });
  vite.stdout.on('data', (data) => process.stdout.write(data));
  vite.stderr.on('data', (data) => process.stderr.write(data));
  await waitForServer();
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 850 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Home', exact: true }).waitFor({ timeout: 15000 });
  const dialog = page.getByRole('dialog', { name: 'MALENJO command palette' });
  const launcher = page.getByRole('button', { name: 'Open command palette' });
  const topbarSearch = page.getByRole('textbox', { name: 'Search commands' });

  // A pointer-opened dialog must restore focus to its launcher after Escape.
  await launcher.click();
  await dialog.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForTimeout(100);
  assert(await launcher.evaluate((node) => document.activeElement === node),
    'Escape did not restore focus to the top-bar palette button');

  // Focusing top-bar search is a second launcher. Closing must not reopen it.
  await topbarSearch.focus();
  await dialog.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForTimeout(150);
  assert(await topbarSearch.evaluate((node) => document.activeElement === node),
    'Escape did not restore focus to top-bar search');
  assert(!(await dialog.isVisible()), 'Restoring search focus reopened the palette');

  // User typing after close should still open the palette normally.
  await topbarSearch.fill('Open Settings');
  await dialog.waitFor({ state: 'visible' });
  await page.getByRole('option', { name: /Open Settings/ }).waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert(errors.length === 0, 'Browser errors: ' + errors.join('; '));
  console.log('Command palette launcher focus Chromium regression: PASS');
}
try { await main(); }
catch (error) { console.error(error); process.exitCode = 1; }
finally {
  if (browser) await browser.close();
  if (vite) vite.kill('SIGTERM');
}
