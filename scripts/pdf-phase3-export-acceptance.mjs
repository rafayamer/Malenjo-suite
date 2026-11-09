/* Phase 3 export acceptance (MAL-029 transparent PNG, MAL-036 images, MAL-041 Markdown,
 * MAL-042 HTML, MAL-043 SVG, MAL-044 plain text) in real Chromium. Every download is decoded
 * here independently: PNG/TIFF/JPEG headers and pixels, ZIP contents, and the SVG is rendered
 * by the browser itself to check where its graphics land.
 * Run: node scripts/pdf-phase3-export-acceptance.mjs   (needs `playwright`)
 */
import { inflateSync, deflateSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { startHarness } from './lib/pdf-harness.mjs';

const h = await startHarness('PHASE3-EXPORT');
const { page, panel, expect, check, action, notice, openPdf, download } = h;
const near = (a, b, t) => Math.abs(a - b) <= t;

// ---- independent decoders ----
function crc(buf) { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; }
function makePng(w, h, rgbPixels) {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgbPixels(x, y).forEach((v, c) => { raw[y * (w * 3 + 1) + 1 + x * 3 + c] = v; });
  const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function readPng(buf) {
  expect(buf.subarray(1, 4).toString('latin1') === 'PNG', 'not a PNG');
  let o = 8; const idat = []; let width = 0, height = 0, type = 0, dpi = null;
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), kind = buf.subarray(o + 4, o + 8).toString('latin1'), data = buf.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); type = data[9]; }
    else if (kind === 'pHYs' && data[8] === 1) dpi = Math.round(data.readUInt32BE(0) * 0.0254);
    else if (kind === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const ch = type === 6 ? 4 : type === 2 ? 3 : type === 0 ? 1 : 0; expect(ch, 'unsupported PNG type ' + type);
  const raw = inflateSync(Buffer.concat(idat)); const stride = width * ch; const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x], a = x >= ch ? px[y * stride + x - ch] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= ch && y ? px[(y - 1) * stride + x - ch] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      px[y * stride + x] = (v + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255;
    }
  }
  const at = (x, y) => { const i = (Math.floor(y) * width + Math.floor(x)) * ch; return ch === 4 ? [...px.subarray(i, i + 4)] : [...px.subarray(i, i + 3), 255]; };
  return { width, height, dpi, alpha: ch === 4, at };
}
function readJpeg(buf) {
  expect(buf[0] === 0xff && buf[1] === 0xd8, 'not a JPEG');
  const density = buf.subarray(6, 11).toString('latin1') === 'JFIF\0' && buf[13] === 1 ? buf.readUInt16BE(14) : null;
  for (let o = 2; o < buf.length;) {
    const marker = buf[o + 1], len = buf.readUInt16BE(o + 2);
    if (marker >= 0xc0 && marker <= 0xc2) return { height: buf.readUInt16BE(o + 5), width: buf.readUInt16BE(o + 7), density };
    o += 2 + len;
  }
  throw Error('JPEG has no frame header');
}
function readTiff(buf) {
  expect(buf.subarray(0, 2).toString('latin1') === 'II' && buf.readUInt16LE(2) === 42, 'not a TIFF');
  const pages = [];
  for (let at = buf.readUInt32LE(4); at; ) {
    const n = buf.readUInt16LE(at); const tags = {};
    for (let i = 0; i < n; i++) { const e = at + 2 + i * 12; const type = buf.readUInt16LE(e + 2), count = buf.readUInt32LE(e + 4); tags[buf.readUInt16LE(e)] = type === 3 && count === 1 ? buf.readUInt16LE(e + 8) : buf.readUInt32LE(e + 8); }
    const strip = buf.subarray(tags[273], tags[273] + tags[279]);
    const raw = tags[259] === 8 ? inflateSync(strip) : strip;
    pages.push({ width: tags[256], height: tags[257], compression: tags[259], samples: tags[277], dpi: buf.readUInt32LE(tags[282]) / buf.readUInt32LE(tags[282] + 4), raw });
    at = buf.readUInt32LE(at + 2 + n * 12);
  }
  return pages;
}
const unzip = (buf) => Object.fromEntries(Object.entries(unzipSync(new Uint8Array(buf))).map(([k, v]) => [k, Buffer.from(v)]));

// ---- source document ----
const QUAD = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]];
async function source() {
  const pdf = await PDFDocument.create();
  const [regular, bold] = [await pdf.embedFont(StandardFonts.Helvetica), await pdf.embedFont(StandardFonts.HelveticaBold)];
  const p = pdf.addPage([612, 792]);
  p.drawText('Quarterly Report', { x: 72, y: 720, size: 24, font: bold });
  p.drawText('Overview', { x: 72, y: 680, size: 16, font: bold });
  p.drawText('Revenue grew in every region during the quarter and', { x: 72, y: 655, size: 11, font: regular });
  p.drawText('costs stayed flat.', { x: 72, y: 641, size: 11, font: regular });
  ['• Faster delivery', '• Lower churn'].forEach((t, i) => p.drawText(t, { x: 72, y: 610 - i * 15, size: 11, font: regular }));
  ['1. Hire staff', '2. Open office'].forEach((t, i) => p.drawText(t, { x: 72, y: 570 - i * 15, size: 11, font: regular }));
  [['Region', 'Q1', 'Q2'], ['North', '10', '12'], ['South', '8', '9']].forEach((row, r) => row.forEach((c, k) => p.drawText(c, { x: 72 + k * 120, y: 520 - r * 16, size: 11, font: regular })));
  p.drawImage(await pdf.embedPng(makePng(2, 2, (x, y) => QUAD[y * 2 + x])), { x: 72, y: 300, width: 100, height: 100 });
  p.drawRectangle({ x: 300, y: 300, width: 200, height: 100, color: rgb(1, 0, 0) });
  const two = pdf.addPage([612, 792]);
  [['Left one', 'Right one'], ['Left two', 'Right two'], ['Left three', 'Right three']].forEach(([l, r], i) => { two.drawText(l, { x: 72, y: 700 - i * 15, size: 11, font: regular }); two.drawText(r, { x: 340, y: 700 - i * 15, size: 11, font: regular }); });
  const three = pdf.addPage([612, 792]);
  three.drawRectangle({ x: 100, y: 400, width: 200, height: 200, color: rgb(1, 1, 1) });
  three.drawRectangle({ x: 150, y: 450, width: 100, height: 100, color: rgb(1, 0, 0) });
  // Invisible text, as OCR adds over a scanned image (text render mode 3).
  three.node.normalize();
  const fontKey = three.node.newFontDictionary('OcrF', pdf.context.register(pdf.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' })));
  three.node.addContentStream(pdf.context.register(pdf.context.stream(`BT 3 Tr /${fontKey.decodeText()} 12 Tf 72 200 Td (Scanned invoice 4471) Tj ET`)));
  return pdf.save();
}

const exporter = () => page.getByRole('dialog', { name: 'Export as' });
async function openExport() {
  await action('Convert', 'Export as…');
  await exporter().waitFor();
}
async function exportFile() { return download(() => exporter().getByRole('button', { name: 'Export', exact: true }).click()); }
async function setFormat(format) { await exporter().getByLabel('Export format').selectOption(format); }

try {
  await check('MAL-036 export chosen pages to PNG, JPG and TIFF at a chosen resolution and quality', async () => {
    await openPdf(await source(), 'export.pdf');
    await openExport();
    const e = exporter();
    await setFormat('png');
    await e.getByLabel('Export pages').fill('1, 3');
    await e.getByLabel('Export resolution').fill('100');
    await e.getByText('Transparent page background').click(); // opaque
    const zip = unzip(await exportFile());
    expect(JSON.stringify(Object.keys(zip).sort()) === JSON.stringify(['export-page-1.png', 'export-page-3.png', 'export-report.txt']), 'png zip ' + Object.keys(zip));
    const png = readPng(zip['export-page-1.png']);
    const s = 100 / 72;
    expect(png.width === Math.ceil(612 * s) && png.height === Math.ceil(792 * s) && png.dpi === 100 && !png.alpha, `png ${png.width}x${png.height} ${png.dpi} ${png.alpha}`);
    expect(JSON.stringify(png.at(400 * s, (792 - 350) * s)) === '[255,0,0,255]', 'red rect pixel ' + png.at(400 * s, (792 - 350) * s));
    // The embedded 2x2 image's top-left quarter is red, bottom-right white.
    expect(png.at(97 * s, (792 - 375) * s)[0] > 200 && png.at(97 * s, (792 - 375) * s)[1] < 60, 'image pixel');
    await setFormat('jpeg');
    await e.getByLabel('Export pages').fill('1');
    await e.getByLabel('Export resolution').fill('200');
    await e.getByLabel('JPEG quality').fill('40');
    const low = await exportFile();
    await e.getByLabel('JPEG quality').fill('95');
    const high = await exportFile();
    const j = readJpeg(high);
    expect(j.width === Math.ceil(612 * 200 / 72) && j.height === Math.ceil(792 * 200 / 72) && j.density === 200, 'jpeg ' + JSON.stringify(j));
    expect(low.length < high.length * 0.8, `quality has no effect ${low.length} vs ${high.length}`);
    await setFormat('tiff');
    await e.getByLabel('Export pages').fill('1-2');
    await e.getByLabel('Export resolution').fill('72');
    const tiff = readTiff(await exportFile());
    expect(tiff.length === 2 && tiff.every((p) => p.width === 612 && p.height === 792 && p.compression === 8 && p.dpi === 72), 'tiff ' + JSON.stringify(tiff.map(({ raw, ...t }) => t)));
    const t = tiff[0]; const i = ((792 - 350) * 612 + 400) * t.samples;
    expect(t.raw[i] === 255 && t.raw[i + 1] === 0, 'tiff pixel');
    await e.getByLabel('TIFF compression').selectOption('none');
    await e.getByText('One multi-page TIFF').click();
    const files = unzip(await exportFile());
    expect(Object.keys(files).filter((n) => n.endsWith('.tif')).length === 2 && readTiff(files['export-page-2.tif'])[0].compression === 1, 'per-page tiff');
  });

  await check('MAL-029 transparent PNG of a page and of a dragged region, with background removal', async () => {
    const e = exporter();
    await setFormat('png');
    await e.getByLabel('Export pages').fill('3');
    await e.getByLabel('Export resolution').fill('72');
    await e.getByText('Transparent page background').click(); // back on
    let png = readPng(await exportFile());
    expect(png.alpha && png.at(30, 30)[3] === 0 && png.at(200, 792 - 500)[3] === 255 && png.at(120, 792 - 420).join() === '255,255,255,255', 'transparent page ' + [png.at(30, 30), png.at(120, 792 - 420)]);
    await e.getByText('Remove a background colour').click();
    await e.getByLabel('Background removal tolerance').fill('10');
    png = readPng(await exportFile());
    expect(png.at(120, 792 - 420)[3] === 0 && png.at(200, 792 - 500).join() === '255,0,0,255', 'white not removed ' + png.at(120, 792 - 420));
    await e.getByText('Remove a background colour').click();
    // Region: drag over the red rectangle on page 1 (shown fractions 300..500 x 392..492 of 612x792).
    await e.getByLabel('Export pages').fill('1');
    await e.getByRole('button', { name: 'Drag a region on the page' }).click();
    const target = panel().locator('[id$="-page-1"] canvas').first();
    await target.scrollIntoViewIfNeeded();
    await page.evaluate(() => { const c = document.querySelector('.document-session-panel.active [id$="-page-1"] canvas'); let s = c.parentElement; while (s && s.scrollHeight <= s.clientHeight + 1) s = s.parentElement; const r = c.getBoundingClientRect(); if (s) s.scrollTo({ top: s.scrollTop + r.top + r.height * 0.55 - innerHeight / 2, behavior: 'instant' }); });
    const box = await target.boundingBox();
    await page.mouse.move(box.x + (310 / 612) * box.width, box.y + (402 / 792) * box.height); await page.mouse.down();
    await page.mouse.move(box.x + (490 / 612) * box.width, box.y + (482 / 792) * box.height, { steps: 8 }); await page.mouse.up();
    await e.getByText(/Region on page 1:/).waitFor();
    png = readPng(await exportFile());
    expect(near(png.width, 180, 4) && near(png.height, 80, 4), `region size ${png.width}x${png.height}`);
    expect(png.at(png.width / 2, png.height / 2).join() === '255,0,0,255' && png.at(2, 2).join() === '255,0,0,255', 'region pixels');
    await e.getByRole('button', { name: 'Whole pages' }).click();
  });

  await check('MAL-041 Markdown with headings, lists, a table and image files', async () => {
    const e = exporter();
    await setFormat('markdown');
    await e.getByLabel('Export pages').fill('1');
    const zip = unzip(await exportFile());
    const md = zip['export.md'].toString('utf8');
    expect(md.includes('# Quarterly Report\n\n## Overview\n\nRevenue grew in every region during the quarter and costs stayed flat.'), 'headings/paragraph ' + md.slice(0, 200));
    expect(md.includes('- Faster delivery\n- Lower churn') && md.includes('1. Hire staff\n2. Open office'), 'lists');
    expect(md.includes('| Region | Q1 | Q2 |\n| --- | --- | --- |\n| North | 10 | 12 |\n| South | 8 | 9 |'), 'table');
    expect(md.includes('![Page 1 image 1](assets/page-1-image-1.png)'), 'image ref');
    const img = readPng(zip['assets/page-1-image-1.png']);
    expect(img.width === 2 && img.at(0, 0).join() === '255,0,0,255' && img.at(1, 1).join() === '255,255,255,255', 'image file');
    await e.getByText('Export report').waitFor();
  });

  await check('MAL-042 HTML with structure, tables and images, or positioned layout', async () => {
    const e = exporter();
    await setFormat('html');
    const zip = unzip(await exportFile());
    const html = zip['export.html'].toString('utf8');
    expect(/<h1>Quarterly Report<\/h1>\s*<h2>Overview<\/h2>/.test(html) && html.includes('<ul><li>Faster delivery</li><li>Lower churn</li></ul>') && html.includes('<ol><li>Hire staff</li>'), 'structure');
    expect(html.includes('<table><thead><tr><th>Region</th><th>Q1</th><th>Q2</th></tr></thead><tbody><tr><td>North</td><td>10</td><td>12</td></tr>'), 'table');
    expect(html.includes('<img src="assets/page-1-image-1.png"') && zip['assets/page-1-image-1.png'], 'image');
    // The browser renders the exported page: the table becomes a real table.
    const check = await page.context().newPage();
    await check.setContent(html);
    expect(await check.locator('table tr').count() === 3 && await check.locator('h1').innerText() === 'Quarterly Report', 'html does not render');
    await check.close();
    await e.getByLabel('HTML layout').selectOption('positioned');
    await e.getByText('Include images (saved as PNG files)').click();
    const positioned = (await exportFile()).toString('utf8');
    expect(/<span style="left:72pt;top:[\d.]+pt;font-size:24pt;font-weight:bold">Quarterly Report<\/span>/.test(positioned) && /<span style="left:192pt;[^"]*">Q1<\/span>/.test(positioned), 'positioned spans');
  });

  await check('MAL-043 SVG keeps vector paths, text and images where they are on the page', async () => {
    const e = exporter();
    await setFormat('svg');
    await e.getByLabel('Export pages').fill('1');
    const svg = (await exportFile()).toString('utf8');
    expect(/<path d="[^"]+" transform="matrix\([^)]*\)" fill="#ff0000"/.test(svg), 'red path');
    expect(/<text [^>]*>Quarterly Report<\/text>/.test(svg) && /href="data:image\/png;base64,/.test(svg), 'text/image');
    // Render the SVG independently in the browser and sample where the PDF draws things.
    const view = await page.context().newPage();
    const pixels = await view.evaluate(async (source) => {
      const img = new Image(); img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(source)));
      await img.decode();
      const c = document.createElement('canvas'); c.width = 612; c.height = 792;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, 612, 792);
      const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
      let dark = 0; for (let x = 72; x < 260; x++) for (let y = 50; y < 72; y++) if (ctx.getImageData(x, y, 1, 1).data[0] < 100) dark++;
      return { red: at(400, 792 - 350), quad: at(97, 792 - 375), blank: at(560, 40), dark };
    }, svg);
    await view.close();
    expect(pixels.red.slice(0, 3).join() === '255,0,0' && pixels.quad[0] > 200 && pixels.quad[1] < 60 && pixels.blank.slice(0, 3).join() === '255,255,255', 'svg render ' + JSON.stringify(pixels));
    expect(pixels.dark > 200, 'heading text not drawn ' + pixels.dark);
  });

  await check('MAL-044 plain text with reading order, page separators and OCR text', async () => {
    const e = exporter();
    await setFormat('text');
    await e.getByLabel('Export pages').fill('2-3');
    await e.getByLabel('Reading order').selectOption('columns');
    await e.getByLabel('Page separator', { exact: true }).selectOption('custom');
    await e.getByLabel('Page separator text').fill('=== Page {n} of {total} ===');
    let text = (await exportFile()).toString('utf8');
    expect(text.startsWith('=== Page 2 of 3 ===\nLeft one\nLeft two\nLeft three\nRight one\nRight two\nRight three\n=== Page 3 of 3 ===\nScanned invoice 4471'), 'columns/custom ' + JSON.stringify(text));
    await e.getByLabel('Reading order').selectOption('rows');
    await e.getByLabel('Page separator', { exact: true }).selectOption('formfeed');
    text = (await exportFile()).toString('utf8');
    expect(text.startsWith('Left one\tRight one\nLeft two\tRight two') && text.includes('\n\f\nScanned invoice 4471'), 'rows/formfeed ' + JSON.stringify(text));
    await e.getByLabel('Reading order').selectOption('stored');
    await e.getByLabel('Page separator', { exact: true }).selectOption('blank');
    text = (await exportFile()).toString('utf8');
    expect(text.startsWith('Left one\tRight one\nLeft two\tRight two') && text.includes('\n\nScanned invoice 4471'), 'stored ' + JSON.stringify(text));
    await notice(/Exported export\.txt/);
  });
} finally {
  await h.finish();
}
