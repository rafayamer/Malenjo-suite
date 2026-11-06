import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { replacePdfText, searchPdfText, type TextMatch } from './content/textEdit';
import { describePdfError } from './pdfUserErrors';

type Operation = (latest: Uint8Array) => Promise<{ bytes: Uint8Array; summary: string }>;
export interface RevisionInfo { index: number; label: string; current: boolean; /** The document as it was opened (not an edited revision kept after older history was dropped). */ original: boolean }
interface Props {
  domIdPrefix: string;
  bytes: Uint8Array;
  busy: boolean;
  revisions: RevisionInfo[];
  onApply(label: string, operation: Operation): Promise<boolean>;
  onRestore(index: number): void;
  onSaveRevision(index: number): void;
  onGoToPage(page: number): void;
  onClose(): void;
}

/** MAL-023: find and replace text in place, and the document's revision history. */
export default function PdfFindReplaceDialog({ domIdPrefix, bytes, busy, revisions, onApply, onRestore, onSaveRevision, onGoToPage, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [matches, setMatches] = useState<TextMatch[] | null>(null);
  const [report, setReport] = useState('');
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => { dialogRef.current?.querySelector<HTMLElement>('input')?.focus(); }, []);
  useEffect(() => { setMatches(null); }, [bytes]);

  async function find() {
    setError(''); setReport('');
    try { setMatches(await searchPdfText(bytes, query, matchCase)); } catch (reason) { setError(describePdfError(reason)); }
  }
  async function replaceAll() {
    setError(''); setReport('');
    try {
      // Dry run on the current bytes so a refusal is reported here, then apply as one undoable edit.
      const preview = await replacePdfText(bytes, query, replacement, matchCase);
      const refused = preview.refused.length ? ` ${preview.refused.length} piece(s) of text were left unchanged: ${preview.refused.slice(0, 3).map((r) => `page ${r.pageNumber}, “${r.text.slice(0, 30)}” (${r.reason})`).join('; ')}.` : '';
      if (!preview.replaced) { setReport(`Nothing was replaced.${refused}`); return; }
      const applied = await onApply(`Replaced “${query}”.`, async (latest) => {
        const result = await replacePdfText(latest, query, replacement, matchCase);
        return { bytes: result.bytes, summary: `Replaced ${result.replaced} occurrence(s) of “${query}” in place.${refused}` };
      });
      if (applied) setReport(`Replaced ${preview.replaced} occurrence(s).${refused}`);
    } catch (reason) { setError(describePdfError(reason)); }
  }

  const titleId = `${domIdPrefix}-find-title`;
  return <section ref={dialogRef} className="pdf-tool-dialog" role="dialog" aria-labelledby={titleId}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header>
      <h2 id={titleId}>Find and replace</h2>
      <button type="button" aria-label="Close find and replace" title="Close" onClick={onClose}><X size={16} aria-hidden="true"/></button>
    </header>
    <label><span>Find</span><input aria-label="Find text" value={query} onChange={(e) => { setQuery(e.target.value); setMatches(null); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void find(); } }}/></label>
    <label><span>Replace with</span><input aria-label="Replace with" value={replacement} onChange={(e) => setReplacement(e.target.value)}/></label>
    <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={matchCase} onChange={(e) => { setMatchCase(e.target.checked); setMatches(null); }}/>Match case</label>
    <div className="pdf-tool-dialog-actions">
      <button type="button" disabled={!query} onClick={() => void find()}>Find all</button>
      <button type="button" className="primary-action" disabled={busy || !query} onClick={() => void replaceAll()}>Replace all</button>
    </div>
    {matches && <>
      <p role="status">{matches.length ? `${matches.length} match(es)` : 'No matches.'}</p>
      {!!matches.length && <ul className="pdf-merge-list static" aria-label="Matches">
        {matches.slice(0, 200).map((m, i) => <li key={i}><button type="button" className="pdf-merge-name" onClick={() => onGoToPage(m.pageNumber)}>Page {m.pageNumber}: {m.context.slice(0, 80)}</button></li>)}
      </ul>}
    </>}
    {report && <p role="status">{report}</p>}
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    <fieldset>
      <legend>Revision history</legend>
      <ol className="pdf-merge-list static" aria-label="Revisions">
        {revisions.map((r) => <li key={r.index}>
          <span className="pdf-merge-name">{r.original ? 'Opened document' : r.index === 0 ? `Oldest kept revision: ${r.label}` : `${r.index}. ${r.label}`}{r.current ? ' (current)' : ''}</span>
          <button type="button" disabled={busy || r.current} aria-label={`Go back to revision ${r.index}`} onClick={() => onRestore(r.index)}>Restore</button>
          <button type="button" disabled={busy} aria-label={`Save revision ${r.index} as a PDF`} onClick={() => onSaveRevision(r.index)}>Save…</button>
        </li>)}
      </ol>
    </fieldset>
    <small>Replacements change the PDF's own text in its original fonts; text whose font lacks a needed character is left unchanged and listed. Text split across separately drawn pieces is not matched. Every change is a revision you can undo, restore or save as its own PDF during this session.</small>
  </section>;
}
