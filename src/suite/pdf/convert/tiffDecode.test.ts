import { describe, expect, it, vi } from 'vitest';

// Records how much output each strip inflation may produce.
const limits: (number | undefined)[] = [];
vi.mock('fflate', async (original) => {
  const real = await original<typeof import('fflate')>();
  return { ...real, unzlibSync: (data: Uint8Array, options?: { out?: Uint8Array }) => { limits.push(options?.out?.length); return real.unzlibSync(data, options as never); } };
});

describe('TIFF Deflate strips', () => {
  it('inflates a strip into storage the size of the strip, so a small file cannot expand without limit', async () => {
    const { zlibSync } = await import('fflate');
    const { decodeTiff } = await import('./tiffDecode');
    // A 1×1 grey image whose Deflate strip would expand to 50 MB.
    const strip = zlibSync(new Uint8Array(50_000_000).fill(7));
    const entries: [number, number, number][] = [[256, 3, 1], [257, 3, 1], [258, 3, 8], [259, 3, 8], [262, 3, 1], [273, 4, 0], [277, 3, 1], [278, 3, 1], [279, 4, strip.length]];
    const ifd = 8, stripAt = ifd + 2 + entries.length * 12 + 4;
    const bytes = new Uint8Array(stripAt + strip.length); const v = new DataView(bytes.buffer);
    bytes.set([0x49, 0x49]); v.setUint16(2, 42, true); v.setUint32(4, ifd, true); v.setUint16(ifd, entries.length, true);
    entries.forEach(([tag, type, value], i) => {
      const e = ifd + 2 + i * 12;
      v.setUint16(e, tag, true); v.setUint16(e + 2, type, true); v.setUint32(e + 4, 1, true);
      if (tag === 273) v.setUint32(e + 8, stripAt, true); else if (type === 3) v.setUint16(e + 8, value, true); else v.setUint32(e + 8, value, true);
    });
    bytes.set(strip, stripAt);
    const [page] = decodeTiff(bytes);
    expect([page.width, page.height, page.data[0]]).toEqual([1, 1, 7]);
    expect(limits).toEqual([1]);
  });
});
