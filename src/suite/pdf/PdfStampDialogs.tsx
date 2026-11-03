import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ImagePlus, X } from 'lucide-react';
import {
  applyHeaderFooter, applyImageWatermark, applyPageNumbers, applyTextWatermark,
  type NumberFormat, type PageNumberSpec, type StampFont, type StampLayer, type StampPosition, type StampScope, type StampText,
} from './pdfStamp';
import { describePdfError } from './pdfUserErrors';

export type StampDialogKind = 'header-footer' | 'page-numbers' | 'text-watermark' | 'image-watermark';
type Operation = (latest: Uint8Array) => Promise<{ bytes: Uint8Array; summary: string }>;

interface Props {
  kind: StampDialogKind;
  domIdPrefix: string;
  sourceName: string;
  busy: boolean;
  /** Apply to the working document (undoable); the operation receives the latest bytes. */
  onApply(label: string, operation: Operation): Promise<boolean>;
  onClose(): void;
}

const TITLES: Record<StampDialogKind, string> = {
  'header-footer': 'Header and footer', 'page-numbers': 'Page numbers', 'text-watermark': 'Text watermark', 'image-watermark': 'Image watermark',
};
const FONTS: [StampFont, string][] = [['helvetica', 'Helvetica'], ['helvetica-bold', 'Helvetica Bold'], ['times', 'Times'], ['times-bold', 'Times Bold'], ['courier', 'Courier']];
const POSITIONS: [StampPosition, string][] = [['top-left', 'Top left'], ['top-center', 'Top centre'], ['top-right', 'Top right'],
  ['middle-left', 'Middle left'], ['center', 'Centre'], ['middle-right', 'Middle right'],
  ['bottom-left', 'Bottom left'], ['bottom-center', 'Bottom centre'], ['bottom-right', 'Bottom right']];
const FORMATS: [NumberFormat, string][] = [['arabic', '1, 2, 3'], ['roman-lower', 'i, ii, iii'], ['roman-upper', 'I, II, III'], ['alpha-lower', 'a, b, c'], ['alpha-upper', 'A, B, C']];

function TextStyle({ value, onChange, sizeLabel = 'Font size (pt)' }: { value: StampText; onChange(next: StampText): void; sizeLabel?: string }) {
  return <>
    <label>Font<select aria-label="Font" value={value.font} onChange={(e) => onChange({ ...value, font: e.target.value as StampFont })}>
      {FONTS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
    <label>{sizeLabel}<input aria-label={sizeLabel} type="number" min={4} max={400} value={value.size} onChange={(e) => onChange({ ...value, size: Number(e.target.value) })}/></label>
    <label>Colour<input aria-label="Text colour" type="color" value={value.color} onChange={(e) => onChange({ ...value, color: e.target.value })}/></label>
  </>;
}

function Scope({ value, onChange }: { value: StampScope; onChange(next: StampScope): void }) {
  return <>
    <label>Pages<input aria-label="Pages to stamp" value={value.pages} placeholder="all, or 1-3, 5, 8-" onChange={(e) => onChange({ ...value, pages: e.target.value })}/></label>
    <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={value.skipFirst} onChange={(e) => onChange({ ...value, skipFirst: e.target.checked })}/>Skip the first page</label>
  </>;
}

function Placement({ position, onPosition, positions = POSITIONS }: { position: StampPosition; onPosition(next: StampPosition): void; positions?: [StampPosition, string][] }) {
  return <label>Position<select aria-label="Position" value={position} onChange={(e) => onPosition(e.target.value as StampPosition)}>
    {positions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>;
}

function Layer({ value, onChange }: { value: StampLayer; onChange(next: StampLayer): void }) {
  return <label>Layer<select aria-label="Layer order" value={value} onChange={(e) => onChange(e.target.value as StampLayer)}>
    <option value="above">Above page content</option><option value="below">Below page content</option></select></label>;
}

/** MAL-017 to MAL-020 dialogs; each applies one undoable edit to the working copy. */
export default function PdfStampDialog({ kind, domIdPrefix, sourceName, busy, onApply, onClose }: Props) {
  const [scope, setScope] = useState<StampScope>({ pages: 'all', skipFirst: false });
  const [style, setStyle] = useState<StampText>({ font: 'helvetica', size: 10, color: '#333333' });
  const [header, setHeader] = useState({ left: '{file}', center: '', right: '{date}' });
  const [footer, setFooter] = useState({ left: '', center: 'Page {page} of {pages}', right: '' });
  const [margins, setMargins] = useState({ x: 36, y: 24 });
  const [numbers, setNumbers] = useState<Pick<PageNumberSpec, 'format' | 'prefix' | 'suffix' | 'start' | 'showTotal' | 'position'>>(
    { format: 'arabic', prefix: '', suffix: '', start: 1, showTotal: false, position: 'bottom-center' });
  const [mark, setMark] = useState({ text: 'CONFIDENTIAL', position: 'center' as StampPosition, margin: 36, rotation: 45, opacityPercent: 30, layer: 'above' as StampLayer, scalePercent: 40 });
  const [markStyle, setMarkStyle] = useState<StampText>({ font: 'helvetica-bold', size: 64, color: '#cc0000' });
  const [image, setImage] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  useEffect(() => { dialogRef.current?.querySelector<HTMLElement>('input:not([type=file]):not([type=color]), select')?.focus(); }, []);

  async function apply() {
    setWorking(true); setError('');
    const placement = { position: mark.position, margin: mark.margin, rotation: mark.rotation, opacity: mark.opacityPercent / 100, layer: mark.layer, scope };
    try {
      let operation: Operation;
      if (kind === 'header-footer') {
        operation = async (latest) => {
          const r = await applyHeaderFooter(latest, { header, footer, text: style, marginX: margins.x, marginY: margins.y, scope, fileName: sourceName, now: new Date() });
          return { bytes: r.bytes, summary: `Added the header and footer to ${r.pages} page(s).` };
        };
      } else if (kind === 'page-numbers') {
        operation = async (latest) => {
          const r = await applyPageNumbers(latest, { ...numbers, marginX: margins.x, marginY: margins.y, text: style, scope });
          return { bytes: r.bytes, summary: `Numbered ${r.pages} page(s), from “${r.first}” to “${r.last}”.` };
        };
      } else if (kind === 'text-watermark') {
        operation = async (latest) => {
          const r = await applyTextWatermark(latest, { ...placement, text: mark.text, style: markStyle });
          return { bytes: r.bytes, summary: `Added the text watermark to ${r.pages} page(s).` };
        };
      } else {
        if (!image) throw new Error('Choose a PNG or JPEG image first.');
        operation = async (latest) => {
          const r = await applyImageWatermark(latest, { ...placement, image: image.bytes, scalePercent: mark.scalePercent });
          return { bytes: r.bytes, summary: `Added the image watermark to ${r.pages} page(s).` };
        };
      }
      if (await onApply(`Added ${TITLES[kind].toLowerCase()}.`, operation)) onClose();
    } catch (reason) {
      setError(describePdfError(reason));
    } finally { setWorking(false); }
  }

  const titleId = `${domIdPrefix}-${kind}-title`;
  const watermark = kind === 'text-watermark' || kind === 'image-watermark';
  const rows = (label: string, value: typeof header, set: (next: typeof header) => void): ReactNode => <fieldset>
    <legend>{label}</legend>
    {(['left', 'center', 'right'] as const).map((slot) => <label key={slot}>{slot === 'center' ? 'Centre' : slot[0].toUpperCase() + slot.slice(1)}
      <input aria-label={`${label} ${slot}`} value={value[slot]} onChange={(e) => set({ ...value, [slot]: e.target.value })}/></label>)}
  </fieldset>;

  return <section ref={dialogRef} className="pdf-tool-dialog" role="dialog" aria-labelledby={titleId}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header>
      <h2 id={titleId}>{TITLES[kind]}</h2>
      <button type="button" aria-label={`Close ${TITLES[kind].toLowerCase()}`} title="Close" onClick={onClose}><X size={16} aria-hidden="true"/></button>
    </header>
    {kind === 'header-footer' && <>
      <p>Fields: {'{page} {pages} {label} {file} {title} {author} {subject} {date} {time}'}</p>
      {rows('Header', header, setHeader)}
      {rows('Footer', footer, setFooter)}
    </>}
    {kind === 'page-numbers' && <fieldset>
      <legend>Numbering</legend>
      <label>Format<select aria-label="Number format" value={numbers.format} onChange={(e) => setNumbers({ ...numbers, format: e.target.value as NumberFormat })}>
        {FORMATS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>Start at<input aria-label="Start number" type="number" min={0} value={numbers.start} onChange={(e) => setNumbers({ ...numbers, start: Math.floor(Number(e.target.value)) })}/></label>
      <label>Prefix<input aria-label="Number prefix" value={numbers.prefix} onChange={(e) => setNumbers({ ...numbers, prefix: e.target.value })}/></label>
      <label>Suffix<input aria-label="Number suffix" value={numbers.suffix} onChange={(e) => setNumbers({ ...numbers, suffix: e.target.value })}/></label>
      <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={numbers.showTotal} onChange={(e) => setNumbers({ ...numbers, showTotal: e.target.checked })}/>Show “of total”</label>
      <Placement position={numbers.position} onPosition={(position) => setNumbers({ ...numbers, position: position as PageNumberSpec['position'] })}
        positions={POSITIONS.filter(([id]) => !id.startsWith('middle') && id !== 'center')}/>
    </fieldset>}
    {(kind === 'header-footer' || kind === 'page-numbers') && <fieldset>
      <legend>Text and margins</legend>
      <TextStyle value={style} onChange={setStyle}/>
      <label>Side margin (pt)<input aria-label="Side margin in points" type="number" min={0} max={300} value={margins.x} onChange={(e) => setMargins({ ...margins, x: Number(e.target.value) })}/></label>
      <label>Top/bottom margin (pt)<input aria-label="Top and bottom margin in points" type="number" min={0} max={300} value={margins.y} onChange={(e) => setMargins({ ...margins, y: Number(e.target.value) })}/></label>
    </fieldset>}
    {kind === 'text-watermark' && <fieldset>
      <legend>Text</legend>
      <label>Watermark text<input aria-label="Watermark text" value={mark.text} onChange={(e) => setMark({ ...mark, text: e.target.value })}/></label>
      <TextStyle value={markStyle} onChange={setMarkStyle}/>
    </fieldset>}
    {kind === 'image-watermark' && <fieldset>
      <legend>Image</legend>
      <input ref={imageRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" aria-hidden="true" tabIndex={-1}
        onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void file.arrayBuffer().then((buf) => { setImage({ name: file.name, bytes: new Uint8Array(buf) }); setError(''); }); }}/>
      <button type="button" onClick={() => imageRef.current?.click()}><ImagePlus size={15} aria-hidden="true"/> {image ? `Image: ${image.name}` : 'Choose image…'}</button>
      <label>Width (% of page)<input aria-label="Image width as percent of page width" type="number" min={5} max={100} value={mark.scalePercent} onChange={(e) => setMark({ ...mark, scalePercent: Number(e.target.value) })}/></label>
    </fieldset>}
    {watermark && <fieldset>
      <legend>Placement</legend>
      <Placement position={mark.position} onPosition={(position) => setMark({ ...mark, position })}/>
      <label>Rotation (°)<input aria-label="Rotation in degrees" type="number" min={-180} max={180} value={mark.rotation} onChange={(e) => setMark({ ...mark, rotation: Number(e.target.value) })}/></label>
      <label>Opacity (%)<input aria-label="Opacity percent" type="number" min={5} max={100} value={mark.opacityPercent} onChange={(e) => setMark({ ...mark, opacityPercent: Number(e.target.value) })}/></label>
      <label>Margin (pt)<input aria-label="Watermark margin in points" type="number" min={0} max={300} value={mark.margin} onChange={(e) => setMark({ ...mark, margin: Number(e.target.value) })}/></label>
      <Layer value={mark.layer} onChange={(layer) => setMark({ ...mark, layer })}/>
    </fieldset>}
    <fieldset><legend>Pages</legend><Scope value={scope} onChange={setScope}/></fieldset>
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    <button type="button" className="primary-action" disabled={busy || working} onClick={() => void apply()}>
      {working ? 'Applying…' : `Apply ${TITLES[kind].toLowerCase()}`}
    </button>
    <small>Stamps are added as real PDF text or images, placed upright on each page as it is shown, including rotated and cropped pages. Undo removes them.</small>
  </section>;
}
