import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { checkStampDesign, documentIdentifier, resolveStamp, STAMP_VARIABLES, type StampDesign } from './pdfDynamicStamp';
import { loadStampLibrary, saveStampLibrary } from './stampLibrary';
import { describePdfError } from './pdfUserErrors';

export interface StampPlacing { design: StampDesign; user: string; docId: string; file: string }
interface Props {
  domIdPrefix: string; bytes: Uint8Array; sourceName: string; busy: boolean; defaultUser: string;
  placing: StampPlacing | null; onPlacing(next: StampPlacing | null): void; onClose(): void;
}
const USER_KEY = 'malenjo.pdf.stamp-user';
const readUser = (fallback: string) => { try { return globalThis.localStorage?.getItem(USER_KEY) || fallback; } catch { return fallback; } };

/** MAL-057: a reusable library of stamps with date, time, user, document identifier and approval-state variables. */
export default function PdfDynamicStampPanel({ domIdPrefix, bytes, sourceName, busy, defaultUser, placing, onPlacing, onClose }: Props) {
  const [library, setLibrary] = useState<StampDesign[]>(() => loadStampLibrary());
  const [selected, setSelected] = useState(library[0].id);
  const [user, setUser] = useState(() => readUser(defaultUser));
  const [docId, setDocId] = useState('');
  const [draft, setDraft] = useState<StampDesign | null>(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('input')?.focus(); }, []);
  useEffect(() => { void documentIdentifier(bytes).then(setDocId); }, [bytes]);
  const design = library.find((d) => d.id === selected) ?? library[0];
  const preview = resolveStamp(design, { user, now: new Date(), docId, file: sourceName });
  const titleId = `${domIdPrefix}-stamps-title`;

  function store(next: StampDesign[]) {
    setLibrary(next);
    if (!saveStampLibrary(next)) setNotice('This device does not allow saving stamps; your stamp lasts until the app closes.');
  }
  function saveDraft() {
    if (!draft) return;
    try {
      checkStampDesign(draft);
      const next = library.some((d) => d.id === draft.id) ? library.map((d) => (d.id === draft.id ? draft : d)) : [...library, draft];
      store(next); setSelected(draft.id); setDraft(null); setError(''); setNotice(`Saved the stamp “${draft.name}” to your library.`);
    } catch (reason) { setError(describePdfError(reason)); }
  }
  return <section ref={ref} className="pdf-tool-dialog" role="dialog" aria-labelledby={titleId}
    onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onPlacing(null); onClose(); } }}>
    <header><h2 id={titleId}>Stamps</h2><button type="button" aria-label="Close stamps" title="Close" onClick={() => { onPlacing(null); onClose(); }}><X size={16} aria-hidden="true"/></button></header>
    <label>Your name on stamps<input value={user} maxLength={80} onChange={(e) => { setUser(e.target.value); try { globalThis.localStorage?.setItem(USER_KEY, e.target.value); } catch { /* not kept */ } }}/></label>
    <fieldset>
      <legend>Stamp library</legend>
      <ul className="pdf-stamp-library" aria-label="Stamp library">
        {library.map((d) => <li key={d.id}><label className="pdf-tool-dialog-choice"><input type="radio" name={`${titleId}-stamp`} checked={selected === d.id} onChange={() => setSelected(d.id)}/>
          <span style={{ color: d.color, fontWeight: 600 }}>{d.status}</span> {d.name}{d.builtIn ? '' : ' (yours)'}</label>
          {!d.builtIn && <><button type="button" aria-label={`Edit stamp ${d.name}`} onClick={() => setDraft({ ...d })}>Edit</button>
            <button type="button" aria-label={`Delete stamp ${d.name}`} onClick={() => { const next = library.filter((x) => x.id !== d.id); store(next); if (selected === d.id) setSelected(next[0].id); }}>Delete</button></>}
        </li>)}
      </ul>
      <button type="button" onClick={() => setDraft({ id: `custom-${Date.now().toString(36)}`, name: '', status: 'APPROVED', detail: '{user} · {date} {time}', color: '#1d4ed8' })}>New stamp…</button>
    </fieldset>
    {draft && <fieldset>
      <legend>{library.some((d) => d.id === draft.id) ? 'Edit stamp' : 'New stamp'}</legend>
      <label>Stamp name<input value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })}/></label>
      <label>Status line<input value={draft.status} maxLength={40} onChange={(e) => setDraft({ ...draft, status: e.target.value })}/></label>
      <label>Detail line<input value={draft.detail} maxLength={120} onChange={(e) => setDraft({ ...draft, detail: e.target.value })}/></label>
      <label><span>Stamp colour</span><input aria-label="Stamp colour" type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })}/></label>
      <small>Variables: {STAMP_VARIABLES.map((v) => `{${v}}`).join(' ')}. {'{docid}'} is the document's identifier; {'{status}'} repeats the status line.</small>
      <button type="button" onClick={saveDraft}>Save stamp</button><button type="button" onClick={() => setDraft(null)}>Cancel</button>
    </fieldset>}
    <p aria-label="Stamp preview" className="pdf-stamp-preview"><strong style={{ color: design.color }}>{preview.status}</strong><br/>{preview.detail}</p>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    <button type="button" className="primary-action" aria-pressed={!!placing} disabled={busy}
      onClick={() => onPlacing(placing ? null : { design, user, docId, file: sourceName })}>{placing ? 'Stop placing' : 'Place on the page'}</button>
    <small>Click the page where the stamp goes; the date and time are filled in when you click. Stamps are saved as Stamp annotations other PDF readers show.</small>
  </section>;
}
