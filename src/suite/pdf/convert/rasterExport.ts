/* PDF to images (MAL-036) and transparent PNG (MAL-029), rendered with PDF.js in the browser. */
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { cropRgba, encodePng, encodeTiff, removeBackground, setJpegDensity, type Rgba } from './imageCodecs';
import type { ConversionFile, ConversionResult } from './textFormats';

export interface RasterOptions {
  format: 'png' | 'jpeg' | 'tiff';
  dpi: number;
  /** JPEG quality, 0.3 – 1. */
  quality: number;
  /** PNG/TIFF: leave the page background transparent where the PDF draws nothing. */
  transparent: boolean;
  /** PNG/TIFF: make pixels close to this colour transparent. */
  removeColor: { rgb: [number, number, number]; tolerance: number } | null;
  /** Only this part of one page (fractions of the page as shown). */
  /** The rectangle is in the page as shown, after `viewRotation` (degrees) is added to the page's own rotation. */
  region: { pageNumber: number; x: number; y: number; width: number; height: number; viewRotation?: number } | null;
  tiffCompression: 'none' | 'deflate';
  tiffMultipage: boolean;
}
const MAX_PIXELS = 40_000_000, MAX_TOTAL = 400 * 1024 * 1024;

async function render(doc: Pick<PDFDocumentProxy, 'getPage'>, pageNumber: number, dpi: number, transparent: boolean, viewRotation = 0): Promise<Rgba> {
  const page = await doc.getPage(pageNumber);
  // A region is cut from the page as it was shown, so it is rendered with the same view rotation.
  const viewport = viewRotation ? page.getViewport({ scale: dpi / 72, rotation: ((page.rotate ?? 0) + viewRotation) % 360 }) : page.getViewport({ scale: dpi / 72 });
  const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
  if (width * height > MAX_PIXELS) throw new Error(`Page ${pageNumber} at ${dpi} dpi would be ${Math.round(width * height / 1e6)} megapixels; the limit is 40. Choose a lower resolution.`);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  try {
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
    if (!context) throw new Error('Image export needs a canvas.');
    if (!transparent) { context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height); }
    await page.render({ canvas, canvasContext: context, viewport, background: transparent ? 'rgba(0,0,0,0)' : '#ffffff' }).promise;
    const { data } = context.getImageData(0, 0, width, height);
    return { width, height, data };
  } finally { canvas.width = 0; canvas.height = 0; page.cleanup(); }
}
async function jpeg(image: Rgba, quality: number, dpi: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  try {
    const context = canvas.getContext('2d')!;
    // JPEG has no transparency: flatten onto white.
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, image.width, image.height);
    const tmp = document.createElement('canvas'); tmp.width = image.width; tmp.height = image.height;
    tmp.getContext('2d')!.putImageData(new ImageData(Uint8ClampedArray.from(image.data), image.width, image.height), 0, 0);
    context.drawImage(tmp, 0, 0); tmp.width = 0;
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', quality));
    if (!blob) throw new Error('JPEG encoding failed.');
    return setJpegDensity(new Uint8Array(await blob.arrayBuffer()), dpi);
  } finally { canvas.width = 0; }
}

export async function pdfToImages(doc: Pick<PDFDocumentProxy, 'getPage'>, pages: number[], options: RasterOptions, title: string,
  progress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<ConversionResult> {
  if (!(options.dpi >= 36 && options.dpi <= 600)) throw new Error('Resolution must be 36 to 600 dpi.');
  if (options.format === 'jpeg' && !(options.quality >= 0.3 && options.quality <= 1)) throw new Error('JPEG quality must be 30 to 100.');
  const list = options.region ? [options.region.pageNumber] : pages;
  if (!list.length) throw new Error('Choose at least one page.');
  if (list.length > 200) throw new Error('Image export handles up to 200 pages at a time.');
  const alphaWanted = options.format !== 'jpeg' && (options.transparent || Boolean(options.removeColor));
  const files: ConversionFile[] = []; const tiffPages: Rgba[] = [];
  let total = 0;
  for (const [i, pageNumber] of list.entries()) {
    if (signal?.aborted) throw Object.assign(new Error('The export was cancelled.'), { name: 'AbortError' });
    let image = await render(doc, pageNumber, options.dpi, alphaWanted && options.transparent, options.region?.viewRotation ?? 0);
    if (options.region) image = cropRgba(image, options.region);
    if (options.removeColor && options.format !== 'jpeg') image = removeBackground(image, options.removeColor.rgb, options.removeColor.tolerance);
    const suffix = options.region ? `page-${pageNumber}-region` : `page-${pageNumber}`;
    if (options.format === 'tiff' && options.tiffMultipage) {
      // Every page is kept until the multi-page TIFF is written, so its pixels count against the budget now.
      total += image.data.length;
      if (total > MAX_TOTAL) throw new Error('The images would exceed 400 MB; choose fewer pages or a lower resolution.');
      tiffPages.push(image);
    }
    else {
      const bytes = options.format === 'png' ? encodePng(image, options.dpi) : options.format === 'jpeg' ? await jpeg(image, options.quality, options.dpi)
        : encodeTiff([image], { dpi: options.dpi, compression: options.tiffCompression });
      total += bytes.length;
      files.push({ name: `${title}-${suffix}.${options.format === 'jpeg' ? 'jpg' : options.format === 'tiff' ? 'tif' : 'png'}`, bytes, mime: options.format === 'png' ? 'image/png' : options.format === 'jpeg' ? 'image/jpeg' : 'image/tiff' });
    }
    if (total > MAX_TOTAL) throw new Error('The images would exceed 400 MB; choose fewer pages or a lower resolution.');
    progress?.(i + 1, list.length);
  }
  const cancelled = () => { if (signal?.aborted) throw Object.assign(new Error('The export was cancelled.'), { name: 'AbortError' }); };
  // Cancelling while the last page renders or encodes still cancels: nothing is returned to be saved.
  cancelled();
  if (tiffPages.length) {
    const bytes = encodeTiff(tiffPages, { dpi: options.dpi, compression: options.tiffCompression });
    if (bytes.length > MAX_TOTAL) throw new Error('The images would exceed 400 MB; choose fewer pages or a lower resolution.');
    files.push({ name: `${title}.tif`, bytes, mime: 'image/tiff' });
  }
  cancelled();
  const notes = [`Rendered at ${options.dpi} dpi.`];
  if (options.format === 'jpeg') notes.push(`JPEG quality ${Math.round(options.quality * 100)}; JPEG has no transparency, so the background is white.`);
  if (alphaWanted && options.transparent) notes.push('Areas where the PDF draws nothing are transparent; white areas the PDF paints stay white unless background removal is on.');
  if (options.removeColor && options.format !== 'jpeg') notes.push(`Pixels within ${options.removeColor.tolerance} of the chosen colour were made transparent.`);
  return { files, notes };
}
