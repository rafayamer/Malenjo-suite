import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { GlyphUnavailableError, listPdfTextRuns, replacePdfTextRun, type TextRunInfo } from './content/textEdit';
import { addPdfDrawing, overlayUnsupported } from './pdfMarkup';
import { describePdfError } from './pdfUserErrors';

type Operation = (latest: Uint8Array) => Promise<{ bytes: Uint8Array; summary: string }>;
export interface TextEditState { pageNumber: number; runs: TextRunInfo[]; selected: number | null }
interface Props {
  domIdPrefix: string;
  bytes: Uint8Array;
  pageNumber: number;
  viewRotation: number;
  busy: boolean;
  state: TextEditState | null;
  onState(next: TextEditState): void;
  onApply(label: string, operation: Operation): Promise<boolean>;
  onClose(): void;
}

/** MAL-011: change a piece of the PDF's own text in place, in its own font. */
export default function PdfTextEditPanel({ domIdPrefix, bytes, pageNumber, viewRotation, busy, state, onState, onApply, onClose }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [overlay, setOverlay] = useState<{ run: TextRunInfo; text: string; pageNumber: number } | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  // A selection belongs to the page it was made on: while the list for a newly shown page loads, nothing is selected.
  const run = state?.pageNumber === pageNumber ? state.runs.find((item) => item.id === state.selected) ?? null : null;

  useEffect(() => {
    let live = true;
    listPdfTextRuns(bytes, pageNumber, viewRotation).then((runs) => {
      if (!live) return;
      onState({ pageNumber, runs, selected: null });
      setError(''); setOverlay(null);
    }).catch((reason) => { if (live) setError(describePdfError(reason)); });
    return () => { live = false; };
  }, [bytes, pageNumber, viewRotation]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setText(run?.text ?? ''); setOverlay(null); setError(''); }, [run?.id, run?.text]);
  useEffect(() => { panelRef.current?.querySelector<HTMLElement>('select,input')?.focus(); }, []);

  async function apply() {
    if (!run) return;
    setError(''); setOverlay(null);
    const chosen = run; const next = text;
    try {
      // Check first on the current bytes, so a font without the needed glyphs is explained here.
      await replacePdfTextRun(bytes, pageNumber, chosen.id, chosen.text, next);
      await onApply('Edited text.', async (latest) => ({
        bytes: await replacePdfTextRun(latest, pageNumber, chosen.id, chosen.text, next),
        summary: `Changed “${chosen.text}” to “${next}” on page ${pageNumber}, in the original font (${chosen.fontName}).`,
      }));
    } catch (reason) {
      if (reason instanceof GlyphUnavailableError) {
        // An overlay is only offered when its own font can draw the new text; otherwise it would show “?”.
        const unshowable = await overlayUnsupported(next);
        if (!unshowable.length) setOverlay({ run: chosen, text: next, pageNumber });
        setError(`${describePdfError(reason)}${unshowable.length ? ' An overlay cannot show these characters either.' : ''}`);
        return;
      }
      setError(describePdfError(reason));
    }
  }
  async function placeOverlay() {
    if (!overlay || overlay.pageNumber !== pageNumber || state?.pageNumber !== pageNumber) { setOverlay(null); return; }
    const { run: chosen, text: next } = overlay;
    setOverlay(null);
    await onApply('Added an overlay text box.', async (latest) => ({
      bytes: await addPdfDrawing(latest, { pageNumber, viewRotation, kind: 'FreeText', rect: chosen.shown, text: next, author: 'MALENJO overlay edit',
        style: { color: '#000000', opacity: 1, width: 0.5 } }),
      summary: `Added an overlay text box over “${chosen.text}” on page ${pageNumber}. This is an overlay annotation: the original text is still in the file underneath.`,
    }));
  }

  const titleId = `${domIdPrefix}-text-edit-title`;
  return <section ref={panelRef} className="pdf-markup-panel" role="dialog" aria-modal="false" aria-labelledby={titleId}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header>
      <h2 id={titleId}>Edit text</h2>
      <button type="button" aria-label="Close edit text" title="Close" onClick={onClose}><X size={16} aria-hidden="true"/></button>
    </header>
    <p>Page {pageNumber}: click text on the page, or choose it here. Changes are made to the PDF's own text, in its original font.</p>
    <label><span>Text on this page</span><select aria-label="Text to edit" value={run?.id ?? ''} onChange={(e) => state && onState({ ...state, selected: e.target.value === '' ? null : Number(e.target.value) })}>
      <option value="">Choose text…</option>
      {state?.runs.map((item) => <option key={item.id} value={item.id} disabled={!item.editable}>{item.text.slice(0, 60)}{item.editable ? '' : ` (cannot edit: ${item.reason})`}</option>)}
    </select></label>
    {run && <>
      <p>Font: {run.fontName}, {run.size} pt</p>
      <label><span>New text</span><input aria-label="New text" value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void apply(); } }}/></label>
      <button type="button" className="primary-action" disabled={busy || text === run.text} onClick={() => void apply()}>Replace text</button>
    </>}
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    {overlay && <div className="pdf-tool-dialog-actions">
      <button type="button" disabled={busy} onClick={() => void placeOverlay()}>Use an overlay text box instead (labelled)</button>
    </div>}
    <small>Text drawn with a font the PDF does not fully include can only use characters that font already contains. An overlay places a separate text box on top; it is labelled as an overlay and the original text stays underneath.</small>
  </section>;
}
