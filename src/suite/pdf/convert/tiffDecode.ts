/* Baseline TIFF decoder for images to PDF (MAL-030): every page of a TIFF, stored in strips,
 * uncompressed, PackBits, LZW or Deflate (with the horizontal predictor), as bilevel, grey,
 * palette, RGB or RGBA at 1 or 8 bits per sample. Other variants are refused by name.
 */
import { unzlibSync } from 'fflate';
import type { Rgba } from './imageCodecs';

const MAX_PIXELS = 50_000_000;

function lzw(input: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let o = 0, bit = 0, width = 9;
  let table: Uint8Array[] = [];
  const reset = () => { table = Array.from({ length: 258 }, (_, i) => Uint8Array.of(i)); width = 9; };
  const read = () => {
    let v = 0;
    for (let k = 0; k < width; k++) { const byte = input[(bit >> 3)] ?? 0; v = (v << 1) | ((byte >> (7 - (bit & 7))) & 1); bit++; }
    return v;
  };
  reset();
  let previous: Uint8Array | null = null;
  while ((bit >> 3) < input.length && o < expected) {
    const code = read();
    if (code === 257) break;
    if (code === 256) { reset(); previous = null; continue; }
    let entry: Uint8Array;
    if (code < table.length) entry = table[code];
    else if (previous) { entry = new Uint8Array(previous.length + 1); entry.set(previous); entry[previous.length] = previous[0]; }
    else throw new Error('This TIFF uses damaged LZW data.');
    out.set(entry.subarray(0, Math.max(0, expected - o)), o); o += entry.length;
    if (previous) { const next = new Uint8Array(previous.length + 1); next.set(previous); next[previous.length] = entry[0]; table.push(next); }
    previous = entry;
    // Early change: the code width grows one code before the table fills.
    if (table.length + 1 >= 1 << width && width < 12) width++;
  }
  return out;
}
function packBits(input: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected); let o = 0, i = 0;
  while (i < input.length && o < expected) {
    const n = (input[i++] << 24) >> 24;
    if (n >= 0) { out.set(input.subarray(i, i + n + 1), o); o += n + 1; i += n + 1; }
    else if (n !== -128) { out.fill(input[i++], o, o + 1 - n); o += 1 - n; }
  }
  return out;
}

export function decodeTiff(bytes: Uint8Array): Rgba[] {
  if (bytes.length < 8) throw new Error('This TIFF file is empty or damaged.');
  const little = bytes[0] === 0x49 && bytes[1] === 0x49;
  if (!little && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) throw new Error('This is not a TIFF file.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o: number) => v.getUint16(o, little), u32 = (o: number) => v.getUint32(o, little);
  if (u16(2) !== 42) throw new Error('BigTIFF and other TIFF variants are not supported.');
  const pages: Rgba[] = [];
  const seen = new Set<number>();
  for (let ifd = u32(4); ifd; ) {
    // A safety limit, but never a silent one: more pages than that refuses the file.
    if (pages.length >= 500) throw new Error('This TIFF has more than 500 pages; split it before converting.');
    if (seen.has(ifd) || ifd + 2 > bytes.length) throw new Error('This TIFF file is damaged.');
    seen.add(ifd);
    const count = u16(ifd);
    const tags = new Map<number, number[]>();
    for (let i = 0; i < count; i++) {
      const e = ifd + 2 + i * 12, type = u16(e + 2), n = u32(e + 4);
      const size = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 } as Record<number, number>)[type] ?? 4;
      const at = n * size > 4 ? u32(e + 8) : e + 8;
      const values: number[] = [];
      for (let k = 0; k < Math.min(n, 1 << 16); k++) values.push(type === 3 ? u16(at + k * 2) : type === 4 ? u32(at + k * 4) : type === 5 ? u32(at + k * 8) / (u32(at + k * 8 + 4) || 1) : bytes[at + k]);
      tags.set(u16(e), values);
    }
    const tag = (t: number, fallback?: number) => tags.get(t)?.[0] ?? fallback;
    const width = tag(256)!, height = tag(257)!;
    if (!width || !height || width * height > MAX_PIXELS) throw new Error('The TIFF image is too large or has no size.');
    if (tags.has(322)) throw new Error('Tiled TIFF images are not supported; save the image with strips.');
    const compression = tag(259, 1)!, photometric = tag(262, 1)!, spp = tag(277, 1)!, bps = tag(258, 1)!, predictor = tag(317, 1)!;
    if (tag(284, 1) !== 1 && spp > 1) throw new Error('TIFF images with separate colour planes are not supported.');
    if (![1, 8].includes(bps)) throw new Error(`TIFF images with ${bps} bits per sample are not supported.`);
    if (![0, 1, 2, 3].includes(photometric)) throw new Error('This TIFF colour model (for example CMYK or YCbCr) is not supported.');
    const rowBytes = Math.ceil((width * spp * bps) / 8);
    const rowsPerStrip = tag(278, height)!;
    const offsets = tags.get(273) ?? [], counts = tags.get(279) ?? [];
    const data = new Uint8Array(rowBytes * height);
    offsets.forEach((offset, s) => {
      const raw = bytes.subarray(offset, offset + (counts[s] ?? 0));
      const rows = Math.min(rowsPerStrip, height - s * rowsPerStrip);
      const expected = rows * rowBytes;
      const strip = compression === 1 ? raw : compression === 32773 ? packBits(raw, expected) : compression === 5 ? lzw(raw, expected)
        : compression === 8 || compression === 32946 ? unzlibSync(raw) : (() => { throw new Error('This TIFF compression (for example JPEG or CCITT fax) is not supported.'); })();
      data.set(strip.subarray(0, expected), s * rowsPerStrip * rowBytes);
    });
    if (predictor === 2 && bps === 8) for (let y = 0; y < height; y++) for (let x = spp; x < rowBytes; x++) data[y * rowBytes + x] = (data[y * rowBytes + x] + data[y * rowBytes + x - spp]) & 255;
    const palette = tags.get(320);
    const out = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (bps === 1) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const value = (photometric === 0 ? 1 - bit : bit) * 255;
        out[o] = out[o + 1] = out[o + 2] = value; out[o + 3] = 255;
        continue;
      }
      const i = y * rowBytes + x * spp;
      if (photometric === 2) { out[o] = data[i]; out[o + 1] = data[i + 1]; out[o + 2] = data[i + 2]; out[o + 3] = spp >= 4 ? data[i + 3] : 255; }
      else if (photometric === 3 && palette) { const k = data[i]; const n = palette.length / 3; out[o] = palette[k] >> 8; out[o + 1] = palette[n + k] >> 8; out[o + 2] = palette[2 * n + k] >> 8; out[o + 3] = 255; }
      else { const g = photometric === 0 ? 255 - data[i] : data[i]; out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = spp >= 2 ? data[i + 1] : 255; }
    }
    pages.push({ width, height, data: out });
    ifd = u32(ifd + 2 + count * 12);
  }
  if (!pages.length) throw new Error('This TIFF file has no images.');
  return pages;
}
