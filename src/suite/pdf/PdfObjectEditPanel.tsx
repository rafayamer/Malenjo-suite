import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  adjustPdfImage, cropPdfImage, deletePdfObject, listPdfPageObjects, replacePdfImage, stylePdfPath, transformPdfObject,
  type ImageAdjuster, type InsertKind, type PageObjectInfo,
} from './content/objectEdit';
import { describePdfError } from './pdfUserErrors';

type Operation = (latest: Uint8Array) => Promise<{ bytes: Uint8Array; summary: string }>;
export interface ObjectEditState { pageNumber: number; objects: PageObjectInfo[]; selected: string | null }
export interface InsertSettings { tool: InsertKind | null; stroke: string; fill: string | null; lineWidth: number; text: string; fontSize: number }
export const objectKey = (o: Pick<PageObjectInfo, 'kind' | 'id'>) => `${o.kind}:${o.id}`;

interface Props {
  domIdPrefix: string;
  bytes: Uint8Array;
  pageNumber: number;
  viewRotation: number;
  busy: boolean;
  state: ObjectEditState | null;
  onState(next: ObjectEditState): void;
  insert: InsertSettings;
  onInsert(next: InsertSettings): void;
  onApply(label: string, operation: Operation): Promise<boolean>;
  onClose(): void;
}

/** Browser adjuster: canvas filters for brightness, contrast and greyscale; PNG output keeps it lossless. */
const canvasAdjuster: ImageAdjuster = async (input, adjustment) => {
  let source: ImageBitmap;
  if (input.kind === 'jpeg') source = await createImageBitmap(new Blob([input.bytes.slice().buffer], { type: 'image/jpeg' }));
  else {
    const rgba = new Uint8ClampedArray(input.width * input.height * 4);
    for (let i = 0, j = 0; i < input.width * input.height; i++, j += input.components) {
      const r = input.bytes[j], g = input.components === 3 ? input.bytes[j + 1] : r, b = input.components === 3 ? input.bytes[j + 2] : r;
      rgba.set([r, g, b, 255], i * 4);
    }
    source = await createImageBitmap(new ImageData(rgba, input.width, input.height));
  }
  const canvas = document.createElement('canvas');
  canvas.width = input.width; canvas.height = input.height;
  const context = canvas.getContext('2d')!;
  context.filter = `brightness(${adjustment.brightness}) contrast(${adjustment.contrast})${adjustment.grayscale ? ' grayscale(1)' : ''}`;
  context.drawImage(source, 0, 0);
  source.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Image encoding failed.')), 'image/png'));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'png' };
};

const INSERT_TOOLS: [InsertKind, string][] = [['text', 'Text'], ['rectangle', 'Rectangle'], ['ellipse', 'Ellipse'], ['line', 'Line'], ['arrow', 'Arrow']];

/** MAL-014 / 015 / 016: select, move, scale, rotate, crop, replace, adjust, recolour and delete page objects, or insert new ones. */
export default function PdfObjectEditPanel({ domIdPrefix, bytes, pageNumber, viewRotation, busy, state, onState, insert, onInsert, onApply, onClose }: Props) {
  const [step, setStep] = useState(5);
  const [scale, setScale] = useState(100);
  const [rotate, setRotate] = useState(90);
  const [crop, setCrop] = useState({ left: 0, top: 0, right: 0, bottom: 0 });
  const [adjust, setAdjust] = useState({ brightness: 100, contrast: 100, grayscale: false });
  const [style, setStyle] = useState({ stroke: '#cc0000', fill: '#ffffff', useFill: false, lineWidth: 2 });
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const selected = state?.objects.find((o) => objectKey(o) === state.selected) ?? null;

  useEffect(() => {
    let live = true;
    listPdfPageObjects(bytes, pageNumber, viewRotation).then((objects) => {
      if (!live) return;
      onState({ pageNumber, objects, selected: state?.pageNumber === pageNumber && objects.some((o) => objectKey(o) === state.selected) ? state.selected : null });
      setError('');
    }).catch((reason) => { if (live) setError(describePdfError(reason)); });
    return () => { live = false; };
  }, [bytes, pageNumber, viewRotation]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { panelRef.current?.querySelector<HTMLElement>('select')?.focus(); }, []);

  const run = async (label: string, summary: string, edit: (latest: Uint8Array) => Promise<Uint8Array>) => {
    setError('');
    try { await onApply(label, async (latest) => ({ bytes: await edit(latest), summary })); } catch (reason) { setError(describePdfError(reason)); }
  };
  const move = (dx: number, dy: number) => selected && void run('Moved an object.', `Moved ${selected.label.toLowerCase()}.`,
    (b) => transformPdfObject(b, pageNumber, selected.kind, selected.id, { dx: (dx * 72) / 25.4, dy: (dy * 72) / 25.4 }, viewRotation));

  const titleId = `${domIdPrefix}-objects-title`;
  return <section ref={panelRef} className="pdf-markup-panel" role="dialog" aria-modal="false" aria-labelledby={titleId}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (insert.tool) onInsert({ ...insert, tool: null }); else onClose(); } }}>
    <header>
      <h2 id={titleId}>Edit objects</h2>
      <button type="button" aria-label="Close edit objects" title="Close" onClick={onClose}><X size={16} aria-hidden="true"/></button>
    </header>
    <label><span>Images and shapes on page {pageNumber}</span>
      <select aria-label="Object to edit" value={state?.selected ?? ''} onChange={(e) => state && onState({ ...state, selected: e.target.value || null })}>
        <option value="">Choose an object…</option>
        {state?.objects.map((o) => <option key={objectKey(o)} value={objectKey(o)}>{o.label}</option>)}
      </select></label>
    {selected && <fieldset>
      <legend>{selected.label}</legend>
      <label><span>Move step (mm)</span><input aria-label="Move step in mm" type="number" min={0.5} max={200} value={step} onChange={(e) => setStep(Number(e.target.value))}/></label>
      <div className="pdf-tool-dialog-actions">
        <button type="button" disabled={busy} aria-label="Move left" onClick={() => move(-step, 0)}>←</button>
        <button type="button" disabled={busy} aria-label="Move right" onClick={() => move(step, 0)}>→</button>
        <button type="button" disabled={busy} aria-label="Move up" onClick={() => move(0, -step)}>↑</button>
        <button type="button" disabled={busy} aria-label="Move down" onClick={() => move(0, step)}>↓</button>
      </div>
      <label><span>Size (%)</span><input aria-label="Resize percent" type="number" min={5} max={2000} value={scale} onChange={(e) => setScale(Number(e.target.value))}/></label>
      <button type="button" disabled={busy || scale === 100} onClick={() => void run('Resized an object.', `Resized ${selected.label.toLowerCase()} to ${scale}%.`, (b) => transformPdfObject(b, pageNumber, selected.kind, selected.id, { scale: scale / 100 }, viewRotation))}>Resize</button>
      <label><span>Rotate (° clockwise)</span><input aria-label="Rotate degrees" type="number" min={-360} max={360} value={rotate} onChange={(e) => setRotate(Number(e.target.value))}/></label>
      <button type="button" disabled={busy || !rotate} onClick={() => void run('Rotated an object.', `Rotated ${selected.label.toLowerCase()} by ${rotate}°.`, (b) => transformPdfObject(b, pageNumber, selected.kind, selected.id, { rotate }, viewRotation))}>Rotate</button>
      {selected.kind === 'image' && <>
        <span className="pdf-object-row-label">Crop (% from each side)</span>
        {(['left', 'top', 'right', 'bottom'] as const).map((side) => <label key={side}><span>{side[0].toUpperCase() + side.slice(1)}</span>
          <input aria-label={`Crop ${side} percent`} type="number" min={0} max={95} value={crop[side]} onChange={(e) => setCrop({ ...crop, [side]: Number(e.target.value) })}/></label>)}
        <button type="button" disabled={busy} onClick={() => void run('Cropped an image.', `Cropped ${selected.label.toLowerCase()}.`, (b) => cropPdfImage(b, pageNumber, selected.id, { left: crop.left / 100, top: crop.top / 100, right: crop.right / 100, bottom: crop.bottom / 100 }))}>Crop</button>
        <input ref={fileRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" aria-hidden="true" tabIndex={-1}
          onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void file.arrayBuffer().then((buf) => run('Replaced an image.', `Replaced ${selected.label.toLowerCase()} with ${file.name}.`, (b) => replacePdfImage(b, pageNumber, selected.id, new Uint8Array(buf)))); }}/>
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>Replace image…</button>
        <label><span>Brightness (%)</span><input aria-label="Brightness percent" type="number" min={20} max={300} value={adjust.brightness} onChange={(e) => setAdjust({ ...adjust, brightness: Number(e.target.value) })}/></label>
        <label><span>Contrast (%)</span><input aria-label="Contrast percent" type="number" min={20} max={300} value={adjust.contrast} onChange={(e) => setAdjust({ ...adjust, contrast: Number(e.target.value) })}/></label>
        <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={adjust.grayscale} onChange={(e) => setAdjust({ ...adjust, grayscale: e.target.checked })}/>Greyscale</label>
        <button type="button" disabled={busy} onClick={() => void run('Adjusted an image.', `Adjusted ${selected.label.toLowerCase()}.`, (b) => adjustPdfImage(b, pageNumber, selected.id, { brightness: adjust.brightness / 100, contrast: adjust.contrast / 100, grayscale: adjust.grayscale }, canvasAdjuster))}>Adjust image</button>
      </>}
      {selected.kind === 'path' && <>
        <label><span>Line colour</span><input aria-label="Shape line colour" type="color" value={style.stroke} onChange={(e) => setStyle({ ...style, stroke: e.target.value })}/></label>
        <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={style.useFill} onChange={(e) => setStyle({ ...style, useFill: e.target.checked })}/>Change fill</label>
        {style.useFill && <label><span>Fill colour</span><input aria-label="Shape fill colour" type="color" value={style.fill} onChange={(e) => setStyle({ ...style, fill: e.target.value })}/></label>}
        <label><span>Line width (pt)</span><input aria-label="Shape line width" type="number" min={0} max={72} step={0.5} value={style.lineWidth} onChange={(e) => setStyle({ ...style, lineWidth: Number(e.target.value) })}/></label>
        <button type="button" disabled={busy} onClick={() => void run('Restyled a shape.', `Restyled ${selected.label.toLowerCase()}.`, (b) => stylePdfPath(b, pageNumber, selected.id, { stroke: style.stroke, fill: style.useFill ? style.fill : undefined, lineWidth: style.lineWidth }))}>Apply style</button>
      </>}
      <button type="button" disabled={busy} onClick={() => window.confirm(`Delete ${selected.label.toLowerCase()} from the page?`) && void run('Deleted an object.', `Deleted ${selected.label.toLowerCase()}.`, (b) => deletePdfObject(b, pageNumber, selected.kind, selected.id))}>Delete</button>
    </fieldset>}
    <fieldset>
      <legend>Insert into the page</legend>
      {INSERT_TOOLS.map(([kind, name]) => <button key={kind} type="button" aria-pressed={insert.tool === kind} onClick={() => onInsert({ ...insert, tool: insert.tool === kind ? null : kind })}>{name}</button>)}
      {insert.tool && <p role="status">Drag on a page to place the {insert.tool}. Press Escape to stop.</p>}
      <label><span>Colour</span><input aria-label="Insert colour" type="color" value={insert.stroke} onChange={(e) => onInsert({ ...insert, stroke: e.target.value })}/></label>
      <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={insert.fill !== null} onChange={(e) => onInsert({ ...insert, fill: e.target.checked ? '#ffffff' : null })}/>Fill shapes</label>
      {insert.fill !== null && <label><span>Fill</span><input aria-label="Insert fill colour" type="color" value={insert.fill} onChange={(e) => onInsert({ ...insert, fill: e.target.value })}/></label>}
      <label><span>Line width (pt)</span><input aria-label="Insert line width" type="number" min={0} max={72} step={0.5} value={insert.lineWidth} onChange={(e) => onInsert({ ...insert, lineWidth: Number(e.target.value) })}/></label>
      <label><span>Text</span><textarea aria-label="Insert text" rows={2} value={insert.text} onChange={(e) => onInsert({ ...insert, text: e.target.value })}/></label>
      <label><span>Text size (pt)</span><input aria-label="Insert text size" type="number" min={4} max={144} value={insert.fontSize} onChange={(e) => onInsert({ ...insert, fontSize: Number(e.target.value) })}/></label>
    </fieldset>
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    <small>Edits change the page's own drawing (not annotations) and can be undone. Inserted text and shapes become part of the page and can be edited again here or with Edit text.</small>
  </section>;
}
