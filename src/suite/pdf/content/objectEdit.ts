/**
 * MAL-014 image editing, MAL-015 vector path editing and MAL-016 inserting
 * text, shapes and graphics as page content (not annotations).
 *
 * Edits change the drawing operations themselves: an image's `Do` or a
 * path's construction-to-paint operations are wrapped in `q <matrix> cm ... Q`
 * (the matrix is computed in page space, so moves follow the page as shown),
 * recoloured inside that wrapper, clipped for crops, or removed. Inserted
 * text and shapes are ordinary page content, so they can be edited again
 * with the same tools (MAL-011 for text, MAL-015 for shapes).
 */
import { refuseSignedPdf } from '../pdfSignatureGuard';
import { PDFDocument, PDFName, PDFRawStream, PDFRef, StandardFonts, degrees, rgb } from 'pdf-lib';
import { rewriteContent } from './contentLexer';
import { IDENTITY, apply, documentModels, multiply, type Box, type Matrix, type PageModel } from './contentModel';
import { parseColor, viewerFrame } from '../pdfStamp';

export interface ShownBox { x: number; y: number; width: number; height: number }
export interface PageObjectInfo { id: number; kind: 'image' | 'path'; box: Box; shown: ShownBox; label: string; pixels?: { width: number; height: number }; stroke?: string; fill?: string; lineWidth?: number }
export interface ObjectTransform {
  /** Move in points along the page as shown (x right, y down). */
  dx?: number; dy?: number;
  /** Uniform scale about the object's centre (1 = unchanged). */
  scale?: number;
  /** Clockwise rotation, in degrees as shown, about the object's centre. */
  rotate?: number;
}

const r = (n: number) => Math.round(n * 10000) / 10000;
const invert = (m: Matrix): Matrix => {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) throw new Error('This object has a degenerate transform and cannot be edited.');
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
};
const cm = (m: Matrix) => `${m.map(r).join(' ')} cm`;

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  if (!(bytes instanceof Uint8Array) || bytes.length < 5 || bytes.length > 256 * 1024 * 1024) throw new Error('Object editing accepts PDFs up to 256 MB.');
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    if (pdf.getPageCount() < 1) throw new Error('no pages');
    return pdf;
  } catch { throw new Error('This PDF could not be opened for editing because it is encrypted, invalid or damaged.'); }
}
const save = async (pdf: PDFDocument) => Uint8Array.from(await pdf.save({ useObjectStreams: false, updateFieldAppearances: false }));
function pageModel(pdf: PDFDocument, pageNumber: number): PageModel {
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.getPageCount()) throw new Error('That page is not in this PDF.');
  return documentModels(pdf)[pageNumber - 1];
}
function writePage(pdf: PDFDocument, pageNumber: number, model: PageModel, replace: Map<number, string>): void {
  const data = rewriteContent(model.data, model.ops, replace);
  pdf.getPage(pageNumber - 1).node.set(PDFName.of('Contents'), pdf.context.obj([pdf.context.register(pdf.context.flateStream(data))]));
}
const opText = (model: PageModel, index: number) => new TextDecoder('latin1').decode(model.data.subarray(model.ops[index].start, model.ops[index].end));

/** Shown-frame helpers for a page (shown = fractions of the page as displayed, origin top-left). */
function frameOf(pdf: PDFDocument, pageNumber: number, viewRotation: number) {
  const frame = viewerFrame(pdf, pageNumber - 1, viewRotation);
  const inv = invert(frame.matrix);
  return {
    frame,
    toShown(box: Box): ShownBox {
      const pts = [[box[0], box[1]], [box[2], box[3]], [box[0], box[3]], [box[2], box[1]]].map(([x, y]) => apply(inv, x, y)).map(([u, v]) => [u / frame.width, 1 - v / frame.height]);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    },
    /** A shown point (fractions) in page space. */
    toPage(x: number, y: number): [number, number] { return apply(frame.matrix, x * frame.width, (1 - y) * frame.height); },
  };
}

export async function listPdfPageObjects(bytes: Uint8Array, pageNumber: number, viewRotation = 0): Promise<PageObjectInfo[]> {
  const pdf = await load(bytes);
  const model = pageModel(pdf, pageNumber);
  const shown = frameOf(pdf, pageNumber, viewRotation);
  const images = model.images.map((image): PageObjectInfo => {
    const stream = image.ref ? pdf.context.lookup(PDFRef.of(Number(image.ref.split(' ')[0]), Number(image.ref.split(' ')[1]))) : undefined;
    const size = stream instanceof PDFRawStream ? { width: Number(stream.dict.get(PDFName.of('Width'))?.toString() ?? 0), height: Number(stream.dict.get(PDFName.of('Height'))?.toString() ?? 0) } : undefined;
    return { id: image.id, kind: 'image', box: image.box, shown: shown.toShown(image.box), label: `Image ${image.id + 1}${size ? ` (${size.width} × ${size.height} px)` : ''}`, pixels: size };
  });
  const paths = model.paths.map((path): PageObjectInfo => ({
    id: path.id, kind: 'path', box: path.box, shown: shown.toShown(path.box), stroke: path.stroke, fill: path.fill, lineWidth: path.lineWidth,
    label: `${/[fFbB]/.test(path.paint) ? (/[SsBb]/.test(path.paint.replace(/\*/g, '')) && path.paint !== 'f' ? 'Filled, stroked' : 'Filled') : 'Stroked'} shape ${path.id + 1}`,
  }));
  return [...images, ...paths];
}

function locate(model: PageModel, kind: 'image' | 'path', id: number) {
  if (kind === 'image') {
    const image = model.images[id];
    if (!image) throw new Error('That image is no longer on this page. Choose it again.');
    // A cropped image is `q <x y w h re> W n <Do> Q`: the clip belongs to the image, so moves,
    // resizes and deletion take the whole wrapper with it.
    const i = image.opIndex, names = (from: number, to: number) => model.ops.slice(from, to).map((o) => o.op).join(' ');
    if (i >= 4 && names(i - 4, i) === 'q re W n' && model.ops[i + 1]?.op === 'Q') return { start: i - 4, end: i + 1, box: image.box };
    return { start: i, end: i, box: image.box };
  }
  const path = model.paths[id];
  if (!path) throw new Error('That shape is no longer on this page. Choose it again.');
  return { start: path.startIndex, end: path.endIndex, box: path.box };
}

/** The extra page-space transform for a move/scale/rotate, expressed as a `cm` for the object's current CTM. */
function transformFor(pdf: PDFDocument, pageNumber: number, viewRotation: number, box: Box, ctm: Matrix, change: ObjectTransform): Matrix {
  const scale = change.scale ?? 1, angle = change.rotate ?? 0;
  if (!(scale > 0.05 && scale <= 20)) throw new Error('Scale must be between 5% and 2000%.');
  if (!Number.isFinite(angle) || Math.abs(angle) > 360) throw new Error('Rotation must be between -360° and 360°.');
  const { frame } = frameOf(pdf, pageNumber, viewRotation);
  const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
  const theta = (-angle * Math.PI) / 180; // clockwise as shown; shown frame and page differ only by a rotation
  const cos = Math.cos(theta), sin = Math.sin(theta);
  // Shown move (x right, y down) as a page-space vector.
  const du = change.dx ?? 0, dv = -(change.dy ?? 0);
  if (!Number.isFinite(du) || !Number.isFinite(dv) || Math.abs(du) > 14400 || Math.abs(dv) > 14400) throw new Error('Move must be a reasonable distance.');
  const m = frame.matrix;
  const tx = m[0] * du + m[2] * dv, ty = m[1] * du + m[3] * dv;
  // In page space: move the centre to the origin, rotate and scale, move back and shift.
  let t: Matrix = [1, 0, 0, 1, -cx, -cy];
  t = multiply(t, [scale * cos, scale * sin, -scale * sin, scale * cos, 0, 0]);
  t = multiply(t, [1, 0, 0, 1, cx + tx, cy + ty]);
  // New CTM = CTM * T; as a prefix cm in the object's own space: M = CTM * T * CTM^-1.
  return multiply(multiply(ctm, t), invert(ctm));
}

/** Operators that only build, paint or clip a path or draw an XObject; anything else in a path's span changes graphics state. */
const DRAWING = new Set(['m', 'l', 'c', 'v', 'y', 'h', 're', 'S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n', 'W', 'W*', 'Do']);

/**
 * Wraps ops start..end in `q prefix … Q`. Graphics-state changes made inside the span (a colour or
 * width set between a path's construction and its painting) are repeated after the `Q`, so the
 * content that follows still sees them and only the requested edit is isolated.
 */
function wrap(model: PageModel, start: number, end: number, prefix: string, inner?: string): Map<number, string> {
  const edits = new Map<number, string>();
  const replay: string[] = [];
  for (let k = start; k <= end; k++) { const op = model.ops[k].op; if (!DRAWING.has(op) && op !== 'q' && op !== 'Q') replay.push(opText(model, k)); }
  const after = replay.length ? ` ${replay.join(' ')}` : '';
  if (start === end) edits.set(start, `q ${prefix} ${inner ?? opText(model, start)} Q${after}`);
  else {
    edits.set(start, `q ${prefix} ${opText(model, start)}`);
    edits.set(end, `${opText(model, end)} Q${after}`);
  }
  return edits;
}

export async function transformPdfObject(bytes: Uint8Array, pageNumber: number, kind: 'image' | 'path', id: number, change: ObjectTransform, viewRotation = 0): Promise<Uint8Array> {
  const pdf = await load(bytes);
  refuseSignedPdf(pdf, 'editing it');
  const model = pageModel(pdf, pageNumber);
  const where = locate(model, kind, id);
  const ctm = kind === 'image' ? model.images[id].ctm : model.paths[id].ctm;
  const matrix = transformFor(pdf, pageNumber, viewRotation, where.box, ctm, change);
  writePage(pdf, pageNumber, model, wrap(model, where.start, where.end, cm(matrix)));
  return save(pdf);
}

export async function deletePdfObject(bytes: Uint8Array, pageNumber: number, kind: 'image' | 'path', id: number): Promise<Uint8Array> {
  const pdf = await load(bytes);
  refuseSignedPdf(pdf, 'editing it');
  const model = pageModel(pdf, pageNumber);
  const where = locate(model, kind, id);
  const edits = new Map<number, string>();
  // Only the object's own drawing goes: graphics-state changes made between a path's construction
  // and its painting (colours, widths) still apply to the content after it.
  for (let i = where.start; i <= where.end; i++) if (kind === 'image' || DRAWING.has(model.ops[i].op)) edits.set(i, '');
  writePage(pdf, pageNumber, model, edits);
  return save(pdf);
}

/** Crops an image to a part of itself: fractions of the image (left, top, right, bottom insets as shown in its own frame). */
export async function cropPdfImage(bytes: Uint8Array, pageNumber: number, id: number, inset: { left: number; top: number; right: number; bottom: number }): Promise<Uint8Array> {
  const values = [inset.left, inset.top, inset.right, inset.bottom];
  if (values.some((v) => !(v >= 0 && v < 1)) || inset.left + inset.right >= 0.98 || inset.top + inset.bottom >= 0.98) throw new Error('Crop must leave part of the image visible.');
  const pdf = await load(bytes);
  refuseSignedPdf(pdf, 'editing it');
  const model = pageModel(pdf, pageNumber);
  const where = locate(model, 'image', id);
  // Image space is the unit square, origin bottom-left of the image.
  const clip = `${r(inset.left)} ${r(inset.bottom)} ${r(1 - inset.left - inset.right)} ${r(1 - inset.top - inset.bottom)} re W n`;
  writePage(pdf, pageNumber, model, wrap(model, where.start, where.end, clip));
  return save(pdf);
}

/** Replaces an image, fitting the new one inside the old one's box (aspect ratio kept, centred). */
export async function replacePdfImage(bytes: Uint8Array, pageNumber: number, id: number, image: Uint8Array): Promise<Uint8Array> {
  const png = image.length > 8 && image[0] === 0x89 && image[1] === 0x50;
  const jpeg = image.length > 3 && image[0] === 0xff && image[1] === 0xd8;
  if (!png && !jpeg) throw new Error('Choose a PNG or JPEG image.');
  if (image.length > 32 * 1024 * 1024) throw new Error('Replacement images must be 32 MB or smaller.');
  const pdf = await load(bytes);
  refuseSignedPdf(pdf, 'editing it');
  const model = pageModel(pdf, pageNumber);
  const placement = model.images[id];
  if (!placement) throw new Error('That image is no longer on this page. Choose it again.');
  let embedded;
  try { embedded = png ? await pdf.embedPng(image) : await pdf.embedJpg(image); } catch { throw new Error('This image could not be read. Choose another PNG or JPEG.'); }
  const name = pdf.getPage(pageNumber - 1).node.newXObject('MalenjoImg', embedded.ref);
  // Fit inside the old unit square (in image space): keep the new image's aspect against the old box's shape.
  const ctm = placement.ctm;
  const oldW = Math.hypot(ctm[0], ctm[1]), oldH = Math.hypot(ctm[2], ctm[3]);
  const target = embedded.width / embedded.height, current = oldW / oldH;
  const [sx, sy] = target > current ? [1, current / target] : [target / current, 1];
  const fit: Matrix = [sx, 0, 0, sy, (1 - sx) / 2, (1 - sy) / 2];
  writePage(pdf, pageNumber, model, new Map([[placement.opIndex, `q ${cm(fit)} /${name.decodeText()} Do Q`]]));
  return save(pdf);
}

export interface ImageAdjustment { brightness: number; contrast: number; grayscale: boolean }
/** Decodes an image, applies the adjustment and returns a PNG or JPEG. The browser uses a canvas. */
export type ImageAdjuster = (input: { kind: 'jpeg' | 'raw'; bytes: Uint8Array; width: number; height: number; components: 1 | 3 }, adjustment: ImageAdjustment) => Promise<{ bytes: Uint8Array; type: 'png' | 'jpeg' }>;

/** Adjusts brightness, contrast or greyscale of an 8-bit grey/RGB image (JPEG or Flate without predictors). */
export async function adjustPdfImage(bytes: Uint8Array, pageNumber: number, id: number, adjustment: ImageAdjustment, adjuster: ImageAdjuster): Promise<Uint8Array> {
  if (!(adjustment.brightness >= 0.2 && adjustment.brightness <= 3) || !(adjustment.contrast >= 0.2 && adjustment.contrast <= 3)) throw new Error('Brightness and contrast must be between 20% and 300%.');
  const pdf = await load(bytes);
  refuseSignedPdf(pdf, 'editing it');
  const model = pageModel(pdf, pageNumber);
  const placement = model.images[id];
  if (!placement?.ref) throw new Error('That image is no longer on this page. Choose it again.');
  const [num, gen] = placement.ref.split(' ').map(Number);
  const stream = pdf.context.lookup(PDFRef.of(num, gen));
  if (!(stream instanceof PDFRawStream)) throw new Error('This image cannot be adjusted.');
  const d = stream.dict;
  const space = d.get(PDFName.of('ColorSpace'))?.toString();
  const filter = d.get(PDFName.of('Filter'))?.toString();
  const components = space === '/DeviceGray' ? 1 : space === '/DeviceRGB' ? 3 : 0;
  const width = Number(d.get(PDFName.of('Width'))?.toString()), height = Number(d.get(PDFName.of('Height'))?.toString());
  if (!components || d.get(PDFName.of('BitsPerComponent'))?.toString() !== '8' || d.has(PDFName.of('Decode')) || d.has(PDFName.of('SMask')) || d.has(PDFName.of('Mask'))
    || !(filter === '/DCTDecode' || (filter === '/FlateDecode' && !d.has(PDFName.of('DecodeParms'))))) {
    throw new Error('Only plain colour or greyscale photos without transparency can be adjusted.');
  }
  const { decodePDFRawStream } = await import('pdf-lib');
  const input = filter === '/DCTDecode'
    ? { kind: 'jpeg' as const, bytes: stream.contents, width, height, components: components as 1 | 3 }
    : { kind: 'raw' as const, bytes: decodePDFRawStream(stream).decode(), width, height, components: components as 1 | 3 };
  const out = await adjuster(input, adjustment);
  const embedded = out.type === 'png' ? await pdf.embedPng(out.bytes) : await pdf.embedJpg(out.bytes);
  const name = pdf.getPage(pageNumber - 1).node.newXObject('MalenjoImg', embedded.ref);
  writePage(pdf, pageNumber, model, new Map([[placement.opIndex, `/${name.decodeText()} Do`]]));
  return save(pdf);
}

/** Recolours a path: stroke and/or fill colour and line width, applied inside a q/Q wrapper. */
export async function stylePdfPath(bytes: Uint8Array, pageNumber: number, id: number, style: { stroke?: string; fill?: string; lineWidth?: number }): Promise<Uint8Array> {
  const pdf = await load(bytes);
  refuseSignedPdf(pdf, 'editing it');
  const model = pageModel(pdf, pageNumber);
  const where = locate(model, 'path', id);
  const parts: string[] = [];
  if (style.stroke) parts.push(`${parseColor(style.stroke).map(r).join(' ')} RG`);
  if (style.fill) parts.push(`${parseColor(style.fill).map(r).join(' ')} rg`);
  if (style.lineWidth !== undefined) {
    if (!(style.lineWidth >= 0 && style.lineWidth <= 72)) throw new Error('Line width must be between 0 and 72 points.');
    parts.push(`${r(style.lineWidth)} w`);
  }
  if (!parts.length) throw new Error('Choose a colour or line width to change.');
  writePage(pdf, pageNumber, model, wrap(model, where.start, where.end, parts.join(' ')));
  return save(pdf);
}

export type InsertKind = 'text' | 'rectangle' | 'ellipse' | 'line' | 'arrow';
export interface InsertSpec {
  pageNumber: number; viewRotation: number; kind: InsertKind;
  /** Box (text, rectangle, ellipse) or the line from (x, y) to (x + width, y + height), as shown fractions. */
  rect: ShownBox;
  text?: string; fontSize?: number;
  stroke: string; fill?: string | null; lineWidth: number;
}

/** Adds new text or a shape to the page content itself, upright on the page as shown. */
export async function insertPdfContent(bytes: Uint8Array, spec: InsertSpec): Promise<Uint8Array> {
  const pdf = await load(bytes);
  refuseSignedPdf(pdf, 'editing it');
  pageModel(pdf, spec.pageNumber);
  const page = pdf.getPage(spec.pageNumber - 1);
  const { frame, toPage } = frameOf(pdf, spec.pageNumber, spec.viewRotation);
  const color = (hex: string) => { const [a, b, c] = parseColor(hex); return rgb(a, b, c); };
  if (!(spec.lineWidth >= 0 && spec.lineWidth <= 72)) throw new Error('Line width must be between 0 and 72 points.');
  const shownAngle = Math.round(Math.atan2(frame.matrix[1], frame.matrix[0]) * 180 / Math.PI); // page angle of the shown x axis
  const { x, y, width, height } = spec.rect;
  const bottomLeft = toPage(Math.min(x, x + width), Math.max(y, y + height));
  const [w, h] = [Math.abs(width) * frame.width, Math.abs(height) * frame.height];
  if (spec.kind === 'text') {
    const text = (spec.text ?? '').replace(/\r/g, '');
    if (!text.trim() || text.length > 4000) throw new Error('Enter the text to insert (up to 4,000 characters).');
    const size = spec.fontSize ?? 12;
    if (!(size >= 4 && size <= 144)) throw new Error('Text size must be between 4 and 144 points.');
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        try { font.encodeText(next); } catch { throw new Error(`“${word}” has characters the built-in font cannot show.`); }
        if (line && font.widthOfTextAtSize(next, size) > w) { lines.push(line); line = word; } else line = next;
      }
      lines.push(line);
    }
    const lineHeight = size * 1.25;
    if (lines.length * lineHeight > h + size) throw new Error(`The text needs ${lines.length} lines and does not fit the box; make the box taller or the text smaller.`);
    // Draw each line as its own run so it can be edited later; position along the shown axes.
    const down: [number, number] = [-frame.matrix[2], -frame.matrix[3]];
    const top = toPage(Math.min(x, x + width), Math.min(y, y + height));
    lines.forEach((line, i) => {
      const baseline = (i + 1) * lineHeight - (lineHeight - size) - size * 0.2;
      page.drawText(line, { x: top[0] + down[0] * baseline, y: top[1] + down[1] * baseline, size, font, color: color(spec.stroke), rotate: degrees(shownAngle) });
    });
  } else if (spec.kind === 'rectangle' || spec.kind === 'ellipse') {
    if (w < 1 || h < 1) throw new Error('Drag a box on the page.');
    const fill = spec.fill ? color(spec.fill) : undefined;
    if (spec.kind === 'rectangle') page.drawRectangle({ x: bottomLeft[0], y: bottomLeft[1], width: w, height: h, rotate: degrees(shownAngle), borderColor: color(spec.stroke), borderWidth: spec.lineWidth, color: fill });
    else {
      const centre = toPage(x + width / 2, y + height / 2);
      page.drawEllipse({ x: centre[0], y: centre[1], xScale: w / 2, yScale: h / 2, rotate: degrees(shownAngle), borderColor: color(spec.stroke), borderWidth: spec.lineWidth, color: fill });
    }
  } else {
    const start = toPage(x, y), end = toPage(x + width, y + height);
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 2) throw new Error('Drag from the start to the end of the line.');
    page.drawLine({ start: { x: start[0], y: start[1] }, end: { x: end[0], y: end[1] }, thickness: spec.lineWidth, color: color(spec.stroke) });
    if (spec.kind === 'arrow') {
      const angle = Math.atan2(end[1] - start[1], end[0] - start[0]); const size = Math.max(8, spec.lineWidth * 4);
      for (const a of [0.45, -0.45]) page.drawLine({ start: { x: end[0], y: end[1] }, end: { x: end[0] - size * Math.cos(angle + a), y: end[1] - size * Math.sin(angle + a) }, thickness: spec.lineWidth, color: color(spec.stroke) });
    }
  }
  return save(pdf);
}

export { IDENTITY };
