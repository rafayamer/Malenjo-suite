/**
 * MAL-011 native inline text editing and MAL-023 search and replace.
 *
 * Edits change the PDF's own text-showing operations (the bytes a Tj/TJ
 * draws), re-encoded through the run's own font. They never add an overlay.
 * When the font cannot draw a character (a subset without that glyph, an
 * encoding without it, an unmapped Type3 font), the edit is refused with the
 * exact characters, so the caller can offer an explicitly labelled overlay.
 */
import { PDFDocument, PDFName } from 'pdf-lib';
import { rewriteContent, serializeOperand, type ContentOp, type Operand } from './contentLexer';
import { documentModels, type PageModel, type TextRun } from './contentModel';
import { viewerFrame } from '../pdfStamp';

export class GlyphUnavailableError extends Error {
  constructor(readonly missing: string[], readonly fontName: string) {
    super(`The font “${fontName.replace(/^[A-Z]{6}\+/, '')}” in this PDF has no glyph for ${missing.map((c) => `“${c}”`).join(', ')}. `
      + 'Native editing keeps the original font, so this change cannot be made in place.');
  }
}

export interface TextRunInfo {
  id: number; text: string; fontName: string; size: number;
  /** Box in page space. */
  box: [number, number, number, number];
  /** Box as fractions of the page as shown (origin top-left), after /Rotate, crop box and view rotation. */
  shown: { x: number; y: number; width: number; height: number };
  editable: boolean; reason: string;
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  if (!(bytes instanceof Uint8Array) || bytes.length < 5 || bytes.length > 256 * 1024 * 1024) throw new Error('Text editing accepts PDFs up to 256 MB.');
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    if (pdf.getPageCount() < 1) throw new Error('no pages');
    return pdf;
  } catch { throw new Error('This PDF could not be opened for text editing because it is encrypted, invalid or damaged.'); }
}

function editability(run: TextRun): { editable: boolean; reason: string } {
  if (run.font.kind === 'type3') return { editable: false, reason: 'drawn with a Type 3 (picture) font' };
  if (run.unmapped) return { editable: false, reason: 'its font does not say which characters it draws' };
  return { editable: true, reason: '' };
}

/** Text runs on a page, in drawing order, with whether they can be edited natively. */
export async function listPdfTextRuns(bytes: Uint8Array, pageNumber: number, viewRotation = 0): Promise<TextRunInfo[]> {
  const pdf = await load(bytes);
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.getPageCount()) throw new Error('That page is not in this PDF.');
  const model = documentModels(pdf)[pageNumber - 1];
  const frame = viewerFrame(pdf, pageNumber - 1, viewRotation);
  const [a, b, c, d, e, f] = frame.matrix; const det = a * d - b * c;
  const toShown = (x: number, y: number): [number, number] => {
    const u = (d * (x - e) - c * (y - f)) / det, v = (a * (y - f) - b * (x - e)) / det;
    return [u / frame.width, 1 - v / frame.height];
  };
  const shownOf = (box: TextRun['box']) => {
    const pts = [toShown(box[0], box[1]), toShown(box[2], box[3]), toShown(box[0], box[3]), toShown(box[2], box[1])];
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  };
  return model.runs.filter((run) => run.text.trim()).map((run) => ({
    shown: shownOf(run.box), id: run.id, text: run.text, fontName: run.font.baseFont.replace(/^[A-Z]{6}\+/, ''), size: Math.round(Math.hypot(run.start[2], run.start[3]) * 100) / 100, box: run.box, ...editability(run) }));
}

/** Replacement text for one text-showing operation, keeping its operator semantics. */
function rewrittenOp(op: ContentOp, encoded: Uint8Array): string {
  const string: Operand = { type: 'string', bytes: encoded, hex: true };
  if (op.op === '"') return [serializeOperand(op.operands[0]), serializeOperand(op.operands[1]), serializeOperand(string), '"'].join(' ');
  if (op.op === "'") return `${serializeOperand(string)} '`;
  return `${serializeOperand(string)} Tj`;
}

function encodeOrThrow(run: TextRun, text: string): Uint8Array {
  const result = run.font.encode(text);
  if ('missing' in result) throw new GlyphUnavailableError(result.missing, run.font.baseFont);
  return result.bytes;
}

function writePage(pdf: PDFDocument, pageIndex: number, model: PageModel, replace: Map<number, string>): void {
  const data = rewriteContent(model.data, model.ops, replace);
  const stream = pdf.context.flateStream(data);
  pdf.getPage(pageIndex).node.set(PDFName.of('Contents'), pdf.context.obj([pdf.context.register(stream)]));
}

const save = async (pdf: PDFDocument) => Uint8Array.from(await pdf.save({ useObjectStreams: false, updateFieldAppearances: false }));

/**
 * Replaces the whole text of one run. `expected` must equal the run's current
 * text, so an edit made against a stale view is refused instead of misapplied.
 */
export async function replacePdfTextRun(bytes: Uint8Array, pageNumber: number, runId: number, expected: string, text: string): Promise<Uint8Array> {
  if (typeof text !== 'string' || text.length > 2000 || /[\u0000-\u001F]/.test(text)) throw new Error('Text must be one line of at most 2,000 characters.');
  const pdf = await load(bytes);
  const models = documentModels(pdf);
  const model = models[pageNumber - 1];
  const run = model?.runs[runId];
  if (!run || run.text !== expected) throw new Error('This text changed since it was selected. Select it again.');
  const { editable, reason } = editability(run);
  if (!editable) throw new Error(`This text cannot be edited in place because it is ${reason}.`);
  writePage(pdf, pageNumber - 1, model, new Map([[run.opIndex, rewrittenOp(model.ops[run.opIndex], encodeOrThrow(run, text))]]));
  return save(pdf);
}

export interface TextMatch { pageNumber: number; runId: number; index: number; text: string; context: string }

function finder(query: string, matchCase: boolean): RegExp {
  if (!query || query.length > 500) throw new Error('Enter text to find (up to 500 characters).');
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
}

/** Finds text within individual runs (a match split across separately drawn pieces is not found). */
export async function searchPdfText(bytes: Uint8Array, query: string, matchCase = false): Promise<TextMatch[]> {
  const pdf = await load(bytes);
  const pattern = finder(query, matchCase);
  const out: TextMatch[] = [];
  documentModels(pdf).forEach((model, pageIndex) => model.runs.forEach((run) => {
    for (const m of run.text.matchAll(pattern)) {
      out.push({ pageNumber: pageIndex + 1, runId: run.id, index: m.index!, text: m[0], context: run.text });
    }
  }));
  return out;
}

export interface ReplaceReport { bytes: Uint8Array; replaced: number; runs: number; refused: { pageNumber: number; text: string; reason: string }[] }

/** Replaces every match in place; runs whose font cannot draw the replacement are left unchanged and reported. */
export async function replacePdfText(bytes: Uint8Array, query: string, replacement: string, matchCase = false): Promise<ReplaceReport> {
  if (typeof replacement !== 'string' || replacement.length > 2000 || /[\u0000-\u001F]/.test(replacement)) throw new Error('The replacement must be one line of at most 2,000 characters.');
  const pdf = await load(bytes);
  const pattern = finder(query, matchCase);
  const models = documentModels(pdf);
  let replaced = 0, runs = 0;
  const refused: ReplaceReport['refused'] = [];
  models.forEach((model, pageIndex) => {
    const edits = new Map<number, string>();
    for (const run of model.runs) {
      const count = [...run.text.matchAll(pattern)].length;
      if (!count) continue;
      const { editable, reason } = editability(run);
      if (!editable) { refused.push({ pageNumber: pageIndex + 1, text: run.text, reason: `it is ${reason}` }); continue; }
      const next = run.text.replace(pattern, () => replacement);
      const encoded = run.font.encode(next);
      if ('missing' in encoded) { refused.push({ pageNumber: pageIndex + 1, text: run.text, reason: `its font has no glyph for ${encoded.missing.join(' ')}` }); continue; }
      edits.set(run.opIndex, rewrittenOp(model.ops[run.opIndex], encoded.bytes));
      replaced += count; runs++;
    }
    if (edits.size) writePage(pdf, pageIndex, model, edits);
  });
  if (!replaced && !refused.length) throw new Error(`“${query}” was not found.`);
  return { bytes: replaced ? await save(pdf) : bytes, replaced, runs, refused };
}
