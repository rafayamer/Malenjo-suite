import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { addDynamicStamp, documentIdentifier, resolveStamp, checkStampDesign, BUILT_IN_STAMPS } from './pdfDynamicStamp';
import { addPdfMeasurement, calibrateScale, listPdfMeasurements, measureValue, unitsPerPoint, type MeasureScale } from './pdfMeasure';

const TEN_FEET: MeasureScale = { pageValue: 1, pageUnit: 'in', realValue: 10, realUnit: 'ft' };
async function blank(rotate = 0) { const pdf = await PDFDocument.create(); pdf.addPage([720, 720]).setRotation(degrees(rotate)); return pdf.save(); }
async function annots(bytes: Uint8Array) {
  const loading = getDocument({ data: bytes.slice() } as never);
  const doc = await loading.promise;
  const list = (await (await doc.getPage(1)).getAnnotations()) as { subtype: string; contentsObj: { str: string }; rect: number[] }[];
  await loading.destroy();
  return list.map((a) => ({ subtype: a.subtype, contents: a.contentsObj.str, rect: a.rect }));
}

describe('Precision measurement (MAL-058)', () => {
  it('measures distance, perimeter, area and angle through a scale', () => {
    const sq: [number, number][] = [[0, 0], [144, 0], [144, 72], [0, 72]]; // 2 in by 1 in
    expect(measureValue('distance', [sq[0], sq[1]], TEN_FEET)).toEqual({ value: 20, unit: 'ft' });
    expect(measureValue('perimeter', sq, TEN_FEET).value).toBeCloseTo(60);
    expect(measureValue('area', sq, TEN_FEET)).toEqual({ value: 200, unit: 'sq ft' });
    expect(measureValue('angle', [sq[1], sq[0], sq[3]], TEN_FEET).value).toBeCloseTo(90);
    expect(measureValue('distance', [[0, 0], [72 / 2.54, 0]], { pageValue: 1, pageUnit: 'cm', realValue: 2, realUnit: 'm' }).value).toBeCloseTo(2);
    const calibrated = calibrateScale(216, 30, 'm'); // a 3 in line is 30 m
    expect(unitsPerPoint(calibrated) * 72).toBeCloseTo(10);
    expect(() => measureValue('angle', [[0, 0], [1, 1]], TEN_FEET)).toThrow('three points');
  });

  it('saves measurement annotations with the scale, on rotated pages too', async () => {
    let bytes = await blank(90);
    // Shown upright the 90°-rotated page is 720 wide; 0.1 to 0.3 across is 144 pt = 2 in = 20 ft.
    bytes = (await addPdfMeasurement(bytes, { pageNumber: 1, viewRotation: 0, kind: 'distance', points: [{ x: 0.1, y: 0.5 }, { x: 0.3, y: 0.5 }], scale: TEN_FEET, precision: 2, color: '#d00000', author: 'Tester' })).bytes;
    bytes = (await addPdfMeasurement(bytes, { pageNumber: 1, viewRotation: 0, kind: 'area', points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.1 }, { x: 0.3, y: 0.2 }, { x: 0.1, y: 0.2 }], scale: TEN_FEET, precision: 1, color: '#0000d0', author: 'Tester' })).bytes;
    bytes = (await addPdfMeasurement(bytes, { pageNumber: 1, viewRotation: 0, kind: 'perimeter', points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.1 }, { x: 0.3, y: 0.2 }, { x: 0.1, y: 0.2 }], scale: TEN_FEET, precision: 0, color: '#0000d0', author: 'Tester' })).bytes;
    bytes = (await addPdfMeasurement(bytes, { pageNumber: 1, viewRotation: 0, kind: 'angle', points: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }, { x: 0.6, y: 0.4 }], scale: TEN_FEET, precision: 2, color: '#0000d0', author: 'Tester' })).bytes;
    expect((await annots(bytes)).map((a) => `${a.subtype}:${a.contents}`)).toEqual(['Line:Distance: 20.00 ft', 'Polygon:Area: 200.0 sq ft', 'PolyLine:Perimeter: 60 ft', 'PolyLine:Angle: 90.0°']);
    expect((await listPdfMeasurements(bytes)).map((m) => [m.kind, m.scale])).toEqual([['distance', '1 in = 10 ft'], ['area', '1 in = 10 ft'], ['perimeter', '1 in = 10 ft'], ['angle', '1 in = 10 ft']]);
    const pdf = await PDFDocument.load(bytes);
    const line = pdf.context.lookup(pdf.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).get(0)) as PDFDict;
    const x = (line.lookup(PDFName.of('Measure'), PDFDict).lookup(PDFName.of('X'), PDFArray).lookup(0, PDFDict));
    expect(x.lookup(PDFName.of('C'))?.toString()).toBe(String(10 / 72));
  });
});

describe('Dynamic and custom stamps (MAL-057)', () => {
  const now = new Date(2026, 10, 9, 14, 5);
  it('fills the variables and checks designs', () => {
    expect(resolveStamp({ id: 'x', name: 'Legal', status: 'APPROVED BY LEGAL', detail: '{user} · {date} {time} · {docid} · {file} · {status}', color: '#15803d' },
      { user: 'Dana Reviewer', now, docId: 'ABC123', file: 'contract.pdf' })).toEqual({ status: 'APPROVED BY LEGAL', detail: 'Dana Reviewer · 2026-11-09 14:05 · ABC123 · contract.pdf · APPROVED BY LEGAL' });
    expect(() => checkStampDesign({ ...BUILT_IN_STAMPS[0], detail: '{owner}' })).toThrow('{owner} is not a stamp variable');
  });
  it('places a stamp annotation with its resolved text and appearance', async () => {
    const source = await blank();
    const pdf = await PDFDocument.load(source);
    const docId = await documentIdentifier(source);
    const { bytes, text } = await addDynamicStamp(source, { pageNumber: 1, viewRotation: 0, point: { x: 0.5, y: 0.2 }, design: BUILT_IN_STAMPS[0], values: { user: 'Dana Reviewer', now, docId, file: 'a.pdf' } });
    expect(text).toBe('APPROVED — By Dana Reviewer on 2026-11-09 at 14:05');
    const [stamp] = await annots(bytes);
    expect(stamp.subtype).toBe('Stamp'); expect(stamp.contents).toBe(text);
    expect((stamp.rect[1] + stamp.rect[3]) / 2).toBeCloseTo(576, 0); // centred on the click, 20% from the top
    expect(pdf.getPageCount()).toBe(1);
  });
});
