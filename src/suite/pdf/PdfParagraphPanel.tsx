import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { listPdfParagraphs, reflowPdfParagraph, type ParagraphAlign, type ParagraphFont, type ParagraphInfo, type ParagraphStyle } from './content/paragraphs';
import { describePdfError } from './pdfUserErrors';

type Operation = (latest: Uint8Array) => Promise<{ bytes: Uint8Array; summary: string }>;
export interface ParagraphEditState { pageNumber: number; paragraphs: ParagraphInfo[]; selected: number | null }
interface Props {
  domIdPrefix: string;
  bytes: Uint8Array;
  pageNumber: number;
  viewRotation: number;
  busy: boolean;
  state: ParagraphEditState | null;
  onState(next: ParagraphEditState): void;
  onApply(label: string, operation: Operation): Promise<boolean>;
  onClose(): void;
}

const STYLE_KEY = 'malenjo.pdf.paragraph-styles';
const FONTS: [ParagraphFont, string][] = [['keep', 'Keep the original font'], ['helvetica', 'Helvetica'], ['helvetica-bold', 'Helvetica Bold'], ['times', 'Times'], ['times-bold', 'Times Bold'], ['courier', 'Courier']];
type Named = ParagraphStyle & { name: string };
function readStyles(): Named[] {
  try { const parsed = JSON.parse(localStorage.getItem(STYLE_KEY) ?? '[]'); return Array.isArray(parsed) ? parsed.filter((s) => s && typeof s.name === 'string').slice(0, 50) : []; } catch { return []; }
}
function writeStyles(styles: Named[]) { try { localStorage.setItem(STYLE_KEY, JSON.stringify(styles)); } catch { /* storage unavailable: styles last for this session */ } }

/** MAL-012 / MAL-013: rewrite a paragraph with reflow, alignment, spacing, size, weight and reusable styles. */
export default function PdfParagraphPanel({ domIdPrefix, bytes, pageNumber, viewRotation, busy, state, onState, onApply, onClose }: Props) {
  const [text, setText] = useState('');
  const [style, setStyle] = useState<ParagraphStyle>({ align: 'left', size: 12, lineHeight: 1.2, charSpacing: 0, wordSpacing: 0, font: 'keep' });
  const [allowGrow, setAllowGrow] = useState(false);
  const [styles, setStyles] = useState<Named[]>(() => readStyles());
  const [styleName, setStyleName] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const panelRef = useRef<HTMLElement>(null);
  // A selection belongs to the page it was made on: while the list for a newly shown page loads, nothing is selected.
  const paragraph = state?.pageNumber === pageNumber ? state.paragraphs.find((p) => p.id === state.selected) ?? null : null;

  useEffect(() => {
    let live = true;
    listPdfParagraphs(bytes, pageNumber, viewRotation).then((paragraphs) => {
      if (live) { onState({ pageNumber, paragraphs, selected: null }); setError(''); }
    }).catch((reason) => { if (live) setError(describePdfError(reason)); });
    return () => { live = false; };
  }, [bytes, pageNumber, viewRotation]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!paragraph) return;
    setText(paragraph.text.replace(/\n/g, ' '));
    setStyle({ align: paragraph.align, size: paragraph.size, lineHeight: paragraph.lineHeight, charSpacing: 0, wordSpacing: 0, font: 'keep' });
    setError(''); setNote('');
  }, [paragraph?.id, paragraph?.text]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { panelRef.current?.querySelector<HTMLElement>('select')?.focus(); }, []);

  async function apply() {
    if (!paragraph) return;
    setError(''); setNote('');
    const chosen = paragraph;
    try {
      // Check first on the current bytes so overflow and missing glyphs are explained here.
      const preview = await reflowPdfParagraph(bytes, pageNumber, chosen.id, chosen.text, text, style, allowGrow);
      await onApply('Rewrote a paragraph.', async (latest) => {
        const result = await reflowPdfParagraph(latest, pageNumber, chosen.id, chosen.text, text, style, allowGrow);
        return { bytes: result.bytes, summary: `Rewrote the paragraph on page ${pageNumber} in ${result.lines} line(s).${result.overflow ? ' It now extends beyond its original box.' : ''}${result.substitution ? ` Font substitution: ${result.substitution}` : ''}` };
      });
      if (preview.substitution) setNote(`Font substitution: ${preview.substitution}`);
    } catch (reason) { setError(describePdfError(reason)); }
  }
  function saveStyle() {
    const name = styleName.trim().slice(0, 40);
    if (!name) { setError('Name the style first.'); return; }
    const next = [...styles.filter((s) => s.name !== name), { ...style, name }];
    setStyles(next); writeStyles(next); setStyleName(''); setNote(`Saved the style “${name}”.`);
  }

  const titleId = `${domIdPrefix}-paragraph-title`;
  const set = (patch: Partial<ParagraphStyle>) => setStyle({ ...style, ...patch });
  return <section ref={panelRef} className="pdf-markup-panel" role="dialog" aria-modal="false" aria-labelledby={titleId}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header>
      <h2 id={titleId}>Paragraphs</h2>
      <button type="button" aria-label="Close paragraphs" title="Close" onClick={onClose}><X size={16} aria-hidden="true"/></button>
    </header>
    <label><span>Paragraphs on page {pageNumber}</span>
      <select aria-label="Paragraph to edit" value={paragraph?.id ?? ''} onChange={(e) => state && onState({ ...state, selected: e.target.value === '' ? null : Number(e.target.value) })}>
        <option value="">Choose a paragraph…</option>
        {state?.paragraphs.map((p) => <option key={p.id} value={p.id} disabled={!p.editable}>{p.text.replace(/\n/g, ' ').slice(0, 60)}</option>)}
      </select></label>
    {paragraph && <>
      <p>Font: {paragraph.fontName}{paragraph.embedded ? (paragraph.subset ? ' (embedded subset)' : ' (embedded)') : ' (standard, not embedded)'} · {paragraph.size} pt · {paragraph.lines} line(s)</p>
      <label><span>Text</span><textarea aria-label="Paragraph text" rows={4} value={text} onChange={(e) => setText(e.target.value)}/></label>
      <fieldset>
        <legend>Formatting</legend>
        <label><span>Alignment</span><select aria-label="Paragraph alignment" value={style.align} onChange={(e) => set({ align: e.target.value as ParagraphAlign })}>
          <option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option><option value="justify">Justify</option></select></label>
        <label><span>Font and weight</span><select aria-label="Paragraph font" value={style.font} onChange={(e) => set({ font: e.target.value as ParagraphFont })}>
          {FONTS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label><span>Size (pt)</span><input aria-label="Paragraph text size" type="number" min={4} max={144} step={0.5} value={style.size} onChange={(e) => set({ size: Number(e.target.value) })}/></label>
        <label><span>Line height (× size)</span><input aria-label="Paragraph line height" type="number" min={0.8} max={4} step={0.05} value={style.lineHeight} onChange={(e) => set({ lineHeight: Number(e.target.value) })}/></label>
        <label><span>Letter spacing (pt)</span><input aria-label="Paragraph letter spacing" type="number" min={-20} max={20} step={0.1} value={style.charSpacing} onChange={(e) => set({ charSpacing: Number(e.target.value) })}/></label>
        <label><span>Word spacing (pt)</span><input aria-label="Paragraph word spacing" type="number" min={-50} max={50} step={0.5} value={style.wordSpacing} onChange={(e) => set({ wordSpacing: Number(e.target.value) })}/></label>
        <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={allowGrow} onChange={(e) => setAllowGrow(e.target.checked)}/>Allow the text to grow beyond its box</label>
      </fieldset>
      <fieldset>
        <legend>Reusable styles</legend>
        <label><span>Apply a saved style</span><select aria-label="Saved paragraph style" value="" onChange={(e) => { const s = styles.find((x) => x.name === e.target.value); if (s) { const { name, ...rest } = s; setStyle(rest); setNote(`Applied the style “${name}”; choose Apply to change the paragraph.`); } }}>
          <option value="">Choose a style…</option>{styles.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</select></label>
        <label><span>Save these settings as</span><input aria-label="New style name" value={styleName} onChange={(e) => setStyleName(e.target.value)}/></label>
        <button type="button" onClick={saveStyle}>Save style</button>
      </fieldset>
      <button type="button" className="primary-action" disabled={busy || !text.trim()} onClick={() => void apply()}>Apply to paragraph</button>
    </>}
    {note && <p role="status">{note}</p>}
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    <small>The paragraph is rewritten in place within its original width. The original font is kept when it can draw every character; choosing another font or weight substitutes a standard font, and that is reported. Styles are saved on this device.</small>
  </section>;
}
