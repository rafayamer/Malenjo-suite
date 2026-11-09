/* Structured reading of PDF pages for Markdown, HTML, plain text and Office export
 * (MAL-037 – 039, 041, 042, 044). Text comes from PDF.js (any font PDF.js can read, including
 * the invisible text layer of OCR'd PDFs); images come from the operator list. Positions are
 * on the page as shown (origin top-left, after /Rotate).
 *
 * Reconstruction is heuristic and reported as such: headings from font-size ranks (and bold
 * lines), lists from bullet or number markers, tables from column-aligned cells.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { rgbaFromPdfJs, type Rgba } from './imageCodecs';

export interface TextItem { str: string; x: number; y: number; width: number; size: number; bold: boolean; italic: boolean; order: number; eol: boolean }
export interface ImageItem { x: number; y: number; width: number; height: number; image: Rgba }
export interface PageStructure { pageNumber: number; width: number; height: number; items: TextItem[]; images: ImageItem[]; skippedImages: number }
export interface Line { y: number; size: number; cells: { x: number; end: number; text: string; bold: boolean; italic: boolean }[]; text: string; x: number; end: number }
export type Block =
  | { kind: 'heading'; level: number; text: string; y: number; size: number }
  | { kind: 'paragraph'; text: string; y: number; bold: boolean; italic: boolean; size: number }
  | { kind: 'list'; ordered: boolean; items: string[]; y: number }
  | { kind: 'table'; rows: string[][]; y: number }
  | { kind: 'image'; index: number; y: number };
export type ReadingOrder = 'stored' | 'rows' | 'columns';

type Doc = Pick<PDFDocumentProxy, 'numPages' | 'getPage'>;
const MAX_IMAGE_PIXELS = 25_000_000;
type M = number[];
const mul = (m: M, n: M): M => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];

/** Reads text items (and images when asked) from the chosen pages. */
export async function readPdfStructure(doc: Doc, pages: number[], options: { images: boolean; signal?: AbortSignal; ops?: Record<string, number> }): Promise<PageStructure[]> {
  const OPS = options.ops ?? (await import('pdfjs-dist')).OPS;
  const out: PageStructure[] = [];
  for (const pageNumber of pages) {
    if (options.signal?.aborted) throw Object.assign(new Error('The export was cancelled.'), { name: 'AbortError' });
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const list = await page.getOperatorList();
    const content = await page.getTextContent();
    const fontStyle = (name: string) => {
      let label = '';
      try { const font = page.commonObjs.has(name) ? page.commonObjs.get(name) as { name?: string } : null; label = font?.name ?? ''; } catch { /* not loaded */ }
      label += ' ' + (content.styles[name]?.fontFamily ?? '');
      return { bold: /bold|black|heavy|semibold|demi/i.test(label), italic: /italic|oblique/i.test(label) };
    };
    const items: TextItem[] = [];
    content.items.forEach((raw, order) => {
      if (!('str' in raw)) return;
      const t = raw.transform as number[];
      const [x, y] = viewport.convertToViewportPoint(t[4], t[5]) as [number, number];
      const size = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]);
      if (!raw.str && !raw.hasEOL) return;
      items.push({ str: raw.str, x, y, width: raw.width, size, ...fontStyle(raw.fontName), order, eol: raw.hasEOL });
    });
    const images: ImageItem[] = [];
    let skipped = 0;
    if (options.images) {
      let ctm: M = [1, 0, 0, 1, 0, 0]; const stack: M[] = [];
      for (let i = 0; i < list.fnArray.length; i++) {
        const fn = list.fnArray[i], args = list.argsArray[i] as unknown[];
        if (fn === OPS.save) stack.push(ctm);
        else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
        else if (fn === OPS.transform) ctm = mul(args as M, ctm);
        // A form XObject draws in its own graphics state, through its /Matrix.
        else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); const m = args[0] as ArrayLike<number> | null; if (m && m.length === 6) ctm = mul(Array.from(m), ctm); }
        else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
        else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageXObjectRepeat) {
          const data = fn === OPS.paintInlineImageXObject ? args[0] : await new Promise((done) => {
            const id = args[0] as string;
            const objs = id.startsWith('g_') ? page.commonObjs : page.objs;
            objs.get(id, done);
          });
          // PDF.js folds one picture drawn at several places into a single repeat operation: expand each placement.
          const placements: M[] = [];
          if (fn === OPS.paintImageXObjectRepeat) {
            const [, sx, sy, positions] = args as [string, number, number, ArrayLike<number>];
            for (let k = 0; k + 1 < positions.length; k += 2) placements.push(mul([sx, 0, 0, sy, positions[k], positions[k + 1]], ctm));
          } else placements.push(ctm);
          const img = data as { width: number; height: number; kind?: number; data?: Uint8Array } | null;
          if (!img?.data || !img.kind || img.width * img.height > MAX_IMAGE_PIXELS) { skipped += placements.length; continue; }
          const image = rgbaFromPdfJs({ width: img.width, height: img.height, kind: img.kind, data: img.data });
          for (const m of placements) {
            const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => viewport.convertToViewportPoint(m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]) as [number, number]);
            const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
            // The exporters stretch the bitmap into an upright box, so turn or mirror its pixels the way they are shown.
            const ex: [number, number] = [corners[1][0] - corners[0][0], corners[1][1] - corners[0][1]];
            const ey: [number, number] = [corners[2][0] - corners[0][0], corners[2][1] - corners[0][1]];
            images.push({ x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), image: orient(image, ex, ey) });
          }
        } else if (fn === OPS.paintImageMaskXObject) skipped++;
        // Stencil masks and grouped inline images are not extracted: count every placement as skipped.
        else if (fn === OPS.paintImageMaskXObjectRepeat) skipped += Math.max(1, Math.floor(((args[5] as ArrayLike<number> | undefined)?.length ?? 2) / 2));
        else if (fn === OPS.paintImageMaskXObjectGroup) skipped += Math.max(1, (args[0] as ArrayLike<unknown> | undefined)?.length ?? 1);
        else if (fn === OPS.paintInlineImageXObjectGroup) skipped += Math.max(1, (args[1] as ArrayLike<unknown> | undefined)?.length ?? 1);
      }
    }
    out.push({ pageNumber, width: viewport.width, height: viewport.height, items, images, skippedImages: skipped });
    page.cleanup();
  }
  return out;
}

/**
 * The bitmap as it appears on the page, for a placement whose image x axis lands on `ex` and y axis on `ey` in
 * viewport space (y down). Quarter turns and mirrors are applied to the pixels; an upright placement, or a skewed
 * or freely rotated one (only its bounding box is kept), returns the bitmap unchanged.
 */
export function orient(image: Rgba, ex: [number, number], ey: [number, number]): Rgba {
  const tiny = (a: number, b: number) => Math.abs(a) <= 1e-6 * Math.max(Math.abs(b), 1e-9);
  const straight = tiny(ex[1], ex[0]) && tiny(ey[0], ey[1]);
  const turned = tiny(ex[0], ex[1]) && tiny(ey[1], ey[0]);
  if (!straight && !turned) return image;
  if (straight && ex[0] > 0 && ey[1] < 0) return image;
  const bw = Math.abs(ex[0]) + Math.abs(ey[0]), bh = Math.abs(ex[1]) + Math.abs(ey[1]);
  if (!(bw > 0 && bh > 0)) return image; // a placement with no area has nothing to turn
  const { width: w, height: h, data } = image;
  const [W, H] = turned ? [h, w] : [w, h];
  const out = new Uint8ClampedArray(W * H * 4);
  const minX = Math.min(0, ex[0]) + Math.min(0, ey[0]), minY = Math.min(0, ex[1]) + Math.min(0, ey[1]);
  for (let sy = 0; sy < h; sy++) for (let sx = 0; sx < w; sx++) {
    // Pixel rows run top to bottom, while the image's own y axis points up.
    const u = (sx + 0.5) / w, v = 1 - (sy + 0.5) / h;
    const px = ex[0] * u + ey[0] * v, py = ex[1] * u + ey[1] * v;
    const ox = Math.min(W - 1, Math.floor(((px - minX) / bw) * W)), oy = Math.min(H - 1, Math.floor(((py - minY) / bh) * H));
    out.set(data.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (oy * W + ox) * 4);
  }
  return { width: W, height: H, data: out };
}

/** Text lines (top to bottom), each split into cells where a wide gap separates text. */
export function linesOf(page: PageStructure): Line[] {
  const items = page.items.filter((i) => i.str.trim()).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: TextItem[][] = [];
  for (const item of items) {
    const row = rows.find((r) => Math.abs(r[0].y - item.y) < Math.max(r[0].size, item.size) * 0.4);
    if (row) row.push(item); else rows.push([item]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    const size = Math.max(...row.map((i) => i.size));
    const cells: Line['cells'] = [];
    for (const item of row) {
      const last = cells[cells.length - 1];
      const gap = last ? item.x - last.end : Infinity;
      if (last && gap < Math.max(size * 1.6, 10)) {
        last.text += (gap > size * 0.12 && !last.text.endsWith(' ') && !item.str.startsWith(' ') ? ' ' : '') + item.str;
        last.end = Math.max(last.end, item.x + item.width); last.bold &&= item.bold; last.italic &&= item.italic;
      } else cells.push({ x: item.x, end: item.x + item.width, text: item.str, bold: item.bold, italic: item.italic });
    }
    cells.forEach((c) => { c.text = c.text.replace(/\s+/g, ' ').trim(); });
    return { y: Math.min(...row.map((i) => i.y)), size, cells, text: cells.map((c) => c.text).join(' '), x: cells[0].x, end: cells[cells.length - 1].end };
  }).sort((a, b) => a.y - b.y);
}

export const BULLET = /^([•●◦▪▫‣∙·○■□–—*-])\s+/;
export const NUMBERED = /^(\(?\d{1,3}[.)]|\(?[a-z][.)])\s+/i;
const bodySize = (lines: Line[]) => {
  const weight = new Map<number, number>();
  for (const l of lines) { const s = Math.round(l.size * 2) / 2; weight.set(s, (weight.get(s) ?? 0) + l.text.length); }
  return [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 12;
};
const joinLines = (parts: string[]) => parts.reduce((text, part) => (!text ? part : /[A-Za-z]-$/.test(text) && /^[a-z]/.test(part) ? text.slice(0, -1) + part : `${text} ${part}`), '');

/** Headings, paragraphs, lists, tables and images in reading order (top to bottom). */
export function blocksOf(page: PageStructure, headingSizes?: number[]): Block[] {
  const lines = linesOf(page);
  const body = bodySize(lines);
  const sizes = headingSizes ?? [...new Set(lines.filter((l) => l.size >= body * 1.15).map((l) => Math.round(l.size * 2) / 2))].sort((a, b) => b - a);
  const level = (size: number) => { const i = sizes.findIndex((s) => Math.abs(s - size) < 0.6); return i < 0 ? sizes.length + 1 : i + 1; };
  const blocks: Block[] = [];
  const used = new Set<Line>();
  // Tables: two or more consecutive multi-cell lines whose cells share column starts.
  for (let i = 0; i < lines.length; i++) {
    if (used.has(lines[i]) || lines[i].cells.length < 2) continue;
    let j = i;
    while (j + 1 < lines.length && lines[j + 1].cells.length >= 2 && lines[j + 1].y - lines[j].y < lines[j].size * 2.6) j++;
    if (j === i) continue;
    const run = lines.slice(i, j + 1);
    const starts: number[] = [];
    for (const cell of run.flatMap((l) => l.cells)) if (!starts.some((s) => Math.abs(s - cell.x) < body * 1.2)) starts.push(cell.x);
    starts.sort((a, b) => a - b);
    const aligned = run.filter((l) => l.cells.every((c) => starts.some((s) => Math.abs(s - c.x) < body * 1.2))).length;
    if (aligned < run.length || starts.length > 12) continue;
    const column = (x: number) => starts.findIndex((s) => Math.abs(s - x) < body * 1.2);
    const rows = run.map((l) => { const row = starts.map(() => ''); for (const c of l.cells) row[column(c.x)] = [row[column(c.x)], c.text].filter(Boolean).join(' '); return row; });
    blocks.push({ kind: 'table', rows, y: run[0].y });
    run.forEach((l) => used.add(l));
    i = j;
  }
  let current: { lines: Line[]; list?: { ordered: boolean; items: string[][] } } | null = null;
  const flush = () => {
    if (!current) return;
    const first = current.lines[0];
    if (current.list) blocks.push({ kind: 'list', ordered: current.list.ordered, items: current.list.items.map(joinLines), y: first.y });
    else {
      const text = joinLines(current.lines.map((l) => l.text));
      const bold = current.lines.every((l) => l.cells.every((c) => c.bold)), italic = current.lines.every((l) => l.cells.every((c) => c.italic));
      if (first.size >= body * 1.15 && current.lines.length <= 3) blocks.push({ kind: 'heading', level: Math.min(6, level(first.size)), text, y: first.y, size: first.size });
      else if (bold && current.lines.length === 1 && text.length < 90 && !/[.:;,]$/.test(text)) blocks.push({ kind: 'heading', level: Math.min(6, sizes.length + 1), text, y: first.y, size: first.size });
      else blocks.push({ kind: 'paragraph', text, y: first.y, bold, italic, size: first.size });
    }
    current = null;
  };
  for (const line of lines) {
    if (used.has(line)) { flush(); continue; }
    const bullet = BULLET.exec(line.text), number = !bullet ? NUMBERED.exec(line.text) : null;
    const prev = current?.lines[current.lines.length - 1];
    const near = prev && line.y - prev.y < Math.max(prev.size, line.size) * 1.75 && Math.abs(prev.size - line.size) < 0.6;
    if (bullet || number) {
      const text = line.text.slice((bullet ?? number)![0].length);
      if (current?.list && near && current.list.ordered === Boolean(number)) { current.list.items.push([text]); current.lines.push(line); continue; }
      flush(); current = { lines: [line], list: { ordered: Boolean(number), items: [[text]] } }; continue;
    }
    if (current?.list && near && line.x > current.lines[0].x + 2) { current.list.items[current.list.items.length - 1].push(line.text); current.lines.push(line); continue; }
    const sameStyle = prev && line.cells.every((c) => c.bold) === prev.cells.every((c) => c.bold);
    if (current && !current.list && near && sameStyle) { current.lines.push(line); continue; }
    flush(); current = { lines: [line] };
  }
  flush();
  page.images.forEach((image, index) => blocks.push({ kind: 'image', index, y: image.y }));
  return blocks.sort((a, b) => a.y - b.y);
}

/** Heading sizes ranked across all pages, so h1/h2 mean the same on every page. */
export function documentHeadingSizes(pages: PageStructure[]): number[] {
  const lines = pages.flatMap(linesOf);
  const body = bodySize(lines);
  return [...new Set(lines.filter((l) => l.size >= body * 1.15).map((l) => Math.round(l.size * 2) / 2))].sort((a, b) => b - a).slice(0, 6);
}

/** Text in the chosen reading order. */
export function pageText(page: PageStructure, order: ReadingOrder): string {
  if (order === 'stored') {
    let text = ''; let last: TextItem | null = null;
    for (const item of [...page.items].sort((a, b) => a.order - b.order)) {
      // Whitespace items PDF.js adds between runs: the gap itself decides what separates them.
      if (!item.str.trim()) { if (item.eol && !text.endsWith('\n')) text += '\n'; continue; }
      if (last && Math.abs(item.y - last.y) > item.size * 0.5) { if (!text.endsWith('\n')) text += '\n'; }
      else if (last && !text.endsWith('\n')) {
        // Same line: a wide gap is a column break, a small one a space.
        const gap = item.x - (last.x + last.width);
        if (gap > item.size * 1.6) text += '\t'; else if (gap > item.size * 0.12 && !/\s$/.test(text) && !/^\s/.test(item.str)) text += ' ';
      }
      text += item.str; if (item.eol) text += '\n';
      last = item;
    }
    return text.replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
  }
  const lines = linesOf(page);
  if (order === 'rows') return lines.map((l) => l.cells.map((c) => c.text).join('\t').trim()).join('\n');
  // Columns: find a vertical gutter no cell crosses, then read the left column before the right one;
  // text spanning the gutter (titles) separates sections.
  const cells = lines.flatMap((l) => l.cells.map((c) => ({ ...c, y: l.y })));
  let gutter: number | null = null; let best = 0;
  for (let x = page.width * 0.25; x <= page.width * 0.75; x += 2) {
    const crossing = cells.filter((c) => c.x < x && c.end > x).length;
    const left = cells.filter((c) => c.end <= x).length, right = cells.filter((c) => c.x >= x).length;
    const score = Math.min(left, right) - crossing * 4;
    if (crossing <= cells.length * 0.08 && score > best) { best = score; gutter = x; }
  }
  if (gutter === null || best < 3) return pageText(page, 'rows');
  const out: string[] = []; let left: string[] = [], right: string[] = [];
  const flush = () => { out.push(...left, ...right); left = []; right = []; };
  for (const line of lines) {
    const spanning = line.cells.some((c) => c.x < gutter! && c.end > gutter!);
    if (spanning) { flush(); out.push(line.text); continue; }
    const l = line.cells.filter((c) => c.end <= gutter!).map((c) => c.text).join(' '), r = line.cells.filter((c) => c.x >= gutter!).map((c) => c.text).join(' ');
    if (l) left.push(l); if (r) right.push(r);
  }
  flush();
  return out.join('\n');
}
