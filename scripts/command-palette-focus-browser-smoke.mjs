/* Reproduction/acceptance: command palette Enter must activate the focused control.
 * This test intentionally fails on the known Phase 1 bug until CommandPalette.tsx
 * scopes Enter to the search input and permits native button activation.
 * Run after installing Playwright + Chromium: node scripts/command-palette-focus-browser-smoke.mjs
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const base = 'http://127.0.0.1:1420';
let vite;
let browser;

function check(value, message) {
  if (!value) throw Error('Command palette keyboard acceptance: ' + message);
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

  const search = page.getByRole('combobox', { name: 'Search MALENJO actions, documents and settings' });
  const dialog = page.getByRole('dialog', { name: 'MALENJO command palette' });

  await page.keyboard.press('Control+k');
  await search.fill('Open Settings');
  await page.getByRole('option', { name: /Open Settings/ }).waitFor();
  const close = page.getByRole('button', { name: 'Close command palette' });
  await close.focus();
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'hidden' });
  check(await page.getByRole('heading', { name: 'Appearance' }).count() === 0,
    'Enter on Close executed the highlighted Open Settings command');

  await page.keyboard.press('Control+k');
  await search.fill('Open Settings');
  const settings = page.getByRole('option', { name: /Open Settings/ });
  await settings.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Appearance' }).waitFor();
  check(await dialog.count() === 0, 'Enter on focused result did not activate it');

  await page.keyboard.press('Control+k');
  await search.fill('Open');
  const options = dialog.locator('button[role="option"]:not([disabled])');
  check(await options.count() >= 2, 'Expected multiple enabled commands for arrow navigation');
  await options.first().focus();
  const initialId = await page.evaluate(() => document.activeElement?.id);
  await page.keyboard.press('ArrowDown');
  const nextId = await page.evaluate(() => document.activeElement?.id);
  check(Boolean(nextId) && nextId !== initialId && nextId.startsWith('malenjo-command-option-'),
    'ArrowDown did not move focus to another enabled command');
  check(await search.getAttribute('aria-activedescendant') === nextId,
    'Focused result and accessible active selection disagree');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  check(errors.length === 0, 'Unexpected browser errors: ' + errors.join('; '));
  console.log('Phase 1 command palette keyboard focus acceptance: PASS');
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (vite) vite.kill('SIGTERM');
}
