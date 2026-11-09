/**
 * Precision measurement (MAL-058): distance, perimeter, area and angle on a page, in real-world units through a
 * calibrated scale (for example 1 in on the page = 10 ft). Measurements are saved as standard measurement
 * annotations — Line (LineDimension), PolyLine (PolyLineDimension), Polygon (PolygonDimension) — with a /Measure
 * dictionary describing the scale, and the value as their text, so other PDF readers can show them too.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { refuseSignedPdf } from './pdfSignatureGuard';
import { parseColor, viewerFrame } from './pdfStamp';
import type { ShownPoint } from './pdfMarkup';

export type MeasureKind = 'distance' | 'perimeter' | 'area' | 'angle';
export type PageUnit = 'pt' | 'in' | 'mm' | 'cm';
export type RealUnit = 'pt' | 'in' | 'ft' | 'yd' | 'mi' | 'mm' | 'cm' | 'm' | 'km';
export const REAL_UNITS: RealUnit[] = ['mm', 'cm', 'm', 'km', 'in', 'ft', 'yd', 'mi', 'pt'];
export interface MeasureScale { pageValue: number; pageUnit: PageUnit; realValue: number; realUnit: RealUnit }
export const ACTUAL_SIZE: MeasureScale = { pageValue: 1, pageUnit: 'in', realValue: 1, realUnit: 'in' };

const POINTS_PER: Record<PageUnit, number> = { pt: 1, in: 72, mm: 72 / 25.4, cm: 72 / 2.54 };
const N = PDFName.of;

export function checkScale(scale: MeasureScale): void {
  if (!(scale.pageValue > 0 && scale.pageValue < 1e6) || !(scale.realValue > 0 && scale.realValue < 1e9)) throw new Error('Both sides of the scale must be positive numbers.');
  if (!POINTS_PER[scale.pageUnit] || !REAL_UNITS.includes(scale.realUnit)) throw new Error('Choose units from the lists.');
}
/** Real units per PDF point. */
export const unitsPerPoint = (scale: MeasureScale) => scale.realValue / (scale.pageValue * POINTS_PER[scale.pageUnit]);
export const scaleLabel = (s: MeasureScale) => `${s.pageValue} ${s.pageUnit} = ${s.realValue} ${s.realUnit}`;

/** The scale that makes a line of `lengthPoints` measure `realValue` real units. */
export function calibrateScale(lengthPoints: number, realValue: number, realUnit: RealUnit): MeasureScale {
  if (!(lengthPoints > 0.5)) throw new Error('Draw a longer reference line to calibrate from.');
  const scale: MeasureScale = { pageValue: Math.round(lengthPoints * 1000) / 1000, pageUnit: 'pt', realValue, realUnit };
  checkScale(scale);
  return scale;
}

type P = [number, number];
const dist = (a: P, b: P) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export function measureValue(kind: MeasureKind, points: P[], scale: MeasureScale): { value: number; unit: string } {
  checkScale(scale);
  const k = unitsPerPoint(scale);
  const need = { distance: 2, perimeter: 3, area: 3, angle: 3 }[kind];
  if (points.length < need || (kind !== 'perimeter' && kind !== 'area' && points.length !== need)) throw new Error(kind === 'distance' ? 'A distance needs two points.' : kind === 'angle' ? 'An angle needs three points: one arm, the vertex, the other arm.' : `A ${kind} needs at least three points.`);
  if (kind === 'distance') return { value: dist(points[0], points[1]) * k, unit: scale.realUnit };
  if (kind === 'perimeter') return { value: points.reduce((n, p, i) => n + dist(p, points[(i + 1) % points.length]), 0) * k, unit: scale.realUnit };
  if (kind === 'area') {
    const twice = points.reduce((n, p, i) => { const q = points[(i + 1) % points.length]; return n + p[0] * q[1] - q[0] * p[1]; }, 0);
    return { value: (Math.abs(twice) / 2) * k * k, unit: `sq ${scale.realUnit}` };
  }
  const [a, v, b] = points;
  const angle = Math.abs(Math.atan2(a[1] - v[1], a[0] - v[0]) - Math.atan2(b[1] - v[1], b[0] - v[0])) * (180 / Math.PI);
  return { value: angle > 180 ? 360 - angle : angle, unit: '°' };
}
export function formatMeasure(kind: MeasureKind, value: number, unit: string, precision: number): string {
  const name = { distance: 'Distance', perimeter: 'Perimeter', area: 'Area', angle: 'Angle' }[kind];
  const digits = kind === 'angle' ? 1 : precision;
  return `${name}: ${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}${unit === '°' ? '°' : ` ${unit}`}`;
}

export interface MeasureSpec { pageNumber: number; viewRotation: number; kind: MeasureKind; points: ShownPoint[]; scale: MeasureScale; precision: number; color: string; author: string }

export async function addPdfMeasurement(bytes: Uint8Array, spec: MeasureSpec): Promise<{ bytes: Uint8Array; label: string }> {
  if (!Number.isInteger(spec.precision) || spec.precision < 0 || spec.precision > 4) throw new Error('Precision must be 0 to 4 decimal places.');
  let pdf: PDFDocument;
  try { pdf = await PDFDocument.load(bytes, { updateMetadata: false }); } catch { throw new Error('This PDF could not be measured because it is encrypted, invalid or damaged.'); }
  refuseSignedPdf(pdf, 'adding measurements');
  if (!Number.isSafeInteger(spec.pageNumber) || spec.pageNumber < 1 || spec.pageNumber > pdf.getPageCount()) throw new Error('That page is not in this PDF.');
  const frame = viewerFrame(pdf, spec.pageNumber - 1, spec.viewRotation);
  const m = frame.matrix;
  const points: P[] = spec.points.map((p) => {
    if (!(p.x >= -0.001 && p.x <= 1.001 && p.y >= -0.001 && p.y <= 1.001)) throw new Error('Measurements must stay on the page.');
    const u = p.x * frame.width, v = (1 - p.y) * frame.height;
    return [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]];
  });
  const { value, unit } = measureValue(spec.kind, points, spec.scale);
  const label = formatMeasure(spec.kind, value, unit, spec.precision);
  const [r, g, b] = parseColor(spec.color);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const size = 9; const labelWidth = font.widthOfTextAtSize(label, size);
  // The label sits upright (in the shown frame) beside the middle of the shape.
  const anchor: P = spec.kind === 'angle' ? points[1] : spec.kind === 'distance' ? [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2]
    : [points.reduce((n, p) => n + p[0], 0) / points.length, points.reduce((n, p) => n + p[1], 0) / points.length];
  const det = m[0] * m[3] - m[1] * m[2];
  const au = (m[3] * (anchor[0] - m[4]) - m[2] * (anchor[1] - m[5])) / det, av = (-m[1] * (anchor[0] - m[4]) + m[0] * (anchor[1] - m[5])) / det;
  const lu = au + 4, lv = av + 4;
  const labelCorners = [[lu, lv], [lu + labelWidth + 4, lv + size + 4]].map(([u, v]) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]]);
  const all = [...points, ...labelCorners];
  const pad = 4;
  const rect = [Math.min(...all.map((p) => p[0])) - pad, Math.min(...all.map((p) => p[1])) - pad, Math.max(...all.map((p) => p[0])) + pad, Math.max(...all.map((p) => p[1])) + pad];
  const path = points.map((p, i) => `${p[0].toFixed(3)} ${p[1].toFixed(3)} ${i ? 'l' : 'm'}`).join(' ') + (spec.kind === 'area' || spec.kind === 'perimeter' ? ' h' : '');
  const ticks = points.map((p) => `${(p[0] - 2).toFixed(3)} ${(p[1] - 2).toFixed(3)} 4 4 re`).join(' ');
  const ops = [`q ${r} ${g} ${b} RG ${r} ${g} ${b} rg 1 w ${path} S ${ticks} f Q`,
    `q ${m.join(' ')} cm 1 1 1 rg ${lu} ${lv} ${labelWidth + 4} ${size + 4} re f ${r} ${g} ${b} rg BT /MF ${size} Tf ${lu + 2} ${lv + 3} Td ${font.encodeText(label).toString()} Tj ET Q`];
  const appearance = pdf.context.register(pdf.context.stream(ops.join('\n'), { Type: 'XObject', Subtype: 'Form', BBox: rect, Resources: { Font: { MF: font.ref } } }));
  const k = unitsPerPoint(spec.scale);
  const format = (u: string, c: number) => pdf.context.obj({ Type: 'NumberFormat', U: PDFHexString.fromText(u), C: c, D: 10 ** spec.precision, SS: PDFHexString.fromText(' ') });
  const measure = pdf.context.obj({
    Type: 'Measure', Subtype: 'RL', R: PDFHexString.fromText(scaleLabel(spec.scale)),
    X: [format(spec.scale.realUnit, k)], Y: [format(spec.scale.realUnit, k)], D: [format(spec.scale.realUnit, 1)], A: [format(`sq ${spec.scale.realUnit}`, 1)], T: [format('°', 1)],
  });
  const subtype = spec.kind === 'distance' ? 'Line' : spec.kind === 'area' ? 'Polygon' : 'PolyLine';
  const dict = pdf.context.obj({
    Type: 'Annot', Subtype: subtype, Rect: rect, F: 4, C: [r, g, b], BS: { W: 1 }, Contents: PDFHexString.fromText(label), T: PDFHexString.fromText(spec.author || 'MALENJO User'),
    M: PDFString.fromDate(new Date()), Measure: measure, AP: { N: appearance }, MALENJO_Measure: N(spec.kind),
  }) as PDFDict;
  const flat = points.flat().map((n) => Math.round(n * 1000) / 1000);
  if (subtype === 'Line') { dict.set(N('L'), pdf.context.obj(flat)); dict.set(N('IT'), N('LineDimension')); dict.set(N('Cap'), pdf.context.obj(true)); }
  else {
    // A perimeter is closed: its vertex list returns to the start.
    dict.set(N('Vertices'), pdf.context.obj(spec.kind === 'perimeter' ? [...flat, ...flat.slice(0, 2)] : flat));
    dict.set(N('IT'), N(spec.kind === 'area' ? 'PolygonDimension' : spec.kind === 'perimeter' ? 'PolyLineDimension' : 'PolyLineAngle'));
  }
  const page = pdf.getPage(spec.pageNumber - 1);
  const annots = page.node.lookupMaybe(N('Annots'), PDFArray);
  const ref = pdf.context.register(dict);
  if (annots) annots.push(ref); else page.node.set(N('Annots'), pdf.context.obj([ref]));
  return { bytes: await pdf.save({ useObjectStreams: false }), label };
}

export interface MeasurementItem { pageNumber: number; kind: MeasureKind; label: string; scale: string }
export async function listPdfMeasurements(bytes: Uint8Array): Promise<MeasurementItem[]> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const out: MeasurementItem[] = [];
  pdf.getPages().forEach((page, i) => {
    for (const ref of page.node.lookupMaybe(N('Annots'), PDFArray)?.asArray() ?? []) {
      const dict = pdf.context.lookup(ref);
      if (!(dict instanceof PDFDict) || !dict.has(N('Measure'))) continue;
      const kind = (dict.get(N('MALENJO_Measure'))?.toString().slice(1) ?? (dict.get(N('Subtype'))?.toString() === '/Line' ? 'distance' : dict.get(N('Subtype'))?.toString() === '/Polygon' ? 'area' : 'perimeter')) as MeasureKind;
      const contents = dict.lookup(N('Contents')); const r = dict.lookupMaybe(N('Measure'), PDFDict)?.lookup(N('R'));
      const text = (o: unknown) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : '');
      out.push({ pageNumber: i + 1, kind, label: text(contents), scale: text(r) });
    }
  });
  return out;
}
