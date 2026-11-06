/* Image codecs for PDF export (MAL-029, MAL-036): PNG with alpha and DPI, baseline TIFF
 * (single or multi-page, uncompressed or Deflate), JPEG density, background removal and
 * cropping. Pure functions over RGBA pixels, so they run the same in the browser and tests.
 */
import { zlibSync } from 'fflate';

export interface Rgba { width: number; height: number; data: Uint8ClampedArray | Uint8Array }

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
const concat = (parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

/** True when any pixel is not fully opaque. */
export const hasAlpha = (image: Rgba) => { for (let i = 3; i < image.data.length; i += 4) if (image.data[i] !== 255) return true; return false; };

/** PNG (RGBA when the image has transparency, RGB otherwise) with its resolution in pHYs. */
export function encodePng(image: Rgba, dpi = 72): Uint8Array {
  const { width, height, data } = image;
  const alpha = hasAlpha(image);
  const channels = alpha ? 4 : 3;
  const raw = new Uint8Array(height * (width * channels + 1));
  for (let y = 0, o = 0; y < height; y++) {
    raw[o++] = 1; // Sub filter: smaller output for rendered pages
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < channels; c++) {
        const left = x > 0 ? data[i - 4 + c] : 0;
        raw[o++] = (data[i + c] - left) & 0xff;
      }
    }
  }
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width); hv.setUint32(4, height); header[8] = 8; header[9] = alpha ? 6 : 2;
  const phys = new Uint8Array(9);
  const ppm = Math.round(dpi / 0.0254);
  new DataView(phys.buffer).setUint32(0, ppm); new DataView(phys.buffer).setUint32(4, ppm); phys[8] = 1;
  return concat([Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk('IHDR', header), chunk('pHYs', phys),
    chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))]);
}

/** Sets a JFIF JPEG's density to the given DPI (adds nothing when the file has no JFIF header). */
export function setJpegDensity(jpeg: Uint8Array, dpi: number): Uint8Array {
  const out = Uint8Array.from(jpeg);
  if (out[0] !== 0xff || out[1] !== 0xd8 || out[2] !== 0xff || out[3] !== 0xe0 || String.fromCharCode(...out.subarray(6, 10)) !== 'JFIF') return out;
  out[13] = 1; // dots per inch
  const value = Math.max(1, Math.min(65535, Math.round(dpi)));
  out[14] = value >> 8; out[15] = value & 0xff; out[16] = value >> 8; out[17] = value & 0xff;
  return out;
}

/**
 * Baseline TIFF, little-endian, 8 bits per sample, RGB or RGBA (unassociated alpha), one page
 * per image, uncompressed or Adobe Deflate. Resolution is written in pixels per inch.
 */
export function encodeTiff(pages: Rgba[], options: { dpi: number; compression: 'none' | 'deflate' }): Uint8Array {
  if (!pages.length) throw new Error('No pages to write.');
  const parts: Uint8Array[] = [new Uint8Array(8)];
  let offset = 8;
  const ifdOffsets: number[] = []; const patches: { at: number; value: number }[] = [];
  for (const page of pages) {
    const alpha = hasAlpha(page);
    const spp = alpha ? 4 : 3;
    const raw = new Uint8Array(page.width * page.height * spp);
    for (let i = 0, o = 0; i < page.data.length; i += 4) { raw[o++] = page.data[i]; raw[o++] = page.data[i + 1]; raw[o++] = page.data[i + 2]; if (alpha) raw[o++] = page.data[i + 3]; }
    const strip = options.compression === 'deflate' ? zlibSync(raw, { level: 6 }) : raw;
    const stripOffset = offset; parts.push(strip); offset += strip.length; if (offset % 2) { parts.push(new Uint8Array(1)); offset++; }
    const bps = new Uint8Array(spp * 2); for (let i = 0; i < spp; i++) bps[i * 2] = 8;
    const bpsOffset = offset; parts.push(bps); offset += bps.length;
    const res = new Uint8Array(8); new DataView(res.buffer).setUint32(0, Math.round(options.dpi), true); new DataView(res.buffer).setUint32(4, 1, true);
    const resOffset = offset; parts.push(res); offset += 8;
    const entries: [number, number, number, number][] = [ // tag, type (3 SHORT, 4 LONG, 5 RATIONAL), count, value
      [256, 4, 1, page.width], [257, 4, 1, page.height], [258, 3, spp, bpsOffset], [259, 3, 1, options.compression === 'deflate' ? 8 : 1],
      [262, 3, 1, 2], [273, 4, 1, stripOffset], [277, 3, 1, spp], [278, 4, 1, page.height], [279, 4, 1, strip.length],
      [282, 5, 1, resOffset], [283, 5, 1, resOffset], [284, 3, 1, 1], [296, 3, 1, 2],
      ...(alpha ? [[338, 3, 1, 2] as [number, number, number, number]] : []),
    ];
    const ifd = new Uint8Array(2 + entries.length * 12 + 4);
    const view = new DataView(ifd.buffer);
    view.setUint16(0, entries.length, true);
    entries.forEach(([tag, type, count, value], i) => {
      const at = 2 + i * 12;
      view.setUint16(at, tag, true); view.setUint16(at + 2, type, true); view.setUint32(at + 4, count, true);
      if (type === 3 && count === 1) view.setUint16(at + 8, value, true); else view.setUint32(at + 8, value, true);
    });
    ifdOffsets.push(offset);
    patches.push({ at: offset + 2 + entries.length * 12, value: 0 });
    parts.push(ifd); offset += ifd.length;
  }
  const out = concat(parts);
  const view = new DataView(out.buffer);
  out[0] = 0x49; out[1] = 0x49; view.setUint16(2, 42, true); view.setUint32(4, ifdOffsets[0], true);
  patches.forEach((patch, i) => view.setUint32(patch.at, ifdOffsets[i + 1] ?? 0, true));
  return out;
}

/** Makes pixels close to `key` transparent; a soft edge keeps anti-aliased borders smooth. */
export function removeBackground(image: Rgba, key: [number, number, number], tolerance: number): Rgba {
  if (!(tolerance >= 0 && tolerance <= 255)) throw new Error('Tolerance must be 0 to 255.');
  const data = Uint8ClampedArray.from(image.data);
  const soft = Math.max(8, tolerance * 0.5);
  for (let i = 0; i < data.length; i += 4) {
    const distance = Math.max(Math.abs(data[i] - key[0]), Math.abs(data[i + 1] - key[1]), Math.abs(data[i + 2] - key[2]));
    if (distance <= tolerance) data[i + 3] = 0;
    else if (distance <= tolerance + soft) data[i + 3] = Math.round(data[i + 3] * ((distance - tolerance) / soft));
  }
  return { width: image.width, height: image.height, data };
}

/** The part of an image inside a rectangle given as fractions of its size. */
export function cropRgba(image: Rgba, region: { x: number; y: number; width: number; height: number }): Rgba {
  const x0 = Math.max(0, Math.floor(region.x * image.width)), y0 = Math.max(0, Math.floor(region.y * image.height));
  const x1 = Math.min(image.width, Math.ceil((region.x + region.width) * image.width)), y1 = Math.min(image.height, Math.ceil((region.y + region.height) * image.height));
  if (x1 - x0 < 1 || y1 - y0 < 1) throw new Error('The region is empty.');
  const width = x1 - x0, height = y1 - y0;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) data.set(image.data.subarray(((y0 + y) * image.width + x0) * 4, ((y0 + y) * image.width + x1) * 4), y * width * 4);
  return { width, height, data };
}

/** PDF.js image data (gray 1-bit, RGB or RGBA) as RGBA. */
export function rgbaFromPdfJs(image: { width: number; height: number; kind: number; data: Uint8Array | Uint8ClampedArray }): Rgba {
  const { width, height, kind, data } = image;
  const out = new Uint8ClampedArray(width * height * 4);
  if (kind === 3) out.set(data.subarray(0, out.length));
  else if (kind === 2) for (let i = 0, o = 0; o < out.length; i += 3, o += 4) { out[o] = data[i]; out[o + 1] = data[i + 1]; out[o + 2] = data[i + 2]; out[o + 3] = 255; }
  else {
    const rowBytes = (width + 7) >> 3;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const v = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
      const o = (y * width + x) * 4; out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255;
    }
  }
  return { width, height, data: out };
}
