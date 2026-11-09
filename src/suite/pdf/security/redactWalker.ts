/**
 * The content-stream walker behind permanent redaction (MAL-063) and sensitive-text detection (MAL-064).
 *
 * It follows the graphics and text state of a content stream (and of the form XObjects it draws) and either
 * collects every glyph with its position on the page, or rewrites the stream so that nothing inside the marked
 * areas survives:
 * - glyphs touching a mark are replaced by the equivalent positioning adjustment, so the text around them stays put;
 * - images touching a mark have those pixels replaced by black (or are removed when they cannot be decoded);
 * - paths with any point inside a mark are removed (a clipping path keeps only its bounding rectangle);
 * - inline images touching a mark are removed;
 * - form XObjects touching a mark are rewritten as private copies, so other pages that share them are unchanged;
 * - replacement text (ActualText, Alt, E) of marked content that lost glyphs is dropped.
 */
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream, type PDFDocument } from 'pdf-lib';
import { rewriteContent, serializeOperand, tokenizeContent, type Operand } from '../content/contentLexer';
import { IDENTITY, apply, multiply, pageContentBytes, type Box, type Matrix } from '../content/contentModel';
import { fontCodec, type FontCodec } from '../content/fontCodec';
import { redactImagePixels, type ImageDecoder } from './redactImages';

export interface PageGlyph {
  text: string;
  /** Corners in page space: baseline start, baseline end, top start, top end. */
  quad: [number, number][];
  box: Box;
  /** Font size as drawn on the page (text space height). */
  size: number;
}
export interface RedactStats { glyphs: number; imagesEdited: number; imagesRemoved: number; paths: number; forms: number; markedContent: number }
export interface WalkContext {
  pdf: PDFDocument;
  marks: Box[];
  /** Collect mode: glyphs are gathered here and nothing is rewritten. */
  collect?: PageGlyph[];
  fonts: Map<PDFDict, FontCodec | null>;
  decodeImage?: ImageDecoder;
  stats: RedactStats;
  /** Phrases removed from visible text, for scrubbing the same words elsewhere. */
  removedText: string[];
  names: { next: number };
}

const N = PDFName.of;
const MAX_DEPTH = 12;
const EPS = 0.01;
const num = (o: Operand | undefined) => (o && o.type === 'number' ? o.value : 0);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));
export const boxOf = (points: [number, number][]): Box => [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1])), Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))];
export const overlaps = (a: Box, b: Box) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > EPS && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > EPS;
const pointIn = (p: [number, number], b: Box) => p[0] >= b[0] - EPS && p[0] <= b[2] + EPS && p[1] >= b[1] - EPS && p[1] <= b[3] + EPS;

export function decodedStream(stream: PDFStream): Uint8Array {
  return stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
}
/** A shallow copy, so adding or renaming entries leaves the original (possibly shared) dictionary alone. */
export function copyDict(pdf: PDFDocument, dict: PDFDict | undefined): PDFDict {
  const out = pdf.context.obj({});
  for (const [key, value] of dict?.entries() ?? []) out.set(key, value);
  return out;
}

/** Walks one content stream; returns the rewritten bytes and resources (unchanged objects when nothing was hit). */
export async function walkContent(ctx: WalkContext, data: Uint8Array, resources: PDFDict | undefined, base: Matrix, depth = 0): Promise<{ data: Uint8Array; resources: PDFDict | undefined; changed: boolean }> {
  if (depth > MAX_DEPTH) throw new Error('This PDF nests its drawings too deeply to be redacted safely.');
  const { pdf } = ctx;
  const ops = tokenizeContent(data);
  const replace = new Map<number, string>();
  const fontsDict = resources?.lookupMaybe(N('Font'), PDFDict);
  const xobjects = resources?.lookupMaybe(N('XObject'), PDFDict);
  let ownXObjects: PDFDict | null = null; let ownResources: PDFDict | null = null;
  const own = () => { if (!ownResources) { ownResources = copyDict(pdf, resources); ownXObjects = copyDict(pdf, xobjects); ownResources.set(N('XObject'), ownXObjects); } return ownXObjects!; };
  const addXObject = (ref: PDFRef): string => {
    const name = `Rd${ctx.names.next++}`;
    own().set(N(name), ref);
    return name;
  };
  // An XObject whose every use was replaced is dropped from the resources, so the original is not kept in the file.
  const uses = new Map<string, number>(); const replacedUses = new Map<string, number>();
  for (const op of ops) if (op.op === 'Do' && op.operands[0]?.type === 'name') uses.set(op.operands[0].value, (uses.get(op.operands[0].value) ?? 0) + 1);
  const replacedDo = (name: string) => replacedUses.set(name, (replacedUses.get(name) ?? 0) + 1);
  const codecFor = (key: string): FontCodec | null => {
    const dict = fontsDict?.lookupMaybe(N(key), PDFDict);
    if (!dict) return null;
    if (!ctx.fonts.has(dict)) {
      let codec: FontCodec | null = null;
      try { codec = fontCodec(pdf, key, dict); } catch { codec = null; }
      // Glyph positions are exact only for horizontal fonts with fixed-length codes.
      const encoding = dict.get(N('Encoding'));
      const subtype = dict.get(N('Subtype'))?.toString();
      if (codec && subtype === '/Type0' && encoding?.toString() !== '/Identity-H') codec = null;
      if (codec && subtype === '/Type3') codec = null;
      ctx.fonts.set(dict, codec);
    }
    return ctx.fonts.get(dict) ?? null;
  };

  type State = { ctm: Matrix; codec: FontCodec | null; size: number; tc: number; tw: number; tz: number; tl: number; ts: number };
  let gs: State = { ctm: [...base] as Matrix, codec: null, size: 0, tc: 0, tw: 0, tz: 100, tl: 0, ts: 0 };
  const stack: State[] = [];
  let tm: Matrix = [...IDENTITY] as Matrix, tlm: Matrix = [...IDENTITY] as Matrix;
  const marked: { index: number; dict: Operand | null; hit: boolean }[] = [];
  let pathStart = -1; let pathLocal: [number, number][] = []; let pathHit = false; let clipAt = -1;
  const hits = (box: Box) => ctx.marks.some((m) => overlaps(box, m));

  /** Shows text; in redact mode returns the TJ items to draw instead, or null when nothing was hit. */
  const show = (items: Operand[]): Operand[] | null => {
    const th = gs.tz / 100; const size = gs.size; const codec = gs.codec;
    const textToPage = () => multiply(tm, gs.ctm);
    const out: Operand[] = []; let hit = false; let phrase = '';
    const endPhrase = () => { if (phrase.trim()) ctx.removedText.push(phrase.trim()); phrase = ''; };
    const glyphQuad = (x0: number, x1: number): [number, number][] => {
      const m = textToPage(); const lo = gs.ts - 0.25 * size, hi = gs.ts + 0.9 * size;
      return [apply(m, x0, lo), apply(m, x1, lo), apply(m, x0, hi), apply(m, x1, hi)];
    };
    const advanceBy = (tx: number) => { tm = multiply([1, 0, 0, 1, tx, 0], tm); };
    for (const item of items) {
      if (item.type === 'number') { advanceBy(-(item.value / 1000) * size * th); out.push(item); continue; }
      if (item.type !== 'string') continue;
      const exact = codec && (codec.bytesPerCode === 1 || item.bytes.length % 2 === 0);
      if (!exact) {
        // Unknown metrics: treat the string as one block, half an em per byte, and remove it whole when touched.
        const width = codec ? codec.codes(item.bytes).reduce((n, c) => n + codec.width(c), 0) : item.bytes.length * 500;
        const tx = ((width / 1000) * size + item.bytes.length * gs.tc) * th;
        const m = textToPage(); const lo = gs.ts - 0.5 * size, hi = gs.ts + 1.2 * size;
        const quad: [number, number][] = [apply(m, 0, lo), apply(m, tx, lo), apply(m, 0, hi), apply(m, tx, hi)];
        const text = codec ? codec.codes(item.bytes).map((c) => codec.unicode(c) ?? '').join('') : '';
        if (ctx.collect) ctx.collect.push({ text, quad, box: boxOf(quad), size: Math.abs(size) * Math.hypot(m[2], m[3]) });
        if (!ctx.collect && size !== 0 && hits(boxOf(quad))) {
          hit = true; ctx.stats.glyphs += Math.max(1, codec ? codec.codes(item.bytes).length : item.bytes.length);
          if (text.trim()) ctx.removedText.push(text.trim());
          out.push({ type: 'number', value: -(tx / th) * 1000 / size });
        } else out.push(item);
        advanceBy(tx);
        continue;
      }
      const codes = codec!.codes(item.bytes); const width = codec!.bytesPerCode;
      let kept: number[] = [];
      const flushKept = () => { if (kept.length) { out.push({ type: 'string', hex: true, bytes: Uint8Array.from(kept) }); kept = []; } };
      codes.forEach((code, k) => {
        const w = codec!.width(code);
        const spacing = gs.tc + (width === 1 && code === 32 ? gs.tw : 0);
        const glyphWidth = (w / 1000) * size * th;
        const tx = ((w / 1000) * size + spacing) * th;
        const quad = glyphQuad(0, glyphWidth);
        const text = codec!.unicode(code) ?? '�';
        if (ctx.collect) {
          const m = textToPage();
          ctx.collect.push({ text, quad, box: boxOf(quad), size: Math.abs(size) * Math.hypot(m[2], m[3]) });
          advanceBy(tx); return;
        }
        if (size !== 0 && hits(boxOf(quad))) {
          hit = true; ctx.stats.glyphs++; phrase += text;
          flushKept();
          out.push({ type: 'number', value: -(w + (spacing * 1000) / size) });
        } else {
          endPhrase();
          const bytes = item.bytes.subarray(k * width, (k + 1) * width);
          kept.push(...bytes);
        }
        advanceBy(tx);
      });
      flushKept(); endPhrase();
    }
    if (!hit) return null;
    for (const entry of marked) entry.hit = true;
    // Merge neighbouring adjustments.
    const merged: Operand[] = [];
    for (const item of out) {
      const last = merged[merged.length - 1];
      if (item.type === 'number' && last?.type === 'number') merged[merged.length - 1] = { type: 'number', value: last.value + item.value };
      else merged.push(item);
    }
    return merged;
  };
  const nextLine = (tx: number, ty: number) => { tlm = multiply([1, 0, 0, 1, tx, ty], tlm); tm = [...tlm] as Matrix; };
  const tj = (items: Operand[]) => `${serializeOperand({ type: 'array', items })} TJ`;

  for (let index = 0; index < ops.length; index++) {
    const op = ops[index]; const o = op.operands; const n = (k: number) => num(o[k]);
    switch (op.op) {
      case 'q': stack.push({ ...gs, ctm: [...gs.ctm] as Matrix }); break;
      case 'Q': gs = stack.pop() ?? gs; break;
      case 'cm': gs.ctm = multiply([n(0), n(1), n(2), n(3), n(4), n(5)], gs.ctm); break;
      case 'BT': tm = [...IDENTITY] as Matrix; tlm = [...IDENTITY] as Matrix; break;
      case 'Tf': gs.codec = o[0]?.type === 'name' ? codecFor(o[0].value) : null; gs.size = n(1); break;
      case 'Tc': gs.tc = n(0); break;
      case 'Tw': gs.tw = n(0); break;
      case 'Tz': gs.tz = n(0); break;
      case 'TL': gs.tl = n(0); break;
      case 'Ts': gs.ts = n(0); break;
      case 'Td': nextLine(n(0), n(1)); break;
      case 'TD': gs.tl = -n(1); nextLine(n(0), n(1)); break;
      case 'Tm': tlm = [n(0), n(1), n(2), n(3), n(4), n(5)]; tm = [...tlm] as Matrix; break;
      case 'T*': nextLine(0, -gs.tl); break;
      case 'Tj': case 'TJ': case "'": case '"': {
        if (op.op === "'") nextLine(0, -gs.tl);
        if (op.op === '"') { gs.tw = n(0); gs.tc = n(1); nextLine(0, -gs.tl); }
        const shown = op.op === 'TJ' ? (o[0]?.type === 'array' ? o[0].items : []) : [o[op.op === '"' ? 2 : 0]].filter(Boolean);
        const items = show(shown);
        if (items) replace.set(index, (op.op === "'" ? 'T* ' : op.op === '"' ? `${fmt(n(0))} Tw ${fmt(n(1))} Tc T* ` : '') + tj(items));
        break;
      }
      case 'BDC': case 'BMC': marked.push({ index, dict: op.op === 'BDC' ? o[1] ?? null : null, hit: false }); break;
      case 'EMC': {
        const entry = marked.pop();
        if (entry?.hit && entry.dict?.type === 'dict' && entry.dict.entries.some(([k]) => ['ActualText', 'Alt', 'E'].includes(k))) {
          const kept = entry.dict.entries.filter(([k]) => !['ActualText', 'Alt', 'E'].includes(k));
          const tag = ops[entry.index].operands[0];
          replace.set(entry.index, `${tag ? serializeOperand(tag) : '/Span'} ${serializeOperand({ type: 'dict', entries: kept })} BDC`);
          ctx.stats.markedContent++;
        }
        if (entry?.hit) for (const outer of marked) outer.hit = true;
        break;
      }
      case 'BI': {
        if (ctx.collect) break;
        const box = boxOf([apply(gs.ctm, 0, 0), apply(gs.ctm, 1, 0), apply(gs.ctm, 0, 1), apply(gs.ctm, 1, 1)]);
        if (hits(box)) { replace.set(index, ''); ctx.stats.imagesRemoved++; }
        break;
      }
      case 'Do': {
        const name = o[0]?.type === 'name' ? o[0].value : '';
        const ref = xobjects?.get(N(name));
        const object = ref ? pdf.context.lookup(ref) : undefined;
        if (!(object instanceof PDFStream)) break;
        const subtype = object.dict.get(N('Subtype'))?.toString();
        if (subtype === '/Image') {
          if (ctx.collect) break;
          const box = boxOf([apply(gs.ctm, 0, 0), apply(gs.ctm, 1, 0), apply(gs.ctm, 0, 1), apply(gs.ctm, 1, 1)]);
          if (!hits(box)) break;
          const edited = await redactImagePixels(pdf, object, gs.ctm, ctx.marks, ctx.decodeImage);
          if (edited) { replace.set(index, `/${addXObject(edited.ref)} Do`); ctx.stats.imagesEdited++; }
          else { replace.set(index, ''); ctx.stats.imagesRemoved++; }
          replacedDo(name);
        } else if (subtype === '/Form') {
          const matrix = object.dict.lookupMaybe(N('Matrix'), PDFArray)?.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0)) as Matrix | undefined;
          const formCtm = multiply(matrix?.length === 6 ? matrix : IDENTITY, gs.ctm);
          const bbox = object.dict.lookupMaybe(N('BBox'), PDFArray)?.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0));
          const box = bbox?.length === 4 ? boxOf([apply(formCtm, bbox[0], bbox[1]), apply(formCtm, bbox[2], bbox[1]), apply(formCtm, bbox[0], bbox[3]), apply(formCtm, bbox[2], bbox[3])]) : null;
          if (!ctx.collect && box && !hits(box)) break;
          const formResources = object.dict.lookupMaybe(N('Resources'), PDFDict) ?? resources;
          const inner = await walkContent(ctx, decodedStream(object), formResources, formCtm, depth + 1);
          if (ctx.collect || !inner.changed) break;
          const dict = pdf.context.obj({});
          for (const [key, value] of object.dict.entries()) if (!['Length', 'Filter', 'DecodeParms'].includes(key.decodeText())) dict.set(key, value);
          if (inner.resources) dict.set(N('Resources'), inner.resources);
          const copy = pdf.context.flateStream(inner.data, {});
          for (const [key, value] of dict.entries()) copy.dict.set(key, value);
          replace.set(index, `/${addXObject(pdf.context.register(copy))} Do`);
          ctx.stats.forms++; replacedDo(name);
        }
        break;
      }
      case 'm': case 'l': case 're': case 'c': case 'v': case 'y': case 'h': {
        if (pathStart < 0) { pathStart = index; pathLocal = []; pathHit = false; clipAt = -1; }
        const local: [number, number][] = op.op === 're'
          ? [[n(0), n(1)], [n(0) + n(2), n(1)], [n(0), n(1) + n(3)], [n(0) + n(2), n(1) + n(3)]]
          : Array.from({ length: o.length >> 1 }, (_, k) => [n(2 * k), n(2 * k + 1)] as [number, number]);
        pathLocal.push(...local);
        if (!ctx.collect && local.some((p) => ctx.marks.some((m) => pointIn(apply(gs.ctm, p[0], p[1]), m)))) pathHit = true;
        break;
      }
      case 'W': case 'W*': if (pathStart >= 0) clipAt = index; break;
      case 'S': case 's': case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*': case 'n':
        if (pathStart >= 0 && pathHit) {
          ctx.stats.paths++;
          const end = clipAt >= 0 ? clipAt : index;
          for (let k = pathStart; k < end; k++) replace.set(k, '');
          if (clipAt >= 0) {
            // The clip keeps working for the content after it, but no point inside the mark is left in the file.
            const [x0, y0, x1, y1] = boxOf(pathLocal);
            replace.set(pathStart, `${fmt(x0)} ${fmt(y0)} ${fmt(x1 - x0)} ${fmt(y1 - y0)} re`);
            replace.set(index, 'n');
          } else replace.set(index, '');
        }
        pathStart = -1; pathLocal = []; pathHit = false; clipAt = -1;
        break;
      default: break;
    }
  }
  for (const [name, count] of replacedUses) if (count === uses.get(name)) own().delete(N(name));
  if (ctx.collect || (!replace.size && !ownResources)) return { data, resources, changed: false };
  return { data: rewriteContent(data, ops, replace), resources: ownResources ?? resources, changed: true };
}

/** The glyphs of one page, in content order, with their positions on the page. */
export async function pageGlyphs(pdf: PDFDocument, pageIndex: number, fonts = new Map<PDFDict, FontCodec | null>()): Promise<PageGlyph[]> {
  const collect: PageGlyph[] = [];
  const ctx: WalkContext = { pdf, marks: [], collect, fonts, stats: { glyphs: 0, imagesEdited: 0, imagesRemoved: 0, paths: 0, forms: 0, markedContent: 0 }, removedText: [], names: { next: 0 } };
  await walkContent(ctx, pageContentBytes(pdf, pageIndex), pdf.getPage(pageIndex).node.Resources(), [...IDENTITY] as Matrix);
  return collect;
}

