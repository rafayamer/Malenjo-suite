/**
 * MAL-002 split modes that complement splitPdfByPageCount (page count) and
 * splitPdfByChapters (bookmarks): page ranges and a size threshold. Each part
 * is a standalone PDF in a ZIP; the source is never rewritten. Signed,
 * certified and interactive-form documents are refused, as in the other modes.
 */
import { zipSync } from 'fflate';
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';
import { annotationsOf, destinationArray, detachLinkTargets, type LinkTarget } from './pdfMerge';
import { refusesSignedOrInteractive } from './splitByPageCount';

export const PDF_RANGE_SPLIT_MAX_PARTS = 200;
export const PDF_SIZE_SPLIT_MAX_PAGES = 500;
export const PDF_SIZE_SPLIT_MAX_INPUT_BYTES = 128 * 1024 * 1024;
/** Default cumulative output budget; callers pass a smaller one (the desktop writer's) when needed. */
export const PDF_SPLIT_PARTS_MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

/** Tracks retained output and refuses before a split grows past its budget. */
function outputBudget(maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > PDF_SPLIT_PARTS_MAX_OUTPUT_BYTES) {
    throw new Error('Split output budget must be between 1 KB and 256 MB.');
  }
  let used = 0;
  return (data: Uint8Array) => {
    used += data.length + 128; // per-entry ZIP header allowance
    if (used > maxBytes) {
      throw new Error(`The split parts would exceed ${Math.round(maxBytes / (1024 * 1024))} MB together. Use fewer or non-overlapping ranges, or split a smaller document.`);
    }
    return data;
  };
}

export interface PdfSplitPart { filename: string; pages: number[]; bytes: number }
export interface PdfSplitResult { archive: Uint8Array; parts: PdfSplitPart[]; sourcePageCount: number }
export interface PdfSizeSplitResult extends PdfSplitResult {
  /** Pages that alone exceed the size limit; each became its own part. */
  oversizedPages: number[];
}

/** Parses "1-3, 5, 8-" (open end = last page) into one page group per part. */
export function parsePageRanges(text: string, pageCount: number): number[][] {
  const pieces = text.split(',').map((piece) => piece.trim()).filter(Boolean);
  if (!pieces.length) throw new Error('Enter at least one page or range, for example 1-3, 5, 8-.');
  if (pieces.length > PDF_RANGE_SPLIT_MAX_PARTS) throw new Error(`Split supports up to ${PDF_RANGE_SPLIT_MAX_PARTS} ranges.`);
  return pieces.map((piece) => {
    const match = /^(\d+)\s*(?:-\s*(\d*))?$/.exec(piece);
    if (!match) throw new Error(`“${piece}” is not a page or range. Use forms like 4 or 2-7 or 8-.`);
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : match[2] === '' ? pageCount : Number(match[2]);
    if (start < 1 || end > pageCount || start > end) {
      throw new Error(`Range “${piece}” is outside pages 1–${pageCount} or runs backwards.`);
    }
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  });
}

/** The loaded source with its internal links detached (page index instead of page ref). */
interface SplitSource { pdf: PDFDocument; links: LinkTarget[] }

async function loadForSplit(bytes: Uint8Array): Promise<SplitSource> {
  let pdf: PDFDocument;
  try { pdf = await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch { throw new Error('This file could not be split because it is encrypted, invalid or damaged.'); }
  refusesSignedOrInteractive(pdf);
  // Copying would otherwise clone link targets as orphan pages, and named
  // destinations have no /Dests in a part; both are resolved here.
  return { pdf, links: detachLinkTargets(pdf) };
}

/**
 * One part as a standalone PDF. Internal links to pages in the part point at
 * their new page; links to pages outside the part are removed (they could
 * not go anywhere in this file).
 */
async function partBytes(source: SplitSource, pages: number[]): Promise<Uint8Array> {
  const output = await PDFDocument.create();
  const copied = await output.copyPages(source.pdf, pages.map((page) => page - 1));
  copied.forEach((page) => output.addPage(page));
  const position = new Map(pages.map((page, index) => [page - 1, index]));
  const removals = new Map<number, number[]>();
  for (const link of source.links) {
    const at = position.get(link.page);
    if (at === undefined) continue;
    const target = position.get(link.target);
    if (target === undefined) { removals.set(at, [...(removals.get(at) ?? []), link.annot]); continue; }
    const annot = annotationsOf(output, at)[link.annot];
    const dest = annot ? destinationArray(output, annot, link.viaAction) : undefined;
    dest?.set(0, output.getPage(target).ref);
  }
  for (const [at, indexes] of removals) {
    const annots = output.getPage(at).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    for (const index of [...new Set(indexes)].sort((a, b) => b - a)) annots?.remove(index);
  }
  return Uint8Array.from(await output.save({ useObjectStreams: true }));
}

function label(pages: number[]): string {
  return pages.length === 1 ? `page-${pages[0]}` : `pages-${pages[0]}-${pages[pages.length - 1]}`;
}

function archive(parts: { pages: number[]; data: Uint8Array }[]): { archive: Uint8Array; parts: PdfSplitPart[] } {
  const entries: Record<string, Uint8Array> = {};
  const listed = parts.map((part, index) => {
    const filename = `part-${String(index + 1).padStart(3, '0')}-${label(part.pages)}.pdf`;
    entries[filename] = part.data;
    return { filename, pages: part.pages, bytes: part.data.length };
  });
  return { archive: zipSync(entries, { level: 0 }), parts: listed };
}

export async function splitPdfByRanges(bytes: Uint8Array, rangeText: string,
  maxOutputBytes = PDF_SPLIT_PARTS_MAX_OUTPUT_BYTES): Promise<PdfSplitResult> {
  const retain = outputBudget(maxOutputBytes);
  const source = await loadForSplit(bytes);
  const groups = parsePageRanges(rangeText, source.pdf.getPageCount());
  const parts = [];
  for (const pages of groups) parts.push({ pages, data: retain(await partBytes(source, pages)) });
  return { ...archive(parts), sourcePageCount: source.pdf.getPageCount() };
}

/**
 * Groups consecutive pages into parts no larger than maxBytes. Each page is
 * measured once on its own, pages are packed greedily by those sizes, and
 * every part is then saved for real; a part that still exceeds the limit is
 * halved until it fits (shared fonts make single-page sizes an overestimate,
 * so parts may be smaller than strictly necessary but never over the limit).
 * A page that alone exceeds the limit becomes its own part and is reported.
 */
export async function splitPdfBySize(bytes: Uint8Array, maxBytes: number,
  maxOutputBytes = PDF_SPLIT_PARTS_MAX_OUTPUT_BYTES): Promise<PdfSizeSplitResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 10 * 1024) throw new Error('Choose a size limit of at least 10 KB.');
  // Single-page measurements and the saved parts each stay within the budget.
  const measure = outputBudget(maxOutputBytes);
  const retain = outputBudget(maxOutputBytes);
  if (bytes.length > PDF_SIZE_SPLIT_MAX_INPUT_BYTES) throw new Error('Size-based splitting accepts PDFs up to 128 MB.');
  const source = await loadForSplit(bytes);
  const pageCount = source.pdf.getPageCount();
  if (pageCount > PDF_SIZE_SPLIT_MAX_PAGES) throw new Error(`Size-based splitting supports up to ${PDF_SIZE_SPLIT_MAX_PAGES} pages.`);

  const alone: Uint8Array[] = [];
  for (let page = 1; page <= pageCount; page++) alone.push(measure(await partBytes(source, [page])));
  const oversizedPages = alone.flatMap((data, index) => data.length > maxBytes ? [index + 1] : []);

  // Greedy packing by single-page sizes; oversized pages stand alone.
  const groups: number[][] = [];
  let current: number[] = []; let estimate = 0;
  for (let page = 1; page <= pageCount; page++) {
    const size = alone[page - 1].length;
    if (oversizedPages.includes(page)) {
      if (current.length) groups.push(current);
      groups.push([page]); current = []; estimate = 0; continue;
    }
    if (current.length && estimate + size > maxBytes) { groups.push(current); current = []; estimate = 0; }
    current.push(page); estimate += size;
  }
  if (current.length) groups.push(current);

  // Save each part for real; halve any that still exceeds the limit.
  const parts: { pages: number[]; data: Uint8Array }[] = [];
  const pending = [...groups];
  while (pending.length) {
    const pages = pending.shift()!;
    const data = pages.length === 1 ? alone[pages[0] - 1] : await partBytes(source, pages);
    if (data.length <= maxBytes || pages.length === 1) { parts.push({ pages, data: retain(data) }); continue; }
    const middle = Math.ceil(pages.length / 2);
    pending.unshift(pages.slice(0, middle), pages.slice(middle));
  }
  return { ...archive(parts), sourcePageCount: pageCount, oversizedPages };
}
