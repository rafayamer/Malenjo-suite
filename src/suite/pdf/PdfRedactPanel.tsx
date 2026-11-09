import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { OPS, getDocument } from 'pdfjs-dist';
import { findRedactionText, pdfPageFrames, redactPdf, type RedactionMark } from './security/pdfRedact';
import { pdfjsImageDecoder } from './security/redactImages';
import { detectSensitiveInformation, SENSITIVE_CATEGORIES, type SensitiveCandidate, type SensitiveCategory } from './security/sensitiveDetect';
import { describePdfError } from './pdfUserErrors';

type Operation = (latest: Uint8Array) => Promise<{ bytes: Uint8Array; summary: string }>;
export interface RedactMarkItem extends RedactionMark { id: number; label: string }
export interface RedactState {
  frames: { crop: [number, number, number, number]; rotation: number }[];
  marks: RedactMarkItem[];
  drawing: boolean;
  selected: number | null;
}
interface Props {
  domIdPrefix: string;
  bytes: Uint8Array;
  busy: boolean;
  state: RedactState | null;
  onState(update: (current: RedactState | null) => RedactState | null): void;
  onApply(label: string, operation: Operation): Promise<boolean>;
  onClose(): void;
}

let markSequence = 0;
export const newMarkId = () => ++markSequence;
const decodeImage = pdfjsImageDecoder(getDocument as never, OPS.paintImageXObject);
const DEFAULT_KINDS: SensitiveCategory[] = ['name', 'address', 'email', 'phone', 'national-id', 'card', 'bank', 'date'];

/** MAL-063 permanent redaction, with MAL-064 detection of sensitive information to review and mark. */
export default function PdfRedactPanel({ domIdPrefix, bytes, busy, state, onState, onApply, onClose }: Props) {
  const [phrase, setPhrase] = useState(''); const [wholeWords, setWholeWords] = useState(true);
  const [kinds, setKinds] = useState<Set<SensitiveCategory>>(new Set(DEFAULT_KINDS)); const [custom, setCustom] = useState('');
  const [candidates, setCandidates] = useState<SensitiveCandidate[] | null>(null); const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [fill, setFill] = useState('#000000'); const [label, setLabel] = useState(''); const [scrub, setScrub] = useState(true);
  const [status, setStatus] = useState<string[]>([]); const [error, setError] = useState(''); const [working, setWorking] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    let live = true;
    pdfPageFrames(bytes).then((frames) => { if (live) onState((current) => ({ marks: [], drawing: false, selected: null, ...current, frames })); })
      .catch((reason) => { if (live) setError(describePdfError(reason)); });
    return () => { live = false; };
  }, [bytes]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(); }, []);
  const marks = state?.marks ?? [];
  const addMarks = (added: RedactMarkItem[]) => onState((current) => current ? { ...current, marks: [...current.marks, ...added] } : current);
  const titleId = `${domIdPrefix}-redact-title`;

  async function run(task: () => Promise<void>) {
    setWorking(true); setError('');
    try { await task(); } catch (reason) { setError(describePdfError(reason)); } finally { setWorking(false); }
  }
  const markText = () => run(async () => {
    const matches = await findRedactionText(bytes, phrase, wholeWords);
    addMarks(matches.flatMap((m) => m.marks.map((mark) => ({ ...mark, id: newMarkId(), label: `“${m.text}”` }))));
    setStatus([matches.length ? `Marked ${matches.length} match${matches.length === 1 ? '' : 'es'} of “${phrase.trim()}”.` : `“${phrase.trim()}” was not found in the page text.`]);
  });
  const detect = () => run(async () => {
    const found = await detectSensitiveInformation(bytes, [...kinds], custom.split(/\r?\n/));
    setCandidates(found); setChosen(new Set(found.map((c) => c.id)));
    setStatus([`Found ${found.length} candidate${found.length === 1 ? '' : 's'} to review.`]);
  });
  const markCandidates = () => {
    const picked = (candidates ?? []).filter((c) => chosen.has(c.id));
    addMarks(picked.flatMap((c) => c.marks.map((mark) => ({ ...mark, id: newMarkId(), label: `“${c.text}”` }))));
    setCandidates(null); setStatus([`Marked ${picked.length} reviewed candidate${picked.length === 1 ? '' : 's'}.`]);
  };
  const apply = () => run(async () => {
    let lines: string[] = [];
    const ok = await onApply(`Redacted ${marks.length} area(s).`, async (latest) => {
      const { bytes: out, report: r } = await redactPdf(latest, { marks: marks.map(({ pageNumber, box }) => ({ pageNumber, box })), fill, label, scrubElsewhere: scrub, decodeImage });
      const parts = [`${r.glyphs} character(s)`, r.imagesEdited && `${r.imagesEdited} image(s) blacked out`, r.imagesRemoved && `${r.imagesRemoved} image(s) removed`,
        r.paths && `${r.paths} drawing(s)`, r.forms && `${r.forms} shared drawing(s) rewritten`, r.annotations && `${r.annotations} comment(s) or link(s)`, r.fields && `${r.fields} form field(s)`].filter(Boolean);
      lines = [`Redacted ${r.areas} area(s) on ${r.pages} page(s): removed ${parts.join(', ')}.`,
        ...(r.elsewhere.length ? [`Also removed the redacted words from: ${[...new Set(r.elsewhere)].join('; ')}.`] : [])];
      return { bytes: out, summary: lines[0] };
    });
    if (ok) { onState((current) => current ? { ...current, marks: [], selected: null, drawing: false } : current); setStatus(lines); }
  });

  return <section ref={ref} className="pdf-tool-dialog pdf-redact-panel" role="dialog" aria-labelledby={titleId}
    onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
    <header><h2 id={titleId}>Redact</h2><button type="button" aria-label="Close redact" title="Close" onClick={onClose}><X size={16} aria-hidden="true"/></button></header>
    <fieldset>
      <legend>Mark what to remove</legend>
      <button type="button" data-autofocus aria-pressed={!!state?.drawing} disabled={!state}
        onClick={() => onState((current) => current ? { ...current, drawing: !current.drawing } : current)}>{state?.drawing ? 'Stop drawing areas' : 'Draw areas on the page'}</button>
      <label>Text to redact<input value={phrase} onChange={(e) => setPhrase(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && phrase.trim() && !working) void markText(); }}/></label>
      <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={wholeWords} onChange={(e) => setWholeWords(e.target.checked)}/>Whole words only</label>
      <button type="button" disabled={working || !phrase.trim()} onClick={() => void markText()}>Mark all matches</button>
    </fieldset>
    <fieldset>
      <legend>Find sensitive information</legend>
      {SENSITIVE_CATEGORIES.map(([kind, text]) => <label key={kind} className="pdf-tool-dialog-choice"><input type="checkbox" checked={kinds.has(kind)}
        onChange={(e) => { const next = new Set(kinds); if (e.target.checked) next.add(kind); else next.delete(kind); setKinds(next); }}/>{text}</label>)}
      {kinds.has('custom') && <label>Your patterns (one per line; /regex/ for a pattern)<textarea rows={3} value={custom} onChange={(e) => setCustom(e.target.value)}/></label>}
      <button type="button" disabled={working || !kinds.size} onClick={() => void detect()}>Find candidates</button>
      {candidates && <>
        <ul className="pdf-redact-candidates" aria-label="Candidates to review">
          {candidates.map((c) => <li key={c.id}><label className="pdf-tool-dialog-choice"><input type="checkbox" checked={chosen.has(c.id)}
            onChange={(e) => { const next = new Set(chosen); if (e.target.checked) next.add(c.id); else next.delete(c.id); setChosen(next); }}/>
            Page {c.pageNumber}: {c.text} <small>({c.reason})</small></label></li>)}
        </ul>
        <button type="button" disabled={!chosen.size} onClick={markCandidates}>Mark {chosen.size} selected candidate{chosen.size === 1 ? '' : 's'}</button>
      </>}
    </fieldset>
    <fieldset>
      <legend>Marked for redaction ({marks.length})</legend>
      <ul className="pdf-redact-marks" aria-label="Areas marked for redaction">
        {marks.map((m) => <li key={m.id} className={state?.selected === m.id ? 'selected' : undefined}><span>Page {m.pageNumber}: {m.label}</span>
          <button type="button" aria-label={`Unmark page ${m.pageNumber}: ${m.label}`} onClick={() => onState((current) => current ? { ...current, marks: current.marks.filter((x) => x.id !== m.id) } : current)}><X size={14} aria-hidden="true"/></button></li>)}
      </ul>
      {marks.length > 0 && <button type="button" onClick={() => onState((current) => current ? { ...current, marks: [], selected: null } : current)}>Clear all marks</button>}
    </fieldset>
    <fieldset>
      <legend>Redaction boxes</legend>
      <label><span>Box colour</span><input aria-label="Box colour" type="color" value={fill} onChange={(e) => setFill(e.target.value)}/></label>
      <label>Text in each box (optional)<input value={label} maxLength={60} placeholder="REDACTED" onChange={(e) => setLabel(e.target.value)}/></label>
      <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={scrub} onChange={(e) => setScrub(e.target.checked)}/>Also remove the redacted words from document information, metadata, bookmarks, comments, form values and tags</label>
    </fieldset>
    {status.length > 0 && <div role="status">{status.map((line, i) => <p key={i}>{line}</p>)}</div>}
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    <button type="button" className="primary-action" disabled={busy || working || !marks.length} onClick={() => void apply()}>{working ? 'Working…' : `Apply ${marks.length} redaction${marks.length === 1 ? '' : 's'}`}</button>
    <small>Redaction removes what lies under each area — text, image pixels, drawings, comments and form fields — and covers it with a box. Undo restores it until you save; the saved file keeps no copy. Detection is rule-based and runs on this device: review every candidate, and check scanned pages, which have no text to search.</small>
  </section>;
}
