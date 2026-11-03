import { useEffect, useRef, useState } from 'react';
import { FilePlus2, Plus, X } from 'lucide-react';
import { exportPdfPartsZip } from './api';
import { describeBatchRule, runPdfBatch, type PdfBatchEntry, type PdfBatchRule } from './pdfBatch';
import type { NupPerSheet } from './pdfNup';
import { describePdfError } from './pdfUserErrors';

interface FileEntry { id: string; name: string; bytes: Uint8Array | null; current: boolean }
type RuleKind = PdfBatchRule['kind'];

interface Props {
  domIdPrefix: string;
  currentName: string;
  busy: boolean;
  /** Latest working bytes of the open document at the moment the batch runs. */
  getBytes(): Uint8Array | null;
  onDone(message: string): void;
  onClose(): void;
}

let fileSequence = 0;

/** MAL-010: apply page organization rules to several PDFs and save results plus a manifest. */
export default function PdfBatchDialog({ domIdPrefix, currentName, busy, getBytes, onDone, onClose }: Props) {
  const [files, setFiles] = useState<FileEntry[]>(() => [{ id: 'current', name: currentName, bytes: null, current: true }]);
  const [rules, setRules] = useState<PdfBatchRule[]>([]);
  const [kind, setKind] = useState<RuleKind>('rotate');
  const [pages, setPages] = useState('all');
  const [angle, setAngle] = useState<90 | 180 | 270>(90);
  const [perSheet, setPerSheet] = useState<NupPerSheet>(2);
  const [results, setResults] = useState<PdfBatchEntry[] | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => { dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(); }, []);

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const added: FileEntry[] = [];
    for (const file of Array.from(list)) added.push({ id: `batch-${++fileSequence}`, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), current: false });
    setFiles((current) => [...current, ...added]);
    setError('');
  }

  function addRule() {
    setError('');
    if ((kind === 'remove' || kind === 'keep') && !pages.trim()) { setError('Enter the pages for this rule, for example 1-3, 5.'); return; }
    const rule: PdfBatchRule = kind === 'rotate' ? { kind, pages, angle }
      : kind === 'nup' ? { kind, options: { perSheet, sheet: 'letter', orientation: perSheet === 2 ? 'landscape' : 'portrait', margin: 18, gap: 9, order: 'rows', borders: false } }
        : { kind, pages };
    setRules((current) => [...current, rule]);
  }

  async function run() {
    setWorking(true); setError(''); setResults(null);
    try {
      const latest = getBytes();
      const sources = files.map(({ name, bytes, current }) => ({ name, bytes: current ? latest : bytes }))
        .filter((source): source is { name: string; bytes: Uint8Array } => !!source.bytes);
      const result = await runPdfBatch(sources, rules);
      setResults(result.entries);
      const saved = await exportPdfPartsZip('MALENJO-batch.zip', result.archive);
      onDone(saved
        ? `Batch finished: ${result.succeeded} succeeded, ${result.failed} failed. Results and manifest.json / manifest.csv saved as one ZIP. The open document is unchanged.`
        : 'Batch cancelled. No output was saved.');
    } catch (reason) {
      setError(describePdfError(reason));
    } finally { setWorking(false); }
  }

  const titleId = `${domIdPrefix}-batch-title`;
  const pagesHint = kind === 'rotate' ? 'all, or 1-3, 5' : '1-3, 5, 8-';
  return <section ref={dialogRef} className="pdf-tool-dialog" role="dialog" aria-labelledby={titleId}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header>
      <h2 id={titleId}>Batch organize PDFs</h2>
      <button type="button" aria-label="Close batch" title="Close batch" onClick={onClose}><X size={16} aria-hidden="true"/></button>
    </header>
    <p>The same rules run on every file, in order. Each file gets its own result.</p>
    <ol className="pdf-merge-list static" aria-label="PDFs in the batch">
      {files.map((entry) => <li key={entry.id}>
        <span className="pdf-merge-name">{entry.name}{entry.current ? ' (open document)' : ''}</span>
        <button type="button" aria-label={`Remove ${entry.name} from batch`}
          onClick={() => setFiles((current) => current.filter((item) => item.id !== entry.id))}><X size={14} aria-hidden="true"/></button>
      </li>)}
    </ol>
    <input ref={inputRef} className="visually-hidden" type="file" accept="application/pdf,.pdf" multiple aria-hidden="true" tabIndex={-1}
      onChange={(event) => { void addFiles(event.target.files); event.target.value = ''; }}/>
    <button type="button" data-autofocus onClick={() => inputRef.current?.click()}><FilePlus2 size={15} aria-hidden="true"/> Add PDFs…</button>
    <fieldset>
      <legend>Add a rule</legend>
      <label>Rule<select aria-label="Rule type" value={kind} onChange={(event) => { const next = event.target.value as RuleKind; setKind(next); setPages(next === 'rotate' ? 'all' : ''); }}>
        <option value="rotate">Rotate pages</option>
        <option value="remove">Remove pages</option>
        <option value="keep">Keep only pages</option>
        <option value="nup">Pages per sheet (N-up)</option>
      </select></label>
      {kind !== 'nup' && <label>Pages<input aria-label="Rule pages" value={pages} placeholder={pagesHint} onChange={(event) => setPages(event.target.value)}/></label>}
      {kind === 'rotate' && <label>Angle<select aria-label="Rotation angle" value={angle} onChange={(event) => setAngle(Number(event.target.value) as 90 | 180 | 270)}>
        <option value={90}>90° clockwise</option><option value={180}>180°</option><option value={270}>90° counter-clockwise</option>
      </select></label>}
      {kind === 'nup' && <label>Pages per sheet<select aria-label="Batch pages per sheet" value={perSheet}
        onChange={(event) => setPerSheet(Number(event.target.value) as NupPerSheet)}>
        {[2, 4, 6, 9, 16].map((count) => <option key={count} value={count}>{count}</option>)}
      </select></label>}
      <button type="button" onClick={addRule}><Plus size={15} aria-hidden="true"/> Add rule</button>
    </fieldset>
    <ol className="pdf-merge-list static" aria-label="Batch rules, in order">
      {rules.map((rule, index) => <li key={index}>
        <span className="pdf-merge-name">{index + 1}. {describeBatchRule(rule)}</span>
        <button type="button" aria-label={`Remove rule ${index + 1}`}
          onClick={() => setRules((current) => current.filter((_, i) => i !== index))}><X size={14} aria-hidden="true"/></button>
      </li>)}
    </ol>
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    {results && <table className="pdf-batch-results" aria-label="Batch results">
      <thead><tr><th scope="col">File</th><th scope="col">Status</th><th scope="col">Pages</th></tr></thead>
      <tbody>{results.map((entry, index) => <tr key={index}>
        <td>{entry.source}</td>
        <td>{entry.status === 'ok' ? 'Done' : `Failed: ${entry.message}`}</td>
        <td>{entry.status === 'ok' ? `${entry.inputPages} → ${entry.outputPages}` : '—'}</td>
      </tr>)}</tbody>
    </table>}
    <button type="button" className="primary-action" disabled={busy || working || !files.length || !rules.length} onClick={() => void run()}>
      {working ? 'Running…' : `Run on ${files.length} PDF${files.length === 1 ? '' : 's'} and save ZIP`}
    </button>
    <small>Results are saved as one ZIP with a manifest (JSON and CSV) listing each file's status, pages and SHA-256. Files that fail are listed with the reason; the others still run. Source files are never changed.</small>
  </section>;
}
