import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { PDFDict, PDFDocument, PDFHexString, PDFName, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { batchManifestCsv, batchPages, runPdfBatch, type PdfBatchEntry } from './pdfBatch';

async function labelled(prefix: string, pages: number) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pages; n++) pdf.addPage([612, 792]).drawText(`${prefix}${n}`, { x: 60, y: 700, size: 30, font });
  return pdf.save();
}

async function texts(bytes: Uint8Array) {
  const loading = getDocument({ data: bytes.slice(), useSystemFonts: true });
  const doc = await loading.promise;
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    out.push((await (await doc.getPage(p)).getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(' ').trim());
  }
  await loading.destroy();
  return out;
}

/** Independent digest via WebCrypto (not the module's own helper). */
const sha = async (bytes: Uint8Array) => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))))
  .map((b) => b.toString(16).padStart(2, '0')).join('');

describe('runPdfBatch (MAL-010)', () => {
  it('applies the rule set to every file and writes results with JSON and CSV manifests', async () => {
    const alpha = await labelled('Alpha', 5);
    const beta = await labelled('Beta', 3);
    const result = await runPdfBatch(
      [{ name: 'alpha.pdf', bytes: alpha }, { name: 'beta.pdf', bytes: beta }, { name: 'broken.pdf', bytes: new TextEncoder().encode('%PDF-1.7 nope') }],
      [{ kind: 'remove', pages: '1' }, { kind: 'rotate', pages: '1', angle: 90 }],
    );
    expect([result.succeeded, result.failed]).toEqual([2, 1]);
    const zip = unzipSync(result.archive);
    expect(Object.keys(zip).sort()).toEqual(['manifest.csv', 'manifest.json', 'results/alpha.pdf', 'results/beta.pdf']);
    expect(await texts(zip['results/alpha.pdf'])).toEqual(['Alpha2', 'Alpha3', 'Alpha4', 'Alpha5']);
    expect(await texts(zip['results/beta.pdf'])).toEqual(['Beta2', 'Beta3']);
    const reopened = await PDFDocument.load(zip['results/alpha.pdf']);
    expect(reopened.getPage(0).getRotation().angle).toBe(90);
    expect(reopened.getPage(1).getRotation().angle).toBe(0);

    const manifest = JSON.parse(strFromU8(zip['manifest.json'])) as { rules: string[]; entries: PdfBatchEntry[] };
    expect(manifest.rules).toEqual(['Remove pages 1', 'Rotate 1 by 90°']);
    const [a, b, broken] = manifest.entries;
    expect(a).toMatchObject({ source: 'alpha.pdf', status: 'ok', inputPages: 5, outputPages: 4, inputSha256: await sha(alpha), outputSha256: await sha(zip['results/alpha.pdf']) });
    expect(b).toMatchObject({ status: 'ok', inputPages: 3, outputPages: 2 });
    expect(broken).toMatchObject({ source: 'broken.pdf', status: 'failed', output: null });
    expect(broken.message).toMatch(/encrypted, invalid or damaged/);
    const csv = strFromU8(zip['manifest.csv']).trim().split('\r\n');
    expect(csv).toHaveLength(4);
    expect(csv[1]).toContain(await sha(alpha));
    expect(csv[3]).toContain('"failed"');
  });

  it('keeps ranges, arranges N-up, reports a rule that does not fit, and dedupes names', async () => {
    const result = await runPdfBatch(
      [{ name: 'a/report.pdf', bytes: await labelled('R', 6) }, { name: 'b/report.pdf', bytes: await labelled('S', 2) }],
      [{ kind: 'keep', pages: '1-4' }, { kind: 'nup', options: { perSheet: 2, sheet: 'letter', orientation: 'landscape', margin: 18, gap: 9, order: 'rows', borders: false } }],
    );
    expect(result.entries.map((entry) => entry.status)).toEqual(['ok', 'failed']);
    expect(result.entries[0]).toMatchObject({ output: 'results/report.pdf', inputPages: 6, outputPages: 2 });
    expect(result.entries[1].message).toMatch(/^Rule 1 \(Keep only pages 1-4\): Range/);
    const zip = unzipSync(result.archive);
    expect(await texts(zip['results/report.pdf'])).toEqual(['R1 R2', 'R3 R4']);

    const again = await runPdfBatch(
      [{ name: 'a/report.pdf', bytes: await labelled('R', 2) }, { name: 'b/report.pdf', bytes: await labelled('S', 2) }],
      [{ kind: 'rotate', pages: 'all', angle: 180 }],
    );
    expect(again.entries.map((entry) => entry.output)).toEqual(['results/report.pdf', 'results/report (2).pdf']);
  });

  it('drops bookmarks and links that point to removed pages, keeping the rest', async () => {
    const pdf = await PDFDocument.load(await labelled('N', 4));
    const ctx = pdf.context;
    const dest = (n: number) => ctx.obj([pdf.getPage(n - 1).ref, PDFName.of('Fit')]);
    // Bookmarks: "Two" (page 2, removed) has a child "Three" (page 3, kept); "Four" (page 4).
    const rootRef = ctx.register(ctx.obj({ Type: 'Outlines' }));
    const [two, three, four] = ['Two', 'Three', 'Four'].map((title, i) => ctx.register(ctx.obj({ Title: PDFHexString.fromText(title), Dest: dest(i + 2) })));
    const d = (ref: typeof two) => ctx.lookup(ref, PDFDict);
    d(two).set(PDFName.of('Parent'), rootRef); d(two).set(PDFName.of('Next'), four); d(two).set(PDFName.of('First'), three); d(two).set(PDFName.of('Last'), three); d(two).set(PDFName.of('Count'), ctx.obj(1));
    d(three).set(PDFName.of('Parent'), two);
    d(four).set(PDFName.of('Parent'), rootRef); d(four).set(PDFName.of('Prev'), two);
    const root = ctx.lookup(rootRef, PDFDict); root.set(PDFName.of('First'), two); root.set(PDFName.of('Last'), four);
    pdf.catalog.set(PDFName.of('Outlines'), rootRef);
    const link = (n: number) => ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], Dest: dest(n) }));
    pdf.getPage(0).node.set(PDFName.of('Annots'), ctx.obj([link(2), link(4)]));
    const result = await runPdfBatch([{ name: 'nav.pdf', bytes: await pdf.save() }], [{ kind: 'remove', pages: '2' }]);
    expect(result.entries[0].message).toBe('Removed 1 bookmark(s) and 1 link(s) that pointed to removed pages.');
    const out = unzipSync(result.archive)['results/nav.pdf'];
    const loading = getDocument({ data: out.slice(), useSystemFonts: true });
    const doc = await loading.promise;
    const outline = await doc.getOutline();
    expect(outline.map((o) => o.title)).toEqual(['Three', 'Four']);
    const annots = await (await doc.getPage(1)).getAnnotations();
    expect(annots.filter((a) => a.subtype === 'Link')).toHaveLength(1);
    expect(await doc.getPageIndex((annots[0].dest as { num: number; gen: number }[])[0])).toBe(2);
    await loading.destroy();
  });

  it('keeps every remaining page\'s label when pages are removed', async () => {
    const pdf = await PDFDocument.load(await labelled('L', 6));
    // Cover (no label), then i, ii, then 1, 2, 3.
    pdf.catalog.set(PDFName.of('PageLabels'), pdf.context.obj({ Nums: [0, pdf.context.obj({}), 1, pdf.context.obj({ S: 'r' }), 3, pdf.context.obj({ S: 'D' })] }));
    const result = await runPdfBatch([{ name: 'labels.pdf', bytes: await pdf.save() }], [{ kind: 'remove', pages: '1, 5' }]);
    const loading = getDocument({ data: unzipSync(result.archive)['results/labels.pdf'].slice(), useSystemFonts: true });
    const doc = await loading.promise;
    expect(await doc.getPageLabels()).toEqual(['i', 'ii', '1', '3']);
    await loading.destroy();
  });

  it('refuses removing every page and validates input', async () => {
    const result = await runPdfBatch([{ name: 'x.pdf', bytes: await labelled('X', 2) }], [{ kind: 'remove', pages: '1-2' }]);
    expect(result.entries[0].message).toMatch(/remove every page/);
    await expect(runPdfBatch([], [{ kind: 'remove', pages: '1' }])).rejects.toThrow(/at least one PDF/);
    await expect(runPdfBatch([{ name: 'x.pdf', bytes: await labelled('X', 1) }], [])).rejects.toThrow(/at least one rule/);
    await expect(runPdfBatch([{ name: 'a.pdf', bytes: await labelled('A', 3) }, { name: 'b.pdf', bytes: await labelled('B', 3) }],
      [{ kind: 'rotate', pages: 'all', angle: 90 }], 64 * 1024 + 1500)).rejects.toThrow(/would exceed/);
    expect(batchPages('all', 3)).toEqual([1, 2, 3]);
    expect(batchPages('3, 1-2, 2', 3)).toEqual([1, 2, 3]);
  });

  it('neutralises spreadsheet formulas in the CSV manifest', () => {
    const csv = batchManifestCsv([{ source: '=HYPERLINK("x")', output: null, status: 'failed', message: 'a "quote"', inputPages: null, outputPages: null, inputBytes: 1, outputBytes: null, inputSha256: 'h', outputSha256: null }]);
    expect(csv.split('\r\n')[1]).toBe(`"'=HYPERLINK(""x"")","","failed","a ""quote""","","","1","","h",""`);
  });
});
