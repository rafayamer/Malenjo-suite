/**
 * MAL-025 Advanced PDF compression: image downsampling and JPEG quality by
 * profile, then the lossless passes of MAL-024, with a size report.
 *
 * Eligible images: 8-bit DeviceGray/DeviceRGB that are not used as another
 * image's mask (ICC-based colour is left as is), stored as JPEG (DCTDecode) or Flate without predictors, with no
 * Decode array, colour-key mask or image mask. Soft masks are kept. Everything
 * else is left untouched and counted, so nothing is silently degraded.
 *
 * Effective resolution is measured against the size of the page the image is
 * used on, which is never larger than the size it is drawn at; images are
 * therefore never reduced below the profile's resolution at their real size.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';
import { loadForCompression, optimizeLoaded, pageContents } from './pdfCompress';

export type CompressionProfile = 'high' | 'balanced' | 'small';
export const COMPRESSION_PROFILES: Record<CompressionProfile, { dpi: number; quality: number; label: string }> = {
  high: { dpi: 200, quality: 0.85, label: 'High quality (200 dpi, JPEG 85%)' },
  balanced: { dpi: 150, quality: 0.75, label: 'Balanced (150 dpi, JPEG 75%)' },
  small: { dpi: 96, quality: 0.6, label: 'Smallest (96 dpi, JPEG 60%)' },
};

export interface RecodeInput {
  /** jpeg: bytes are a JPEG file; raw: 8-bit samples, row-major, `components` per pixel. */
  kind: 'jpeg' | 'raw';
  bytes: Uint8Array;
  width: number;
  height: number;
  components: 1 | 3;
}
export interface RecodeOutput { jpeg: Uint8Array; width: number; height: number; components: 1 | 3 }
/** Decodes, scales to width x height and encodes as JPEG at quality (0-1). The browser uses a canvas. */
export type ImageRecoder = (input: RecodeInput, target: { width: number; height: number; quality: number }) => Promise<RecodeOutput>;

export interface ImageCompressOptions { dpi: number; quality: number; recoder: ImageRecoder }
export interface ImageCompressReport {
  bytes: Uint8Array;
  before: number;
  after: number;
  images: number;
  downsampled: number;
  recompressed: number;
  skipped: number;
  unchanged: boolean;
}

function colorComponents(pdf: PDFDocument, dict: PDFDict): 1 | 3 | null {
  const space = dict.get(PDFName.of('ColorSpace'));
  const resolved = space instanceof PDFRef ? pdf.context.lookup(space) : space;
  const name = resolved?.toString();
  if (name === '/DeviceGray') return 1;
  if (name === '/DeviceRGB') return 3;
  // ICC-based images are left alone: their samples would need converting through the profile first.
  return null;
}

/** Largest page (in inches) on which each image ref is used directly. */
function usage(pdf: PDFDocument): Map<string, { w: number; h: number }> {
  const out = new Map<string, { w: number; h: number }>();
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const xobjects = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    for (const [, value] of xobjects?.entries() ?? []) {
      if (!(value instanceof PDFRef)) continue;
      const prev = out.get(value.toString());
      out.set(value.toString(), { w: Math.max(prev?.w ?? 0, width / 72), h: Math.max(prev?.h ?? 0, height / 72) });
    }
  }
  return out;
}

export async function compressPdfImages(bytes: Uint8Array, options: ImageCompressOptions): Promise<ImageCompressReport> {
  if (!(options.dpi >= 36 && options.dpi <= 600)) throw new Error('Target resolution must be between 36 and 600 dpi.');
  if (!(options.quality >= 0.1 && options.quality <= 1)) throw new Error('JPEG quality must be between 10% and 100%.');
  const pdf = await loadForCompression(bytes);
  const beforeContent = pageContents(pdf);
  const used = usage(pdf);
  const largest = pdf.getPages().reduce((max, page) => ({ w: Math.max(max.w, page.getWidth() / 72), h: Math.max(max.h, page.getHeight() / 72) }), { w: 0, h: 0 });
  let images = 0, downsampled = 0, recompressed = 0, skipped = 0;
  // Images used as another image's soft mask or mask must stay single-channel and lossless.
  const masks = new Set<string>();
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    for (const key of ['SMask', 'Mask']) { const ref = object.dict.get(PDFName.of(key)); if (ref instanceof PDFRef) masks.add(ref.toString()); }
  }

  for (const [ref, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || object.dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue;
    const dict = object.dict;
    if (dict.get(PDFName.of('ImageMask'))?.toString() === 'true' || masks.has(ref.toString())) continue; // masks are not pictures
    images++;
    const width = dict.lookupMaybe(PDFName.of('Width'), PDFNumber)?.asNumber() ?? 0;
    const height = dict.lookupMaybe(PDFName.of('Height'), PDFNumber)?.asNumber() ?? 0;
    const filter = dict.get(PDFName.of('Filter'));
    const filterName = filter instanceof PDFArray ? (filter.size() === 1 ? filter.get(0).toString() : 'multi') : filter?.toString();
    const components = colorComponents(pdf, dict);
    const bits = dict.lookupMaybe(PDFName.of('BitsPerComponent'), PDFNumber)?.asNumber();
    const eligible = components && bits === 8 && width > 0 && height > 0 && !dict.has(PDFName.of('Decode')) && !dict.has(PDFName.of('Mask'))
      && (filterName === '/DCTDecode' || (filterName === '/FlateDecode' && !dict.has(PDFName.of('DecodeParms'))));
    if (!eligible) { skipped++; continue; }

    const page = used.get(ref.toString()) ?? largest;
    // The lower axis resolution bounds the reduction, so neither axis falls below the target.
    const dpi = Math.min(width / page.w, height / page.h);
    const scale = dpi > options.dpi * 1.1 ? options.dpi / dpi : 1;
    const target = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: options.quality };
    const input: RecodeInput = filterName === '/DCTDecode'
      ? { kind: 'jpeg', bytes: object.contents, width, height, components: components! }
      : { kind: 'raw', bytes: decodePDFRawStream(object).decode(), width, height, components: components! };
    if (input.kind === 'raw' && input.bytes.length < width * height * components!) { skipped++; continue; }
    let recoded: RecodeOutput;
    try { recoded = await options.recoder(input, target); } catch { skipped++; continue; }
    // Keep the original unless the new image is clearly smaller.
    if (recoded.jpeg.length >= object.contents.length * 0.9) continue;
    const next = dict.clone(pdf.context);
    for (const key of ['Filter', 'DecodeParms', 'Length', 'ColorSpace', 'Width', 'Height', 'BitsPerComponent']) next.delete(PDFName.of(key));
    next.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
    next.set(PDFName.of('ColorSpace'), PDFName.of(recoded.components === 1 ? 'DeviceGray' : 'DeviceRGB'));
    next.set(PDFName.of('Width'), PDFNumber.of(recoded.width));
    next.set(PDFName.of('Height'), PDFNumber.of(recoded.height));
    next.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
    pdf.context.assign(ref, PDFRawStream.of(next, recoded.jpeg));
    if (scale < 1) downsampled++; else recompressed++;
  }

  await optimizeLoaded(pdf);
  const out = Uint8Array.from(await pdf.save({ useObjectStreams: true, updateFieldAppearances: false }));
  const check = await PDFDocument.load(out, { updateMetadata: false });
  const afterContent = pageContents(check);
  if (afterContent.length !== beforeContent.length || afterContent.some((content, i) => content !== beforeContent[i])) {
    throw new Error('Compression stopped: page content would change. The document was not changed.');
  }
  const smaller = out.length < bytes.length;
  return { bytes: smaller ? out : bytes, before: bytes.length, after: smaller ? out.length : bytes.length, images, downsampled, recompressed, skipped, unchanged: !smaller };
}

/** Browser recoder: decode with the platform, scale on a canvas, encode JPEG. */
export const canvasRecoder: ImageRecoder = async (input, target) => {
  let source: CanvasImageSource;
  if (input.kind === 'jpeg') {
    source = await createImageBitmap(new Blob([input.bytes.slice().buffer], { type: 'image/jpeg' }));
  } else {
    const rgba = new Uint8ClampedArray(input.width * input.height * 4);
    for (let i = 0, j = 0; i < input.width * input.height; i++, j += input.components) {
      const r = input.bytes[j]; const g = input.components === 3 ? input.bytes[j + 1] : r; const b = input.components === 3 ? input.bytes[j + 2] : r;
      rgba.set([r, g, b, 255], i * 4);
    }
    source = await createImageBitmap(new ImageData(rgba, input.width, input.height));
  }
  const canvas = document.createElement('canvas');
  canvas.width = target.width; canvas.height = target.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable.');
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, target.width, target.height);
  if ('close' in source && typeof source.close === 'function') source.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('JPEG encoding failed.')), 'image/jpeg', target.quality));
  // Canvas JPEGs are 3-component (RGB) even for grey sources.
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: target.width, height: target.height, components: 3 };
};
