/**
 * MAL-022 generated table of contents: built from the document's bookmarks
 * (the "suitable document structure"), inserted as new pages at the front.
 * Each entry shows the target's page label (or number) and is a real link
 * to that page. Existing page labels are shifted so every original page keeps
 * its label; the contents pages are labelled i, ii, ...
 */
import { PDFArray, PDFDict, PDFDocument, PDFFont, PDFHexString, PDFName, PDFNumber, PDFRef, StandardFonts, rgb } from 'pdf-lib';
import { resolveDestination } from './pdfMerge';
import { listPdfPageLabelRanges, type PdfPageLabelRange } from './pageLabels';
import { listPdfOutlineTree } from './pdfOutlineTree';
import { labelFor } from './pdfStamp';

export interface PdfTocOptions { title: string; maxDepth: number; fontSize: number }
export interface PdfTocResult {
  bytes: Uint8Array; tocPages: number; entries: number;
  /** Bookmarks at the chosen levels without a page in this PDF (e.g. web links). */
  skipped: number;
  /** Entries whose titles had characters the standard font cannot show (shown as ?). */
  substituted: number;
}

const MARGIN = 72;

/** Replaces characters the standard font cannot encode, so a title never fails silently. */
function encodable(font: PDFFont, value: string): { text: string; changed: boolean } {
  let changed = false;
  const text = [...value].map((ch) => {
    try { font.encodeText(ch); return ch; } catch { changed = true; return '?'; }
  }).join('');
  return { text, changed };
}

function fitWidth(font: PDFFont, value: string, size: number, width: number): string {
  if (font.widthOfTextAtSize(value, size) <= width) return value;
  let cut = value;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, size) > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}...`;
}

export async function generatePdfTableOfContents(bytes: Uint8Array, options: PdfTocOptions): Promise<PdfTocResult> {
  const title = options.title.replace(/[\u0000-\u001F]/g, ' ').trim();
  if (!title || title.length > 120) throw new Error('Enter a contents title of up to 120 characters.');
  if (!Number.isInteger(options.maxDepth) || options.maxDepth < 1 || options.maxDepth > 16) throw new Error('Choose 1 to 16 bookmark levels.');
  if (!(options.fontSize >= 6 && options.fontSize <= 24)) throw new Error('Entry size must be between 6 and 24 points.');
  const listed = await listPdfOutlineTree(bytes);
  // Bookmarks with named destinations or GoTo actions are resolved to their page here.
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const pageIndex = new Map(source.getPages().map((page, index) => [page.ref.toString(), index + 1]));
  const outline = listed.map((entry) => {
    if (entry.pageNumber !== null) return entry;
    const [num, gen] = entry.ref.split(' ').map(Number);
    const dict = source.context.lookup(PDFRef.of(num, gen));
    if (!(dict instanceof PDFDict)) return entry;
    const action = dict.get(PDFName.of('A')) ? source.context.lookup(dict.get(PDFName.of('A'))) : undefined;
    const value = dict.get(PDFName.of('Dest')) ?? (action instanceof PDFDict && action.get(PDFName.of('S'))?.toString() === '/GoTo' ? action : undefined);
    const target = resolveDestination(source, value)?.get(0);
    return { ...entry, pageNumber: target instanceof PDFRef ? pageIndex.get(target.toString()) ?? null : null };
  });
  const inDepth = outline.filter((entry) => entry.depth < options.maxDepth);
  const usable = inDepth.filter((entry) => entry.pageNumber !== null);
  if (!outline.length) throw new Error('This PDF has no bookmarks to build a table of contents from. Add bookmarks first.');
  if (!usable.length) throw new Error('None of the bookmarks at the chosen levels points to a page in this PDF.');
  let ranges: PdfPageLabelRange[] | null = null;
  try { ranges = await listPdfPageLabelRanges(bytes); }
  catch {
    // Inserting pages would shift labels we cannot rewrite (for example a /Kids number tree).
    throw new Error('This PDF\'s page labels use a structure that cannot be updated, so contents pages were not inserted.');
  }

  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const first = pdf.getPage(0);
  const box = first.getCropBox();
  const turned = first.getRotation().angle % 180 !== 0;
  const [width, height] = turned ? [box.height, box.width] : [box.width, box.height];
  const size = options.fontSize;
  const line = size * 1.7;
  const titleSize = Math.min(28, size * 1.8);
  const firstPageLines = Math.floor((height - 2 * MARGIN - titleSize * 2) / line);
  const otherPageLines = Math.floor((height - 2 * MARGIN) / line);
  if (firstPageLines < 1) throw new Error('The first page is too small for a table of contents at this size.');
  const tocPages = usable.length <= firstPageLines ? 1 : 1 + Math.ceil((usable.length - firstPageLines) / otherPageLines);
  if (tocPages > 50) throw new Error('The table of contents would need more than 50 pages; choose fewer levels.');

  const originalRefs = pdf.getPages().map((page) => page.ref);
  const pages = Array.from({ length: tocPages }, (_, i) => pdf.insertPage(i, [width, height]));
  let substituted = 0;
  let row = 0;
  pages[0].drawText(encodable(bold, title).text, { x: MARGIN, y: height - MARGIN - titleSize, size: titleSize, font: bold, color: rgb(0.1, 0.1, 0.12) });
  for (const entry of usable) {
    const pageIndex = row < firstPageLines ? 0 : 1 + Math.floor((row - firstPageLines) / otherPageLines);
    const slot = pageIndex === 0 ? row : (row - firstPageLines) % otherPageLines;
    const top = pageIndex === 0 ? height - MARGIN - titleSize * 2 : height - MARGIN;
    const y = top - (slot + 1) * line + (line - size) / 2;
    const page = pages[pageIndex];
    const font = entry.depth === 0 ? bold : regular;
    const number = encodable(regular, ranges ? labelFor(entry.pageNumber!, ranges) : String(entry.pageNumber! + tocPages)).text;
    const numberWidth = regular.widthOfTextAtSize(number, size);
    const indent = MARGIN + entry.depth * size * 1.5;
    const available = width - MARGIN - numberWidth - size * 2 - indent;
    const { text, changed } = encodable(font, entry.title);
    if (changed) substituted++;
    const shown = fitWidth(font, text, size, available);
    page.drawText(shown, { x: indent, y, size, font, color: rgb(0.1, 0.1, 0.12) });
    const dotsStart = indent + font.widthOfTextAtSize(shown, size) + size / 2;
    const dotsEnd = width - MARGIN - numberWidth - size / 2;
    const leader = regular.widthOfTextAtSize('. ', size);
    if (dotsEnd > dotsStart + leader) page.drawText('. '.repeat(Math.floor((dotsEnd - dotsStart) / leader)).trimEnd(), { x: dotsStart, y, size, font: regular, color: rgb(0.55, 0.55, 0.6) });
    page.drawText(number, { x: width - MARGIN - numberWidth, y, size, font: regular, color: rgb(0.1, 0.1, 0.12) });
    const link = pdf.context.register(pdf.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [indent, y - size * 0.3, width - MARGIN, y + size], Border: [0, 0, 0], F: 4,
      Contents: entry.title.slice(0, 200),
      Dest: pdf.context.obj([originalRefs[entry.pageNumber! - 1], PDFName.of('Fit')]),
    }));
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (annots) annots.push(link); else page.node.set(PDFName.of('Annots'), pdf.context.obj([link]));
    row++;
  }

  // Keep every original page's label; the contents pages read i, ii, ...
  if (ranges) {
    const nums: unknown[] = [0, pdf.context.obj({ S: PDFName.of('r') })];
    const source = ranges.length ? ranges : [{ startPage: 1, style: 'D' as const, prefix: '', startNumber: 1 }];
    for (const range of source) {
      const dict = pdf.context.obj({}) as PDFDict;
      if (range.style !== 'none') dict.set(PDFName.of('S'), PDFName.of(range.style));
      if (range.prefix) dict.set(PDFName.of('P'), PDFHexString.fromText(range.prefix));
      if (range.startNumber !== 1) dict.set(PDFName.of('St'), PDFNumber.of(range.startNumber));
      nums.push(range.startPage - 1 + tocPages, dict);
    }
    pdf.catalog.set(PDFName.of('PageLabels'), pdf.context.obj({ Nums: nums as never }));
  }
  const out = Uint8Array.from(await pdf.save({ useObjectStreams: false }));
  return { bytes: out, tocPages, entries: usable.length, skipped: inDepth.length - usable.length, substituted };
}
