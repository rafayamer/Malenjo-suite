import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { DrawingKind, ShownPoint, ShownRect } from './pdfMarkup';

export interface DrawnShape { points?: ShownPoint[]; rect?: ShownRect }

interface Props {
  pageNumber: number;
  kind: DrawingKind;
  color: string;
  /** While the previous drawing is being saved, input is ignored (and the cursor says so). */
  busy?: boolean;
  /** The rendered page; fractions are measured against its box. */
  surface(): HTMLElement | null;
  onShape(shape: DrawnShape): void;
}

const LABELS: Record<DrawingKind, string> = {
  Ink: 'Draw freehand', Line: 'Drag to draw a line', Arrow: 'Drag to draw an arrow', Square: 'Drag to draw a rectangle',
  Circle: 'Drag to draw an ellipse', FreeText: 'Drag to place a text box', Callout: 'Drag from the point to comment on to where the text goes', Note: 'Click to place a sticky note',
};
const CALLOUT = { width: 0.3, height: 0.07 };

/** MAL-055 pointer capture over one page; reports shapes as fractions of the page as shown. */
export default function PdfDrawOverlay({ pageNumber, kind, color, busy = false, surface, onShape }: Props) {
  const [points, setPoints] = useState<ShownPoint[]>([]);
  const path = useRef<ShownPoint[] | null>(null);
  const at = (event: ReactPointerEvent<HTMLDivElement>): ShownPoint => {
    const box = (surface() ?? event.currentTarget).getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) };
  };
  const rectOf = (a: ShownPoint, b: ShownPoint): ShownRect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) });
  const calloutBox = (end: ShownPoint): ShownRect => ({ x: Math.min(end.x, 1 - CALLOUT.width), y: Math.min(end.y, 1 - CALLOUT.height), ...CALLOUT });

  function finish(path: ShownPoint[]) {
    const [first, last] = [path[0], path[path.length - 1]];
    if (!first) return;
    if (kind === 'Note') { onShape({ points: [first] }); return; }
    if (kind === 'Ink') { if (path.length > 1) onShape({ points: path }); return; }
    if (Math.hypot(last.x - first.x, last.y - first.y) < 0.01) return; // a click, not a drag
    if (kind === 'Line' || kind === 'Arrow') onShape({ points: [first, last] });
    else if (kind === 'Callout') onShape({ points: [first], rect: calloutBox(last) });
    else onShape({ rect: rectOf(first, last) });
  }

  const preview = points.length ? (() => {
    const [a, b] = [points[0], points[points.length - 1]];
    if (kind === 'Ink') return <polyline points={points.map((p) => `${p.x * 1000},${p.y * 1000}`).join(' ')} />;
    if (kind === 'Line' || kind === 'Arrow' || kind === 'Callout') return <line x1={a.x * 1000} y1={a.y * 1000} x2={b.x * 1000} y2={b.y * 1000} />;
    if (kind === 'Circle') return <ellipse cx={(a.x + b.x) * 500} cy={(a.y + b.y) * 500} rx={Math.abs(b.x - a.x) * 500} ry={Math.abs(b.y - a.y) * 500} />;
    const r = rectOf(a, b);
    return <rect x={r.x * 1000} y={r.y * 1000} width={r.width * 1000} height={r.height * 1000} />;
  })() : null;

  return <div role="region" aria-label={`${LABELS[kind]} on PDF page ${pageNumber}`} data-pdf-draw-overlay={pageNumber}
    aria-busy={busy}
    style={{ position: 'absolute', inset: 0, zIndex: 9, cursor: busy ? 'progress' : 'crosshair', touchAction: 'none' }}
    onPointerDown={(event) => {
      event.preventDefault();
      if (event.button !== 0 || busy) return;
      path.current = [at(event)];
      setPoints(path.current);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    }}
    onPointerMove={(event) => {
      const current = path.current;
      if (!current) return;
      const next = at(event);
      const last = current[current.length - 1];
      const updated = kind !== 'Ink' ? [current[0], next]
        : Math.hypot(next.x - last.x, next.y - last.y) > 0.002 && current.length < 4000 ? [...current, next] : current;
      path.current = updated;
      setPoints(updated);
    }}
    onPointerUp={(event) => {
      const current = path.current;
      if (!current) return;
      path.current = null;
      const end = at(event);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      setPoints([]);
      finish(kind === 'Ink' ? [...current, end] : [current[0], end]);
    }}
    onPointerCancel={() => { path.current = null; setPoints([]); }}>
    {preview && <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', fill: 'none', stroke: color, strokeWidth: 3, vectorEffect: 'non-scaling-stroke' }}>
      {preview}
    </svg>}
  </div>;
}
