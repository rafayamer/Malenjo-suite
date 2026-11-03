import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { zlibSync } from 'fflate';
import { compressPdfImages, type ImageRecoder, type RecodeInput } from './pdfImageCompress';

/** A page-filling 1200x1600 RGB Flate image on a Letter-sized page (about 200 dpi), plus a 1-bit image that must be skipped. */
async function scanned() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const pixels = new Uint8Array(1200 * 1600 * 3).map((_, i) => (i * 7) % 251);
  const image = pdf.context.register(PDFRawStream.of(pdf.context.obj({
    Type: 'XObject', Subtype: 'Image', Width: 1200, Height: 1600, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode',
  }), zlibSync(pixels)));
  const bilevel = pdf.context.register(PDFRawStream.of(pdf.context.obj({
    Type: 'XObject', Subtype: 'Image', Width: 8, Height: 8, ColorSpace: 'DeviceGray', BitsPerComponent: 1,
  }), new Uint8Array(8)));
  const name = page.node.newXObject('Scan', image);
  const other = page.node.newXObject('Bits', bilevel);
  const content = pdf.context.register(pdf.context.flateStream(`q 612 0 0 792 0 0 cm /${name.decodeText()} Do Q q 8 0 0 8 0 0 cm /${other.decodeText()} Do Q`));
  page.node.set(PDFName.of('Contents'), pdf.context.obj([content]));
  return pdf.save();
}

describe('compressPdfImages (MAL-025)', () => {
  it('downsamples to the profile resolution, re-encodes as JPEG, skips ineligible images and reports sizes', async () => {
    const calls: [RecodeInput, { width: number; height: number; quality: number }][] = [];
    const recoder: ImageRecoder = async (input, target) => { calls.push([input, target]); return { jpeg: new Uint8Array(5000).fill(1), width: target.width, height: target.height, components: 3 }; };
    const source = await scanned();
    const result = await compressPdfImages(source, { dpi: 100, quality: 0.6, recoder });
    expect([result.images, result.downsampled, result.recompressed, result.skipped]).toEqual([2, 1, 0, 1]);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({ kind: 'raw', width: 1200, height: 1600, components: 3 });
    expect(calls[0][0].bytes.length).toBe(1200 * 1600 * 3);
    // 1200 px across 8.5 in = 141 dpi (the lower axis) -> 100 dpi: 850 x 1133, so neither axis drops below 100 dpi.
    expect(calls[0][1]).toEqual({ width: 850, height: 1133, quality: 0.6 });
    expect(result.after).toBeLessThan(result.before);
    const out = await PDFDocument.load(result.bytes);
    const image = out.context.enumerateIndirectObjects().map(([, o]) => o).find((o) => o instanceof PDFRawStream && o.dict.lookupMaybe(PDFName.of('Width'), PDFNumber)?.asNumber() === 850) as PDFRawStream;
    expect(image.dict.get(PDFName.of('Filter'))?.toString()).toBe('/DCTDecode');
    expect(image.dict.get(PDFName.of('Height'))?.toString()).toBe('1133');
  });

  it('never recompresses an image used as a soft mask', async () => {
    const pdf = await PDFDocument.load(await scanned());
    const mask = pdf.context.register(PDFRawStream.of(pdf.context.obj({ Type: 'XObject', Subtype: 'Image', Width: 1200, Height: 1600, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'FlateDecode' }),
      zlibSync(new Uint8Array(1200 * 1600).map((_, i) => i % 251))));
    const image = pdf.context.enumerateIndirectObjects().find(([, o]) => o instanceof PDFRawStream && o.dict.lookupMaybe(PDFName.of('Width'), PDFNumber)?.asNumber() === 1200)![1] as PDFRawStream;
    image.dict.set(PDFName.of('SMask'), mask);
    const seen: number[] = [];
    const recoder: ImageRecoder = async (input, target) => { seen.push(input.components); return { jpeg: new Uint8Array(100), width: target.width, height: target.height, components: 3 }; };
    const result = await compressPdfImages(await pdf.save(), { dpi: 100, quality: 0.6, recoder });
    expect(seen).toEqual([3]);
    const out = await PDFDocument.load(result.bytes);
    const grey = out.context.enumerateIndirectObjects().map(([, o]) => o).filter((o) => o instanceof PDFRawStream && o.dict.get(PDFName.of('ColorSpace'))?.toString() === '/DeviceGray' && o.dict.lookupMaybe(PDFName.of('Width'), PDFNumber)?.asNumber() === 1200);
    expect(grey).toHaveLength(1);
  });

  it('leaves ICC-based images alone (their colours would need profile conversion)', async () => {
    const pdf = await PDFDocument.load(await scanned());
    const image = pdf.context.enumerateIndirectObjects().find(([, o]) => o instanceof PDFRawStream && o.dict.lookupMaybe(PDFName.of('Width'), PDFNumber)?.asNumber() === 1200)![1] as PDFRawStream;
    image.dict.set(PDFName.of('ColorSpace'), pdf.context.obj([PDFName.of('ICCBased'), pdf.context.register(pdf.context.stream('profile', { N: 3 }))]));
    let calls = 0;
    const recoder: ImageRecoder = async (_input, target) => { calls++; return { jpeg: new Uint8Array(100), width: target.width, height: target.height, components: 3 }; };
    const result = await compressPdfImages(await pdf.save(), { dpi: 100, quality: 0.6, recoder });
    expect([calls, result.skipped, result.downsampled]).toEqual([0, 2, 0]);
  });

  it('leaves images that are already at or below the target alone unless re-encoding clearly helps', async () => {
    const recoder: ImageRecoder = async (_input, target) => ({ jpeg: new Uint8Array(10_000_000), width: target.width, height: target.height, components: 3 });
    const result = await compressPdfImages(await scanned(), { dpi: 300, quality: 0.8, recoder });
    expect([result.downsampled, result.recompressed]).toEqual([0, 0]);
    await expect(compressPdfImages(await scanned(), { dpi: 10, quality: 0.8, recoder })).rejects.toThrow(/between 36 and 600/);
  });
});
