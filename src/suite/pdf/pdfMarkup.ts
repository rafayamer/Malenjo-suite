/**
 * MAL-054 text markup (highlight, underline, strikeout, squiggly) and MAL-055
 * drawings (freehand ink, lines, arrows, rectangles, ellipses, text boxes,
 * callouts) and sticky notes, as standard PDF annotations.
 *
 * Geometry arrives as fractions of the page *as shown* (origin top-left,
 * after /Rotate, the crop box and any view rotation) and is stored in page
 * space as the PDF specification requires (QuadPoints, InkList, L, Rect,
 * CL). Every annotation carries its own appearance stream built from that
 * geometry, so it looks the same in every viewer; editing the colour, width
 * or text rebuilds the appearance from the stored geometry.
 */
import {
  PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, StandardFonts,
} from 'pdf-lib';
import { parseColor, viewerFrame, type Matrix } from './pdfStamp';

export type TextMarkupKind = 'Highlight' | 'Underline' | 'StrikeOut' | 'Squiggly';
export type DrawingKind = 'Ink' | 'Line' | 'Arrow' | 'Square' | 'Circle' | 'FreeText' | 'Callout' | 'Note';
export type MarkupKind = TextMarkupKind | 'Ink' | 'Line' | 'Square' | 'Circle' | 'FreeText' | 'Text';
/** A point as a fraction of the shown page (0..1, origin top-left). */
export interface ShownPoint { x: number; y: number }
export interface ShownRect { x: number; y: number; width: number; height: number }
export interface MarkupStyle { color: string; opacity: number; width: number }

export interface TextMarkupSpec { pageNumber: number; viewRotation: number; kind: TextMarkupKind; rects: ShownRect[]; text: string; note: string; author: string; style: MarkupStyle }
export interface DrawingSpec {
  pageNumber: number; viewRotation: number; kind: DrawingKind; author: string; style: MarkupStyle;
  /** Ink: the stroke; Line/Arrow: [start, end]; Callout: [anchor] + rect; Note: [position]. */
  points?: ShownPoint[];
  /** Square/Circle/FreeText/Callout: the box. */
  rect?: ShownRect;
  /** FreeText/Callout: the shown text; Note: the comment. */
  text?: string;
}
export interface MarkupItem { pageNumber: number; index: number; ref: string | null; kind: MarkupKind; label: string; color: string; contents: string; author: string }
export type MarkupTarget = Pick<MarkupItem, 'pageNumber' | 'index' | 'ref'>;

const KINDS = new Set<MarkupKind>(['Highlight', 'Underline', 'StrikeOut', 'Squiggly', 'Ink', 'Line', 'Square', 'Circle', 'FreeText', 'Text']);
const N = (name: string) => PDFName.of(name);
const MAX_POINTS = 5000;
const r2 = (n: number) => Math.round(n * 100) / 100;

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  if (!(bytes instanceof Uint8Array) || bytes.length < 5 || bytes.length > 256 * 1024 * 1024) throw new Error('Markup accepts PDFs up to 256 MB.');
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    if (pdf.getPageCount() < 1) throw new Error('no pages');
    return pdf;
  } catch { throw new Error('This PDF could not be marked up because it is encrypted, invalid or damaged.'); }
}
const save = async (pdf: PDFDocument) => Uint8Array.from(await pdf.save({ useObjectStreams: false, updateFieldAppearances: false }));

function checkStyle(style: MarkupStyle): void {
  parseColor(style.color);
  if (!(style.opacity >= 0.1 && style.opacity <= 1)) throw new Error('Opacity must be between 10% and 100%.');
  if (!(style.width >= 0.5 && style.width <= 24)) throw new Error('Line width must be between 0.5 and 24 points.');
}
function checkText(value: string, label: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label} must be at most ${max.toLocaleString()} characters.`);
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
}
function pageFor(pdf: PDFDocument, pageNumber: number) {
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.getPageCount()) throw new Error('That page is not in this PDF.');
  return pdf.getPage(pageNumber - 1);
}
const inside = (v: number) => Number.isFinite(v) && v >= -0.001 && v <= 1.001;

/** Maps shown fractions to page space. */
function mapper(pdf: PDFDocument, pageNumber: number, viewRotation: number) {
  if (![0, 90, 180, 270].includes(((viewRotation % 360) + 360) % 360)) throw new Error('View rotation must be a multiple of 90°.');
  const frame = viewerFrame(pdf, pageNumber - 1, viewRotation);
  const m: Matrix = frame.matrix;
  return {
    frame,
    point(p: ShownPoint): [number, number] {
      if (!inside(p.x) || !inside(p.y)) throw new Error('Markup must stay on the page.');
      const u = p.x * frame.width; const v = (1 - p.y) * frame.height;
      return [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]];
    },
  };
}

function bounds(points: [number, number][], pad: number): [number, number, number, number] {
  const xs = points.map((p) => p[0]); const ys = points.map((p) => p[1]);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

function annotsOf(pdf: PDFDocument, pageNumber: number): PDFArray {
  const page = pdf.getPage(pageNumber - 1);
  const existing = page.node.lookupMaybe(N('Annots'), PDFArray);
  if (existing) return existing;
  const created = pdf.context.obj([]);
  page.node.set(N('Annots'), created);
  return created;
}

const numbers = (array: PDFArray | undefined) => array ? array.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0)) : [];
const colorOf = (dict: PDFDict) => numbers(dict.lookupMaybe(N('C'), PDFArray));
const hex = (rgb: number[]) => '#' + (rgb.length >= 3 ? rgb.slice(0, 3) : [0, 0, 0]).map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
const textOf = (value: unknown) => value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : '';

/** Rebuilds the /AP /N appearance of a supported annotation from its stored geometry and style. */
async function buildAppearance(pdf: PDFDocument, pageNumber: number, dict: PDFDict, viewRotation = 0): Promise<void> {
  const kind = dict.get(N('Subtype'))?.toString().slice(1) as MarkupKind;
  const rect = numbers(dict.lookupMaybe(N('Rect'), PDFArray));
  const [cr, cg, cb] = colorOf(dict).length >= 3 ? colorOf(dict) : [0, 0, 0];
  const width = dict.lookupMaybe(N('BS'), PDFDict)?.lookupMaybe(N('W'), PDFNumber)?.asNumber() ?? 1;
  const opacity = dict.lookupMaybe(N('CA'), PDFNumber)?.asNumber() ?? 1;
  const ops: string[] = [`${cr} ${cg} ${cb} RG ${cr} ${cg} ${cb} rg ${width} w 1 J 1 j`];
  const resources: Record<string, unknown> = {};
  const gs: Record<string, unknown> = { Type: 'ExtGState', CA: opacity, ca: opacity };
  if (kind === 'Highlight') gs.BM = 'Multiply';
  resources.ExtGState = pdf.context.obj({ GS0: pdf.context.obj(gs as never) });
  ops.unshift('/GS0 gs');
  const quads = numbers(dict.lookupMaybe(N('QuadPoints'), PDFArray));
  for (let q = 0; q + 7 < quads.length && ['Highlight', 'Underline', 'StrikeOut', 'Squiggly'].includes(kind); q += 8) {
    const [x1, y1, x2, y2, x3, y3, x4, y4] = quads.slice(q, q + 8); // top-left, top-right, bottom-left, bottom-right
    const thick = Math.max(0.5, Math.hypot(x1 - x3, y1 - y3) / 14);
    const along = (t: number, s: number): [number, number] => [x3 + (x4 - x3) * t + (x1 - x3) * s, y3 + (y4 - y3) * t + (y1 - y3) * s];
    if (kind === 'Highlight') ops.push(`${x1} ${y1} m ${x2} ${y2} l ${x4} ${y4} l ${x3} ${y3} l f`);
    else if (kind === 'Underline' || kind === 'StrikeOut') {
      const s = kind === 'Underline' ? 0.08 : 0.42;
      const [a, b] = [along(0, s), along(1, s)];
      ops.push(`${thick} w ${a[0]} ${a[1]} m ${b[0]} ${b[1]} l S`);
    } else {
      const steps = Math.max(4, Math.round(Math.hypot(x4 - x3, y4 - y3) / (thick * 4)));
      const path = Array.from({ length: steps + 1 }, (_, i) => along(i / steps, i % 2 ? 0.12 : 0.02));
      ops.push(`${thick} w ${path.map((p, i) => `${p[0]} ${p[1]} ${i ? 'l' : 'm'}`).join(' ')} S`);
    }
  }
  if (kind === 'Ink') {
    for (const stroke of dict.lookupMaybe(N('InkList'), PDFArray)?.asArray() ?? []) {
      const pts = numbers(pdf.context.lookup(stroke) as PDFArray);
      if (pts.length >= 2) ops.push(pts.reduce((acc, v, i) => i % 2 ? acc : `${acc} ${pts[i]} ${pts[i + 1]} ${i ? 'l' : 'm'}`, '') + ' S');
    }
  }
  if (kind === 'Line') {
    const [x1, y1, x2, y2] = numbers(dict.lookupMaybe(N('L'), PDFArray));
    ops.push(`${x1} ${y1} m ${x2} ${y2} l S`);
    const ends = dict.lookupMaybe(N('LE'), PDFArray)?.asArray().map((v) => v.toString()) ?? [];
    if (ends[1] === '/OpenArrow') {
      const angle = Math.atan2(y2 - y1, x2 - x1); const size = Math.max(6, width * 4);
      const wing = (a: number) => `${x2 - size * Math.cos(angle + a)} ${y2 - size * Math.sin(angle + a)}`;
      ops.push(`${wing(0.45)} m ${x2} ${y2} l ${wing(-0.45)} l S`);
    }
  }
  const box = numbers(dict.lookupMaybe(N('RD'), PDFArray));
  const [bx1, by1, bx2, by2] = [rect[0] + (box[0] ?? 0), rect[1] + (box[3] ?? 0), rect[2] - (box[2] ?? 0), rect[3] - (box[1] ?? 0)];
  if (kind === 'Square') ops.push(`${bx1 + width / 2} ${by1 + width / 2} ${bx2 - bx1 - width} ${by2 - by1 - width} re S`);
  if (kind === 'Circle') {
    const cx = (bx1 + bx2) / 2, cy = (by1 + by2) / 2, rx = (bx2 - bx1 - width) / 2, ry = (by2 - by1 - width) / 2, k = 0.5523;
    ops.push(`${cx + rx} ${cy} m ${cx + rx} ${cy + ry * k} ${cx + rx * k} ${cy + ry} ${cx} ${cy + ry} c ${cx - rx * k} ${cy + ry} ${cx - rx} ${cy + ry * k} ${cx - rx} ${cy} c`
      + ` ${cx - rx} ${cy - ry * k} ${cx - rx * k} ${cy - ry} ${cx} ${cy - ry} c ${cx + rx * k} ${cy - ry} ${cx + rx} ${cy - ry * k} ${cx + rx} ${cy} c S`);
  }
  if (kind === 'Text') {
    // A note icon: a folded square with lines.
    const [x, y] = [rect[0], rect[1]];
    ops.push(`1 0.85 0.2 rg ${x} ${y} 20 20 re f 0.35 0.25 0 RG 0.8 w ${x} ${y} 20 20 re S ${x + 4} ${y + 14} m ${x + 16} ${y + 14} l ${x + 4} ${y + 10} m ${x + 16} ${y + 10} l ${x + 4} ${y + 6} m ${x + 12} ${y + 6} l S`);
  }
  if (kind === 'FreeText') {
    const callout = numbers(dict.lookupMaybe(N('CL'), PDFArray));
    if (callout.length >= 4) ops.push(`${callout.slice(0, 2).join(' ')} m ${callout.slice(-2).join(' ')} l S`);
    ops.push(`1 1 1 rg ${bx1} ${by1} ${bx2 - bx1} ${by2 - by1} re B ${cr} ${cg} ${cb} rg`);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    resources.Font = pdf.context.obj({ Helv: font.ref });
    const frame = viewerFrame(pdf, pageNumber - 1, viewRotation);
    // Lay text out upright in the shown frame, inside the box.
    const inv = invert(frame.matrix);
    const corners = [[bx1, by1], [bx2, by2]].map(([x, y]) => [inv[0] * x + inv[2] * y + inv[4], inv[1] * x + inv[3] * y + inv[5]]);
    const [sx1, sx2] = [Math.min(corners[0][0], corners[1][0]), Math.max(corners[0][0], corners[1][0])];
    const sy2 = Math.max(corners[0][1], corners[1][1]);
    const size = 11; const lines = wrap(textOf(dict.get(N('Contents'))), font, size, sx2 - sx1 - 8);
    const shown = lines.map((line, i) => `BT /Helv ${size} Tf ${sx1 + 4} ${sy2 - 4 - size * (i + 1) * 1.2 + size * 0.2} Td ${encode(font, line)} Tj ET`).join(' ');
    ops.push(`q ${frame.matrix.join(' ')} cm ${shown} Q`);
  }
  const stream = pdf.context.stream(ops.join('\n'), { Type: 'XObject', Subtype: 'Form', BBox: rect, Resources: pdf.context.obj(resources as never) });
  dict.set(N('AP'), pdf.context.obj({ N: pdf.context.register(stream) }));
}

function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
function encode(font: Awaited<ReturnType<PDFDocument['embedFont']>>, text: string): string {
  const safe = [...text].map((ch) => { try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');
  return font.encodeText(safe).toString();
}
function wrap(text: string, font: Awaited<ReturnType<PDFDocument['embedFont']>>, size: number, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      const measure = (value: string) => { try { return font.widthOfTextAtSize(value, size); } catch { return value.length * size * 0.5; } };
      if (line && measure(next) > width) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out.slice(0, 60);
}

function baseDict(pdf: PDFDocument, subtype: string, rect: number[], spec: { author: string; style: MarkupStyle }, contents: string) {
  const [r, g, b] = parseColor(spec.style.color);
  return pdf.context.obj({
    Type: 'Annot', Subtype: subtype, Rect: rect.map(r2), F: 4, C: [r, g, b], CA: spec.style.opacity,
    BS: pdf.context.obj({ W: spec.style.width }),
    T: PDFHexString.fromText(checkText(spec.author || 'MALENJO User', 'Author', 160)),
    Contents: PDFHexString.fromText(contents),
    M: PDFString.fromDate(new Date()),
    NM: PDFString.of(`malenjo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
  }) as PDFDict;
}

export async function addPdfTextMarkup(bytes: Uint8Array, spec: TextMarkupSpec): Promise<Uint8Array> {
  if (!['Highlight', 'Underline', 'StrikeOut', 'Squiggly'].includes(spec.kind)) throw new Error('Choose highlight, underline, strikeout or squiggly.');
  checkStyle(spec.style);
  if (!spec.rects.length || spec.rects.length > 500) throw new Error('Select some text on the page first.');
  const pdf = await load(bytes);
  pageFor(pdf, spec.pageNumber);
  const map = mapper(pdf, spec.pageNumber, spec.viewRotation);
  const quads: number[] = []; const all: [number, number][] = [];
  for (const r of spec.rects) {
    if (!(r.width > 0 && r.height > 0)) continue;
    // Shown corners: top-left, top-right, bottom-left, bottom-right.
    const corners = [map.point({ x: r.x, y: r.y }), map.point({ x: r.x + r.width, y: r.y }), map.point({ x: r.x, y: r.y + r.height }), map.point({ x: r.x + r.width, y: r.y + r.height })];
    corners.forEach((c) => { quads.push(r2(c[0]), r2(c[1])); all.push(c); });
  }
  if (!quads.length) throw new Error('Select some text on the page first.');
  const note = checkText(spec.note, 'Note', 4000);
  const selected = checkText(spec.text, 'Selected text', 20000);
  const dict = baseDict(pdf, spec.kind, bounds(all, 1), spec, note || selected);
  dict.set(N('QuadPoints'), pdf.context.obj(quads));
  await buildAppearance(pdf, spec.pageNumber, dict, spec.viewRotation);
  annotsOf(pdf, spec.pageNumber).push(pdf.context.register(dict));
  return save(pdf);
}

export async function addPdfDrawing(bytes: Uint8Array, spec: DrawingSpec): Promise<Uint8Array> {
  checkStyle(spec.style);
  const pdf = await load(bytes);
  pageFor(pdf, spec.pageNumber);
  const map = mapper(pdf, spec.pageNumber, spec.viewRotation);
  const points = (spec.points ?? []).map((p) => map.point(p));
  if (points.length > MAX_POINTS) throw new Error('This stroke is too long; draw it in parts.');
  const box = spec.rect ? [map.point({ x: spec.rect.x, y: spec.rect.y }), map.point({ x: spec.rect.x + spec.rect.width, y: spec.rect.y + spec.rect.height })] : null;
  const pad = spec.style.width;
  const text = checkText(spec.text ?? '', 'Text', 4000);
  let dict: PDFDict;
  switch (spec.kind) {
    case 'Ink':
      if (points.length < 2) throw new Error('Draw a stroke on the page.');
      dict = baseDict(pdf, 'Ink', bounds(points, pad), spec, text);
      dict.set(N('InkList'), pdf.context.obj([pdf.context.obj(points.flat().map(r2))]));
      break;
    case 'Line': case 'Arrow':
      if (points.length !== 2) throw new Error('Drag from the start to the end of the line.');
      dict = baseDict(pdf, 'Line', bounds(points, pad * 4 + 6), spec, text);
      dict.set(N('L'), pdf.context.obj(points.flat().map(r2)));
      dict.set(N('LE'), pdf.context.obj([N('None'), N(spec.kind === 'Arrow' ? 'OpenArrow' : 'None')]));
      break;
    case 'Square': case 'Circle': case 'FreeText':
      if (!box) throw new Error('Drag a box on the page.');
      if (spec.kind === 'FreeText' && !text.trim()) throw new Error('Enter the text for the text box.');
      dict = baseDict(pdf, spec.kind, bounds(box, spec.kind === 'FreeText' ? 0 : pad / 2), spec, text);
      if (spec.kind === 'FreeText') dict.set(N('DA'), PDFString.of(`/Helv 11 Tf ${parseColor(spec.style.color).join(' ')} rg`));
      break;
    case 'Callout': {
      if (!box || points.length !== 1) throw new Error('Drag from the point you are commenting on to where the text should go.');
      if (!text.trim()) throw new Error('Enter the text for the callout.');
      const [bx1, by1, bx2, by2] = bounds(box, 0);
      const knee: [number, number] = [Math.max(bx1, Math.min(bx2, points[0][0])), Math.max(by1, Math.min(by2, points[0][1]))];
      const outer = bounds([...box, points[0]], pad);
      dict = baseDict(pdf, 'FreeText', outer, spec, text);
      dict.set(N('IT'), N('FreeTextCallout'));
      dict.set(N('CL'), pdf.context.obj([...points[0], ...knee].map(r2)));
      dict.set(N('RD'), pdf.context.obj([bx1 - outer[0], outer[3] - by2, outer[2] - bx2, by1 - outer[1]].map(r2)));
      dict.set(N('DA'), PDFString.of(`/Helv 11 Tf ${parseColor(spec.style.color).join(' ')} rg`));
      break;
    }
    case 'Note': {
      if (points.length !== 1) throw new Error('Click where the note should go.');
      if (!text.trim()) throw new Error('Enter the note text.');
      const [x, y] = points[0];
      dict = baseDict(pdf, 'Text', [x, y - 20, x + 20, y], spec, text);
      dict.set(N('Name'), N('Comment'));
      dict.set(N('Open'), PDFBool.False);
      break;
    }
    default: throw new Error('Unsupported drawing.');
  }
  await buildAppearance(pdf, spec.pageNumber, dict, spec.viewRotation);
  annotsOf(pdf, spec.pageNumber).push(pdf.context.register(dict));
  return save(pdf);
}

function itemLabel(dict: PDFDict, kind: MarkupKind): string {
  if (kind === 'Line') return dict.lookupMaybe(N('LE'), PDFArray)?.get(1)?.toString() === '/OpenArrow' ? 'Arrow' : 'Line';
  if (kind === 'FreeText') return dict.get(N('IT'))?.toString() === '/FreeTextCallout' ? 'Callout' : 'Text box';
  return ({ Highlight: 'Highlight', Underline: 'Underline', StrikeOut: 'Strikeout', Squiggly: 'Squiggly', Ink: 'Freehand', Square: 'Rectangle', Circle: 'Ellipse', Text: 'Sticky note' } as Record<string, string>)[kind] ?? kind;
}

export async function listPdfMarkupAnnotations(bytes: Uint8Array): Promise<MarkupItem[]> {
  const pdf = await load(bytes);
  const out: MarkupItem[] = [];
  pdf.getPages().forEach((page, pageIndex) => {
    page.node.lookupMaybe(N('Annots'), PDFArray)?.asArray().forEach((entry, index) => {
      const dict = entry instanceof PDFRef ? pdf.context.lookupMaybe(entry, PDFDict) : entry instanceof PDFDict ? entry : undefined;
      const kind = dict?.get(N('Subtype'))?.toString().slice(1) as MarkupKind | undefined;
      if (!dict || !kind || !KINDS.has(kind) || dict.has(N('IRT'))) return;
      out.push({ pageNumber: pageIndex + 1, index, ref: entry instanceof PDFRef ? entry.toString() : null, kind, label: itemLabel(dict, kind),
        color: hex(colorOf(dict)), contents: textOf(dict.get(N('Contents'))), author: textOf(dict.get(N('T'))) });
    });
  });
  return out;
}

function locate(pdf: PDFDocument, target: MarkupTarget): { annots: PDFArray; dict: PDFDict } {
  const page = pageFor(pdf, target.pageNumber);
  const annots = page.node.lookupMaybe(N('Annots'), PDFArray);
  const entry = annots?.get(target.index);
  const dict = entry instanceof PDFRef ? pdf.context.lookupMaybe(entry, PDFDict) : entry instanceof PDFDict ? entry : undefined;
  const kind = dict?.get(N('Subtype'))?.toString().slice(1) as MarkupKind | undefined;
  if (!annots || !dict || !kind || !KINDS.has(kind) || (entry instanceof PDFRef ? entry.toString() : null) !== target.ref) {
    throw new Error('That markup changed or was removed. Choose it again.');
  }
  return { annots, dict };
}

/** Changes colour, opacity, line width or text, and rebuilds the appearance. */
export async function updatePdfMarkupAnnotation(bytes: Uint8Array, target: MarkupTarget, change: { color?: string; opacity?: number; width?: number; contents?: string }): Promise<Uint8Array> {
  const pdf = await load(bytes);
  const { dict } = locate(pdf, target);
  if (change.color !== undefined) dict.set(N('C'), pdf.context.obj(parseColor(change.color)));
  if (change.opacity !== undefined) { if (!(change.opacity >= 0.1 && change.opacity <= 1)) throw new Error('Opacity must be between 10% and 100%.'); dict.set(N('CA'), PDFNumber.of(change.opacity)); }
  if (change.width !== undefined) { if (!(change.width >= 0.5 && change.width <= 24)) throw new Error('Line width must be between 0.5 and 24 points.'); dict.set(N('BS'), pdf.context.obj({ W: change.width })); }
  if (change.contents !== undefined) dict.set(N('Contents'), PDFHexString.fromText(checkText(change.contents, 'Text', 4000)));
  dict.set(N('M'), PDFString.fromDate(new Date()));
  await buildAppearance(pdf, target.pageNumber, dict);
  return save(pdf);
}

/** Removes the markup and its pop-up and replies on the same page. */
export async function deletePdfMarkupAnnotation(bytes: Uint8Array, target: MarkupTarget): Promise<Uint8Array> {
  const pdf = await load(bytes);
  const { annots, dict } = locate(pdf, target);
  const own = annots.get(target.index);
  const popup = dict.get(N('Popup'));
  for (let i = annots.size() - 1; i >= 0; i--) {
    const entry = annots.get(i);
    const other = entry instanceof PDFRef ? pdf.context.lookupMaybe(entry, PDFDict) : undefined;
    const related = i === target.index || (popup && entry instanceof PDFRef && entry.toString() === popup.toString())
      || (own instanceof PDFRef && other?.get(N('IRT'))?.toString() === own.toString());
    if (related) annots.remove(i);
  }
  return save(pdf);
}
