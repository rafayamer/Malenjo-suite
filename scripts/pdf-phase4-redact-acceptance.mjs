/* Phase 4 redaction acceptance (MAL-063 permanent redaction, MAL-064 sensitive-information detection, MAL-067 Bates
 * numbering across files) in real Chromium. Every output is saved and read independently: PDF.js for text, comments and
 * metadata, pdf-lib for the image pixels and for what is left anywhere in the file's bytes.
 * Run: node scripts/pdf-phase4-redact-acceptance.mjs   (needs `playwright`)
 */
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { PDFDocument, PDFHexString, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { root, startHarness } from './lib/pdf-harness.mjs';

const h = await startHarness('PHASE4-REDACT');
const { page, panel, expect, check, action, notice, openPdf, download, save, undo } = h;
const N = PDFName.of;

async function read(bytes) {
  const loading = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, standardFontDataUrl: resolve(root, 'node_modules/pdfjs-dist/standard_fonts') + '/' });
  const doc = await loading.promise;
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const p = await doc.getPage(n);
      pages.push({ text: (await p.getTextContent()).items.map((i) => i.str).join(' '), annots: (await p.getAnnotations()).map((a) => a.subtype) });
    }
    return { pages, info: (await doc.getMetadata()).info };
  } finally { await loading.destroy(); }
}
/** Every stream decompressed, plus the hex form text strings are often written in. */
async function everything(bytes) {
  const pdf = await PDFDocument.load(bytes);
  let out = Buffer.from(bytes).toString('latin1');
  for (const [, o] of pdf.context.enumerateIndirectObjects()) if (o instanceof PDFRawStream) { try { out += Buffer.from(decodePDFRawStream(o).decode()).toString('latin1'); } catch { /* binary */ } }
  return { has: (s) => out.includes(s) || out.toLowerCase().replace(/\s/g, '').includes(Buffer.from(s).toString('hex')), pdf };
}
async function letter() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const p = pdf.addPage([612, 792]);
  p.drawText('Account holder: John Smith', { x: 72, y: 700, size: 14, font });
  p.drawText('Statement for March', { x: 72, y: 680, size: 14, font });
  // A 20x20 picture in the area that will be drawn over, and a comment there.
  const pixels = new Uint8Array(20 * 20 * 3).fill(200);
  p.node.setXObject(N('Photo'), pdf.context.register(pdf.context.flateStream(pixels, { Type: 'XObject', Subtype: 'Image', Width: 20, Height: 20, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 })));
  p.node.addContentStream(pdf.context.register(pdf.context.stream('q 200 0 0 200 72 300 cm /Photo Do Q q 0 0 1 RG 100 350 m 150 450 l S Q')));
  p.node.set(N('Annots'), pdf.context.obj([pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [120, 400, 140, 420], Contents: PDFHexString.fromText('signature here') }))]));
  pdf.setTitle('Statement for John Smith');
  return pdf.save();
}
const canvasBox = () => panel().locator('[id$="-page-1"] canvas').first().boundingBox();
/** Drags over a page-space box (612 x 792 page, upright). */
async function dragBox([x0, y0, x1, y1]) {
  const b = await canvasBox();
  const at = (x, y) => [b.x + (x / 612) * b.width, b.y + (1 - y / 792) * b.height];
  const [sx, sy] = at(x0, y1); const [ex, ey] = at(x1, y0);
  await page.mouse.move(sx, sy); await page.mouse.down();
  for (let t = 1; t <= 8; t++) await page.mouse.move(sx + ((ex - sx) * t) / 8, sy + ((ey - sy) * t) / 8);
  await page.mouse.up();
}

try {
  await check('MAL-063 permanently remove selected text, images, graphics and associated hidden content', async () => {
    await openPdf(await letter(), 'statement.pdf');
    await action('Protect', 'Redact…');
    const d = page.getByRole('dialog', { name: 'Redact' });
    await d.getByLabel('Text to redact').fill('John Smith');
    await d.getByRole('button', { name: 'Mark all matches' }).click();
    await d.getByText('Marked 1 match of “John Smith”.').waitFor();
    await d.getByRole('button', { name: 'Draw areas on the page' }).click();
    await dragBox([60, 290, 290, 510]);
    await d.getByRole('button', { name: 'Stop drawing areas' }).click();
    await d.getByRole('list', { name: 'Areas marked for redaction' }).getByText('Page 1: drawn area').waitFor();
    await panel().getByRole('button', { name: /^Redaction mark: drawn area/ }).waitFor();
    await d.getByLabel('Text in each box (optional)').fill('REDACTED');
    await d.getByRole('button', { name: 'Apply 2 redactions' }).click();
    await notice(/Redacted 2 area\(s\) on 1 page\(s\): removed 10 character\(s\), 1 image\(s\) blacked out, 1 drawing\(s\), 1 comment\(s\) or link\(s\)/);
    await d.getByText(/Also removed the redacted words from: Document information: Title/).waitFor();
    const out = await save();
    const r = await read(out);
    expect(!/John|Smith/.test(r.pages[0].text) && r.pages[0].text.includes('Account holder:') && r.pages[0].text.includes('Statement for March'), 'text ' + r.pages[0].text);
    expect(r.pages[0].text.includes('REDACTED') && r.info.Title === 'Statement for [REDACTED]' && r.pages[0].annots.length === 0, 'label/title/comments ' + JSON.stringify(r));
    const { has, pdf } = await everything(out);
    expect(!has('John') && !has('Smith') && !has('signature here') && !has('150 450 l'), 'removed content still in the file');
    const images = [...pdf.context.enumerateIndirectObjects()].map(([, o]) => o).filter((o) => o instanceof PDFRawStream && o.dict.get(N('Subtype'))?.toString() === '/Image');
    const data = decodePDFRawStream(images[0]).decode();
    // The drawn area covers the picture's left x ≤ 290 of 72..272 (all of it) up to y 510 of 300..500 (all of it): every pixel black.
    expect(images.length === 1 && data.every((v) => v === 0), 'image pixels ' + images.length);
    await undo();
    expect((await read(await save())).pages[0].text.includes('John Smith'), 'undo did not restore');
  });

  await check('MAL-064 privately detect candidate identifiers, financial data, names and addresses for reviewed redaction', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const p = pdf.addPage([612, 792]);
    ['Patient: Sarah Connor', 'Email sarah.connor@example.com', 'Card 4111 1111 1111 1111', 'SSN 123-45-6789', 'IBAN GB82 WEST 1234 5698 7654 32',
      'Address: 221 Baker Street, London NW1 6XE', 'Case ref ORD-7781', 'Invoice total 1234.56'].forEach((line, i) => p.drawText(line, { x: 72, y: 700 - i * 24, size: 12, font }));
    await openPdf(await pdf.save(), 'intake.pdf');
    await action('Protect', 'Redact…');
    const d = page.getByRole('dialog', { name: 'Redact' });
    await d.getByLabel('Your own patterns').check();
    await d.getByLabel(/^Your patterns/).fill('/ORD-\\d+/');
    await d.getByRole('button', { name: 'Find candidates' }).click();
    await d.getByText(/Found \d+ candidates to review\./).waitFor();
    const list = d.getByRole('list', { name: 'Candidates to review' });
    for (const text of ['Sarah Connor', 'sarah.connor@example.com', '4111 1111 1111 1111', '123-45-6789', 'GB82 WEST 1234 5698 7654 32', '221 Baker Street, London', 'NW1 6XE', 'ORD-7781']) await list.getByText(text, { exact: false }).first().waitFor();
    expect(!(await list.textContent()).includes('1234.56'), 'invoice total flagged');
    // The reviewer keeps the street address.
    await list.getByLabel(/221 Baker Street, London/).uncheck();
    await d.getByRole('button', { name: 'Mark 7 selected candidates' }).click();
    await d.getByRole('button', { name: /^Apply \d+ redactions$/ }).click();
    await notice(/Redacted \d+ area\(s\) on 1 page\(s\)/);
    const text = (await read(await save())).pages[0].text;
    for (const gone of ['Sarah Connor', 'sarah.connor', '4111', '123-45-6789', 'GB82', 'NW1 6XE', 'ORD-7781']) expect(!text.includes(gone), `${gone} left: ${text}`);
    expect(text.includes('221 Baker Street') && text.includes('Invoice total 1234.56') && text.includes('Patient:'), 'kept text ' + text);
  });

  await check('MAL-067 Bates numbers across files with prefix, padding, placement and continuation rules', async () => {
    const make = async (pages, rotate = 0) => { const pdf = await PDFDocument.create(); for (let i = 0; i < pages; i++) pdf.addPage([612, 792]).setRotation({ type: 'degrees', angle: rotate }); return Buffer.from(await pdf.save()); };
    await openPdf(await make(2), 'volume-a.pdf');
    await action('Protect', 'Bates numbering across files…');
    const d = page.getByRole('dialog', { name: 'Bates numbering' });
    await d.locator('input[type="file"]').setInputFiles([{ name: 'volume-b.pdf', mimeType: 'application/pdf', buffer: await make(3, 90) }, { name: 'volume-c.pdf', mimeType: 'application/pdf', buffer: await make(1) }]);
    await d.getByRole('list', { name: 'PDFs to number, in order' }).getByText('volume-c.pdf').waitFor();
    await d.getByRole('button', { name: 'Move volume-c.pdf up' }).click(); // order: a, c, b
    await d.getByLabel('Prefix', { exact: true }).fill('ACME-{vol}-');
    await d.getByLabel('Padding (digits)').fill('5');
    await d.getByLabel('Numbering', { exact: true }).selectOption('round');
    await d.getByLabel('Round to').fill('100');
    await d.getByLabel('Position', { exact: true }).selectOption('top-left');
    const zip = unzipSync(new Uint8Array(await download(() => d.getByRole('button', { name: 'Number 3 PDFs and save ZIP' }).click())));
    await notice(/Numbered 3 PDFs \(ACME-001-00001 to ACME-003-00202\)/);
    expect(JSON.stringify(Object.keys(zip).sort()) === JSON.stringify(['ACME-001-00001_volume-a.pdf', 'ACME-002-00100_volume-c.pdf', 'ACME-003-00200_volume-b.pdf', 'bates-log.csv']), 'zip ' + Object.keys(zip));
    const b = await read(zip['ACME-003-00200_volume-b.pdf']);
    expect(b.pages.map((x) => x.text.trim()).join(',') === 'ACME-003-00200,ACME-003-00201,ACME-003-00202', 'volume b ' + JSON.stringify(b.pages));
    const log = Buffer.from(zip['bates-log.csv']).toString('utf8').split('\r\n');
    expect(log[0] === 'File,First Bates,Last Bates,Pages,SHA-256' && /^volume-c\.pdf,ACME-002-00100,ACME-002-00100,1,[0-9a-f]{64}$/.test(log[2]), 'log ' + log.join(' / '));
    // The open document was numbered too (undoable), at the top left of its visible page.
    const open = await read(await save());
    expect(open.pages.map((x) => x.text.trim()).join(',') === 'ACME-001-00001,ACME-001-00002', 'open document ' + JSON.stringify(open.pages));
  });
} finally {
  await h.finish();
}
