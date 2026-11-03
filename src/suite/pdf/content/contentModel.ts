/**
 * Interprets one page's content stream (graphics and text state) into
 * editable objects: text runs, image placements and vector paths, each tied
 * to the operations that draw it. Form XObjects are listed but not entered.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFStream, decodePDFRawStream } from 'pdf-lib';
import { tokenizeContent, type ContentOp, type Operand } from './contentLexer';
import { fontCodec, type FontCodec } from './fontCodec';

export type Matrix = [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** m then n (a point is transformed by m first). */
export const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
export const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export type Box = [number, number, number, number];
const boxOf = (points: [number, number][]): Box => [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1])), Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))];

export interface TextRun {
  id: number;
  opIndex: number;
  /** Index of the BT operation that opens this run's text object. */
  btIndex: number;
  fontKey: string;
  font: FontCodec;
  size: number;
  text: string;
  codes: number[];
  /** True when some code had no Unicode mapping (text shown as �). */
  unmapped: boolean;
  /** Text rendering matrix at the start of the run (text space -> page space, before size). */
  start: Matrix;
  /** Advance in unscaled text space (already includes size, spacing and scaling). */
  advance: number;
  box: Box;
  charSpacing: number;
  wordSpacing: number;
  horizontalScale: number;
  leading: number;
  fill: string;
}
export interface ImagePlacement { id: number; opIndex: number; name: string; ctm: Matrix; box: Box; ref: string | null }
export interface PathObject { id: number; startIndex: number; endIndex: number; paint: string; ctm: Matrix; box: Box; stroke: string; fill: string; lineWidth: number }

export interface PageModel {
  data: Uint8Array;
  ops: ContentOp[];
  runs: TextRun[];
  images: ImagePlacement[];
  paths: PathObject[];
  fonts: Map<string, FontCodec>;
}

const N = (name: string) => PDFName.of(name);
const numberOf = (o: Operand | undefined) => (o && o.type === 'number' ? o.value : 0);

export function pageContentBytes(pdf: PDFDocument, pageIndex: number): Uint8Array {
  const node = pdf.getPage(pageIndex).node;
  const direct = node.get(N('Contents'));
  const resolved = direct ? pdf.context.lookup(direct) : undefined;
  const refs = resolved instanceof PDFArray ? resolved.asArray() : direct ? [direct] : [];
  const parts = refs.map((ref) => {
    const stream = pdf.context.lookup(ref);
    if (!(stream instanceof PDFStream)) return new Uint8Array();
    return stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
  });
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; out[at++] = 10; }
  return out;
}

/** Font codecs for every font a page's resources name; usage is collected across the document. */
export function pageFonts(pdf: PDFDocument, pageIndex: number, cache = new Map<PDFDict, FontCodec>()): Map<string, FontCodec> {
  const fonts = new Map<string, FontCodec>();
  const dict = pdf.getPage(pageIndex).node.Resources()?.lookupMaybe(N('Font'), PDFDict);
  for (const [key] of dict?.entries() ?? []) {
    const fontDict = dict!.lookupMaybe(key, PDFDict);
    if (!fontDict) continue;
    if (!cache.has(fontDict)) cache.set(fontDict, fontCodec(pdf, key.decodeText(), fontDict));
    fonts.set(key.decodeText(), cache.get(fontDict)!);
  }
  return fonts;
}

const color = (operands: Operand[], kind: string): string => {
  const v = operands.map(numberOf);
  const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0')).join('');
  if (kind === 'g') return hex(v[0], v[0], v[0]);
  if (kind === 'rg') return hex(v[0], v[1], v[2]);
  if (kind === 'k') return hex((1 - v[0]) * (1 - v[3]), (1 - v[1]) * (1 - v[3]), (1 - v[2]) * (1 - v[3]));
  return '#000000';
};

export function readPageModel(pdf: PDFDocument, pageIndex: number, fontCache?: Map<PDFDict, FontCodec>): PageModel {
  const data = pageContentBytes(pdf, pageIndex);
  const ops = tokenizeContent(data);
  const fonts = pageFonts(pdf, pageIndex, fontCache);
  const xobjects = pdf.getPage(pageIndex).node.Resources()?.lookupMaybe(N('XObject'), PDFDict);
  const runs: TextRun[] = []; const images: ImagePlacement[] = []; const paths: PathObject[] = [];
  type State = { ctm: Matrix; fill: string; stroke: string; lineWidth: number; font?: FontCodec; fontKey: string; size: number; tc: number; tw: number; tz: number; tl: number; ts: number };
  let gs: State = { ctm: [...IDENTITY] as Matrix, fill: '#000000', stroke: '#000000', lineWidth: 1, fontKey: '', size: 0, tc: 0, tw: 0, tz: 100, tl: 0, ts: 0 };
  const stack: State[] = [];
  let tm: Matrix = [...IDENTITY] as Matrix, tlm: Matrix = [...IDENTITY] as Matrix, btIndex = -1;
  let pathStart = -1; let pathPoints: [number, number][] = [];

  const show = (opIndex: number, items: Operand[]) => {
    const font = gs.font;
    if (!font) return;
    const th = gs.tz / 100;
    const start = multiply(multiply([gs.size * th, 0, 0, gs.size, 0, gs.ts], tm), gs.ctm);
    let advance = 0; const codes: number[] = []; let text = ''; let unmapped = false;
    for (const item of items) {
      if (item.type === 'number') { advance -= (item.value / 1000) * gs.size * th; continue; }
      if (item.type !== 'string') continue;
      for (const code of font.codes(item.bytes)) {
        codes.push(code); font.used.add(code);
        const u = font.unicode(code);
        if (u === null) unmapped = true;
        text += u ?? '�';
        advance += ((font.width(code) / 1000) * gs.size + gs.tc + (font.bytesPerCode === 1 && code === 32 ? gs.tw : 0)) * th;
      }
    }
    const textToPage = multiply(tm, gs.ctm);
    const descent = -0.25 * gs.size, ascent = 0.85 * gs.size;
    const corners = [apply(textToPage, 0, descent + gs.ts), apply(textToPage, advance, descent + gs.ts), apply(textToPage, 0, ascent + gs.ts), apply(textToPage, advance, ascent + gs.ts)];
    runs.push({ id: runs.length, opIndex, btIndex, fontKey: gs.fontKey, font, size: gs.size, text, codes, unmapped, start, advance, box: boxOf(corners),
      charSpacing: gs.tc, wordSpacing: gs.tw, horizontalScale: gs.tz, leading: gs.tl, fill: gs.fill });
    tm = multiply([1, 0, 0, 1, advance, 0], tm);
  };
  const nextLine = (tx: number, ty: number) => { tlm = multiply([1, 0, 0, 1, tx, ty], tlm); tm = [...tlm] as Matrix; };

  ops.forEach((op, index) => {
    const o = op.operands; const n = (k: number) => numberOf(o[k]);
    switch (op.op) {
      case 'q': stack.push({ ...gs, ctm: [...gs.ctm] as Matrix }); break;
      case 'Q': gs = stack.pop() ?? gs; break;
      case 'cm': gs.ctm = multiply([n(0), n(1), n(2), n(3), n(4), n(5)], gs.ctm); break;
      case 'w': gs.lineWidth = n(0); break;
      case 'g': case 'rg': case 'k': gs.fill = color(o, op.op); break;
      case 'G': case 'RG': case 'K': gs.stroke = color(o, op.op.toLowerCase()); break;
      case 'BT': tm = [...IDENTITY] as Matrix; tlm = [...IDENTITY] as Matrix; btIndex = index; break;
      case 'Tf': gs.fontKey = o[0]?.type === 'name' ? o[0].value : ''; gs.font = fonts.get(gs.fontKey); gs.size = n(1); break;
      case 'Tc': gs.tc = n(0); break;
      case 'Tw': gs.tw = n(0); break;
      case 'Tz': gs.tz = n(0); break;
      case 'TL': gs.tl = n(0); break;
      case 'Ts': gs.ts = n(0); break;
      case 'Td': nextLine(n(0), n(1)); break;
      case 'TD': gs.tl = -n(1); nextLine(n(0), n(1)); break;
      case 'Tm': tlm = [n(0), n(1), n(2), n(3), n(4), n(5)]; tm = [...tlm] as Matrix; break;
      case 'T*': nextLine(0, -gs.tl); break;
      case 'Tj': show(index, [o[0]]); break;
      case 'TJ': show(index, o[0]?.type === 'array' ? o[0].items : []); break;
      case "'": nextLine(0, -gs.tl); show(index, [o[0]]); break;
      case '"': gs.tw = n(0); gs.tc = n(1); nextLine(0, -gs.tl); show(index, [o[2]]); break;
      case 'Do': {
        const name = o[0]?.type === 'name' ? o[0].value : '';
        const ref = xobjects?.get(N(name));
        const object = ref ? pdf.context.lookup(ref) : undefined;
        if (object instanceof PDFRawStream && object.dict.get(N('Subtype'))?.toString() === '/Image') {
          const corners: [number, number][] = [apply(gs.ctm, 0, 0), apply(gs.ctm, 1, 0), apply(gs.ctm, 0, 1), apply(gs.ctm, 1, 1)];
          images.push({ id: images.length, opIndex: index, name, ctm: [...gs.ctm] as Matrix, box: boxOf(corners), ref: ref ? ref.toString() : null });
        }
        break;
      }
      case 'm': case 'l': case 're': case 'c': case 'v': case 'y': case 'h': {
        if (pathStart < 0) { pathStart = index; pathPoints = []; }
        if (op.op === 're') { const [x, y, w, h] = [n(0), n(1), n(2), n(3)]; pathPoints.push(apply(gs.ctm, x, y), apply(gs.ctm, x + w, y + h)); }
        else for (let k = 0; k + 1 < o.length; k += 2) pathPoints.push(apply(gs.ctm, n(k), n(k + 1)));
        break;
      }
      case 'S': case 's': case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*': case 'n':
        if (pathStart >= 0 && op.op !== 'n' && pathPoints.length) {
          paths.push({ id: paths.length, startIndex: pathStart, endIndex: index, paint: op.op, ctm: [...gs.ctm] as Matrix, box: boxOf(pathPoints), stroke: gs.stroke, fill: gs.fill, lineWidth: gs.lineWidth });
        }
        pathStart = -1; pathPoints = [];
        break;
      default: break;
    }
  });
  return { data, ops, runs, images, paths, fonts };
}

/** Collects, across every page, which codes each font uses (needed before encoding into subset fonts). */
export function documentModels(pdf: PDFDocument): PageModel[] {
  const cache = new Map<PDFDict, FontCodec>();
  return pdf.getPages().map((_, index) => readPageModel(pdf, index, cache));
}
