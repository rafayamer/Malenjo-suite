/* Phase 1 regression: shell menus and drawers must be keyboard operable.
 * Real mounted MALENJO app in Chromium:
 *   node scripts/phase1-shell-keyboard-browser-smoke.mjs
 * PORT overrides the Vite port (default 1420, as in CI).
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';

const root = resolve(import.meta.dirname, '..');
const port = Number(process.env.PORT || 1420);
const base = `http://127.0.0.1:${port}`;
let vite, browser;
function check(ok, message) {
  if (!ok) throw Error('Phase 1 shell keyboard acceptance: ' + message);
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
async function main() {
  vite = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'),
    '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
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

  const frames = (count = 3) => page.evaluate((n) => new Promise((done) => {
    const step = (left) => left ? requestAnimationFrame(() => step(left - 1)) : done();
    step(n);
  }), count);
  const describeActive = () => page.evaluate(() => {
    const node = document.activeElement;
    return node ? `${node.tagName.toLowerCase()} ${node.getAttribute('aria-label') ?? ''}`.trim() : 'none';
  });
  const focusInside = (selector) => page.evaluate((s) => !!document.activeElement?.closest(s), selector);
  const activeIs = (locator) => locator.evaluate((node) => document.activeElement === node);
  const danglingControls = () => page.evaluate(() => [...document.querySelectorAll('[aria-controls]')]
    .filter((node) => node.getAttribute('aria-controls').split(/\s+/).some((id) => id && !document.getElementById(id)))
    .map((node) => node.getAttribute('aria-label') || node.outerHTML.slice(0, 80)));

  // 1. aria-controls must always reference rendered elements.
  const closedDangling = await danglingControls();
  check(closedDangling.length === 0, 'aria-controls points at missing elements: ' + closedDangling.join(', '));

  // 2. The hidden browser file input is not an unnamed control or a stray Tab
  // stop: it is hidden from assistive tech (the visible Open button is the
  // control) and removed from the Tab order.
  const fileInput = page.locator('input[type="file"].visually-hidden').first();
  check(await fileInput.getAttribute('aria-hidden') === 'true' || Boolean(await fileInput.getAttribute('aria-label')),
    'Hidden file input is exposed to assistive tech without a name');
  check(await fileInput.evaluate((node) => node.tabIndex) === -1, 'Hidden file input is in the Tab order');

  // 2b. Every workspace: named controls, valid ARIA id references, unique ids.
  const sweep = () => page.evaluate(() => {
    const visible = (n) => !n.closest('[inert],[aria-hidden="true"]') && n.getClientRects().length > 0;
    const textName = (n) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(n.tagName) ? '' : n.textContent;
    const nameOf = (n) => (n.getAttribute('aria-label') ||
      (n.getAttribute('aria-labelledby') || '').split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ') ||
      (n.labels ? [...n.labels].map((l) => l.textContent).join(' ') : '') || n.getAttribute('title') ||
      textName(n) || n.getAttribute('placeholder') || '').trim();
    const problems = [...document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,[role=tab],[role=menuitem]')]
      .filter(visible).filter((n) => !nameOf(n)).map((n) => 'unnamed ' + n.outerHTML.slice(0, 90));
    for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-activedescendant']) {
      for (const n of document.querySelectorAll(`[${attr}]`)) {
        for (const id of (n.getAttribute(attr) || '').split(/\s+/).filter(Boolean)) {
          if (!document.getElementById(id)) problems.push(`${attr} -> missing #${id}`);
        }
      }
    }
    for (const n of document.querySelectorAll('input[type="file"].visually-hidden')) {
      if (n.tabIndex !== -1) problems.push('hidden file input is a Tab stop: ' + n.outerHTML.slice(0, 80));
      if (n.getAttribute('aria-hidden') !== 'true' && n.getAttribute('aria-label') !== 'Select PDF to replace page') {
        problems.push('hidden file input exposed to assistive tech: ' + n.outerHTML.slice(0, 80));
      }
    }
    const seen = new Map();
    for (const n of document.querySelectorAll('[id]')) seen.set(n.id, (seen.get(n.id) || 0) + 1);
    for (const [id, count] of seen) if (count > 1) problems.push(`duplicate id #${id} x${count}`);
    return [...new Set(problems)];
  });
  await page.getByRole('button', { name: 'All tools', exact: true }).click();
  const workspaceNames = await page.locator('.ml-tools-popup.is-open .nav-item')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
  await page.keyboard.press('Escape');
  check(workspaceNames.length >= 15, 'Expected the full workspace list, got ' + workspaceNames.length);
  for (const name of workspaceNames) {
    await page.getByRole('button', { name: 'All tools', exact: true }).click();
    await page.locator(`.ml-tools-popup.is-open .nav-item[aria-label="${name}"]`).click();
    await page.waitForTimeout(800);
    const problems = await sweep();
    check(problems.length === 0, `${name} workspace accessibility problems: ` + problems.join('; '));
  }
  await page.getByRole('button', { name: 'All tools', exact: true }).click();
  await page.locator('.ml-tools-popup.is-open .nav-item[aria-label="Home"]').click();
  await page.locator('.ml-start-recent').waitFor({ timeout: 15000 });

  // 3. Workspaces menu: focus moves in on open; Escape closes and returns focus.
  const tools = page.getByRole('button', { name: 'All tools', exact: true });
  const toolsOpen = page.locator('.ml-tools-popup.is-open');
  for (const how of ['click', 'keyboard']) {
    if (how === 'click') await tools.click();
    else { await tools.focus(); await page.keyboard.press('Enter'); }
    await frames();
    check(await toolsOpen.count() === 1, `Workspaces menu did not open (${how})`);
    check(await focusInside('.ml-tools-popup'),
      `Focus stayed outside the Workspaces menu after ${how} open; focus is on ` + await describeActive());
    await page.keyboard.press('Escape');
    await frames();
    check(await toolsOpen.count() === 0, `Escape did not close the Workspaces menu (${how})`);
    check(await activeIs(tools), 'Focus did not return to All tools; focus is on ' + await describeActive());
  }

  // 3b. Choosing a workspace from the menu must not drop focus to <body>.
  await tools.click();
  await frames();
  await page.locator('.ml-tools-popup.is-open .nav-item').nth(1).press('Enter');
  await frames();
  check(await toolsOpen.count() === 0, 'Choosing a workspace did not close the menu');
  check(await page.evaluate(() => document.activeElement && document.activeElement !== document.body),
    'Focus was dropped to <body> after choosing a workspace');

  // 4. AI drawer: Escape and Close both close it and return focus to the toggle.
  const ai = page.getByRole('button', { name: 'MALENJO AI', exact: true });
  await ai.click();
  await page.locator('#ml-ai-assistant.is-open').waitFor({ timeout: 15000 });
  await frames();
  check(await ai.getAttribute('aria-expanded') === 'true', 'AI toggle did not report expanded');
  check(await focusInside('#ml-ai-assistant'),
    'Focus stayed outside the opened AI drawer; focus is on ' + await describeActive());
  const openDangling = await danglingControls();
  check(openDangling.length === 0, 'aria-controls points at missing elements (AI open): ' + openDangling.join(', '));
  await page.keyboard.press('Escape');
  await frames();
  check(await ai.getAttribute('aria-expanded') === 'false', 'Escape did not close the AI drawer');
  check(await activeIs(ai), 'Focus did not return to the AI toggle after Escape; focus is on ' + await describeActive());
  await ai.click();
  await page.locator('#ml-ai-assistant.is-open').waitFor();
  await page.getByRole('button', { name: 'Close MALENJO AI' }).click();
  await frames();
  check(await ai.getAttribute('aria-expanded') === 'false', 'Close did not close the AI drawer');
  check(await activeIs(ai), 'Focus did not return to the AI toggle after Close; focus is on ' + await describeActive());

  // 5. Escape on a closed drawer must not interfere with the command palette.
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'MALENJO command palette' });
  await dialog.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  check(await ai.getAttribute('aria-expanded') === 'false', 'Palette Escape toggled the AI drawer');

  // 6. Closing document tabs must not drop focus to <body>.
  page.on('dialog', (prompt) => prompt.accept());
  const makePdf = async (text) => {
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText(text);
    return Buffer.from(await pdf.save());
  };
  await page.locator('.workspace > input[type="file"]').setInputFiles(await Promise.all(
    ['tab-a.pdf', 'tab-b.pdf', 'tab-c.pdf'].map(async (name) =>
      ({ name, mimeType: 'application/pdf', buffer: await makePdf(name) }))));
  const tabs = page.locator('.document-tab-main');
  await tabs.nth(2).waitFor({ timeout: 15000 });
  const selectedTab = page.locator('.document-tab-main[aria-selected="true"]');
  const notBody = () => page.evaluate(() => !!document.activeElement && document.activeElement !== document.body);
  await page.locator('.document-tab-close').nth(2).focus();
  await page.keyboard.press('Enter');
  await frames(4);
  check(await tabs.count() === 2, 'Close button did not close the tab');
  check(await activeIs(selectedTab), 'Close button dropped focus; focus is on ' + await describeActive());
  await page.locator('.document-tab-menu-button').nth(1).click();
  await frames();
  await page.keyboard.press('Enter');
  await frames(4);
  check(await tabs.count() === 1, 'Tab menu Close did not close the tab');
  check(await activeIs(selectedTab), 'Tab menu Close dropped focus; focus is on ' + await describeActive());
  await selectedTab.focus();
  await page.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown',
    { key: 'w', ctrlKey: true, bubbles: true, cancelable: true })));
  await frames(4);
  check(await tabs.count() === 0, 'Ctrl+W did not close the last tab');
  check(await notBody(), 'Closing the last tab dropped focus to <body>');

  // 7. A wrong PDF password keeps focus in the password field for retyping.
  await page.locator('.workspace > input[type="file"]').setInputFiles({
    name: 'locked.pdf', mimeType: 'application/pdf',
    buffer: await readFile(resolve(root, 'testing/suite/fixtures/pdf/encrypted-user-password.pdf')),
  });
  const passwordField = page.locator('.document-session-panel.active .pdf-password-prompt input[type="password"]');
  await passwordField.waitFor({ timeout: 15000 });
  await passwordField.fill('definitely-wrong');
  await page.keyboard.press('Enter');
  await page.locator('.document-session-panel.active .pdf-password-error').waitFor({ timeout: 15000 });
  await frames(4);
  check(await activeIs(passwordField),
    'Focus left the password field after a wrong password; focus is on ' + await describeActive());
  // 7b. Focus moved elsewhere while the password is being checked stays there.
  await passwordField.fill('still-wrong');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+k');
  const paletteSearch = page.getByRole('combobox', { name: 'Search MALENJO actions, documents and settings' });
  await paletteSearch.waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  await frames(4);
  check(await activeIs(paletteSearch),
    'A failed password check pulled focus out of the command palette; focus is on ' + await describeActive());
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'MALENJO command palette' }).waitFor({ state: 'hidden' });

  // 8. Home recent-file "More actions" menu is keyboard operable.
  await page.locator('.workspace > input[type="file"]').setInputFiles({
    name: 'recent-menu.pdf', mimeType: 'application/pdf', buffer: await makePdf('recent-menu'),
  });
  await page.locator('.document-tab-main', { hasText: 'recent-menu.pdf' }).waitFor({ timeout: 15000 });
  await tools.click();
  await page.locator('.ml-tools-popup.is-open .nav-item[aria-label="Home"]').click();
  const recentToggle = page.locator('.ml-start-recent');
  await recentToggle.waitFor({ timeout: 15000 });
  if (await recentToggle.getAttribute('aria-expanded') !== 'true') await recentToggle.click();
  const recentMore = page.getByRole('button', { name: 'More actions for recent-menu.pdf' }).first();
  await recentMore.waitFor({ timeout: 15000 });
  const recentMenu = page.locator('.ml-home-file-menu');
  await recentMore.click();
  await frames();
  check(await focusInside('.ml-home-file-menu'),
    'Recent-file menu did not take focus; focus is on ' + await describeActive());
  await page.keyboard.press('ArrowDown');
  check(await page.evaluate(() => document.activeElement?.getAttribute('role') === 'menuitem'),
    'ArrowDown did not move between recent-file menu items');
  await page.keyboard.press('Escape');
  await frames();
  check(await recentMenu.count() === 0, 'Escape did not close the recent-file menu');
  check(await activeIs(recentMore), 'Escape did not return focus to More actions; focus is on ' + await describeActive());
  await recentMore.click();
  await frames();
  await page.mouse.click(5, 845);
  await frames();
  check(await recentMenu.count() === 0, 'Clicking outside did not close the recent-file menu');
  await recentMore.click();
  await frames();
  await page.getByRole('menuitem', { name: /Pin to Home/ }).click();
  await frames(4);
  check(await recentMenu.count() === 0, 'Pin did not close the recent-file menu');
  check(await page.evaluate(() => document.activeElement?.classList.contains('ml-home-more')),
    'Pinning dropped focus; focus is on ' + await describeActive());

  check(errors.length === 0, 'Unexpected browser errors: ' + errors.join('; '));
  console.log('Phase 1 shell menus/drawers keyboard Chromium regression: PASS');
}
try { await main(); }
catch (error) { console.error(error); process.exitCode = 1; }
finally {
  if (browser) await browser.close();
  if (vite) vite.kill('SIGTERM');
}
