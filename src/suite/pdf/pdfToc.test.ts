import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { setPdfPageLabelRange } from './pageLabels';
import { addPdfOutlineTreeEntry, listPdfOutlineTree, nestPdfOutlineTreeEntry, setPdfOutlineTreeEntryPage } from './pdfOutlineTree';
import { generatePdfTableOfContents } from './pdfToc';

async function doc(pages: number) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pages; n++) pdf.addPage([600, 800]).drawText(`Body ${n}`, { x: 50, y: 700, size: 14, font });
  return pdf.save();
}

async function texts(bytes: Uint8Array) {
  const loading = getDocument({ data: bytes.slice(), useSystemFonts: true });
  const pdf = await loading.promise;
  const out: string[] = [];
  const labels = await pdf.getPageLabels();
  for (let p = 1; p <= pdf.numPages; p++) out.push((await (await pdf.getPage(p)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ').replace(/\s+/g, ' ').trim());
  await loading.destroy();
  return { out, labels };
}

describe('bookmark editing (MAL-022)', () => {
  it('retargets, nests and un-nests bookmarks', async () => {
    let bytes = await doc(4);
    bytes = await addPdfOutlineTreeEntry(bytes, 'One', 1);
    bytes = await addPdfOutlineTreeEntry(bytes, 'Two', 2);
    let tree = await listPdfOutlineTree(bytes);
    bytes = await setPdfOutlineTreeEntryPage(bytes, tree[1].ref, 4);
    bytes = await nestPdfOutlineTreeEntry(bytes, tree[1].ref, 'in');
    tree = await listPdfOutlineTree(bytes);
    expect(tree.map((e) => [e.title, e.depth, e.pageNumber])).toEqual([['One', 0, 1], ['Two', 1, 4]]);
    bytes = await nestPdfOutlineTreeEntry(bytes, tree[1].ref, 'out');
    expect((await listPdfOutlineTree(bytes)).map((e) => [e.title, e.depth])).toEqual([['One', 0], ['Two', 0]]);
    await expect(nestPdfOutlineTreeEntry(bytes, tree[0].ref, 'in')).rejects.toThrow(/no bookmark above/);
    await expect(nestPdfOutlineTreeEntry(bytes, tree[0].ref, 'out')).rejects.toThrow(/top level/);
  });
});

describe('generatePdfTableOfContents (MAL-022)', () => {
  it('inserts linked contents pages built from bookmarks, keeping page labels', async () => {
    let bytes = await doc(5);
    bytes = await setPdfPageLabelRange(bytes, { startPage: 1, style: 'D', prefix: 'A-', startNumber: 1 });
    bytes = await addPdfOutlineTreeEntry(bytes, 'Introduction', 1);
    bytes = await addPdfOutlineTreeEntry(bytes, 'Methods', 3);
    const tree = await listPdfOutlineTree(bytes);
    bytes = await addPdfOutlineTreeEntry(bytes, 'Sampling', 4, tree[1].ref);
    bytes = await addPdfOutlineTreeEntry(bytes, 'Zürich “notes”', 5);

    const result = await generatePdfTableOfContents(bytes, { title: 'Contents', maxDepth: 2, fontSize: 11 });
    expect([result.tocPages, result.entries, result.skipped, result.substituted]).toEqual([1, 4, 0, 0]);
    const { out, labels } = await texts(result.bytes);
    expect(out).toHaveLength(6);
    expect(out[0]).toMatch(/^Contents Introduction[ .]+A-1 Methods[ .]+A-3 Sampling[ .]+A-4 Zürich “notes”[ .]+A-5$/);
    expect(out[1]).toBe('Body 1');
    expect(labels).toEqual(['i', 'A-1', 'A-2', 'A-3', 'A-4', 'A-5']);

    const pdf = await PDFDocument.load(result.bytes);
    const annots = pdf.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    const targets = annots.asArray().map((ref) => {
      const dest = pdf.context.lookup(ref, PDFDict).lookup(PDFName.of('Dest'), PDFArray).get(0) as PDFRef;
      return pdf.getPages().findIndex((page) => page.ref.toString() === dest.toString()) + 1;
    });
    expect(targets).toEqual([2, 4, 5, 6]);
    // Bookmarks still point at the same content pages.
    expect((await listPdfOutlineTree(result.bytes)).map((e) => e.pageNumber)).toEqual([2, 4, 5, 6]);

    const shallow = await generatePdfTableOfContents(bytes, { title: 'Contents', maxDepth: 1, fontSize: 11 });
    expect(shallow.entries).toBe(3);
  });

  it('paginates long contents and refuses documents without bookmarks', async () => {
    // 80 flat bookmarks written in one pass (adding them one save at a time is slow on CI).
    const pdf = await PDFDocument.load(await doc(80));
    const ctx = pdf.context;
    const rootRef = ctx.register(ctx.obj({ Type: 'Outlines', Count: 80 }));
    const refs = pdf.getPages().map((page, i) => ctx.register(ctx.obj({ Title: PDFHexString.fromText(`Section ${i + 1}`), Parent: rootRef, Dest: [page.ref, PDFName.of('Fit')] })));
    refs.forEach((ref, i) => {
      const item = ctx.lookup(ref, PDFDict);
      if (i) item.set(PDFName.of('Prev'), refs[i - 1]);
      if (i < refs.length - 1) item.set(PDFName.of('Next'), refs[i + 1]);
    });
    const root = ctx.lookup(rootRef, PDFDict);
    root.set(PDFName.of('First'), refs[0]); root.set(PDFName.of('Last'), refs[79]);
    pdf.catalog.set(PDFName.of('Outlines'), rootRef);
    const bytes = await pdf.save();
    const result = await generatePdfTableOfContents(bytes, { title: 'Contents', maxDepth: 1, fontSize: 11 });
    expect(result.tocPages).toBe(3);
    const { out, labels } = await texts(result.bytes);
    expect(out[2]).toContain('Section 80');
    expect(labels?.slice(0, 4)).toEqual(['i', 'ii', 'iii', '1']);
    await expect(generatePdfTableOfContents(await doc(2), { title: 'Contents', maxDepth: 2, fontSize: 11 })).rejects.toThrow(/no bookmarks/);
    // Unsupported page-label structure: refused before anything is inserted.
    const kids = await PDFDocument.load(await addPdfOutlineTreeEntry(await doc(2), 'A', 1));
    kids.catalog.set(PDFName.of('PageLabels'), kids.context.obj({ Kids: [kids.context.obj({ Nums: [0, kids.context.obj({ S: 'D' })] })] }));
    await expect(generatePdfTableOfContents(await kids.save(), { title: 'Contents', maxDepth: 1, fontSize: 11 })).rejects.toThrow(/cannot be updated/);
    // A page-label prefix the font cannot draw does not stop generation.
    let cjk = await addPdfOutlineTreeEntry(await doc(2), 'Intro', 1);
    cjk = await setPdfPageLabelRange(cjk, { startPage: 1, style: 'D', prefix: '第', startNumber: 1 });
    const cjkResult = await generatePdfTableOfContents(cjk, { title: 'Contents', maxDepth: 1, fontSize: 11 });
    expect(cjkResult.entries).toBe(1);
  });
});
