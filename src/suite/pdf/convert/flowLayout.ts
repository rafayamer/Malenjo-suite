/* Flow layout into PDF pages, shared by Word (MAL-031) and HTML (MAL-034) to PDF.
 *
 * Blocks (paragraphs of styled runs, list items, tables, images, rules, page breaks) are laid
 * out with word wrapping, alignment, spacing and pagination using the 14 standard PDF fonts.
 * Characters those fonts cannot draw are replaced and counted for the fidelity report.
 */
import { PDFDocument, PDFFont, StandardFonts, rgb, type PDFPage } from 'pdf-lib';

export type FontFamily = 'sans' | 'serif' | 'mono';
export interface RunStyle { family: FontFamily; bold: boolean; italic: boolean; underline: boolean; strike: boolean; size: number; color: [number, number, number]; background?: [number, number, number] }
export interface Run { text: string; style: RunStyle; link?: string }
export type Align = 'left' | 'center' | 'right' | 'justify';
export interface Paragraph {
  kind: 'para'; runs: Run[]; align: Align; indent: number; firstIndent?: number; spaceBefore: number; spaceAfter: number; lineHeight: number;
  marker?: string; pageBreakBefore?: boolean; background?: [number, number, number]; border?: boolean;
}
export interface TableCell { blocks: Paragraph[]; colSpan: number; background?: [number, number, number] }
export interface Table { kind: 'table'; rows: { cells: TableCell[]; header?: boolean }[]; colWidths: number[]; borders: boolean; spaceAfter: number }
export interface ImageBlock { kind: 'image'; bytes: Uint8Array; format: 'png' | 'jpeg'; width: number; height: number; align: Align; spaceAfter: number }
export type Block = Paragraph | Table | ImageBlock | { kind: 'rule' } | { kind: 'pageBreak' };
export interface PageSetup { width: number; height: number; margin: { top: number; right: number; bottom: number; left: number } }

export const DEFAULT_STYLE: RunStyle = { family: 'sans', bold: false, italic: false, underline: false, strike: false, size: 11, color: [0, 0, 0] };
const FONT_NAMES: Record<FontFamily, [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  mono: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};

export class FlowWriter {
  readonly pdf: PDFDocument;
  private fonts = new Map<string, PDFFont>();
  private page!: PDFPage;
  private y = 0;
  replaced = 0;
  /** Table rows taller than a printable page, laid out as flowing paragraphs instead of side-by-side cells. */
  unrolledRows = 0;
  pages = 0;
  constructor(pdf: PDFDocument, private setup: PageSetup) { this.pdf = pdf; }
  static async create(setup: PageSetup, firstPage = true) { const w = new FlowWriter(await PDFDocument.create(), setup); if (firstPage) w.newPage(); return w; }

  /** The page being written (for callers that draw shapes or pictures themselves). */
  get currentPage(): PDFPage { return this.page; }
  /** Starts a page of a given size (slides and sheets set their own sizes). */
  newPageSized(width: number, height: number) { this.setup = { ...this.setup, width, height }; this.page = this.pdf.addPage([width, height]); this.y = height - this.setup.margin.top; this.pages++; }
  private get contentWidth() { return this.setup.width - this.setup.margin.left - this.setup.margin.right; }
  newPage() { this.page = this.pdf.addPage([this.setup.width, this.setup.height]); this.y = this.setup.height - this.setup.margin.top; this.pages++; }
  private room(height: number) { if (this.y - height < this.setup.margin.bottom && this.y < this.setup.height - this.setup.margin.top - 0.5) this.newPage(); }
  async font(style: RunStyle): Promise<PDFFont> {
    const index = (style.bold ? 1 : 0) + (style.italic ? 2 : 0);
    const name = FONT_NAMES[style.family][index];
    if (!this.fonts.has(name)) this.fonts.set(name, await this.pdf.embedFont(name));
    return this.fonts.get(name)!;
  }
  /** Text the font can draw; other characters become “?” and are counted. */
  drawable(font: PDFFont, text: string): string {
    let out = '';
    for (const ch of text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/ /g, ' ')) {
      try { font.encodeText(ch); out += ch; } catch { out += '?'; this.replaced++; }
    }
    return out;
  }

  /** Splits runs into words (keeping style) and wraps them to lines of at most `width`. */
  private async lines(runs: Run[], width: number) {
    type Piece = { text: string; style: RunStyle; font: PDFFont; width: number; space: boolean };
    const pieces: Piece[] = [];
    for (const run of runs) {
      const font = await this.font(run.style);
      for (const part of run.text.split(/(\s+|\n)/)) {
        if (!part) continue;
        if (part.includes('\n')) { pieces.push({ text: '\n', style: run.style, font, width: 0, space: false }); continue; }
        const text = /^\s+$/.test(part) ? ' ' : this.drawable(font, part);
        pieces.push({ text, style: run.style, font, width: font.widthOfTextAtSize(text, run.style.size), space: text === ' ' });
      }
    }
    const lines: { pieces: Piece[]; width: number; height: number; hard: boolean }[] = [];
    let line: Piece[] = []; let lineWidth = 0;
    const push = (hard: boolean) => {
      while (line.length && line[line.length - 1].space) lineWidth -= line.pop()!.width;
      const height = Math.max(...(line.length ? line : pieces.slice(0, 1)).map((p) => p.style.size), 1);
      lines.push({ pieces: line, width: lineWidth, height, hard }); line = []; lineWidth = 0;
    };
    for (const piece of pieces) {
      if (piece.text === '\n') { push(true); continue; }
      if (piece.space && !line.length) continue;
      if (lineWidth + piece.width > width && line.some((p) => !p.space)) push(false);
      if (piece.space && !line.length) continue;
      // A single word wider than the line is broken by characters.
      if (piece.width > width && !piece.space) {
        let chunk = '';
        for (const ch of piece.text) {
          const w = piece.font.widthOfTextAtSize(chunk + ch, piece.style.size);
          if (w > width && chunk) { line.push({ ...piece, text: chunk, width: piece.font.widthOfTextAtSize(chunk, piece.style.size) }); lineWidth += line[line.length - 1].width; push(false); chunk = ''; }
          chunk += ch;
        }
        if (chunk) { const w = piece.font.widthOfTextAtSize(chunk, piece.style.size); line.push({ ...piece, text: chunk, width: w }); lineWidth += w; }
        continue;
      }
      line.push(piece); lineWidth += piece.width;
    }
    if (line.length || !lines.length) push(true);
    return lines;
  }

  /** Draws a paragraph at the current position (or inside a box when `box` is given), returning its height. */
  async paragraph(p: Paragraph, box?: { x: number; width: number; y: number; draw: boolean }): Promise<number> {
    const left = (box ? box.x : this.setup.margin.left) + p.indent;
    const width = (box ? box.width : this.contentWidth) - p.indent;
    const lines = await this.lines(p.runs.length ? p.runs : [{ text: '', style: DEFAULT_STYLE }], width - (p.firstIndent ?? 0));
    let y = box ? box.y : this.y;
    if (!box) { if (p.pageBreakBefore && this.y < this.setup.height - this.setup.margin.top - 0.5) this.newPage(); y = this.y - p.spaceBefore; this.y = y; }
    let used = p.spaceBefore;
    for (const [index, line] of lines.entries()) {
      const height = line.height * p.lineHeight;
      if (!box) { this.room(height); y = this.y; }
      const firstIndent = index === 0 ? p.firstIndent ?? 0 : 0;
      const extra = width - firstIndent - line.width;
      let x = left + firstIndent + (p.align === 'center' ? extra / 2 : p.align === 'right' ? extra : 0);
      const gaps = line.pieces.filter((piece) => piece.space).length;
      const stretch = p.align === 'justify' && !line.hard && gaps ? extra / gaps : 0;
      const baseline = y - line.height * 0.85;
      const draw = !box || box.draw;
      if (draw && index === 0 && p.marker) {
        const font = await this.font(p.runs[0]?.style ?? DEFAULT_STYLE);
        const size = p.runs[0]?.style.size ?? DEFAULT_STYLE.size;
        const marker = this.drawable(font, p.marker);
        this.page.drawText(marker, { x: left - font.widthOfTextAtSize(marker, size) - 4, y: baseline, size, font, color: rgb(...(p.runs[0]?.style.color ?? [0, 0, 0])) });
      }
      for (const piece of line.pieces) {
        if (draw && !piece.space) {
          const [r, g, b] = piece.style.color;
          if (piece.style.background) this.page.drawRectangle({ x, y: baseline - piece.style.size * 0.22, width: piece.width, height: piece.style.size * 1.05, color: rgb(...piece.style.background) });
          this.page.drawText(piece.text, { x, y: baseline, size: piece.style.size, font: piece.font, color: rgb(r, g, b) });
          if (piece.style.underline) this.page.drawLine({ start: { x, y: baseline - piece.style.size * 0.12 }, end: { x: x + piece.width, y: baseline - piece.style.size * 0.12 }, thickness: Math.max(0.5, piece.style.size / 18), color: rgb(r, g, b) });
          if (piece.style.strike) this.page.drawLine({ start: { x, y: baseline + piece.style.size * 0.3 }, end: { x: x + piece.width, y: baseline + piece.style.size * 0.3 }, thickness: Math.max(0.5, piece.style.size / 18), color: rgb(r, g, b) });
        }
        x += piece.width + (piece.space ? stretch : 0);
      }
      y -= height; used += height;
      if (!box) this.y = y;
    }
    used += p.spaceAfter;
    if (!box) this.y -= p.spaceAfter;
    return used;
  }

  async table(t: Table): Promise<void> {
    const total = t.colWidths.reduce((a, b) => a + b, 0);
    const scale = total > this.contentWidth ? this.contentWidth / total : 1;
    const widths = t.colWidths.map((w) => w * scale);
    const pad = 4;
    for (const row of t.rows) {
      // Measure, then draw; a row moves to the next page when it does not fit.
      const spans: { x: number; width: number; cell: TableCell }[] = [];
      let col = 0, x = this.setup.margin.left;
      for (const cell of row.cells) {
        const width = widths.slice(col, col + cell.colSpan).reduce((a, b) => a + b, 0) || widths[widths.length - 1] || 50;
        spans.push({ x, width, cell }); x += width; col += cell.colSpan;
      }
      const heights = await Promise.all(spans.map(async (s) => {
        let h = 0; for (const p of s.cell.blocks) h += await this.paragraph(p, { x: s.x + pad, width: s.width - 2 * pad, y: 0, draw: false }); return h + 2 * pad;
      }));
      const height = Math.max(12, ...heights);
      if (height > this.setup.height - this.setup.margin.top - this.setup.margin.bottom) {
        // A row taller than a page cannot be drawn as one box without losing what falls below the page:
        // its cells flow as ordinary paragraphs, one after another, across as many pages as they need.
        this.unrolledRows++;
        for (const s of spans) for (const p of s.cell.blocks) await this.paragraph(p);
        continue;
      }
      this.room(height);
      const top = this.y;
      for (const s of spans) {
        if (s.cell.background) this.page.drawRectangle({ x: s.x, y: top - height, width: s.width, height, color: rgb(...s.cell.background) });
        let y = top - pad;
        for (const p of s.cell.blocks) y -= await this.paragraph(p, { x: s.x + pad, width: s.width - 2 * pad, y, draw: true });
        if (t.borders) this.page.drawRectangle({ x: s.x, y: top - height, width: s.width, height, borderColor: rgb(0.5, 0.5, 0.5), borderWidth: 0.6 });
      }
      this.y = top - height;
    }
    this.y -= t.spaceAfter;
  }

  async image(block: ImageBlock): Promise<void> {
    const image = block.format === 'png' ? await this.pdf.embedPng(block.bytes) : await this.pdf.embedJpg(block.bytes);
    const scale = Math.min(1, this.contentWidth / block.width, (this.setup.height - this.setup.margin.top - this.setup.margin.bottom) / block.height);
    const [w, h] = [block.width * scale, block.height * scale];
    this.room(h);
    const extra = this.contentWidth - w;
    const x = this.setup.margin.left + (block.align === 'center' ? extra / 2 : block.align === 'right' ? extra : 0);
    this.page.drawImage(image, { x, y: this.y - h, width: w, height: h });
    this.y -= h + block.spaceAfter;
  }

  async write(blocks: Block[]): Promise<void> {
    for (const block of blocks) {
      if (block.kind === 'para') await this.paragraph(block);
      else if (block.kind === 'table') await this.table(block);
      else if (block.kind === 'image') await this.image(block);
      else if (block.kind === 'pageBreak') this.newPage();
      else { this.room(10); this.page.drawLine({ start: { x: this.setup.margin.left, y: this.y - 5 }, end: { x: this.setup.width - this.setup.margin.right, y: this.y - 5 }, thickness: 0.8, color: rgb(0.6, 0.6, 0.6) }); this.y -= 12; }
    }
  }
  async save(): Promise<Uint8Array> { return Uint8Array.from(await this.pdf.save({ useObjectStreams: true })); }
}

/** Image format and pixel size of PNG or JPEG bytes (null for other formats). */
export function imageInfo(bytes: Uint8Array): { format: 'png' | 'jpeg'; width: number; height: number } | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes.length > 24) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { format: 'png', width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let o = 2; o + 9 < bytes.length;) {
      if (bytes[o] !== 0xff) { o++; continue; }
      const marker = bytes[o + 1]; const len = (bytes[o + 2] << 8) | bytes[o + 3];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { format: 'jpeg', height: (bytes[o + 5] << 8) | bytes[o + 6], width: (bytes[o + 7] << 8) | bytes[o + 8] };
      o += 2 + len;
    }
  }
  return null;
}
