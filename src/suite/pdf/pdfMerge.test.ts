import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, StandardFonts } from 'pdf-lib';
import { mergePdfs } from './pdfMerge';
import { addPdfOutlineTreeEntry, listPdfOutlineTree } from './pdfOutlineTree';

async function sourceDoc(label: string, pages: number, opts: { title?: string; link?: [number, number]; note?: number } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) pdf.addPage([400, 400]).drawText(`${label} ${i}`, { x: 20, y: 360, font, size: 14 });
  if (opts.title) { pdf.setTitle(opts.title); pdf.setAuthor(label + ' author'); }
  if (opts.link) {
    const [from, to] = opts.link;
    const target = pdf.getPage(to - 1);
    const annot = pdf.context.register(pdf.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 40], Border: [0, 0, 0],
      Dest: pdf.context.obj([target.ref, PDFName.of('Fit')]),
    }));
    pdf.getPage(from - 1).node.set(PDFName.of('Annots'), pdf.context.obj([annot]));
  }
  if (opts.note) {
    const annot = pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [50, 50, 70, 70], Contents: 'note' }));
    pdf.getPage(opts.note - 1).node.set(PDFName.of('Annots'), pdf.context.obj([annot]));
  }
  return pdf.save();
}

async function texts(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((page) => page.ref);
}

function linkTargetIndex(pdf: PDFDocument, pageIndex: number): number {
  const annots = pdf.getPage(pageIndex).node.lookup(PDFName.of('Annots'), PDFArray);
  const link = pdf.context.lookup(annots.get(0), PDFDict);
  const dest = link.lookup(PDFName.of('Dest'), PDFArray);
  const ref = dest.get(0) as PDFRef;
  return pdf.getPages().findIndex((page) => page.ref.toString() === ref.toString());
}

describe('mergePdfs (MAL-001)', () => {
  it('merges in the given order, retargets bookmarks and keeps internal links on the merged pages', async () => {
    let a = await sourceDoc('A', 3, { title: 'Alpha report', link: [1, 3] });
    a = await addPdfOutlineTreeEntry(a, 'A chapter', 2);
    let b = await sourceDoc('B', 2);
    b = await addPdfOutlineTreeEntry(b, 'B start', 1);
    const tree = await listPdfOutlineTree(b);
    b = await addPdfOutlineTreeEntry(b, 'B nested', 2, tree[0].ref);
    const c = await sourceDoc('C', 1, { note: 1 });

    const result = await mergePdfs(
      [{ name: 'b.pdf', bytes: b }, { name: 'a.pdf', bytes: a }, { name: 'c.pdf', bytes: c }],
      { bookmarks: 'keep', metadata: 'first' },
    );
    expect(result.pageCount).toBe(6);
    expect(result.sources.map((s) => [s.name, s.firstPage])).toEqual([['b.pdf', 1], ['a.pdf', 3], ['c.pdf', 6]]);

    const merged = await PDFDocument.load(result.bytes);
    expect(merged.getPageCount()).toBe(6);
    // A's link on its page 1 (merged page 3) still targets A's page 3 (merged page 5).
    expect(linkTargetIndex(merged, 2)).toBe(4);
    // No orphan page copies were written (pdf-lib clones link targets otherwise).
    const pageObjects = merged.context.enumerateIndirectObjects()
      .filter(([, obj]) => obj instanceof PDFDict && obj.get(PDFName.of('Type'))?.toString() === '/Page').length;
    expect(pageObjects).toBe(6);
    // C's sticky note survives.
    expect(merged.getPage(5).node.lookup(PDFName.of('Annots'), PDFArray).size()).toBe(1);

    const outline = await listPdfOutlineTree(result.bytes);
    expect(outline.map((e) => [e.title, e.pageNumber, e.depth])).toEqual([
      ['B start', 1, 0], ['B nested', 2, 1], ['A chapter', 4, 0],
    ]);
    // Metadata comes from the FIRST file in the chosen order (b.pdf has none).
    expect(merged.getTitle()).toBeUndefined();
  });

  it('per-file bookmarks group each file, and metadata can come from the first file or none', async () => {
    let a = await sourceDoc('A', 2, { title: 'Alpha report' });
    a = await addPdfOutlineTreeEntry(a, 'A two', 2);
    const b = await sourceDoc('B', 1);
    const grouped = await mergePdfs([{ name: 'Alpha.pdf', bytes: a }, { name: 'Bravo.pdf', bytes: b }],
      { bookmarks: 'per-file', metadata: 'first' });
    expect((await listPdfOutlineTree(grouped.bytes)).map((e) => [e.title, e.pageNumber, e.depth])).toEqual([
      ['Alpha', 1, 0], ['A two', 2, 1], ['Bravo', 3, 0],
    ]);
    const doc = await PDFDocument.load(grouped.bytes);
    expect(doc.getTitle()).toBe('Alpha report');
    expect(doc.getAuthor()).toBe('A author');

    const plain = await mergePdfs([{ name: 'Alpha.pdf', bytes: a }, { name: 'Bravo.pdf', bytes: b }],
      { bookmarks: 'none', metadata: 'none' });
    expect(await listPdfOutlineTree(plain.bytes)).toEqual([]);
    const plainDoc = await PDFDocument.load(plain.bytes);
    expect(plainDoc.getTitle()).toBeUndefined();
    expect((await texts(plain.bytes)).length).toBe(3);
  });

  it('refuses fewer than two files and explains encrypted or invalid inputs', async () => {
    const a = await sourceDoc('A', 1);
    await expect(mergePdfs([{ name: 'a.pdf', bytes: a }], { bookmarks: 'keep', metadata: 'first' }))
      .rejects.toThrow(/at least two/);
    await expect(mergePdfs([{ name: 'a.pdf', bytes: a }, { name: 'bad.pdf', bytes: new TextEncoder().encode('%PDF-garbage') }],
      { bookmarks: 'keep', metadata: 'first' })).rejects.toThrow(/bad\.pdf/);
  });
});
