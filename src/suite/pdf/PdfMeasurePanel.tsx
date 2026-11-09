import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { ShownPoint } from './pdfMarkup';
import { addPdfMeasurement, calibrateScale, checkScale, formatMeasure, listPdfMeasurements, measureValue, REAL_UNITS, scaleLabel,
  type MeasureKind, type MeasureScale, type MeasurementItem, type PageUnit, type RealUnit } from './pdfMeasure';
import { frameOf, pdfPageFrames } from './security/pdfRedact';
import { describePdfError } from './pdfUserErrors';

type Operation = (latest: Uint8Array) => Promise<{ bytes: Uint8Array; summary: string }>;
export type MeasureTool = MeasureKind | 'calibrate';
export interface MeasureState { tool: MeasureTool; active: boolean; pageNumber: number | null; points: ShownPoint[]; scale: MeasureScale; precision: number; color: string }
export const NEW_MEASURE_STATE: MeasureState = { tool: 'distance', active: false, pageNumber: null, points: [], scale: { pageValue: 1, pageUnit: 'in', realValue: 1, realUnit: 'in' }, precision: 2, color: '#c2410c' };
const NEEDS: Record<MeasureTool, number> = { distance: 2, angle: 3, calibrate: 2, perimeter: 3, area: 3 };
const TOOLS: [MeasureTool, string][] = [['distance', 'Distance'], ['perimeter', 'Perimeter'], ['area', 'Area'], ['angle', 'Angle'], ['calibrate', 'Calibrate from a known length']];

interface Props {
  domIdPrefix: string; bytes: Uint8Array; viewRotation: number; busy: boolean; author: string;
  state: MeasureState; onState(update: (current: MeasureState) => MeasureState): void;
  onApply(label: string, operation: Operation): Promise<boolean>; onClose(): void;
}

/** MAL-058: calibrated distance, perimeter, area and angle measurements. */
export default function PdfMeasurePanel({ domIdPrefix, bytes, viewRotation, busy, author, state, onState, onApply, onClose }: Props) {
  const [frames, setFrames] = useState<Awaited<ReturnType<typeof pdfPageFrames>>>([]);
  const [items, setItems] = useState<MeasurementItem[]>([]);
  const [known, setKnown] = useState({ value: 1, unit: 'm' as RealUnit });
  const [error, setError] = useState(''); const [status, setStatus] = useState('');
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('select')?.focus(); }, []);
  useEffect(() => {
    let live = true;
    Promise.all([pdfPageFrames(bytes), listPdfMeasurements(bytes)]).then(([f, list]) => { if (live) { setFrames(f); setItems(list); } }).catch((reason) => { if (live) setError(describePdfError(reason)); });
    return () => { live = false; };
  }, [bytes]);
  const set = (patch: Partial<MeasureState>) => onState((current) => ({ ...current, ...patch }));
  /** Placed points in page space, for the live reading. */
  const pagePoints = (): [number, number][] => {
    if (!state.pageNumber || !frames[state.pageNumber - 1]) return [];
    const frame = frameOf(frames[state.pageNumber - 1], viewRotation); const m = frame.matrix;
    return state.points.map((p) => { const u = p.x * frame.width, v = (1 - p.y) * frame.height; return [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]]; });
  };
  let reading = '';
  try {
    if (state.tool !== 'calibrate' && state.points.length >= NEEDS[state.tool]) { const r = measureValue(state.tool, pagePoints(), state.scale); reading = formatMeasure(state.tool, r.value, r.unit, state.precision); }
  } catch { reading = ''; }
  let scaleError = '';
  try { checkScale(state.scale); } catch (reason) { scaleError = (reason as Error).message; }

  async function save(points = state.points, tool = state.tool) {
    if (tool === 'calibrate' || !state.pageNumber) return;
    setError('');
    let label = '';
    const page = state.pageNumber;
    const ok = await onApply('Added a measurement.', async (latest) => {
      const result = await addPdfMeasurement(latest, { pageNumber: page, viewRotation, kind: tool, points, scale: state.scale, precision: state.precision, color: state.color, author });
      label = result.label; return { bytes: result.bytes, summary: `Added ${result.label} on page ${page}.` };
    }).catch((reason) => { setError(describePdfError(reason)); return false; });
    set({ points: [], pageNumber: null });
    if (ok) setStatus(`Saved ${label}.`);
  }
  // Two-click and three-click tools finish on their own.
  useEffect(() => {
    if (!state.active || state.points.length !== NEEDS[state.tool] || !['distance', 'angle', 'calibrate'].includes(state.tool)) return;
    if (state.tool === 'calibrate') { set({ active: false }); return; }
    void save(); // eslint-disable-line react-hooks/exhaustive-deps
  }, [state.points.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const calibrationLength = state.tool === 'calibrate' && state.points.length === 2 ? (() => { const [a, b] = pagePoints(); return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0; })() : 0;
  const titleId = `${domIdPrefix}-measure-title`;
  return <section ref={ref} className="pdf-tool-dialog" role="dialog" aria-labelledby={titleId}
    onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
    <header><h2 id={titleId}>Measure</h2><button type="button" aria-label="Close measure" title="Close" onClick={onClose}><X size={16} aria-hidden="true"/></button></header>
    <fieldset>
      <legend>Scale: {scaleLabel(state.scale)}</legend>
      <label>On the page<input type="number" aria-label="Page length" min={0} step="any" value={state.scale.pageValue} onChange={(e) => set({ scale: { ...state.scale, pageValue: Number(e.target.value) } })}/></label>
      <label>Page unit<select aria-label="Page unit" value={state.scale.pageUnit} onChange={(e) => set({ scale: { ...state.scale, pageUnit: e.target.value as PageUnit } })}>
        {(['in', 'cm', 'mm', 'pt'] as PageUnit[]).map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
      <label>Equals<input type="number" aria-label="Real length" min={0} step="any" value={state.scale.realValue} onChange={(e) => set({ scale: { ...state.scale, realValue: Number(e.target.value) } })}/></label>
      <label>Real unit<select aria-label="Real unit" value={state.scale.realUnit} onChange={(e) => set({ scale: { ...state.scale, realUnit: e.target.value as RealUnit } })}>
        {REAL_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
      <label>Decimal places<input type="number" aria-label="Decimal places" min={0} max={4} value={state.precision} onChange={(e) => set({ precision: Number(e.target.value) })}/></label>
      {scaleError && <p className="pdf-tool-dialog-error">{scaleError}</p>}
    </fieldset>
    <fieldset>
      <legend>Measure</legend>
      <label>Tool<select aria-label="Measuring tool" value={state.tool} onChange={(e) => set({ tool: e.target.value as MeasureTool, points: [], pageNumber: null, active: false })}>
        {TOOLS.map(([t, label]) => <option key={t} value={t}>{label}</option>)}</select></label>
      <button type="button" aria-pressed={state.active} disabled={!!scaleError || !frames.length} onClick={() => set({ active: !state.active, points: [], pageNumber: null })}>
        {state.active ? 'Stop placing points' : 'Place points on the page'}</button>
      <p>{state.tool === 'calibrate' ? 'Click both ends of a length you know.' : state.tool === 'angle' ? 'Click one arm, the vertex, then the other arm.' : state.tool === 'distance' ? 'Click the start and the end.' : 'Click each corner, then Finish shape.'}
        {' '}{state.points.length} point{state.points.length === 1 ? '' : 's'} placed.</p>
      {reading && <p role="status">{reading}</p>}
      {(state.tool === 'perimeter' || state.tool === 'area') && <button type="button" disabled={busy || state.points.length < 3} onClick={() => { set({ active: false }); void save(); }}>Finish shape</button>}
      {state.points.length > 0 && <button type="button" onClick={() => set({ points: state.points.slice(0, -1), pageNumber: state.points.length > 1 ? state.pageNumber : null })}>Remove last point</button>}
      {calibrationLength > 0 && <div className="pdf-measure-calibrate">
        <label>That length is<input type="number" aria-label="Known length" min={0} step="any" value={known.value} onChange={(e) => setKnown({ ...known, value: Number(e.target.value) })}/></label>
        <label>Unit<select aria-label="Known length unit" value={known.unit} onChange={(e) => setKnown({ ...known, unit: e.target.value as RealUnit })}>{REAL_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
        <button type="button" onClick={() => { try { const scale = calibrateScale(calibrationLength, known.value, known.unit); set({ scale, tool: 'distance', points: [], pageNumber: null }); setStatus(`Scale set: ${scaleLabel(scale)}.`); } catch (reason) { setError(describePdfError(reason)); } }}>Use this scale</button>
      </div>}
    </fieldset>
    {status && <p role="status">{status}</p>}
    {items.length > 0 && <fieldset><legend>Measurements in this PDF ({items.length})</legend>
      <ul aria-label="Measurements in this PDF">{items.map((m, i) => <li key={i}>Page {m.pageNumber}: {m.label} ({m.scale})</li>)}</ul></fieldset>}
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    <small>Measurements are saved as standard PDF measurement annotations with their scale. Accuracy depends on the scale and on where you click; zoom in for precise points.</small>
  </section>;
}
