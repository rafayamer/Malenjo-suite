/**
 * Permanent redaction (MAL-063). The marked areas are removed from the page content itself (text, images, vector
 * graphics, form XObjects, annotations and form fields there), covered with an opaque box, and — when asked — the
 * removed words are also scrubbed from the places that would otherwise still give them away: document information,
 * XMP metadata, bookmarks, comments, form values, link addresses and tagged-structure text. Objects nothing refers to
 * any more are deleted before saving, so the released file holds no copy of what was redacted.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFStream, PDFString, StandardFonts, type PDFObject } from 'pdf-lib';
import { IDENTITY, pageContentBytes, type Box, type Matrix } from '../content/contentModel';
import { removeUnreachableObjects } from './pdfGarbage';
import { boxOf, copyDict, decodedStream, overlaps, pageGlyphs, walkContent, type PageGlyph, type RedactStats, type WalkContext } from './redactWalker';
import type { ImageDecoder } from './redactImages';

export interface RedactionMark { pageNumber: number; box: Box }
export interface RedactOptions {
  marks: RedactionMark[];
  /** Colour of the box drawn over each area (#rrggbb); black by default. */
  fill?: string;
  /** Optional words printed in each box, e.g. "REDACTED" or an exemption code. */
  label?: string;
  /** Also remove the redacted words from metadata, bookmarks, comments, form values and tags. */
  scrubElsewhere?: boolean;
  decodeImage?: ImageDecoder;
}
export interface RedactReport extends RedactStats { pages: number; areas: number; annotations: number; fields: number; elsewhere: string[] }

const N = PDFName.of;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));
const MAX_MARKS = 5000;

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  if (!(bytes instanceof Uint8Array) || bytes.length < 5 || bytes.length > 256 * 1024 * 1024) throw new Error('Redaction handles PDFs up to 256 MB.');
  try { return await PDFDocument.load(bytes, { updateMetadata: false }); } catch (error) {
    if (/encrypt/i.test(String(error))) throw new Error('This PDF is protected. Remove its protection first, then redact it.');
    throw new Error('This PDF could not be read because it is invalid or damaged.');
  }
}
const signed = (pdf: PDFDocument) => pdf.getForm().getFields().some((f) => f.acroField.dict.lookup(N('FT')) === N('Sig') && f.acroField.dict.has(N('V')));
const textOf = (value: PDFObject | undefined) => (value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : null);

function parseFill(fill = '#000000'): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(fill);
  if (!m) throw new Error('Choose the box colour as #rrggbb.');
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** Terms to scrub elsewhere: each removed phrase, and its longer words that look like names or numbers. */
export function redactionTerms(phrases: string[]): string[] {
  const terms = new Set<string>();
  for (const phrase of phrases) {
    const p = phrase.replace(/\s+/g, ' ').trim();
    if (p.length >= 3) terms.add(p);
    for (const word of p.split(/[\s,;:()[\]"“”'‘’]+/)) if (word.length >= 4 && /[\d]|^[A-ZÀ-ɏ]/.test(word)) terms.add(word.replace(/[.]+$/, ''));
  }
  return [...terms].filter((t) => t.length >= 3).sort((a, b) => b.length - a.length).slice(0, 500);
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Removes the redacted words wherever they would still show; returns where they were found. */
function scrubElsewhere(pdf: PDFDocument, terms: string[]): string[] {
  if (!terms.length) return [];
  const pattern = new RegExp(terms.map(escape).join('|'), 'gi');
  const has = (s: string | null) => s !== null && new RegExp(pattern.source, 'i').test(s);
  const scrub = (s: string) => s.replace(pattern, '[REDACTED]');
  const found: string[] = [];
  const fix = (dict: PDFDict, keys: string[], where: string) => {
    for (const key of keys) {
      const value = textOf(dict.lookup(N(key)));
      if (has(value)) { dict.set(N(key), PDFHexString.fromText(scrub(value!))); found.push(`${where}: ${key}`); }
    }
  };
  const info = pdf.context.lookup(pdf.context.trailerInfo.Info);
  if (info instanceof PDFDict) fix(info, info.keys().map((k) => k.decodeText()), 'Document information');
  const xmp = (holder: PDFDict, where: string) => {
    const stream = holder.lookup(N('Metadata'));
    if (stream instanceof PDFStream && has(new TextDecoder('utf-8', { fatal: false }).decode(decodedStream(stream)))) { holder.delete(N('Metadata')); found.push(`${where}: XMP metadata removed`); }
  };
  xmp(pdf.catalog, 'Document');
  // Bookmarks.
  const seen = new Set<PDFDict>();
  const outline = (item: PDFDict | undefined, depth: number) => {
    for (let node = item; node && !seen.has(node) && depth < 64; node = node.lookupMaybe(N('Next'), PDFDict)) {
      seen.add(node); fix(node, ['Title'], 'Bookmark');
      const uri = node.lookupMaybe(N('A'), PDFDict);
      if (uri && has(textOf(uri.lookup(N('URI'))))) { node.delete(N('A')); found.push('Bookmark: link address'); }
      outline(node.lookupMaybe(N('First'), PDFDict), depth + 1);
    }
  };
  outline(pdf.catalog.lookupMaybe(N('Outlines'), PDFDict)?.lookupMaybe(N('First'), PDFDict), 0);
  // Comments, link addresses and page metadata on every page.
  pdf.getPages().forEach((page, i) => {
    xmp(page.node, `Page ${i + 1}`);
    for (const annot of page.node.lookupMaybe(N('Annots'), PDFArray)?.asArray() ?? []) {
      const dict = pdf.context.lookup(annot);
      if (!(dict instanceof PDFDict)) continue;
      fix(dict, ['Contents', 'T', 'Subj', 'TU'], `Page ${i + 1} annotation`);
      if (has(textOf(dict.lookup(N('RC'))))) { dict.delete(N('RC')); found.push(`Page ${i + 1} annotation: rich text`); }
      const action = dict.lookupMaybe(N('A'), PDFDict);
      if (action && has(textOf(action.lookup(N('URI'))))) { dict.delete(N('A')); found.push(`Page ${i + 1} link address`); }
    }
  });
  // Form values: the changed fields get new appearances from the viewer.
  const form = pdf.catalog.lookupMaybe(N('AcroForm'), PDFDict);
  const fields = (array: PDFArray | undefined, depth: number) => {
    for (const ref of array?.asArray() ?? []) {
      const field = pdf.context.lookup(ref);
      if (!(field instanceof PDFDict) || depth > 32) continue;
      const before = found.length;
      fix(field, ['V', 'DV', 'TU', 'TM'], 'Form field');
      const options = field.lookupMaybe(N('Opt'), PDFArray);
      options?.asArray().forEach((option, k) => {
        const value = textOf(pdf.context.lookup(option) ?? option);
        if (has(value)) { options.set(k, PDFHexString.fromText(scrub(value!))); found.push('Form field: option'); }
      });
      if (found.length > before) {
        field.delete(N('AP'));
        for (const kid of field.lookupMaybe(N('Kids'), PDFArray)?.asArray() ?? []) (pdf.context.lookup(kid) as PDFDict | undefined)?.delete?.(N('AP'));
        form!.set(N('NeedAppearances'), pdf.context.obj(true));
      }
      fields(field.lookupMaybe(N('Kids'), PDFArray), depth + 1);
    }
  };
  if (form) fields(form.lookupMaybe(N('Fields'), PDFArray), 0);
  // Tagged structure: alternate and replacement text.
  const visited = new Set<PDFObject>();
  const structure = (object: PDFObject | undefined, depth: number) => {
    const node = object instanceof PDFRef ? pdf.context.lookup(object) : object;
    if (!node || visited.has(node) || depth > 256 || visited.size > 200_000) return;
    visited.add(node);
    if (node instanceof PDFArray) { for (const kid of node.asArray()) structure(kid, depth + 1); return; }
    if (!(node instanceof PDFDict)) return;
    fix(node, ['Alt', 'ActualText', 'E', 'T'], 'Tag');
    structure(node.get(N('K')), depth + 1);
  };
  structure(pdf.catalog.get(N('StructTreeRoot')), 0);
  // Attached files are reported, not changed: Sanitize removes them.
  const files = pdf.catalog.lookupMaybe(N('Names'), PDFDict)?.lookupMaybe(N('EmbeddedFiles'), PDFDict)?.lookupMaybe(N('Names'), PDFArray);
  for (let k = 0; files && k + 1 < files.size(); k += 2) {
    const spec = pdf.context.lookup(files.get(k + 1));
    const name = textOf(files.get(k)) ?? '';
    if (spec instanceof PDFDict && (has(name) || has(textOf(spec.lookup(N('Desc')))) || has(textOf(spec.lookup(N('UF')))))) found.push('Attached file mentions redacted words (use Sanitize to remove attachments)');
  }
  return found;
}

/** Removes annotations (and the form fields of widgets) that overlap a mark on this page. */
function removeAnnotations(pdf: PDFDocument, pageIndex: number, marks: Box[], removedWidgets: Set<string>): number {
  const page = pdf.getPage(pageIndex).node;
  const annots = page.lookupMaybe(N('Annots'), PDFArray);
  if (!annots) return 0;
  const removed = new Set<string>();
  const keep: PDFObject[] = [];
  for (const entry of annots.asArray()) {
    const dict = pdf.context.lookup(entry);
    const rect = dict instanceof PDFDict ? dict.lookupMaybe(N('Rect'), PDFArray)?.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0)) : undefined;
    const box = rect?.length === 4 ? boxOf([[rect[0], rect[1]], [rect[2], rect[3]]]) : null;
    if (dict instanceof PDFDict && box && marks.some((m) => overlaps(box, m))) {
      removed.add(entry.toString());
      if (dict.get(N('Subtype'))?.toString() === '/Widget') removedWidgets.add(entry.toString());
    } else keep.push(entry);
  }
  // Pop-ups belong to the comment they show.
  const final = keep.filter((entry) => {
    const dict = pdf.context.lookup(entry);
    const parent = dict instanceof PDFDict ? dict.get(N('Parent')) : undefined;
    if (dict instanceof PDFDict && dict.get(N('Subtype'))?.toString() === '/Popup' && parent && removed.has(parent.toString())) { removed.add(entry.toString()); return false; }
    return true;
  });
  page.set(N('Annots'), pdf.context.obj(final));
  return removed.size - [...removed].filter((r) => removedWidgets.has(r)).length;
}

/** Drops removed widgets from the field tree, and fields left with no widget. Returns how many fields went. */
function pruneFields(pdf: PDFDocument, widgets: Set<string>): number {
  const form = pdf.catalog.lookupMaybe(N('AcroForm'), PDFDict);
  if (!form || !widgets.size) return 0;
  let fields = 0;
  const prune = (array: PDFArray | undefined, depth: number): PDFObject[] => {
    const kept: PDFObject[] = [];
    for (const ref of array?.asArray() ?? []) {
      if (widgets.has(ref.toString())) { if (!(pdf.context.lookup(ref) as PDFDict).has(N('Parent'))) fields++; continue; }
      const field = pdf.context.lookup(ref);
      const kids = field instanceof PDFDict ? field.lookupMaybe(N('Kids'), PDFArray) : undefined;
      if (field instanceof PDFDict && kids && depth < 32) {
        const left = prune(kids, depth + 1);
        if (!left.length) { fields++; continue; }
        field.set(N('Kids'), pdf.context.obj(left));
      }
      kept.push(ref);
    }
    return kept;
  };
  form.set(N('Fields'), pdf.context.obj(prune(form.lookupMaybe(N('Fields'), PDFArray), 0)));
  return fields;
}

export async function redactPdf(bytes: Uint8Array, options: RedactOptions): Promise<{ bytes: Uint8Array; report: RedactReport }> {
  const pdf = await load(bytes);
  if (signed(pdf)) throw new Error('This PDF is digitally signed; redacting it would invalidate the signatures. Redact an unsigned copy instead.');
  const marks = options.marks ?? [];
  if (!marks.length) throw new Error('Mark at least one area to redact.');
  if (marks.length > MAX_MARKS) throw new Error(`Redact at most ${MAX_MARKS.toLocaleString()} areas at a time.`);
  const fill = parseFill(options.fill);
  const label = (options.label ?? '').trim();
  if (label.length > 60 || /[^\x20-\x7e -ÿ]/.test(label)) throw new Error('The box label must be at most 60 Latin characters.');
  const byPage = new Map<number, Box[]>();
  for (const mark of marks) {
    const [x0, y0, x1, y1] = mark.box ?? [];
    if (!Number.isSafeInteger(mark.pageNumber) || mark.pageNumber < 1 || mark.pageNumber > pdf.getPageCount()) throw new Error('A redaction area is on a page that is not in this PDF.');
    if (![x0, y0, x1, y1].every(Number.isFinite) || x1 - x0 < 0.1 || y1 - y0 < 0.1) throw new Error('A redaction area is empty.');
    byPage.set(mark.pageNumber - 1, [...(byPage.get(mark.pageNumber - 1) ?? []), [x0, y0, x1, y1]]);
  }
  const ctx: WalkContext = { pdf, marks: [], fonts: new Map(), decodeImage: options.decodeImage, stats: { glyphs: 0, imagesEdited: 0, imagesRemoved: 0, paths: 0, forms: 0, markedContent: 0 }, removedText: [], names: { next: 0 } };
  const font = label ? await pdf.embedFont(StandardFonts.Helvetica) : null;
  const widgets = new Set<string>(); let annotations = 0;
  for (const [pageIndex, pageMarks] of byPage) {
    const page = pdf.getPage(pageIndex);
    ctx.marks = pageMarks;
    const resources = copyDict(pdf, page.node.Resources());
    const walked = await walkContent(ctx, pageContentBytes(pdf, pageIndex), resources, [...IDENTITY] as Matrix);
    const pageResources = walked.resources ?? resources;
    let boxes = `q ${fill.map(fmt).join(' ')} rg\n` + pageMarks.map(([x0, y0, x1, y1]) => `${fmt(x0)} ${fmt(y0)} ${fmt(x1 - x0)} ${fmt(y1 - y0)} re f`).join('\n') + '\nQ\n';
    if (font) {
      const fonts = copyDict(pdf, pageResources.lookupMaybe(N('Font'), PDFDict));
      fonts.set(N('RdLabel'), font.ref); pageResources.set(N('Font'), fonts);
      const light = fill[0] * 0.299 + fill[1] * 0.587 + fill[2] * 0.114 > 0.5;
      for (const [x0, y0, x1, y1] of pageMarks) {
        const size = Math.min(12, (y1 - y0) * 0.7, ((x1 - x0) * 0.9 * 12) / Math.max(1, font.widthOfTextAtSize(label, 12)));
        if (size < 3) continue;
        const x = x0 + (x1 - x0 - font.widthOfTextAtSize(label, size)) / 2; const y = y0 + (y1 - y0 - size * 0.7) / 2;
        boxes += `q ${light ? '0 g' : '1 g'} BT /RdLabel ${fmt(size)} Tf ${fmt(x)} ${fmt(y)} Td ${font.encodeText(label).toString()} Tj ET Q\n`;
      }
    }
    const content = new Uint8Array([...new TextEncoder().encode('q\n'), ...walked.data, ...new TextEncoder().encode('\nQ\n' + boxes)]);
    page.node.set(N('Contents'), pdf.context.register(pdf.context.flateStream(content)));
    page.node.set(N('Resources'), pageResources);
    page.node.delete(N('Thumb'));
    annotations += removeAnnotations(pdf, pageIndex, pageMarks, widgets);
  }
  const fields = pruneFields(pdf, widgets);
  const elsewhere = options.scrubElsewhere === false ? [] : scrubElsewhere(pdf, redactionTerms(ctx.removedText));
  removeUnreachableObjects(pdf);
  const out = await pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
  return { bytes: out, report: { ...ctx.stats, pages: byPage.size, areas: marks.length, annotations, fields, elsewhere } };
}

/** Page geometry for converting between what the viewer shows and page space. */
export interface PageFrame { width: number; height: number; matrix: Matrix }
export async function pdfPageFrames(bytes: Uint8Array): Promise<{ crop: Box; rotation: number }[]> {
  const pdf = await load(bytes);
  return pdf.getPages().map((page) => { const c = page.getCropBox(); return { crop: [c.x, c.y, c.x + c.width, c.y + c.height] as Box, rotation: ((page.getRotation().angle % 360) + 360) % 360 }; });
}
/** The upright frame a page is shown in (as viewerFrame in pdfStamp, from stored geometry). */
export function frameOf(page: { crop: Box; rotation: number }, viewRotation: number): PageFrame {
  const [x, y, x1, y1] = page.crop; const width = x1 - x, height = y1 - y;
  const r = (((page.rotation + viewRotation) % 360) + 360) % 360;
  if (r === 90) return { width: height, height: width, matrix: [0, 1, -1, 0, x + width, y] };
  if (r === 180) return { width, height, matrix: [-1, 0, 0, -1, x + width, y + height] };
  if (r === 270) return { width: height, height: width, matrix: [0, -1, 1, 0, x, y + height] };
  return { width, height, matrix: [1, 0, 0, 1, x, y] };
}
/** A rectangle shown on screen (fractions of the shown page) as a box in page space. */
export function shownToBox(frame: PageFrame, r: { x: number; y: number; width: number; height: number }): Box {
  const m = frame.matrix;
  const pt = (fx: number, fy: number): [number, number] => { const u = fx * frame.width, v = (1 - fy) * frame.height; return [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]]; };
  return boxOf([pt(r.x, r.y), pt(r.x + r.width, r.y), pt(r.x, r.y + r.height), pt(r.x + r.width, r.y + r.height)]);
}
/** A page-space box as fractions of the shown page. */
export function boxToShown(frame: PageFrame, box: Box): { x: number; y: number; width: number; height: number } {
  const [a, b, c, d, e, f] = frame.matrix; const det = a * d - b * c;
  const inv = (x: number, y: number) => { const u = (d * (x - e) - c * (y - f)) / det, v = (-b * (x - e) + a * (y - f)) / det; return [u / frame.width, 1 - v / frame.height]; };
  const pts = [inv(box[0], box[1]), inv(box[2], box[1]), inv(box[0], box[3]), inv(box[2], box[3])];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

// ---- Text search (marks from the same glyph geometry the redaction uses) ----------------------------------

export interface PageText { text: string; glyphAt: number[]; glyphs: PageGlyph[] }
/** Page text in content order, with a space or line break where the glyph positions call for one. */
export function composePageText(glyphs: PageGlyph[]): PageText {
  let text = ''; const glyphAt: number[] = [];
  glyphs.forEach((g, i) => {
    const prev = glyphs[i - 1];
    if (prev) {
      const [bx, by] = prev.quad[1]; const [sx, sy] = g.quad[0];
      const dx = prev.quad[1][0] - prev.quad[0][0], dy = prev.quad[1][1] - prev.quad[0][1];
      const len = Math.hypot(dx, dy) || 1; const ux = dx / len, uy = dy / len; const size = prev.size || 1;
      const along = ((sx - bx) * ux + (sy - by) * uy) / size; const across = Math.abs((sx - bx) * -uy + (sy - by) * ux) / size;
      const sep = across > 0.5 || along < -1 ? '\n' : along > 0.2 && !/\s$/.test(text) && !/^\s/.test(g.text) ? ' ' : '';
      for (const ch of sep) { text += ch; glyphAt.push(-1); }
    }
    for (const ch of g.text) { text += ch; glyphAt.push(i); }
  });
  return { text, glyphAt, glyphs };
}
/** Marks covering text positions [start, end) of a page's composed text, one per line of text. */
export function marksForRange(page: PageText, pageNumber: number, start: number, end: number): RedactionMark[] {
  const marks: RedactionMark[] = []; let line: Box | null = null;
  const push = () => { if (line) marks.push({ pageNumber, box: line }); line = null; };
  let last = -1;
  for (let k = start; k < end; k++) {
    const gi = page.glyphAt[k];
    if (gi < 0) { if (page.text[k] === '\n') push(); continue; }
    if (gi === last) continue;
    last = gi;
    const g = page.glyphs[gi];
    if (!g.text.trim()) continue;
    // The mark spans most of the glyph's height, so it does not reach into the lines above and below.
    const [bl, br, tl, tr] = g.quad;
    const lerp = (p: [number, number], q: [number, number], t: number): [number, number] => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const box = boxOf([lerp(bl, tl, 0.05), lerp(br, tr, 0.05), lerp(bl, tl, 0.85), lerp(br, tr, 0.85)]);
    line = line ? [Math.min(line[0], box[0]), Math.min(line[1], box[1]), Math.max(line[2], box[2]), Math.max(line[3], box[3])] : box;
  }
  push();
  return marks;
}
/** The composed text of every page (for search and detection). */
export async function readPagesText(bytes: Uint8Array): Promise<PageText[]> {
  const pdf = await load(bytes);
  const fonts = new Map();
  const out: PageText[] = [];
  for (let i = 0; i < pdf.getPageCount(); i++) out.push(composePageText(await pageGlyphs(pdf, i, fonts)));
  return out;
}
export interface TextMatch { pageNumber: number; text: string; marks: RedactionMark[] }
/** Every occurrence of a phrase (case-insensitive; optionally whole words only). */
export async function findRedactionText(bytes: Uint8Array, phrase: string, wholeWords = false): Promise<TextMatch[]> {
  const query = phrase.trim();
  if (!query || query.length > 500) throw new Error('Enter the text to find (at most 500 characters).');
  const source = escape(query).replace(/\s+/g, '\\s+');
  const pattern = new RegExp(wholeWords ? `(?<![\\p{L}\\p{N}])${source}(?![\\p{L}\\p{N}])` : source, 'giu');
  const pages = await readPagesText(bytes);
  return pages.flatMap((page, i) => [...page.text.matchAll(pattern)].map((m) => ({ pageNumber: i + 1, text: m[0], marks: marksForRange(page, i + 1, m.index!, m.index! + m[0].length) })));
}
