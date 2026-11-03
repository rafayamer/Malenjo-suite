/* Phase 2 object editing acceptance (MAL-014 images, MAL-015 vector shapes,
 * MAL-016 inserting text and shapes) in real Chromium. Saved output is
 * reopened with PDF.js, whose operator list is replayed independently here
 * (save/restore/transform) to find where images and paths are drawn.
 * Run: node scripts/pdf-phase2-objects-acceptance.mjs   (needs `playwright`)
 */
import { resolve } from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pageTexts, root, startHarness } from './lib/pdf-harness.mjs';

const h = await startHarness('PHASE2-OBJECTS');
const { page, panel, expect, check, action, notice, openPdf, save } = h;
// 2x1 PNG: red, blue.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEklEQVR4nGP4z8DAwMDA8B8EAB/+Af+5o3TyAAAAAElFTkSuQmCC', 'base64');
const MM = 72 / 25.4;
const near = (a, b, t = 1) => Math.abs(a - b) <= t;
const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
const pt = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Images (page-space box, decoded pixels) and stroke styles of page 1, from PDF.js. */
async function inspect(bytes) {
  const loading = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, standardFontDataUrl: resolve(root, 'node_modules/pdfjs-dist/standard_fonts') + '/' });
  const doc = await loading.promise;
  try {
    const p = await doc.getPage(1);
    const list = await p.getOperatorList();
    let ctm = [1, 0, 0, 1, 0, 0]; const stack = []; let stroke = null; let width = 1; let clip = null;
    const images = []; const strokes = [];
    for (let i = 0; i < list.fnArray.length; i++) {
      const fn = list.fnArray[i], args = list.argsArray[i];
      if (fn === OPS.save) stack.push({ ctm, stroke, width, clip });
      else if (fn === OPS.restore) ({ ctm, stroke, width, clip } = stack.pop() ?? { ctm, stroke, width, clip });
      else if (fn === OPS.clip || fn === OPS.eoClip) clip = ctm;
      else if (fn === OPS.transform) ctm = mul(args, ctm);
      else if (fn === OPS.setStrokeRGBColor) stroke = typeof args[0] === 'string' ? args[0] : '#' + args.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
      else if (fn === OPS.setLineWidth) width = args[0];
      else if (fn === OPS.paintImageXObject) {
        const corners = [pt(ctm, 0, 0), pt(ctm, 1, 0), pt(ctm, 0, 1), pt(ctm, 1, 1)];
        const box = [Math.min(...corners.map((c) => c[0])), Math.min(...corners.map((c) => c[1])), Math.max(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[1]))];
        const data = await new Promise((done) => p.objs.get(args[0], done));
        images.push({ box, ctm, clipped: !!clip, width: data.width, height: data.height, pixels: data.data });
      } else if (fn === OPS.constructPath) strokes.push({ stroke, width, ctm });
    }
    return { images, strokes };
  } finally { await loading.destroy(); }
}

async function source() {
  const pdf = await PDFDocument.create();
  const p = pdf.addPage([612, 792]);
  p.drawImage(await pdf.embedPng(PNG), { x: 100, y: 500, width: 200, height: 100 });
  p.drawRectangle({ x: 350, y: 500, width: 100, height: 50, borderColor: rgb(0, 0, 1), borderWidth: 2 });
  p.drawText('Report body', { x: 100, y: 450, size: 14, font: await pdf.embedFont(StandardFonts.Helvetica) });
  return pdf.save();
}
async function openObjects() {
  await action('Edit', 'Edit objects…');
  const tools = page.getByRole('dialog', { name: 'Edit objects' });
  await tools.waitFor();
  await panel().getByRole('button', { name: /^Select object: / }).first().waitFor({ timeout: 30000 });
  return tools;
}
const applied = (pattern) => notice(pattern);

try {
  await check('MAL-014 move, resize and rotate an image', async () => {
    await openPdf(await source(), 'objects-image.pdf');
    const tools = await openObjects();
    await panel().getByRole('button', { name: /^Select object: Image 1/ }).click();
    await tools.getByLabel('Move step in mm').fill('10');
    await tools.getByRole('button', { name: 'Move right' }).click();
    await applied(/Moved image 1/);
    let [image] = (await inspect(await save())).images;
    expect(near(image.box[0], 100 + 10 * MM) && near(image.box[1], 500), 'move ' + image.box);
    await tools.getByLabel('Resize percent').fill('50');
    await tools.getByRole('button', { name: 'Resize' }).click();
    await applied(/Resized image 1 .*to 50%/);
    [image] = (await inspect(await save())).images;
    const cx = 200 + 10 * MM;
    expect(near(image.box[2] - image.box[0], 100) && near(image.box[3] - image.box[1], 50) && near((image.box[0] + image.box[2]) / 2, cx), 'resize ' + image.box);
    await tools.getByLabel('Rotate degrees').fill('90');
    await tools.getByRole('button', { name: 'Rotate', exact: true }).click();
    await applied(/Rotated image 1 .*by 90°/);
    [image] = (await inspect(await save())).images;
    expect(near(image.box[2] - image.box[0], 50) && near(image.box[3] - image.box[1], 100), 'rotate ' + image.box);
    // Clockwise as shown: the image's x axis now points down the page.
    expect(near(image.ctm[0], 0, 0.01) && image.ctm[1] < 0, 'rotation direction ' + image.ctm);
  });

  await check('MAL-014 crop, adjust, replace and delete an image', async () => {
    await openPdf(await source(), 'objects-image2.pdf');
    const tools = await openObjects();
    await panel().getByRole('button', { name: /^Select object: Image 1/ }).click();
    await tools.getByLabel('Crop right percent').fill('50');
    await tools.getByRole('button', { name: 'Crop', exact: true }).click();
    await applied(/Cropped image 1/);
    expect((await inspect(await save())).images[0].clipped, 'crop clip not applied');
    await tools.getByLabel('Object to edit').selectOption({ label: 'Image 1 (2 × 1 px)' });
    await tools.getByRole('checkbox', { name: 'Greyscale' }).check();
    await tools.getByRole('button', { name: 'Adjust image' }).click();
    await applied(/Adjusted image 1/);
    let [image] = (await inspect(await save())).images;
    const [r, g, b] = image.pixels;
    expect(r === g && g === b, `not greyscale: ${r},${g},${b}`);
    await tools.getByLabel('Object to edit').selectOption({ label: 'Image 1 (2 × 1 px)' });
    const chooser = page.waitForEvent('filechooser', { timeout: 10000 });
    await tools.getByRole('button', { name: 'Replace image…' }).click();
    await (await chooser).setFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
    await applied(/Replaced image 1 .*with logo\.png/);
    [image] = (await inspect(await save())).images;
    expect(image.pixels[0] > 200 && image.pixels[1] < 50, 'replacement not drawn in colour');
    await tools.getByLabel('Object to edit').selectOption({ label: 'Image 1 (2 × 1 px)' });
    await tools.getByRole('button', { name: 'Delete' }).click();
    await applied(/Deleted image 1/);
    const after = await inspect(await save());
    expect(after.images.length === 0 && (await pageTexts(await save()))[0] === 'Report body', 'delete');
  });

  await check('MAL-015 restyle, move and delete a vector shape', async () => {
    await openPdf(await source(), 'objects-shape.pdf');
    const tools = await openObjects();
    await panel().getByRole('button', { name: /^Select object: Stroked shape 1/ }).click();
    await tools.getByLabel('Shape line colour').fill('#cc0000');
    await tools.getByLabel('Shape line width').fill('5');
    await tools.getByRole('button', { name: 'Apply style' }).click();
    await applied(/Restyled stroked shape 1/);
    let { strokes } = await inspect(await save());
    expect(strokes.some((s) => s.stroke === '#cc0000' && s.width === 5), 'style ' + JSON.stringify(strokes.map((s) => [s.stroke, s.width])));
    await tools.getByLabel('Object to edit').selectOption({ label: 'Stroked shape 1' });
    await tools.getByLabel('Move step in mm').fill('20');
    await tools.getByRole('button', { name: 'Move up' }).click();
    await applied(/Moved stroked shape 1/);
    ({ strokes } = await inspect(await save()));
    const moved = strokes.find((s) => s.stroke === '#cc0000');
    expect(moved && near(moved.ctm[5], 500 + 20 * MM), 'move up ' + (moved && moved.ctm));
    await tools.getByLabel('Object to edit').selectOption({ label: 'Stroked shape 1' });
    await tools.getByRole('button', { name: 'Delete' }).click();
    await applied(/Deleted stroked shape 1/);
    ({ strokes } = await inspect(await save()));
    expect(!strokes.some((s) => s.stroke === '#cc0000'), 'shape not deleted');
  });

  await check('MAL-016 insert text and shapes as page content, then edit the inserted text', async () => {
    await openPdf(await source(), 'objects-insert.pdf');
    const tools = await openObjects();
    await tools.getByLabel('Insert text', { exact: true }).fill('Approved by finance');
    await tools.getByLabel('Insert text size').fill('16');
    await tools.getByRole('button', { name: 'Text', exact: true }).click();
    const box = await panel().locator('[id$="-page-1"] canvas').first().boundingBox();
    const dragTo = async (from, to) => {
      await page.mouse.move(box.x + from[0] * box.width, box.y + from[1] * box.height); await page.mouse.down();
      await page.mouse.move(box.x + to[0] * box.width, box.y + to[1] * box.height, { steps: 6 }); await page.mouse.up();
    };
    await dragTo([0.1, 0.05], [0.6, 0.1]);
    await applied(/Inserted text/);
    await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await dragTo([0.1, 0.12], [0.3, 0.16]);
    await applied(/Inserted a rectangle/);
    await tools.getByRole('button', { name: 'Arrow', exact: true }).click();
    await dragTo([0.35, 0.14], [0.6, 0.14]);
    await applied(/Inserted a arrow|Inserted an arrow/);
    await page.keyboard.press('Escape');
    let bytes = await save();
    expect((await pageTexts(bytes))[0].includes('Approved by finance'), 'inserted text missing');
    const { strokes } = await inspect(bytes);
    expect(strokes.length >= 5, 'inserted shapes missing: ' + strokes.length);
    // The inserted text is ordinary page text: edit it natively.
    await tools.getByRole('button', { name: 'Close edit objects' }).click();
    await action('Edit', 'Edit text…');
    const editor = page.getByRole('dialog', { name: 'Edit text' });
    await panel().getByRole('button', { name: 'Edit text: Approved by finance' }).click();
    await editor.getByLabel('New text').fill('Approved by audit');
    await editor.getByRole('button', { name: 'Replace text' }).click();
    await notice(/in the original font/);
    bytes = await save();
    expect((await pageTexts(bytes))[0].includes('Approved by audit'), 'inserted text not editable');
  });
} finally {
  await h.finish();
}
