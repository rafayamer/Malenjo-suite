import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { nupPdf, type NupOptions, type NupPerSheet } from './pdfNup';
import { describePdfError } from './pdfUserErrors';

const MM_TO_PT = 72 / 25.4;

interface Props {
  domIdPrefix: string;
  busy: boolean;
  /** Apply N-up to the working document (undoable); the operation receives the latest bytes. */
  onApply(operation: (latest: Uint8Array) => Promise<{ bytes: Uint8Array; summary: string }>): Promise<boolean>;
  onClose(): void;
}

/** MAL-009: arrange several pages on each sheet (grid, sheet, orientation, spacing, order). */
export default function PdfNupDialog({ domIdPrefix, busy, onApply, onClose }: Props) {
  const [perSheet, setPerSheet] = useState<NupPerSheet>(4);
  const [sheet, setSheet] = useState<NupOptions['sheet']>('letter');
  const [orientation, setOrientation] = useState<NupOptions['orientation']>('portrait');
  const [order, setOrder] = useState<NupOptions['order']>('rows');
  const [marginMm, setMarginMm] = useState(6);
  const [gapMm, setGapMm] = useState(3);
  const [borders, setBorders] = useState(false);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => { dialogRef.current?.querySelector<HTMLElement>('select')?.focus(); }, []);

  async function apply() {
    setWorking(true); setError('');
    try {
      if (!(marginMm >= 0 && marginMm <= 50) || !(gapMm >= 0 && gapMm <= 50)) throw new Error('Margin and spacing must be between 0 and 50 mm.');
      const options: NupOptions = { perSheet, sheet, orientation, order, borders, margin: marginMm * MM_TO_PT, gap: gapMm * MM_TO_PT };
      const applied = await onApply(async (latest) => {
        const result = await nupPdf(latest, options);
        const dropped = result.droppedAnnotations
          ? ` ${result.droppedAnnotations} annotation(s), link(s) or form field(s) are not carried onto the sheets.` : '';
        return { bytes: result.bytes,
          summary: `Arranged ${perSheet} pages per sheet (${result.columns} × ${result.rows}) on ${result.sheets} sheet(s).${dropped} Undo restores the original pages.` };
      });
      if (applied) onClose();
    } catch (reason) {
      setError(describePdfError(reason));
    } finally { setWorking(false); }
  }

  const titleId = `${domIdPrefix}-nup-title`;
  return <section ref={dialogRef} className="pdf-tool-dialog" role="dialog" aria-labelledby={titleId}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header>
      <h2 id={titleId}>Pages per sheet (N-up)</h2>
      <button type="button" aria-label="Close pages per sheet" title="Close pages per sheet" onClick={onClose}><X size={16} aria-hidden="true"/></button>
    </header>
    <label>Pages per sheet<select aria-label="Pages per sheet" value={perSheet}
      onChange={(event) => setPerSheet(Number(event.target.value) as NupPerSheet)}>
      {[2, 4, 6, 9, 16].map((count) => <option key={count} value={count}>{count}</option>)}
    </select></label>
    <label>Sheet size<select aria-label="Sheet size" value={sheet} onChange={(event) => setSheet(event.target.value as NupOptions['sheet'])}>
      <option value="letter">Letter</option><option value="a4">A4</option><option value="source">Same as first page</option>
    </select></label>
    <label>Orientation<select aria-label="Sheet orientation" value={orientation}
      onChange={(event) => setOrientation(event.target.value as NupOptions['orientation'])}>
      <option value="portrait">Portrait</option><option value="landscape">Landscape</option>
    </select></label>
    <label>Page order<select aria-label="Page order" value={order} onChange={(event) => setOrder(event.target.value as NupOptions['order'])}>
      <option value="rows">Left to right, then down</option><option value="columns">Top to bottom, then right</option>
    </select></label>
    <label>Margin (mm)<input aria-label="Sheet margin in mm" type="number" min={0} max={50} step={1} value={marginMm}
      onChange={(event) => setMarginMm(Number(event.target.value))}/></label>
    <label>Spacing (mm)<input aria-label="Spacing between pages in mm" type="number" min={0} max={50} step={1} value={gapMm}
      onChange={(event) => setGapMm(Number(event.target.value))}/></label>
    <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={borders} onChange={(event) => setBorders(event.target.checked)}/>
      Draw a thin border around each page</label>
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    <button type="button" className="primary-action" disabled={busy || working} onClick={() => void apply()}>
      {working ? 'Arranging…' : 'Arrange pages'}
    </button>
    <small>Pages are placed as vector content, so text stays sharp and searchable. Annotations, links and form fields are not carried onto the sheets. Undo restores the original.</small>
  </section>;
}
