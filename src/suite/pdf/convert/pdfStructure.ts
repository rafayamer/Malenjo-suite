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
  | { kind: 'heading'; level: number; text: string; y: number }
  | { kind: 'paragraph'; text: string; y: number; bold: boolean; italic: boolean }
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
        else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
          const data = fn === OPS.paintInlineImageXObject ? args[0] : await new Promise((done) => {
            const id = args[0] as string;
            const objs = id.startsWith('g_') ? page.commonObjs : page.objs;
            objs.get(id, done);
          });
          const img = data as { width: number; height: number; kind?: number; data?: Uint8Array } | null;
          if (!img?.data || !img.kind || img.width * img.height > MAX_IMAGE_PIXELS) { skipped++; continue; }
          const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => viewport.convertToViewportPoint(ctm[0] * u + ctm[2] * v + ctm[4], ctm[1] * u + ctm[3] * v + ctm[5]) as [number, number]);
          const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
          images.push({ x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), image: rgbaFromPdfJs({ width: img.width, height: img.height, kind: img.kind, data: img.data }) });
        } else if (fn === OPS.paintImageMaskXObject) skipped++;
      }
    }
    out.push({ pageNumber, width: viewport.width, height: viewport.height, items, images, skippedImages: skipped });
    page.cleanup();
  }
  return out;
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
      if (first.size >= body * 1.15 && current.lines.length <= 3) blocks.push({ kind: 'heading', level: Math.min(6, level(first.size)), text, y: first.y });
      else if (bold && current.lines.length === 1 && text.length < 90 && !/[.:;,]$/.test(text)) blocks.push({ kind: 'heading', level: Math.min(6, sizes.length + 1), text, y: first.y });
      else blocks.push({ kind: 'paragraph', text, y: first.y, bold, italic });
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
