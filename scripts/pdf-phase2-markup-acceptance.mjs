/* Phase 2 markup acceptance (MAL-054 text markup, MAL-055 drawings, shapes
 * and sticky notes) in real Chromium: real text selection and real mouse
 * drags on the rendered page, saved output reopened independently with PDF.js.
 * Run: node scripts/pdf-phase2-markup-acceptance.mjs   (needs `playwright`)
 */
import { resolve } from 'node:path';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { root, startHarness } from './lib/pdf-harness.mjs';

const h = await startHarness('PHASE2-MARKUP');
const { page, panel, expect, check, action, notice, openPdf, save } = h;

/** Annotations and text items of a page, read by PDF.js. */
async function inspect(bytes, pageNumber = 1) {
  const loading = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, standardFontDataUrl: resolve(root, 'node_modules/pdfjs-dist/standard_fonts') + '/' });
  const doc = await loading.promise;
  try {
    const p = await doc.getPage(pageNumber);
    const annotations = (await p.getAnnotations()).filter((a) => a.subtype !== 'Link');
    const text = (await p.getTextContent()).items.filter((i) => i.str.trim()).map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }));
    return { annotations, text };
  } finally { await loading.destroy(); }
}
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

async function source({ rotate = 0 } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const p = pdf.addPage([612, 792]);
  p.drawText('Quarterly revenue grew strongly', { x: 72, y: 700, size: 22, font });
  p.drawText('Operating costs were flat', { x: 72, y: 640, size: 22, font });
  p.drawText('Outlook remains cautious', { x: 72, y: 580, size: 22, font });
  if (rotate) p.setRotation(degrees(rotate));
  return pdf.save();
}

async function openMarkup() {
  await action('Review', 'Markup tools…');
  const tools = page.getByRole('dialog', { name: 'Markup tools' });
  await tools.waitFor();
  return tools;
}
/** Waits for the success notice; if the panel shows an error instead, fails with that error. */
async function added(tools, pattern) {
  const alert = tools.getByRole('alert');
  await Promise.race([notice(pattern), alert.waitFor({ timeout: 30000 })]);
  if (await alert.isVisible().catch(() => false)) throw Error('markup panel error: ' + await alert.innerText());
}
async function selectText(text) {
  // The text layer can be redrawn once after the page first renders (slower machines), which drops a
  // selection made too early. Select, let it settle, and select again if it was lost.
  for (let attempt = 0; attempt < 5; attempt++) {
    const span = panel().locator('[id$="-page-1"] .textLayer span').filter({ hasText: text }).first();
    await span.selectText({ timeout: 30000 });
    await page.waitForTimeout(400);
    if (await page.evaluate((t) => (getSelection()?.toString() ?? '').includes(t), text)) return;
  }
  throw Error(`could not keep a selection on “${text}”`);
}
const canvasBox = () => panel().locator('[id$="-page-1"] canvas').first().boundingBox();
/** Drags on page 1 between two points given as fractions of the shown page. */
async function drag(from, to, steps = 8) {
  const box = await canvasBox();
  await page.mouse.move(box.x + from[0] * box.width, box.y + from[1] * box.height);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(box.x + (from[0] + (to[0] - from[0]) * t) * box.width, box.y + (from[1] + (to[1] - from[1]) * t + (steps > 8 ? Math.sin(t * Math.PI) * 0.03 : 0)) * box.height);
  }
  await page.mouse.up();
}

try {
  await check('MAL-054 highlight, underline, strikeout and squiggly on selected text', async () => {
    await openPdf(await source(), 'markup-text.pdf');
    const tools = await openMarkup();
    const marks = [['Quarterly revenue grew strongly', 'Highlight'], ['Operating costs were flat', 'Underline'], ['Outlook remains cautious', 'Strike out']];
    for (const [text, button] of marks) {
      await selectText(text);
      await tools.getByRole('button', { name: button, exact: true }).click();
      await added(tools, new RegExp(`Added ${button.toLowerCase()} on page 1`));
    }
    await selectText('Quarterly revenue grew strongly');
    await tools.getByRole('button', { name: 'Squiggly', exact: true }).click();
    await added(tools, /Added squiggly on page 1/);
    const { annotations, text } = await inspect(await save());
    expect(JSON.stringify(annotations.map((a) => a.subtype)) === JSON.stringify(['Highlight', 'Underline', 'StrikeOut', 'Squiggly']), 'subtypes ' + annotations.map((a) => a.subtype));
    for (const [index, line] of [[0, 0], [1, 1], [2, 2], [3, 0]]) {
      const q = annotations[index].quadPoints; const t = text[line];
      const xs = [q[0], q[2], q[4], q[6]]; const ys = [q[1], q[3], q[5], q[7]];
      expect(near(Math.min(...xs), t.x, 4) && near(Math.max(...xs), t.x + t.w, 4), `${annotations[index].subtype} x ${Math.min(...xs)}..${Math.max(...xs)} vs text ${t.x}..${t.x + t.w}`);
      expect(Math.min(...ys) < t.y + 2 && Math.max(...ys) > t.y + 14, `${annotations[index].subtype} does not cover the line height`);
    }
    expect(annotations[0].contentsObj?.str === 'Quarterly revenue grew strongly', 'highlight does not record the selected text');
    expect(annotations.every((a) => a.hasAppearance), 'missing appearance streams');
  });

  await check('MAL-054 change a markup colour, then delete it', async () => {
    const tools = page.getByRole('dialog', { name: 'Markup tools' });
    await tools.getByRole('radio', { name: /Page 1: Highlight/ }).check();
    await tools.getByLabel('Markup colour').fill('#00aa44');
    await tools.getByRole('button', { name: 'Apply style and text to selected' }).click();
    await notice(/Updated the highlight on page 1/);
    let { annotations } = await inspect(await save());
    expect(JSON.stringify(Array.from(annotations[0].color)) === JSON.stringify([0, 170, 68]), 'colour ' + Array.from(annotations[0].color));
    await tools.getByRole('radio', { name: /Page 1: Strikeout/ }).check();
    await tools.getByRole('button', { name: 'Delete selected' }).click();
    await notice(/Deleted the strikeout on page 1/);
    ({ annotations } = await inspect(await save()));
    expect(JSON.stringify(annotations.map((a) => a.subtype)) === JSON.stringify(['Highlight', 'Underline', 'Squiggly']), 'after delete ' + annotations.map((a) => a.subtype));
    await tools.getByRole('button', { name: 'Close markup tools' }).click();
  });

  await check('MAL-054 a selection across pages is marked on every page', async () => {
    // Two short pages, so both are rendered on screen together.
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([612, 120]).drawText('End of the first page', { x: 72, y: 50, size: 22, font });
    pdf.addPage([612, 120]).drawText('Start of the second page', { x: 72, y: 50, size: 22, font });
    await openPdf(await pdf.save(), 'markup-two-pages.pdf');
    const tools = await openMarkup();
    for (const n of [1, 2]) await panel().locator(`[id$="-page-${n}"] .textLayer span`).first().waitFor({ timeout: 30000 });
    // Text layers can be re-rendered while the pages settle: set the selection, let it settle, and retry until it holds.
    for (let attempt = 0; attempt < 6; attempt++) {
      await page.evaluate(() => {
        const spans = [1, 2].map((n) => document.querySelector(`.document-session-panel.active [id$="-page-${n}"] .textLayer span`));
        const range = document.createRange();
        range.setStart(spans[0].firstChild, 0); range.setEnd(spans[1].firstChild, spans[1].textContent.length);
        getSelection().removeAllRanges(); getSelection().addRange(range);
      });
      await page.waitForTimeout(400);
      const held = await page.evaluate(() => { const t = getSelection()?.toString() ?? ''; return t.includes('End of the first page') && t.includes('Start of the second page'); });
      if (held) break;
    }
    // Set the selection again and press the panel's Highlight button in the same task, so a text-layer
    // re-render cannot shorten the selection between the two (seen on CI runners).
    await page.evaluate(() => {
      const spans = [1, 2].map((n) => document.querySelector(`.document-session-panel.active [id$="-page-${n}"] .textLayer span`));
      const range = document.createRange();
      range.setStart(spans[0].firstChild, 0); range.setEnd(spans[1].firstChild, spans[1].textContent.length);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      const button = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Highlight');
      button.click();
    });
    // Diagnostics for CI: what the selection covered when the markup was chosen.
    const diag = await page.evaluate(() => {
      const sel = getSelection(); const spans = [...document.querySelectorAll('.document-session-panel.active .textLayer span')];
      return { text: sel?.toString().slice(0, 80), ranges: sel?.rangeCount, spans: spans.length, touched: spans.filter((s) => sel?.containsNode(s, true)).length };
    });
    await added(tools, /Added highlight on pages 1, 2/).catch((error) => { throw new Error(`${error.message} :: ${JSON.stringify(diag)}`); });
    const bytes = await save();
    const [first, second] = [await inspect(bytes, 1), await inspect(bytes, 2)];
    expect(first.annotations.length === 1 && second.annotations.length === 1, 'not marked on both pages');
    expect(first.annotations[0].contentsObj?.str === 'End of the first page' && second.annotations[0].contentsObj?.str === 'Start of the second page',
      'each page should keep its own text: ' + first.annotations[0].contentsObj?.str + ' / ' + second.annotations[0].contentsObj?.str);
    // Every quad hugs the text line (22 pt type on a 120 pt page), never a canvas or page box.
    for (const [n, { annotations }] of [[1, first], [2, second]]) {
      const q = annotations[0].quadPoints; const ys = []; for (let i = 1; i < q.length; i += 2) ys.push(q[i]);
      const quads = q.length / 8; const tallest = Math.max(...Array.from({ length: quads }, (_, k) => Math.max(...ys.slice(k * 4, k * 4 + 4)) - Math.min(...ys.slice(k * 4, k * 4 + 4))));
      expect(tallest > 15 && tallest < 40 && Math.min(...ys) > 35 && Math.max(...ys) < 85, `page ${n} quads ${JSON.stringify(Array.from(q))}`);
    }
    await tools.getByRole('button', { name: 'Close markup tools' }).click();
  });

  await check('MAL-055 freehand, arrow, rectangle, ellipse, text box, callout and sticky note drawn on the page', async () => {
    await openPdf(await source(), 'markup-draw.pdf');
    const tools = await openMarkup();
    await tools.getByLabel('Markup colour').fill('#cc0000');
    await tools.getByLabel('Markup opacity percent').fill('100');
    const use = async (name) => { await tools.getByRole('button', { name, exact: true }).click(); };
    // The page is shown at fit width: keep drags in the visible top third and left of the tools panel.
    // Each drawing is saved before the next; wait until it is listed.
    const listed = async (count) => tools.getByRole('list', { name: 'Markup in this PDF' }).locator('li').nth(count - 1).waitFor({ timeout: 30000 });
    await use('Pen'); await drag([0.1, 0.06], [0.4, 0.06], 20); await listed(1);
    await use('Arrow'); await drag([0.1, 0.3], [0.5, 0.3]); await listed(2);
    await use('Rectangle'); await drag([0.5, 0.04], [0.7, 0.1]); await listed(3);
    await use('Ellipse'); await drag([0.5, 0.12], [0.7, 0.18]); await listed(4);
    await tools.getByLabel('Markup text').fill('Check these figures');
    await use('Text box'); await drag([0.45, 0.2], [0.72, 0.25]); await listed(5);
    await use('Callout'); await drag([0.3, 0.27], [0.42, 0.31]); await listed(6);
    await use('Sticky note');
    const box = await canvasBox();
    await page.mouse.click(box.x + 0.05 * box.width, box.y + 0.33 * box.height);
    await notice(/Added a sticky note/); await listed(7);
    await page.keyboard.press('Escape');
    const { annotations } = await inspect(await save());
    expect(JSON.stringify(annotations.map((a) => a.subtype)) === JSON.stringify(['Ink', 'Line', 'Square', 'Circle', 'FreeText', 'FreeText', 'Text']), 'subtypes ' + annotations.map((a) => a.subtype));
    const [ink, arrow, square, , freeText, callout, note] = annotations;
    const xy = (fx, fy) => [fx * 612, (1 - fy) * 792];
    expect(ink.inkLists[0].length >= 20, 'freehand path too short');
    const [ax1, ay1] = xy(0.1, 0.3), [ax2, ay2] = xy(0.5, 0.3);
    const l = arrow.lineCoordinates;
    expect(near(l[0], ax1, 4) && near(l[1], ay1, 4) && near(l[2], ax2, 4) && near(l[3], ay2, 4), 'arrow ' + Array.from(l));
    expect(JSON.stringify(arrow.lineEndings) === JSON.stringify(['None', 'OpenArrow']), 'arrow head ' + arrow.lineEndings);
    const [sx1, sy2] = xy(0.5, 0.04), [sx2, sy1] = xy(0.7, 0.1);
    const r = square.rect;
    expect(near(r[0], sx1, 4) && near(r[1], sy1, 4) && near(r[2], sx2, 4) && near(r[3], sy2, 4), 'rectangle ' + r + ' vs ' + [sx1, sy1, sx2, sy2]);
    expect(JSON.stringify(Array.from(square.color)) === JSON.stringify([204, 0, 0]), 'colour');
    expect(freeText.contentsObj?.str === 'Check these figures' && callout.contentsObj?.str === 'Check these figures', 'text box/callout text');
    expect(note.contentsObj?.str === 'Check these figures' && near(note.rect[0], 0.05 * 612, 4), 'sticky note');
    expect(annotations.every((a) => a.hasAppearance), 'missing appearance streams');
  });

  await check('MAL-055 shapes on a rotated page land where they were drawn', async () => {
    await openPdf(await source({ rotate: 90 }), 'markup-rotated.pdf');
    const tools = await openMarkup();
    await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
    // Shown page is 792 wide x 612 high; drag 0.1..0.3 across, 0.2..0.4 down.
    await drag([0.1, 0.2], [0.3, 0.4]);
    await notice(/Added a drawing/);
    await page.keyboard.press('Escape');
    const { annotations } = await inspect(await save());
    // On a 90° page shown x maps to page y, and shown y (down) maps to page x: x = 612 - (1 - fy) * 612.
    const r = annotations[0].rect;
    const expected = [0.2 * 612, 0.1 * 792, 0.4 * 612, 0.3 * 792];
    expect(r.every((v, i) => near(v, expected[i], 5)), `rect ${r} vs ${expected}`);
  });
} finally {
  await h.finish();
}
