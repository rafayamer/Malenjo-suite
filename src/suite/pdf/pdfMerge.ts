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
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFObject, PDFRef, PDFString } from 'pdf-lib';

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
  /** Largest merged PDF that can be saved here (the desktop writer accepts 32 MB). */
  maxOutputBytes?: number;
}
export interface PdfMergeResult {
  bytes: Uint8Array;
  pageCount: number;
  bookmarkCount: number;
  sources: { name: string; firstPage: number; pageCount: number }[];
  /** Bookmarks without a resolvable page destination (e.g. web links) were pointed at their file's first page. */
  retargetedBookmarks: number;
}

interface OutlineNode { title: string; page: number; children: OutlineNode[] }

/** A link annotation whose destination array points at a page of the same file. */
export interface LinkTarget { page: number; annot: number; viaAction: boolean; target: number }

const MAX_NAME_TREE_NODES = 10000;

/** Looks a named destination up in the catalog's /Dests dictionary or /Names /Dests tree. */
function namedDestination(pdf: PDFDocument, name: PDFObject): PDFObject | undefined {
  if (name instanceof PDFName) {
    return pdf.catalog.lookupMaybe(PDFName.of('Dests'), PDFDict)?.get(PDFName.of(name.decodeText()));
  }
  if (!(name instanceof PDFString || name instanceof PDFHexString)) return undefined;
  const wanted = name.decodeText();
  const root = pdf.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)?.lookupMaybe(PDFName.of('Dests'), PDFDict);
  const pending = root ? [root] : [];
  const seen = new Set<PDFDict>();
  while (pending.length && seen.size < MAX_NAME_TREE_NODES) {
    const node = pending.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    const names = node.lookupMaybe(PDFName.of('Names'), PDFArray);
    for (let i = 0; names && i + 1 < names.size(); i += 2) {
      const key = names.lookup(i);
      if ((key instanceof PDFString || key instanceof PDFHexString) && key.decodeText() === wanted) return names.get(i + 1);
    }
    const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
    kids?.asArray().forEach((kid) => { const dict = pdf.context.lookupMaybe(kid, PDFDict); if (dict) pending.push(dict); });
  }
  return undefined;
}

/** Resolves a destination value (array, reference, name or string) to its explicit array. */
function resolveDestination(pdf: PDFDocument, value: PDFObject | undefined): PDFArray | undefined {
  // Follow references, /D dictionaries and names until an array is reached, with cycle protection.
  const seen = new Set<PDFObject>();
  while (value && !seen.has(value) && seen.size < 32) {
    if (value instanceof PDFArray) return value;
    seen.add(value);
    if (value instanceof PDFRef) value = pdf.context.lookup(value);
    else if (value instanceof PDFDict) value = value.get(PDFName.of('D'));
    else value = namedDestination(pdf, value);
  }
  return undefined;
}

/** The holder dictionary and key of an annotation's or outline item's GoTo destination. */
function destinationSlot(annot: PDFDict, viaAction: boolean): { holder: PDFDict; key: PDFName } | undefined {
  if (!viaAction) return annot.has(PDFName.of('Dest')) ? { holder: annot, key: PDFName.of('Dest') } : undefined;
  const action = annot.lookupMaybe(PDFName.of('A'), PDFDict);
  if (!action || action.get(PDFName.of('S'))?.toString() !== '/GoTo') return undefined;
  return { holder: action, key: PDFName.of('D') };
}

export function destinationArray(pdf: PDFDocument, annot: PDFDict, viaAction: boolean): PDFArray | undefined {
  const slot = destinationSlot(annot, viaAction);
  const value = slot?.holder.get(slot.key);
  if (value instanceof PDFArray) return value;
  return value instanceof PDFRef ? pdf.context.lookupMaybe(value, PDFArray) : undefined;
}

/** Annotation dictionaries by position (undefined where unresolvable, so indexes stay aligned). */
export function annotationsOf(pdf: PDFDocument, pageIndex: number): (PDFDict | undefined)[] {
  const annots = pdf.getPage(pageIndex).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots) return [];
  return annots.asArray().map((item) =>
    item instanceof PDFRef ? pdf.context.lookupMaybe(item, PDFDict) : item instanceof PDFDict ? item : undefined);
}

/**
 * Replace internal link page refs with page indexes so copying does not clone
 * target pages. Also used by the range and size splits (pdfSplitModes).
 *
 * All targets are resolved first, then each link gets its own annotation
 * dictionary and its own GoTo action, so links that share an annotation or
 * action dictionary (or a named destination) never overwrite each other.
 */
export function detachLinkTargets(pdf: PDFDocument): LinkTarget[] {
  const pageIndex = new Map(pdf.getPages().map((page, index) => [page.ref.toString(), index]));
  const found: (LinkTarget & { rest: PDFObject[] })[] = [];
  pdf.getPages().forEach((_, page) => {
    annotationsOf(pdf, page).forEach((annot, index) => {
      if (!annot) return;
      for (const viaAction of [false, true]) {
        const slot = destinationSlot(annot, viaAction);
        if (!slot) continue;
        // Named destinations are resolved here: the output file has no /Dests for them.
        const resolved = resolveDestination(pdf, slot.holder.get(slot.key));
        const first = resolved?.get(0);
        const target = first instanceof PDFRef ? pageIndex.get(first.toString()) : undefined;
        if (resolved && target !== undefined) found.push({ page, annot: index, viaAction, target, rest: resolved.asArray().slice(1) });
      }
    });
  });
  const owned = new Set<PDFDict>();
  const unique = new Map<string, PDFDict>();
  for (const link of found) {
    const key = `${link.page}:${link.annot}`;
    let annot = unique.get(key);
    if (!annot) {
      annot = annotationsOf(pdf, link.page)[link.annot]!;
      if (owned.has(annot)) {
        // The same annotation dictionary appears on another page or slot: give this slot its own copy.
        annot = annot.clone(pdf.context);
        pdf.getPage(link.page).node.lookup(PDFName.of('Annots'), PDFArray).set(link.annot, pdf.context.register(annot));
      }
      owned.add(annot);
      unique.set(key, annot);
    }
    const destination = pdf.context.obj([PDFNumber.of(link.target), ...link.rest]);
    if (link.viaAction) {
      const action = annot.lookup(PDFName.of('A'), PDFDict).clone(pdf.context);
      action.set(PDFName.of('D'), destination);
      annot.set(PDFName.of('A'), action);
    } else {
      annot.set(PDFName.of('Dest'), destination);
    }
  }
  return found.map(({ page, annot, viaAction, target }) => ({ page, annot, viaAction, target }));
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

/**
 * Reads a source's outline from the already-loaded document (no separate
 * size-limited reader), resolving explicit and named destinations. Items
 * without a page destination point at the file's first page and are counted.
 */
function sourceOutline(pdf: PDFDocument, firstPage: number): { nodes: OutlineNode[]; retargeted: number } {
  const pageIndex = new Map(pdf.getPages().map((page, index) => [page.ref.toString(), index]));
  const root = pdf.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  const seen = new Set<PDFDict>();
  let retargeted = 0;
  const read = (first: PDFDict | undefined, depth: number): OutlineNode[] => {
    const nodes: OutlineNode[] = [];
    for (let item = first; item; item = item.lookupMaybe(PDFName.of('Next'), PDFDict)) {
      if (seen.has(item)) throw new Error('A source PDF has a looping bookmark tree; merge without bookmarks.');
      seen.add(item);
      if (seen.size > MAX_OUTLINE_ENTRIES || depth > MAX_OUTLINE_DEPTH) {
        throw new Error('A source PDF has more than 1,000 bookmarks or 16 levels; merge without bookmarks.');
      }
      const raw = item.lookupMaybe(PDFName.of('Title'), PDFString, PDFHexString);
      const dest = resolveDestination(pdf, item.get(PDFName.of('Dest')) ?? (destinationSlot(item, true) ? item.lookupMaybe(PDFName.of('A'), PDFDict) : undefined));
      const target = dest?.get(0);
      const local = target instanceof PDFRef ? pageIndex.get(target.toString()) : undefined;
      if (local === undefined) retargeted++;
      nodes.push({ title: (raw?.decodeText() ?? '').slice(0, 500) || 'Untitled', page: firstPage + (local ?? 0),
        children: read(item.lookupMaybe(PDFName.of('First'), PDFDict), depth + 1) });
    }
    return nodes;
  };
  return { nodes: read(root?.lookupMaybe(PDFName.of('First'), PDFDict), 1), retargeted };
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
    // Read bookmarks before link targets are rewritten for copying.
    const bookmarks = options.bookmarks === 'none' ? null : sourceOutline(doc, firstPage);
    const links = detachLinkTargets(doc);
    const copied = await output.copyPages(doc, doc.getPageIndices());
    copied.forEach((page) => output.addPage(page));
    reattachLinkTargets(output, firstPage - 1, links);
    placed.push({ name: source.name, firstPage, pageCount });

    if (bookmarks) {
      const { nodes, retargeted } = bookmarks;
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
  const limit = options.maxOutputBytes ?? PDF_MERGE_MAX_TOTAL_BYTES;
  if (bytes.length > limit) {
    throw new Error(`The merged PDF would be ${(bytes.length / (1024 * 1024)).toFixed(1)} MB, more than the ${Math.round(limit / (1024 * 1024))} MB that can be saved here. Merge fewer or smaller files.`);
  }
  return { bytes, pageCount: output.getPageCount(), bookmarkCount: countNodes(outline), sources: placed, retargetedBookmarks };
}
