/**
 * Pixel-level image redaction for MAL-063. The pixels of an image that fall under a mark are replaced by black (or,
 * for a stencil mask, by "not painted"), and the result is written as a new image, so none of the original pixels
 * under the mark stay in the file. Images that cannot be decoded are removed whole by the caller.
 *
 * Decoding goes through an injected decoder (PDF.js), which reads every image format a PDF may use (JPEG, JPEG 2000,
 * JBIG2, CCITT, Flate with predictors, indexed and ICC colour) and returns the pixels as RGB(A).
 */
import { PDFArray, PDFBool, PDFDocument, PDFName, PDFNumber, PDFObjectCopier, PDFRef, decodePDFRawStream, PDFRawStream, type PDFStream } from 'pdf-lib';
import { apply, invert, type Box, type Matrix } from '../content/contentModel';

/** kind 1: one bit per pixel (1 = white), 2: RGB, 3: RGBA — as PDF.js reports image data. */
export interface DecodedImage { width: number; height: number; kind: 1 | 2 | 3; data: Uint8Array | Uint8ClampedArray }
/** Decodes the single image drawn on the only page of a one-page PDF. */
export type ImageDecoder = (pdfBytes: Uint8Array) => Promise<DecodedImage | null>;

const N = PDFName.of;
const MAX_PIXELS = 50_000_000;

/** Pixel rectangles (columns x0..x1, rows y0..y1, inclusive; row 0 at the top) that the marks cover. */
function coveredPixels(ctm: Matrix, marks: Box[], width: number, height: number): [number, number, number, number][] {
  let inverse: Matrix;
  try { inverse = invert(ctm); } catch { return [[0, 0, width - 1, height - 1]]; }
  const out: [number, number, number, number][] = [];
  for (const [x0, y0, x1, y1] of marks) {
    const uv = [apply(inverse, x0, y0), apply(inverse, x1, y0), apply(inverse, x0, y1), apply(inverse, x1, y1)];
    const u0 = Math.max(0, Math.min(...uv.map((p) => p[0]))), u1 = Math.min(1, Math.max(...uv.map((p) => p[0])));
    const v0 = Math.max(0, Math.min(...uv.map((p) => p[1]))), v1 = Math.min(1, Math.max(...uv.map((p) => p[1])));
    if (u1 <= u0 || v1 <= v0) continue;
    // A pixel counts when any part of it is under the mark.
    out.push([Math.floor(u0 * width), Math.floor((1 - v1) * height), Math.min(width - 1, Math.ceil(u1 * width) - 1), Math.min(height - 1, Math.ceil((1 - v0) * height) - 1)]);
  }
  return out;
}

const int = (stream: PDFStream, key: string) => stream.dict.lookupMaybe(N(key), PDFNumber)?.asNumber() ?? 0;

/** A stencil mask (ImageMask) decoded here: uncompressed or Flate without a predictor. */
function redactStencil(pdf: PDFDocument, stream: PDFStream, ctm: Matrix, marks: Box[]): PDFRef | null {
  const width = int(stream, 'Width'), height = int(stream, 'Height');
  if (!(width > 0 && height > 0) || width * height > MAX_PIXELS || !(stream instanceof PDFRawStream)) return null;
  const filter = stream.dict.get(N('Filter'))?.toString();
  const parms = stream.dict.get(N('DecodeParms'));
  if ((filter && filter !== '/FlateDecode' && filter !== '[ /FlateDecode ]') || parms) return null;
  let bits: Uint8Array;
  try { bits = Uint8Array.from(decodePDFRawStream(stream).decode()); } catch { return null; }
  const row = Math.ceil(width / 8);
  if (bits.length < row * height) return null;
  const decode = stream.dict.lookupMaybe(N('Decode'), PDFArray)?.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0));
  const unpainted = decode?.[0] === 1 ? 0 : 1; // with Decode [1 0], a 1 paints
  for (const [x0, y0, x1, y1] of coveredPixels(ctm, marks, width, height)) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const at = y * row + (x >> 3); const bit = 0x80 >> (x & 7);
      bits[at] = unpainted ? bits[at] | bit : bits[at] & ~bit;
    }
  }
  const out = pdf.context.flateStream(bits.subarray(0, row * height), { Type: 'XObject', Subtype: 'Image', Width: width, Height: height, ImageMask: true, BitsPerComponent: 1 });
  if (decode) out.dict.set(N('Decode'), pdf.context.obj(decode));
  return pdf.context.register(out);
}

/** Returns a new image with the marked pixels blacked out, or null when the image cannot be read. */
export async function redactImagePixels(pdf: PDFDocument, stream: PDFStream, ctm: Matrix, marks: Box[], decode?: ImageDecoder): Promise<{ ref: PDFRef } | null> {
  if (stream.dict.get(N('ImageMask')) === PDFBool.True) { const ref = redactStencil(pdf, stream, ctm, marks); return ref ? { ref } : null; }
  if (!decode) return null;
  let image: DecodedImage | null = null;
  try {
    const mini = await PDFDocument.create();
    const page = mini.addPage([1, 1]);
    const copy = PDFObjectCopier.for(pdf.context, mini.context).copy(stream);
    page.node.setXObject(N('Im0'), mini.context.register(copy));
    page.node.set(N('Contents'), mini.context.register(mini.context.stream('q 1 0 0 1 0 0 cm /Im0 Do Q')));
    image = await decode(await mini.save());
  } catch { image = null; }
  if (!image || !(image.width > 0 && image.height > 0) || image.width * image.height > MAX_PIXELS) return null;
  const { width, height, kind, data } = image;
  const rgb = new Uint8Array(width * height * 3); let alpha: Uint8Array | null = null;
  if (kind === 1) {
    const row = Math.ceil(width / 8);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgb.fill(data[y * row + (x >> 3)] & (0x80 >> (x & 7)) ? 255 : 0, (y * width + x) * 3, (y * width + x) * 3 + 3);
  } else if (kind === 2) {
    if (data.length < rgb.length) return null;
    rgb.set(data.subarray(0, rgb.length));
  } else {
    if (data.length < width * height * 4) return null;
    alpha = new Uint8Array(width * height);
    for (let p = 0; p < width * height; p++) { rgb[3 * p] = data[4 * p]; rgb[3 * p + 1] = data[4 * p + 1]; rgb[3 * p + 2] = data[4 * p + 2]; alpha[p] = data[4 * p + 3]; }
    if (alpha.every((a) => a === 255)) alpha = null;
  }
  for (const [x0, y0, x1, y1] of coveredPixels(ctm, marks, width, height)) {
    for (let y = y0; y <= y1; y++) {
      rgb.fill(0, (y * width + x0) * 3, (y * width + x1 + 1) * 3);
      alpha?.fill(255, y * width + x0, y * width + x1 + 1);
    }
  }
  const out = pdf.context.flateStream(rgb, { Type: 'XObject', Subtype: 'Image', Width: width, Height: height, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 });
  if (alpha) out.dict.set(N('SMask'), pdf.context.register(pdf.context.flateStream(alpha, { Type: 'XObject', Subtype: 'Image', Width: width, Height: height, ColorSpace: 'DeviceGray', BitsPerComponent: 8 })));
  if (stream.dict.get(N('Interpolate')) === PDFBool.True) out.dict.set(N('Interpolate'), PDFBool.True);
  return { ref: pdf.context.register(out) };
}

/** An ImageDecoder over PDF.js's `getDocument` (the app's bundle or the legacy build in tests). */
export function pdfjsImageDecoder(getDocument: (source: object) => { promise: Promise<unknown>; destroy(): Promise<void> }, paintImageXObject: number): ImageDecoder {
  return async (bytes) => {
    const loading = getDocument({ data: bytes, isOffscreenCanvasSupported: false, isImageDecoderSupported: false, verbosity: 0 });
    try {
      type Objs = { get(name: string, callback: (value: unknown) => void): void };
      const doc = await loading.promise as { getPage(n: number): Promise<{ getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>; objs: Objs; commonObjs: Objs }> };
      const page = await doc.getPage(1);
      const list = await page.getOperatorList();
      const at = list.fnArray.indexOf(paintImageXObject);
      if (at < 0) return null;
      const name = String(list.argsArray[at][0]);
      const objs = name.startsWith('g_') ? page.commonObjs : page.objs;
      const value = await new Promise<unknown>((resolve) => objs.get(name, resolve)) as Partial<DecodedImage> | null;
      if (!value || !value.data || !value.width || !value.height || ![1, 2, 3].includes(value.kind as number)) return null;
      return { width: value.width, height: value.height, kind: value.kind as 1 | 2 | 3, data: value.data };
    } finally { await loading.destroy(); }
  };
}
