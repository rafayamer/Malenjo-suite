/**
 * MAL-001 Merge PDF files: combine several PDFs in a user-selected order,
 * preserving pages, supported annotations, bookmarks and metadata according
 * to the chosen merge options.
 *
 * Internal links: pdf-lib's copier follows a link's page reference and copies
 * the target page a second time as an orphan object, leaving the link dead.
 * Before copying, each internal link target in the (in-memory) source is
 * swapped for its page index; after the pages are added, it is pointed at the
 * real merged page. Bookmarks are rebuilt from each source's outline tree and
 * retargeted to the merged page numbers.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef } from 'pdf-lib';
import { listPdfOutlineTree } from './pdfOutlineTree';

export const PDF_MERGE_MAX_SOURCES = 50;
export const PDF_MERGE_MAX_TOTAL_BYTES = 256 * 1024 * 1024;
export const PDF_MERGE_MAX_PAGES = 2000;
const MAX_OUTLINE_ENTRIES = 1000;
const MAX_OUTLINE_DEPTH = 16;

export interface PdfMergeSource { name: string; bytes: Uint8Array }
export interface PdfMergeOptions {
  /** keep: each file's bookmarks in place; per-file: one entry per file holding its bookmarks; none. */
  bookmarks: 'keep' | 'per-file' | 'none';
  /** first: title/author/subject/keywords from the first file; none: no document info. */
  metadata: 'first' | 'none';
}
export interface PdfMergeResult {
  bytes: Uint8Array;
  pageCount: number;
  bookmarkCount: number;
  sources: { name: string; firstPage: number; pageCount: number }[];
  /** Bookmarks whose destination could not be resolved (named destinations) were pointed at their file's first page. */
  retargetedBookmarks: number;
}

interface OutlineNode { title: string; page: number; children: OutlineNode[] }

/** A link annotation whose destination array points at a page of the same file. */
interface LinkTarget { page: number; annot: number; viaAction: boolean; target: number }

function destinationArray(pdf: PDFDocument, annot: PDFDict, viaAction: boolean): PDFArray | undefined {
  const holder = viaAction ? annot.lookupMaybe(PDFName.of('A'), PDFDict) : annot;
  if (!holder) return undefined;
  const value = holder.get(PDFName.of(viaAction ? 'D' : 'Dest'));
  if (value instanceof PDFArray) return value;
  return value instanceof PDFRef ? pdf.context.lookupMaybe(value, PDFArray) : undefined;
}

/** Annotation dictionaries by position (undefined where unresolvable, so indexes stay aligned). */
function annotationsOf(pdf: PDFDocument, pageIndex: number): (PDFDict | undefined)[] {
  const annots = pdf.getPage(pageIndex).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots) return [];
  return annots.asArray().map((item) =>
    item instanceof PDFRef ? pdf.context.lookupMaybe(item, PDFDict) : item instanceof PDFDict ? item : undefined);
}

/** Replace internal link page refs with page indexes so copying does not clone target pages. */
function detachLinkTargets(pdf: PDFDocument): LinkTarget[] {
  const pageIndex = new Map(pdf.getPages().map((page, index) => [page.ref.toString(), index]));
  const found: LinkTarget[] = [];
  pdf.getPages().forEach((_, page) => {
    annotationsOf(pdf, page).forEach((annot, index) => {
      if (!annot) return;
      for (const viaAction of [false, true]) {
        const dest = destinationArray(pdf, annot, viaAction);
        const first = dest?.get(0);
        const target = first instanceof PDFRef ? pageIndex.get(first.toString()) : undefined;
        if (dest && target !== undefined) {
          dest.set(0, PDFNumber.of(target));
          found.push({ page, annot: index, viaAction, target });
        }
      }
    });
  });
  return found;
}

function reattachLinkTargets(output: PDFDocument, firstPageIndex: number, links: LinkTarget[]): void {
  const pages = output.getPages();
  for (const link of links) {
    const annot = annotationsOf(output, firstPageIndex + link.page)[link.annot];
    const dest = annot ? destinationArray(output, annot, link.viaAction) : undefined;
    if (dest) dest.set(0, pages[firstPageIndex + link.target].ref);
  }
}

function displayName(name: string): string {
  const base = name.replace(/\.pdf$/i, '').trim();
  return (base || 'Document').slice(0, 200);
}

function countNodes(nodes: OutlineNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0);
}

function depthOf(nodes: OutlineNode[]): number {
  return nodes.reduce((max, node) => Math.max(max, 1 + depthOf(node.children)), 0);
}

/** Writes a fresh /Outlines tree with correct First/Last/Prev/Next/Parent/Count links. */
function writeOutline(pdf: PDFDocument, nodes: OutlineNode[]): void {
  if (!nodes.length) return;
  const pages = pdf.getPages();
  const root = pdf.context.obj({ Type: PDFName.of('Outlines') });
  const rootRef = pdf.context.register(root);
  const build = (items: OutlineNode[], parent: PDFDict, parentRef: PDFRef): number => {
    const refs = items.map((item) => {
      const dict = pdf.context.obj({
        Title: PDFHexString.fromText(item.title),
        Parent: parentRef,
        Dest: pdf.context.obj([pages[item.page - 1].ref, PDFName.of('Fit')]),
      });
      return { item, dict, ref: pdf.context.register(dict) };
    });
    let visible = 0;
    refs.forEach(({ item, dict, ref }, index) => {
      if (index > 0) dict.set(PDFName.of('Prev'), refs[index - 1].ref);
      if (index < refs.length - 1) dict.set(PDFName.of('Next'), refs[index + 1].ref);
      const descendants = build(item.children, dict, ref);
      if (item.children.length) dict.set(PDFName.of('Count'), PDFNumber.of(descendants));
      visible += 1 + descendants;
    });
    if (refs.length) {
      parent.set(PDFName.of('First'), refs[0].ref);
      parent.set(PDFName.of('Last'), refs[refs.length - 1].ref);
    }
    return visible;
  };
  const total = build(nodes, root, rootRef);
  root.set(PDFName.of('Count'), PDFNumber.of(total));
  pdf.catalog.set(PDFName.of('Outlines'), rootRef);
}

async function sourceOutline(bytes: Uint8Array, firstPage: number, pageCount: number):
  Promise<{ nodes: OutlineNode[]; retargeted: number }> {
  let entries;
  try { entries = await listPdfOutlineTree(bytes); } catch { return { nodes: [], retargeted: 0 }; }
  const byRef = new Map<string, OutlineNode>();
  const roots: OutlineNode[] = [];
  let retargeted = 0;
  for (const entry of entries) {
    const local = entry.pageNumber && entry.pageNumber <= pageCount ? entry.pageNumber : null;
    if (local === null) retargeted++;
    const node: OutlineNode = { title: entry.title, page: firstPage + (local ?? 1) - 1, children: [] };
    byRef.set(entry.ref, node);
    const parent = entry.parentRef ? byRef.get(entry.parentRef) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return { nodes: roots, retargeted };
}

export async function mergePdfs(sources: PdfMergeSource[], options: PdfMergeOptions): Promise<PdfMergeResult> {
  if (sources.length < 2) throw new Error('Choose at least two PDFs to merge.');
  if (sources.length > PDF_MERGE_MAX_SOURCES) throw new Error(`Merge supports up to ${PDF_MERGE_MAX_SOURCES} files at once.`);
  const totalBytes = sources.reduce((sum, source) => sum + source.bytes.length, 0);
  if (totalBytes > PDF_MERGE_MAX_TOTAL_BYTES) throw new Error('The selected PDFs are larger than 256 MB together.');

  const output = await PDFDocument.create();
  const outline: OutlineNode[] = [];
  const placed: PdfMergeResult['sources'] = [];
  let retargetedBookmarks = 0;
  let firstDoc: PDFDocument | null = null;

  for (const source of sources) {
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(source.bytes, { updateMetadata: false });
    } catch (error) {
      const encrypted = error instanceof Error && /encrypted/i.test(error.message);
      throw new Error(encrypted
        ? `“${source.name}” is encrypted. Remove its password first, then merge the unlocked copy.`
        : `“${source.name}” is not a valid PDF, or it is too damaged to merge.`);
    }
    firstDoc ??= doc;
    const pageCount = doc.getPageCount();
    if (output.getPageCount() + pageCount > PDF_MERGE_MAX_PAGES) {
      throw new Error(`Merged result would exceed ${PDF_MERGE_MAX_PAGES} pages.`);
    }
    const firstPage = output.getPageCount() + 1;
    const links = detachLinkTargets(doc);
    const copied = await output.copyPages(doc, doc.getPageIndices());
    copied.forEach((page) => output.addPage(page));
    reattachLinkTargets(output, firstPage - 1, links);
    placed.push({ name: source.name, firstPage, pageCount });

    if (options.bookmarks !== 'none') {
      const { nodes, retargeted } = await sourceOutline(source.bytes, firstPage, pageCount);
      retargetedBookmarks += retargeted;
      if (options.bookmarks === 'per-file') {
        outline.push({ title: displayName(source.name), page: firstPage, children: nodes });
      } else {
        outline.push(...nodes);
      }
    }
  }

  if (countNodes(outline) > MAX_OUTLINE_ENTRIES || depthOf(outline) > MAX_OUTLINE_DEPTH) {
    throw new Error('Merged bookmarks would exceed 1,000 entries or 16 levels; merge without bookmarks or with fewer files.');
  }
  writeOutline(output, outline);

  if (options.metadata === 'first' && firstDoc) {
    const title = firstDoc.getTitle(); if (title) output.setTitle(title);
    const author = firstDoc.getAuthor(); if (author) output.setAuthor(author);
    const subject = firstDoc.getSubject(); if (subject) output.setSubject(subject);
    const keywords = firstDoc.getKeywords(); if (keywords) output.setKeywords(keywords.split(/\s*[,;]\s*|\s+/).filter(Boolean));
  }
  output.setProducer('MALENJO');

  const bytes = Uint8Array.from(await output.save({ useObjectStreams: false }));
  return { bytes, pageCount: output.getPageCount(), bookmarkCount: countNodes(outline), sources: placed, retargetedBookmarks };
}
