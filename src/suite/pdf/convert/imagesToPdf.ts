/* Images to PDF (MAL-030): JPG, PNG and TIFF (every page) in the chosen order, one image per page,
 * with page size, orientation, margins and fit. Other formats (WebP, BMP, GIF) are converted to
 * PNG by the caller in the browser before they reach this engine.
 */
import { PDFDocument } from 'pdf-lib';
import { encodePng } from './imageCodecs';
import { imageInfo } from './flowLayout';
import { decodeTiff } from './tiffDecode';

export type PageSizeName = 'image' | 'a4' | 'letter' | 'legal' | 'a3' | 'a5';
export const PAGE_SIZES: Record<Exclude<PageSizeName, 'image'>, [number, number]> = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008], a3: [841.89, 1190.55], a5: [419.53, 595.28] };
export interface ImagePageOptions { pageSize: PageSizeName; orientation: 'auto' | 'portrait' | 'landscape'; margin: number; fit: 'fit' | 'actual' }
export interface ImageInput { name: string; bytes: Uint8Array }

const isTiff = (b: Uint8Array) => (b[0] === 0x49 && b[1] === 0x49 && b[2] === 42) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 42);

export async function imagesToPdf(images: ImageInput[], options: ImagePageOptions): Promise<{ bytes: Uint8Array; pages: number; notes: string[] }> {
  if (!images.length) throw new Error('Add at least one image.');
  if (images.length > 200) throw new Error('Up to 200 images can be combined at a time.');
  if (!(options.margin >= 0 && options.margin <= 144)) throw new Error('Margins must be 0 to 144 points (2 inches).');
  const pdf = await PDFDocument.create();
  const notes: string[] = [];
  let shrunk = 0;
  for (const input of images) {
    let pieces: { format: 'png' | 'jpeg'; bytes: Uint8Array; width: number; height: number }[];
    if (isTiff(input.bytes)) {
      try { pieces = decodeTiff(input.bytes).map((page) => ({ format: 'png' as const, bytes: encodePng(page), width: page.width, height: page.height })); }
      catch (reason) { throw new Error(`${input.name}: ${reason instanceof Error ? reason.message : String(reason)}`); }
      if (pieces.length > 1) notes.push(`${input.name}: all ${pieces.length} TIFF pages were added.`);
    } else {
      const info = imageInfo(input.bytes);
      if (!info) throw new Error(`${input.name} is not a JPG, PNG or TIFF image.`);
      pieces = [{ ...info, bytes: input.bytes }];
    }
    for (const piece of pieces) {
      if (piece.width * piece.height > 50_000_000) throw new Error(`${input.name} is larger than 50 megapixels.`);
      const image = piece.format === 'png' ? await pdf.embedPng(piece.bytes) : await pdf.embedJpg(piece.bytes);
      // Pixels are placed at 96 per inch for "actual size" and image-sized pages.
      const [iw, ih] = [piece.width * 0.75, piece.height * 0.75];
      let [pw, ph] = options.pageSize === 'image' ? [iw + 2 * options.margin, ih + 2 * options.margin] : PAGE_SIZES[options.pageSize];
      const landscape = options.orientation === 'landscape' || (options.orientation === 'auto' && iw > ih);
      if (options.pageSize !== 'image' && landscape !== pw > ph) [pw, ph] = [ph, pw];
      const [bw, bh] = [pw - 2 * options.margin, ph - 2 * options.margin];
      if (bw < 10 || bh < 10) throw new Error('The margins leave no room for the image.');
      let scale = options.fit === 'fit' || options.pageSize === 'image' ? Math.min(bw / iw, bh / ih) : 1;
      if (options.fit === 'actual' && (iw > bw || ih > bh)) { scale = Math.min(bw / iw, bh / ih); shrunk++; }
      const [w, h] = [iw * scale, ih * scale];
      pdf.addPage([pw, ph]).drawImage(image, { x: options.margin + (bw - w) / 2, y: options.margin + (bh - h) / 2, width: w, height: h });
    }
  }
  if (shrunk) notes.push(`${shrunk} image(s) were larger than the page at actual size and were scaled down to fit.`);
  return { bytes: Uint8Array.from(await pdf.save({ useObjectStreams: true })), pages: pdf.getPageCount(), notes };
}
