/* Phase 1 regression: Enter must activate only the focused command-palette control.
 * Run in a Codespaces/browser-capable environment with Playwright and Chromium:
 * node scripts/command-palette-enter-focus-browser-smoke.mjs
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const base = 'http://127.0.0.1:1420';
let vite, browser;
function check(ok, message) {
  if (!ok) throw Error('Command palette keyboard acceptance: ' + message);
}
async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch { /* Vite is still starting. */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw Error('Vite did not start on port 1420.');
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
  // DOMContentLoaded is earlier than React hydration. Wait for the same
  // interactive Home ribbon used by the established PDF Chromium smoke before
  // dispatching Ctrl+K; otherwise the shortcut is lost during initial mount.
  await page.getByRole('tab', { name: 'Home', exact: true }).waitFor({ timeout: 15000 });
  const search = page.getByRole('combobox', { name: 'Search MALENJO actions, documents and settings' });
  const dialog = page.getByRole('dialog', { name: 'MALENJO command palette' });
  await page.keyboard.press('Control+k');
  await dialog.waitFor({ state: 'visible', timeout: 15000 });
  await search.fill('Open Settings');
  await page.getByRole('option', { name: /Open Settings/ }).waitFor();
  await page.getByRole('button', { name: 'Close command palette' }).focus();
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'hidden' });
  check(await page.getByRole('heading', { name: 'Appearance' }).count() === 0,
    'Enter on Close incorrectly executed Open Settings');
  await page.keyboard.press('Control+k');
  await search.fill('Open Settings');
  await page.getByRole('option', { name: /Open Settings/ }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Appearance' }).waitFor();
  check(await dialog.count() === 0, 'Focused result did not activate on Enter');
  await page.keyboard.press('Control+k');
  await search.fill('Open');
  const enabled = dialog.locator('button[role="option"]:not([disabled])');
  check(await enabled.count() >= 2, 'Expected multiple enabled results');
  await enabled.first().focus();
  await page.keyboard.press('ArrowDown');
  check(await search.evaluate((node) => document.activeElement === node),
    'ArrowDown did not return focus to the search input');
  const active = await search.getAttribute('aria-activedescendant');
  check(Boolean(active), 'ArrowDown did not select an accessible result');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  // Focus must return to the original launcher even after repeated Ctrl+K.
  const launcher = page.getByRole('button', { name: 'Open command palette' });
  await launcher.click();
  await dialog.waitFor({ state: 'visible' });
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForTimeout(100);
  check(await launcher.evaluate((node) => document.activeElement === node),
    'Repeated Ctrl+K lost the original command-palette launcher focus');

  // Returning focus to the top-bar search must not reopen the closed dialog.
  const topbarSearch = page.getByRole('textbox', { name: 'Search commands' });
  await topbarSearch.focus();
  await dialog.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForTimeout(150);
  check(await topbarSearch.evaluate((node) => document.activeElement === node),
    'Closing the palette did not restore top-bar search focus');
  check(!(await dialog.isVisible()), 'Restoring top-bar search reopened the palette');

  // A stale animation frame from a prior close must not steal focus on reopen.
  await launcher.click();
  await dialog.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await dialog.waitFor({ state: 'visible' });
  check(await search.evaluate((node) => document.activeElement === node),
    'Prior focus restoration stole focus from the reopened dialog');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });

  // The search remains usable after focus restoration.
  await topbarSearch.fill('Open Settings');
  await dialog.waitFor({ state: 'visible' });
  await page.getByRole('option', { name: /Open Settings/ }).waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  check(errors.length === 0, 'Unexpected browser errors: ' + errors.join('; '));
  console.log('Command palette opener-focus Chromium regression: PASS');
}
try { await main(); }
catch (error) { console.error(error); process.exitCode = 1; }
finally {
  if (browser) await browser.close();
  if (vite) vite.kill('SIGTERM');
}
