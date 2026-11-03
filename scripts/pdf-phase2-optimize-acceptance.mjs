/* Phase 2 optimize acceptance (MAL-024 lossless compression, MAL-025 image
 * compression) in real Chromium. Each check drives the real UI, saves the
 * output and reopens it independently with pdf-lib and PDF.js.
 * Run: node scripts/pdf-phase2-optimize-acceptance.mjs   (needs `playwright`)
 */
import { resolve } from 'node:path';
import { zlibSync } from 'fflate';
import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pageTexts, root, startHarness } from './lib/pdf-harness.mjs';

const h = await startHarness('PHASE2-OPTIMIZE');
const { page, expect, check, action, notice, openPdf, save } = h;

/** Decoded page content streams (what is drawn), for an equivalence check. */
function drawn(pdf) {
  return pdf.getPages().map((p) => {
    const direct = p.node.get(PDFName.of('Contents'));
    const raw = direct && pdf.context.lookup(direct) instanceof PDFArray ? pdf.context.lookup(direct) : direct;
    const refs = raw instanceof PDFArray ? raw.asArray() : [raw];
    return refs.map((ref) => Buffer.from(decodePDFRawStream(pdf.context.lookup(ref)).decode()).toString('latin1')).join('\n');
  });
}
/** Image XObjects as {width, height, filter}. */
function images(pdf) {
  return pdf.context.enumerateIndirectObjects().map(([, o]) => o)
    .filter((o) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype'))?.toString() === '/Image')
    .map((o) => ({ width: o.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber(), height: o.dict.lookup(PDFName.of('Height'), PDFNumber).asNumber(), filter: o.dict.get(PDFName.of('Filter'))?.toString() }));
}
/** PDF.js decodes every image on page 1 and reports the mean of its pixel values. */
async function decodedImageMeans(bytes) {
  const loading = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, standardFontDataUrl: resolve(root, 'node_modules/pdfjs-dist/standard_fonts') + '/' });
  const doc = await loading.promise;
  try {
    const p = await doc.getPage(1);
    const list = await p.getOperatorList();
    const means = [];
    for (let i = 0; i < list.fnArray.length; i++) {
      if (list.fnArray[i] !== OPS.paintImageXObject) continue;
      const image = await new Promise((done) => p.objs.get(list.argsArray[i][0], done));
      let sum = 0; for (let j = 0; j < image.data.length; j++) sum += image.data[j];
      means.push(sum / image.data.length);
    }
    return means;
  } finally { await loading.destroy(); }
}

async function compress(configure) {
  await action('Optimize', 'Compress…');
  const dialog = page.getByRole('dialog', { name: 'Compress PDF' });
  await configure(dialog);
  await dialog.getByRole('button', { name: 'Compress', exact: true }).click();
  return dialog;
}

async function bloated() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const logo = new Uint8Array(64 * 32 * 3).map((_, i) => (i * 13) % 256);
  for (let n = 1; n <= 3; n++) {
    const p = pdf.addPage([612, 792]);
    p.node.newFontDictionary('F1', font.ref);
    // Each page gets its own copy of the same logo, and uncompressed text content.
    const image = pdf.context.register(PDFRawStream.of(pdf.context.obj({ Type: 'XObject', Subtype: 'Image', Width: 64, Height: 32, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }), logo));
    const name = p.node.newXObject('Logo', image).decodeText();
    const ops = [`q 64 0 0 32 500 720 cm /${name} Do Q`, ...Array.from({ length: 150 }, (_, i) => `BT /F1 9 Tf 40 ${760 - (i % 80) * 9} Td (Page ${n} line ${i}) Tj ET`)].join('\n');
    p.node.set(PDFName.of('Contents'), pdf.context.obj([pdf.context.register(pdf.context.stream(ops))]));
  }
  pdf.context.register(pdf.context.stream('unused '.repeat(4000)));
  return pdf.save({ useObjectStreams: false });
}

/** A page-filling smooth 2550 x 3300 RGB photo (300 dpi on Letter), Flate-compressed. */
async function scanned() {
  const pdf = await PDFDocument.create();
  const p = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const w = 2550, h = 3300;
  const pixels = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    pixels[i] = Math.round(255 * x / w); pixels[i + 1] = Math.round(255 * y / h); pixels[i + 2] = 128 + Math.round(60 * Math.sin((x + y) / 40));
  }
  const image = pdf.context.register(PDFRawStream.of(pdf.context.obj({ Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode' }), zlibSync(pixels, { level: 6 })));
  const name = p.node.newXObject('Scan', image).decodeText();
  p.node.set(PDFName.of('Contents'), pdf.context.obj([pdf.context.register(pdf.context.flateStream(`q 612 0 0 792 0 0 cm /${name} Do Q`))]));
  p.drawText('Scanned invoice 42', { x: 40, y: 40, size: 14, font });
  return pdf.save();
}

try {
  await check('MAL-024 lossless compression: smaller file, identical page content and images', async () => {
    const source = await bloated();
    await openPdf(source, 'bloated.pdf');
    const dialog = await compress(async (d) => { await d.getByRole('radio', { name: /^Lossless/ }).check(); });
    await notice(/Lossless compression: .* smaller\)/);
    await dialog.getByRole('status').filter({ hasText: 'duplicate(s) merged' }).waitFor();
    const out = await save();
    expect(out.length < source.length * 0.6, `not much smaller: ${source.length} -> ${out.length}`);
    const [before, after] = [await PDFDocument.load(source), await PDFDocument.load(out)];
    expect(JSON.stringify(drawn(after)) === JSON.stringify(drawn(before)), 'decoded page content changed');
    expect(JSON.stringify(await pageTexts(out)) === JSON.stringify(await pageTexts(source)), 'text changed');
    expect(images(after).length === 1 && images(before).length === 3, `duplicate images not merged: ${images(after).length}`);
    const [m0, m1] = [await decodedImageMeans(source), await decodedImageMeans(out)];
    expect(m0.length === 1 && m1.length === 1 && m0[0] === m1[0], `image pixels changed: ${m0} vs ${m1}`);
  });

  await check('MAL-025 image compression profile: downsampled JPEG, size report, same page text, faithful colours', async () => {
    const source = await scanned();
    await openPdf(source, 'scan.pdf');
    const dialog = await compress(async (d) => {
      await d.getByRole('radio', { name: /^Reduce images/ }).check();
      await d.getByLabel('Compression profile').selectOption('small');
    });
    await notice(/Image compression: .* smaller\)\. 1 image\(s\) reduced to 96 dpi/);
    await dialog.getByRole('status').waitFor();
    const out = await save();
    expect(out.length < source.length * 0.5, `not smaller: ${source.length} -> ${out.length}`);
    const [image] = images(await PDFDocument.load(out));
    // 3300 px down 11 in = 300 dpi -> 96 dpi: 816 x 1056.
    expect(image.width === 816 && image.height === 1056 && image.filter === '/DCTDecode', 'image ' + JSON.stringify(image));
    expect(JSON.stringify(await pageTexts(out)) === JSON.stringify(await pageTexts(source)), 'page text changed');
    const [m0, m1] = [await decodedImageMeans(source), await decodedImageMeans(out)];
    expect(Math.abs(m0[0] - m1[0]) < 4, `colours drifted: mean ${m0[0]} vs ${m1[0]}`);
  });

  await check('MAL-025 custom resolution and quality', async () => {
    await openPdf(await scanned(), 'scan-custom.pdf');
    await compress(async (d) => {
      await d.getByRole('radio', { name: /^Reduce images/ }).check();
      await d.getByLabel('Compression profile').selectOption('custom');
      await d.getByLabel('Image resolution in dpi').fill('150');
      await d.getByLabel('JPEG quality percent').fill('50');
    });
    await notice(/reduced to 150 dpi/);
    const [image] = images(await PDFDocument.load(await save()));
    expect(image.width === 1275 && image.height === 1650, 'image ' + JSON.stringify(image));
  });
} finally {
  await h.finish();
}
