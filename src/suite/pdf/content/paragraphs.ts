/**
 * MAL-012 paragraph reconstruction and reflow, MAL-013 typography.
 *
 * Text runs on a page are grouped into lines (same baseline) and lines into
 * paragraphs (same font size, regular line spacing, aligned edges). A
 * paragraph can be rewritten as a whole: its runs are removed and the new
 * text is laid out inside the paragraph's original width with the chosen
 * alignment, size, line height and spacing. The original font is kept when
 * it can draw every character; otherwise the edit is refused, or a standard
 * font is used when the caller chose one, and that substitution is reported.
 * Text that needs more height than the original box is detected and refused
 * unless growing is allowed.
 */
import { refuseSignedPdf } from '../pdfSignatureGuard';
import { PDFDocument, PDFName, StandardFonts, type PDFFont } from 'pdf-lib';
import { rewriteContent, serializeOperand } from './contentLexer';
import { documentModels, invert, type Box, type PageModel, type TextRun } from './contentModel';
import type { ContentOp } from './contentLexer';
import { GlyphUnavailableError } from './textEdit';
import { parseColor, viewerFrame } from '../pdfStamp';

export type ParagraphAlign = 'left' | 'center' | 'right' | 'justify';
export type ParagraphFont = 'keep' | 'helvetica' | 'helvetica-bold' | 'times' | 'times-bold' | 'courier';
export interface ParagraphInfo {
  id: number; text: string; lines: number; box: Box;
  shown: { x: number; y: number; width: number; height: number };
  fontName: string; embedded: boolean; subset: boolean; size: number; lineHeight: number; align: ParagraphAlign;
  editable: boolean; reason: string;
}
export interface ParagraphStyle { align: ParagraphAlign; size: number; lineHeight: number; charSpacing: number; wordSpacing: number; font: ParagraphFont }
export interface ReflowReport { bytes: Uint8Array; lines: number; overflow: boolean; substitution: string | null }
export class ParagraphOverflowError extends Error {
  constructor(readonly needed: number, readonly available: number, message?: string) {
    super(message ?? `The text needs ${needed} lines but the paragraph has room for ${available}. Shorten it, make it smaller, or allow it to grow.`);
  }
}

const STANDARD: Record<Exclude<ParagraphFont, 'keep'>, StandardFonts> = {
  helvetica: StandardFonts.Helvetica, 'helvetica-bold': StandardFonts.HelveticaBold, times: StandardFonts.TimesRoman, 'times-bold': StandardFonts.TimesRomanBold, courier: StandardFonts.Courier,
};

interface Line { runs: TextRun[]; x0: number; x1: number; baseline: number; size: number }
interface Paragraph { lines: Line[]; box: Box; size: number; lineHeight: number; align: ParagraphAlign }

const horizontal = (run: TextRun) => Math.abs(run.start[1]) < 1e-3 && Math.abs(run.start[2]) < 1e-3 && run.start[0] > 0 && run.start[3] > 0;
const sizeOf = (run: TextRun) => run.start[3];

/** Groups the page's horizontal text into paragraphs. */
function paragraphsOf(model: PageModel): Paragraph[] {
  const runs = model.runs.filter((run) => run.text.trim() && horizontal(run));
  // Lines: runs sharing a baseline and size, horizontally close on either side, in reading order.
  const lines: Line[] = [];
  for (const run of [...runs].sort((a, b) => b.start[5] - a.start[5] || a.start[4] - b.start[4])) {
    const size = sizeOf(run);
    const line = lines.find((l) => Math.abs(l.baseline - run.start[5]) < size * 0.2 && Math.abs(l.size - size) < 0.5 && Math.max(run.box[0] - l.x1, l.x0 - run.box[2]) < size * 2);
    if (line) { line.runs.push(run); line.x1 = Math.max(line.x1, run.box[2]); line.x0 = Math.min(line.x0, run.box[0]); }
    else lines.push({ runs: [run], x0: run.box[0], x1: run.box[2], baseline: run.start[5], size });
  }
  lines.sort((a, b) => b.baseline - a.baseline || a.x0 - b.x0);
  const paragraphs: Paragraph[] = [];
  for (const line of lines) {
    const last = paragraphs[paragraphs.length - 1];
    const prev = last?.lines[last.lines.length - 1];
    const gap = prev ? prev.baseline - line.baseline : Infinity;
    const sameSize = prev && Math.abs(prev.size - line.size) < 0.5;
    const regular = prev && gap > line.size * 0.9 && gap < line.size * 1.9 && (last.lines.length < 2 || Math.abs(gap - last.lineHeight) < line.size * 0.25);
    const aligned = prev && (Math.abs(prev.x0 - line.x0) < line.size || Math.abs((prev.x0 + prev.x1) / 2 - (line.x0 + line.x1) / 2) < line.size || Math.abs(prev.x1 - line.x1) < line.size);
    if (last && sameSize && regular && aligned) {
      last.lines.push(line);
      if (last.lines.length === 2) last.lineHeight = gap;
    } else paragraphs.push({ lines: [line], box: [0, 0, 0, 0], size: line.size, lineHeight: line.size * 1.2, align: 'left' });
  }
  for (const p of paragraphs) {
    p.box = [Math.min(...p.lines.flatMap((l) => l.runs.map((r) => r.box[0]))), Math.min(...p.lines.flatMap((l) => l.runs.map((r) => r.box[1]))),
      Math.max(...p.lines.flatMap((l) => l.runs.map((r) => r.box[2]))), Math.max(...p.lines.flatMap((l) => l.runs.map((r) => r.box[3])))];
    const lefts = p.lines.map((l) => l.x0), rights = p.lines.map((l) => l.x1), centres = p.lines.map((l) => (l.x0 + l.x1) / 2);
    const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
    if (p.lines.length > 1) {
      const full = p.lines.slice(0, -1).every((l) => Math.abs(l.x1 - p.box[2]) < p.size * 0.6);
      p.align = spread(lefts) < p.size * 0.5 ? (full && spread(rights.slice(0, -1)) < p.size * 0.3 && p.lines.length > 2 ? 'justify' : 'left')
        : spread(rights) < p.size * 0.5 ? 'right' : spread(centres) < p.size * 0.5 ? 'center' : 'left';
    }
  }
  return paragraphs;
}

/** A line's text: runs in order, with a space only where their gap shows one (a word drawn in pieces stays whole). */
const lineText = (line: Line) => {
  const runs = line.runs.sort((a, b) => a.start[4] - b.start[4]);
  let text = '';
  runs.forEach((run, i) => {
    const gap = i ? run.box[0] - runs[i - 1].box[2] : 0;
    if (i && gap > line.size * 0.15 && !/\s$/.test(text) && !/^\s/.test(run.display)) text += ' ';
    text += run.display;
  });
  return text.replace(/\s+/g, ' ').trim();
};
/**
 * What a removed text-showing operation leaves behind: its effect on the text state without
 * drawing anything. ' and " still move to the next line (and " still sets word and character
 * spacing), and the horizontal advance is kept with a glyph-free TJ, so the rest of the text
 * object stays where it was.
 */
function silenced(op: ContentOp, run: TextRun): string {
  const th = run.horizontalScale / 100;
  const shift = run.size && th ? Math.round((-run.advance * 1000) / (run.size * th) * 1000) / 1000 : 0;
  const advance = shift ? `[${shift}] TJ` : '';
  if (op.op === "'") return `T* ${advance}`.trim();
  if (op.op === '"') return `${serializeOperand(op.operands[0])} Tw ${serializeOperand(op.operands[1])} Tc T* ${advance}`.trim();
  return advance;
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  if (!(bytes instanceof Uint8Array) || bytes.length < 5 || bytes.length > 256 * 1024 * 1024) throw new Error('Paragraph editing accepts PDFs up to 256 MB.');
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    if (pdf.getPageCount() < 1) throw new Error('no pages');
    return pdf;
  } catch { throw new Error('This PDF could not be opened for editing because it is encrypted, invalid or damaged.'); }
}

export async function listPdfParagraphs(bytes: Uint8Array, pageNumber: number, viewRotation = 0): Promise<ParagraphInfo[]> {
  const pdf = await load(bytes);
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.getPageCount()) throw new Error('That page is not in this PDF.');
  const model = documentModels(pdf)[pageNumber - 1];
  const frame = viewerFrame(pdf, pageNumber - 1, viewRotation);
  const [a, b, c, d, e, f] = frame.matrix; const det = a * d - b * c;
  const toShown = (x: number, y: number) => [((d * (x - e) - c * (y - f)) / det) / frame.width, 1 - ((a * (y - f) - b * (x - e)) / det) / frame.height];
  return paragraphsOf(model).map((p, id) => {
    const font = p.lines[0].runs[0].font;
    const pts = [toShown(p.box[0], p.box[1]), toShown(p.box[2], p.box[3])];
    const blocked = p.lines.flatMap((l) => l.runs).find((r) => r.unmapped || r.font.kind === 'type3');
    return {
      id, text: p.lines.map(lineText).join('\n'), lines: p.lines.length, box: p.box,
      shown: { x: Math.min(pts[0][0], pts[1][0]), y: Math.min(pts[0][1], pts[1][1]), width: Math.abs(pts[1][0] - pts[0][0]), height: Math.abs(pts[1][1] - pts[0][1]) },
      fontName: font.baseFont.replace(/^[A-Z]{6}\+/, ''), embedded: font.embedded, subset: font.subset, size: Math.round(p.size * 100) / 100,
      lineHeight: Math.round((p.lines.length > 1 ? p.lineHeight / p.size : 1.2) * 100) / 100, align: p.align,
      editable: !blocked, reason: blocked ? 'its font does not say which characters it draws' : '',
    };
  });
}

/** Rewrites a paragraph's text and formatting in place (see module comment). */
export async function reflowPdfParagraph(bytes: Uint8Array, pageNumber: number, id: number, expected: string, text: string, style: ParagraphStyle, allowGrow: boolean): Promise<ReflowReport> {
  if (typeof text !== 'string' || !text.trim() || text.length > 20000) throw new Error('Enter the paragraph text (up to 20,000 characters).');
  if (!(style.size >= 4 && style.size <= 144)) throw new Error('Text size must be between 4 and 144 points.');
  if (!(style.lineHeight >= 0.8 && style.lineHeight <= 4)) throw new Error('Line height must be between 0.8 and 4 times the text size.');
  if (!(Math.abs(style.charSpacing) <= 20) || !(Math.abs(style.wordSpacing) <= 50)) throw new Error('Spacing values are out of range.');
  const pdf = await load(bytes);
  refuseSignedPdf(pdf, 'editing it');
  const models = documentModels(pdf);
  const model = models[pageNumber - 1];
  if (!model) throw new Error('That page is not in this PDF.');
  const paragraph = paragraphsOf(model)[id];
  if (!paragraph || paragraph.lines.map(lineText).join('\n') !== expected) throw new Error('This paragraph changed since it was selected. Select it again.');
  const first = paragraph.lines[0].runs[0];
  // The rewritten block keeps the text rendering mode: invisible OCR text stays invisible. Stroked or
  // clipping text would also need its stroke and clip state, so those paragraphs are refused.
  const modes = new Set(paragraph.lines.flatMap((l) => l.runs.map((r) => r.render)));
  if (modes.size > 1 || ![0, 3].includes(first.render)) {
    throw new Error('This paragraph is drawn as outlined or clipping text (or mixes text drawing modes), which rewriting it cannot preserve. Edit its text runs one at a time instead.');
  }
  // The rewritten block is drawn in one colour; a coloured link or highlighted phrase would lose its colour.
  if (new Set(paragraph.lines.flatMap((l) => l.runs.map((r) => r.fill))).size > 1) {
    throw new Error('This paragraph mixes text colours (for example a coloured link), which rewriting it cannot preserve. Edit its text runs one at a time instead.');
  }
  if (paragraph.lines.some((l) => l.runs.some((r) => r.unmapped || r.font.kind === 'type3'))) throw new Error('This paragraph uses a font that does not say which characters it draws, so it cannot be rewritten.');

  // Measuring and encoding, either through the paragraph's own font or a chosen standard font.
  let fontKey = first.fontKey;
  let substitution: string | null = null;
  let measure: (s: string) => number;
  let encode: (s: string) => string;
  // Tw only applies to the single-byte code 32, so two-byte fonts get their word spacing from TJ adjustments.
  let twoByte = false;
  const words = text.replace(/\r/g, '').split('\n').map((p) => p.split(/\s+/).filter(Boolean));
  if (style.font === 'keep') {
    // One font is used for the rewritten text; a paragraph that mixes fonts (a bold phrase) would lose them.
    if (new Set(paragraph.lines.flatMap((l) => l.runs.map((r) => r.font.baseFont))).size > 1) {
      throw new Error('This paragraph mixes fonts (for example a bold phrase), which keeping the original font cannot preserve. Choose a font to rewrite it in, or edit its text runs one at a time.');
    }
    const font = first.font;
    twoByte = font.bytesPerCode === 2;
    const encoded = font.encode(words.flat().join(' '));
    if ('missing' in encoded) throw new GlyphUnavailableError(encoded.missing, font.baseFont);
    measure = (s) => {
      const r = font.encode(s); if ('missing' in r) return 0;
      return font.codes(r.bytes).reduce((sum, code) => sum + (font.width(code) / 1000) * style.size + style.charSpacing + (font.bytesPerCode === 1 && code === 32 ? style.wordSpacing : 0), 0)
        + (font.bytesPerCode === 2 ? (s.split(' ').length - 1) * style.wordSpacing : 0);
    };
    encode = (s) => { const r = font.encode(s); if ('missing' in r) throw new GlyphUnavailableError(r.missing, font.baseFont); return serializeOperand({ type: 'string', bytes: r.bytes, hex: true }); };
  } else {
    const standard: PDFFont = await pdf.embedFont(STANDARD[style.font]);
    const unsupported = [...new Set(words.flat().join(' '))].filter((ch) => { try { standard.encodeText(ch); return false; } catch { return true; } });
    if (unsupported.length) throw new GlyphUnavailableError(unsupported, standard.name);
    fontKey = pdf.getPage(pageNumber - 1).node.newFontDictionary('MalenjoP', standard.ref).decodeText();
    substitution = `“${first.font.baseFont.replace(/^[A-Z]{6}\+/, '')}” was replaced by ${standard.name}.`;
    measure = (s) => standard.widthOfTextAtSize(s, style.size) + s.length * style.charSpacing + (s.split(' ').length - 1) * style.wordSpacing;
    encode = (s) => standard.encodeText(s).toString();
  }

  // Lay out inside the original width.
  const width = paragraph.box[2] - paragraph.box[0];
  const laid: { text: string; last: boolean }[] = [];
  for (const paragraphWords of words) {
    let line = '';
    for (const whole of paragraphWords) {
      // A word wider than the paragraph is refused, or broken by characters when growing is allowed.
      const pieces: string[] = [];
      if (measure(whole) > width + 0.5) {
        if (!allowGrow) throw new ParagraphOverflowError(Infinity, 0, `“${whole.slice(0, 40)}” is wider than the paragraph. Shorten it, make the text smaller, or allow the text to grow.`);
        let chunk = '';
        for (const ch of whole) { if (chunk && measure(chunk + ch) > width + 0.5) { pieces.push(chunk); chunk = ''; } chunk += ch; }
        if (chunk) pieces.push(chunk);
      } else pieces.push(whole);
      for (const word of pieces) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > width + 0.5) { laid.push({ text: line, last: false }); line = word; } else line = next;
      }
    }
    laid.push({ text: line, last: true });
  }
  const leading = style.lineHeight * style.size;
  const available = Math.max(1, Math.floor((paragraph.box[3] - paragraph.box[1] - style.size) / leading + 1.0001));
  const overflow = laid.length > available;
  if (overflow && !allowGrow) throw new ParagraphOverflowError(laid.length, available);

  // Remove the old runs and draw the new block where the paragraph was drawn (after the text object
  // holding its last run), so content painted over the paragraph still covers it. The block is laid
  // out in page space, so it undoes the CTM in force there.
  const edits = new Map<number, string>();
  const runs = paragraph.lines.flatMap((l) => l.runs);
  for (const run of runs) edits.set(run.opIndex, silenced(model.ops[run.opIndex], run));
  const last = runs.reduce((a, b) => (b.opIndex > a.opIndex ? b : a));
  const etIndex = model.ops.findIndex((op, k) => k > last.opIndex && op.op === 'ET');
  const [r, g, b] = parseColor(first.fill);
  const firstBaseline = paragraph.lines[0].baseline;
  const round = (n: number) => Math.round(n * 10000) / 10000;
  const ops: string[] = ['q', `${invert(last.ctm).map(round).join(' ')} cm`, `${r} ${g} ${b} rg`, 'BT', `${serializeOperand({ type: 'name', value: fontKey })} ${style.size} Tf`,
    `${style.charSpacing} Tc`, '100 Tz', '0 Ts', `${first.render} Tr`];
  laid.forEach((line, i) => {
    const w = measure(line.text);
    const gaps = line.text.split(' ').length - 1;
    const justify = style.align === 'justify' && !line.last && gaps > 0;
    const x = style.align === 'center' ? paragraph.box[0] + (width - w) / 2 : style.align === 'right' ? paragraph.box[2] - w : paragraph.box[0];
    const tw = style.wordSpacing + (justify ? (width - w) / gaps : 0);
    const position = `1 0 0 1 ${Math.round(x * 100) / 100} ${Math.round((firstBaseline - i * leading) * 100) / 100} Tm`;
    if (twoByte) {
      const words = line.text.split(' ');
      const adjust = round((-tw * 1000) / style.size);
      const items = words.flatMap((word, k) => (k < words.length - 1 ? [encode(`${word} `), ...(adjust ? [String(adjust)] : [])] : word ? [encode(word)] : []));
      ops.push('0 Tw', position, `[${items.join(' ')}] TJ`);
    } else ops.push(`${round(tw)} Tw`, position, `${encode(line.text)} Tj`);
  });
  ops.push('ET', 'Q');
  const block = ops.join('\n');
  if (etIndex >= 0) edits.set(etIndex, `ET\n${block}`);
  const rewritten = rewriteContent(model.data, model.ops, edits);
  const content = etIndex >= 0 ? rewritten
    : new Uint8Array([...new TextEncoder().encode('q\n'), ...rewritten, ...new TextEncoder().encode(`\nQ\n${block}\n`)]);
  pdf.getPage(pageNumber - 1).node.set(PDFName.of('Contents'), pdf.context.obj([pdf.context.register(pdf.context.flateStream(content))]));
  const out = Uint8Array.from(await pdf.save({ useObjectStreams: false, updateFieldAppearances: false }));
  return { bytes: out, lines: laid.length, overflow, substitution };
}
