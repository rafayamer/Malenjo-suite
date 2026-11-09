import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, FilePlus2, X } from 'lucide-react';
import { exportPdfPartsZip } from './api';
import { BATES_MAX_FILES, batesArchive, batesNumberFiles, type BatesContinuation, type BatesFileResult, type BatesSpec } from './pdfBates';
import type { StampPosition } from './pdfStamp';
import { describePdfError } from './pdfUserErrors';

interface FileEntry { id: string; name: string; bytes: Uint8Array | null; current: boolean }
interface Props {
  domIdPrefix: string;
  currentName: string;
  currentSize: number;
  busy: boolean;
  getBytes(): Uint8Array | null;
  onNotice(text: string): void;
  /** Replaces the open document with its numbered copy (undoable). */
  onApplyCurrent(label: string, bytes: Uint8Array): Promise<boolean>;
  onClose(): void;
}
const POSITIONS: [StampPosition, string][] = [['bottom-right', 'Bottom right'], ['bottom-center', 'Bottom centre'], ['bottom-left', 'Bottom left'],
  ['top-right', 'Top right'], ['top-center', 'Top centre'], ['top-left', 'Top left']];
const MAX_TOTAL = 256 * 1024 * 1024;
let sequence = 0;

/** MAL-067: Bates numbers across several PDFs, with continuation rules and a log. */
export default function PdfBatesDialog({ domIdPrefix, currentName, currentSize, busy, getBytes, onNotice, onApplyCurrent, onClose }: Props) {
  const [files, setFiles] = useState<FileEntry[]>(() => [{ id: 'current', name: currentName, bytes: null, current: true }]);
  const [spec, setSpec] = useState<BatesSpec>({ prefix: '', suffix: '', start: 1, digits: 6, position: 'bottom-right', marginX: 24, marginY: 18,
    text: { font: 'helvetica', size: 9, color: '#000000' }, continuation: 'continue', roundTo: 1000 });
  const [updateOpen, setUpdateOpen] = useState(true);
  const [results, setResults] = useState<BatesFileResult[] | null>(null);
  const [error, setError] = useState(''); const [working, setWorking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null); const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(); }, []);
  const set = (patch: Partial<BatesSpec>) => setSpec((current) => ({ ...current, ...patch }));
  const titleId = `${domIdPrefix}-bates-title`;

  async function addFiles(list: FileList | null) {
    const chosen = Array.from(list ?? []);
    if (!chosen.length) return;
    if (files.length + chosen.length > BATES_MAX_FILES) { setError(`Bates numbering handles up to ${BATES_MAX_FILES} files; none were added.`); return; }
    const total = files.reduce((n, f) => n + (f.current ? currentSize : f.bytes?.length ?? 0), 0) + chosen.reduce((n, f) => n + f.size, 0);
    if (total > MAX_TOTAL) { setError('These files would bring the total above 256 MB; none were added.'); return; }
    const added: FileEntry[] = [];
    for (const file of chosen) added.push({ id: `bates-${++sequence}`, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), current: false });
    setFiles((current) => [...current, ...added]); setError('');
  }
  const move = (index: number, by: number) => setFiles((current) => {
    const next = [...current]; const [item] = next.splice(index, 1); next.splice(index + by, 0, item); return next;
  });

  async function run() {
    setWorking(true); setError(''); setResults(null);
    try {
      const latest = getBytes();
      const sources = files.map((f) => ({ name: f.name, bytes: f.current ? latest : f.bytes })).filter((f): f is { name: string; bytes: Uint8Array } => !!f.bytes);
      const result = await batesNumberFiles(sources, spec);
      setResults(result.files);
      const currentIndex = files.findIndex((f) => f.current);
      const range = `${result.files[0].first} to ${result.files[result.files.length - 1].last}`;
      if (sources.length === 1 && currentIndex === 0) {
        if (await onApplyCurrent(`Applied Bates numbers ${range}.`, result.files[0].bytes)) onNotice(`Applied Bates numbers ${range} to the open document.`);
        return;
      }
      const saved = await exportPdfPartsZip('MALENJO-bates.zip', batesArchive(result));
      if (!saved) { onNotice('Bates numbering cancelled. No output was saved.'); return; }
      if (currentIndex >= 0 && updateOpen) await onApplyCurrent(`Applied Bates numbers ${result.files[currentIndex].first} to ${result.files[currentIndex].last}.`, result.files[currentIndex].bytes);
      onNotice(`Numbered ${sources.length} PDFs (${range}); saved them with bates-log.csv as one ZIP.`);
    } catch (reason) { setError(describePdfError(reason)); } finally { setWorking(false); }
  }

  return <section ref={ref} className="pdf-tool-dialog" role="dialog" aria-labelledby={titleId}
    onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
    <header><h2 id={titleId}>Bates numbering</h2><button type="button" aria-label="Close Bates numbering" title="Close" onClick={onClose}><X size={16} aria-hidden="true"/></button></header>
    <p>Pages are numbered in the order of the files below, then page by page.</p>
    <ol className="pdf-merge-list static" aria-label="PDFs to number, in order">
      {files.map((f, i) => <li key={f.id}>
        <span className="pdf-merge-name">{f.name}{f.current ? ' (open document)' : ''}</span>
        <button type="button" aria-label={`Move ${f.name} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} aria-hidden="true"/></button>
        <button type="button" aria-label={`Move ${f.name} down`} disabled={i === files.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} aria-hidden="true"/></button>
        <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((current) => current.filter((x) => x.id !== f.id))}><X size={14} aria-hidden="true"/></button>
      </li>)}
    </ol>
    <input ref={inputRef} className="visually-hidden" type="file" accept="application/pdf,.pdf" multiple aria-hidden="true" tabIndex={-1}
      onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }}/>
    <button type="button" data-autofocus onClick={() => inputRef.current?.click()}><FilePlus2 size={15} aria-hidden="true"/> Add PDFs…</button>
    <fieldset>
      <legend>Identifier</legend>
      <label>Prefix<input value={spec.prefix} maxLength={60} placeholder="ACME-{vol}-" onChange={(e) => set({ prefix: e.target.value })}/></label>
      <label>Start number<input type="number" min={0} step={1} value={spec.start} onChange={(e) => set({ start: Number(e.target.value) })}/></label>
      <label>Padding (digits)<input type="number" min={1} max={12} step={1} value={spec.digits} onChange={(e) => set({ digits: Number(e.target.value) })}/></label>
      <label>Suffix<input value={spec.suffix} maxLength={60} onChange={(e) => set({ suffix: e.target.value })}/></label>
      <small>{'{vol}'} in the prefix becomes the file's place in the list (001, 002, …).</small>
    </fieldset>
    <fieldset>
      <legend>Between files</legend>
      <label>Numbering<select aria-label="Numbering" value={spec.continuation} onChange={(e) => set({ continuation: e.target.value as BatesContinuation })}>
        <option value="continue">Continue from the previous file</option><option value="restart">Restart for each file</option>
        <option value="round">Start each file at the next round number</option></select></label>
      {spec.continuation === 'round' && <label>Round to<input type="number" min={2} step={1} value={spec.roundTo} onChange={(e) => set({ roundTo: Number(e.target.value) })}/></label>}
    </fieldset>
    <fieldset>
      <legend>Placement</legend>
      <label>Position<select aria-label="Position" value={spec.position} onChange={(e) => set({ position: e.target.value as StampPosition })}>
        {POSITIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
      <label>Side margin (pt)<input type="number" min={0} max={300} value={spec.marginX} onChange={(e) => set({ marginX: Number(e.target.value) })}/></label>
      <label>Edge margin (pt)<input type="number" min={0} max={300} value={spec.marginY} onChange={(e) => set({ marginY: Number(e.target.value) })}/></label>
      <label>Font size (pt)<input type="number" min={4} max={72} value={spec.text.size} onChange={(e) => set({ text: { ...spec.text, size: Number(e.target.value) } })}/></label>
    </fieldset>
    {files.length > 1 && files.some((f) => f.current) && <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={updateOpen} onChange={(e) => setUpdateOpen(e.target.checked)}/>Also number the open document here</label>}
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    {results && <table className="pdf-batch-results" aria-label="Bates numbers by file">
      <thead><tr><th scope="col">File</th><th scope="col">First</th><th scope="col">Last</th><th scope="col">Pages</th></tr></thead>
      <tbody>{results.map((r, i) => <tr key={i}><td>{r.name}</td><td>{r.first}</td><td>{r.last}</td><td>{r.pages}</td></tr>)}</tbody>
    </table>}
    <button type="button" className="primary-action" disabled={busy || working || !files.length} onClick={() => void run()}>
      {working ? 'Numbering…' : files.length === 1 && files[0].current ? 'Apply Bates numbers' : `Number ${files.length} PDFs and save ZIP`}</button>
    <small>Numbers are stamped upright in each page's visible area. Several files are saved as one ZIP named by their first number, with bates-log.csv listing each file's first and last number and SHA-256. Source files are not changed.</small>
  </section>;
}
