import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, FilePlus2, X } from 'lucide-react';
import { mergePdfs, type PdfMergeOptions } from './pdfMerge';
import { describePdfError } from './pdfUserErrors';

/** The open document's bytes are read when the merge runs (never a stale copy). */
interface Entry { id: string; name: string; bytes: Uint8Array | null; current: boolean }

interface Props {
  domIdPrefix: string;
  currentName: string;
  busy: boolean;
  /**
   * Apply a merge to the working document (undoable). The operation receives
   * the latest working bytes and returns the merged PDF plus a summary.
   */
  onApply(operation: (latest: Uint8Array) => Promise<{ bytes: Uint8Array; summary: string }>): Promise<boolean>;
  onClose(): void;
}

let entrySequence = 0;

/** MAL-001: merge several PDFs in a user-chosen order with bookmark/metadata options. */
export default function PdfMergeDialog({ domIdPrefix, currentName, busy, onApply, onClose }: Props) {
  const [entries, setEntries] = useState<Entry[]>(() => [{ id: 'current', name: currentName, bytes: null, current: true }]);
  const [options, setOptions] = useState<PdfMergeOptions>({ bookmarks: 'keep', metadata: 'first' });
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const draggedRef = useRef<string | null>(null);

  useEffect(() => { dialogRef.current?.querySelector<HTMLElement>('button')?.focus(); }, []);

  function move(index: number, delta: number) {
    setEntries((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function moveTo(id: string, targetId: string) {
    setEntries((current) => {
      const from = current.findIndex((entry) => entry.id === id);
      const to = current.findIndex((entry) => entry.id === targetId);
      if (from < 0 || to < 0 || from === to) return current;
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const added: Entry[] = [];
    for (const file of Array.from(files)) {
      added.push({ id: `merge-${++entrySequence}`, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), current: false });
    }
    setEntries((current) => [...current, ...added]);
    setError('');
  }

  async function merge() {
    setWorking(true); setError('');
    try {
      const ordered = entries;
      const applied = await onApply(async (latest) => {
        const result = await mergePdfs(ordered.map(({ name, bytes }) => ({ name, bytes: bytes ?? latest })), options);
        const retargeted = result.retargetedBookmarks ? ` ${result.retargetedBookmarks} bookmark(s) without a page target now open their file's first page.` : '';
        return { bytes: result.bytes,
          summary: `Merged ${ordered.length} PDFs into ${result.pageCount} pages with ${result.bookmarkCount} bookmark(s).${retargeted}` };
      });
      if (applied) onClose();
    } catch (reason) {
      setError(describePdfError(reason));
    } finally { setWorking(false); }
  }

  const titleId = `${domIdPrefix}-merge-title`;
  return <section ref={dialogRef} className="pdf-tool-dialog" role="dialog" aria-labelledby={titleId}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header>
      <h2 id={titleId}>Merge PDFs</h2>
      <button type="button" aria-label="Close merge" title="Close merge" onClick={onClose}><X size={16} aria-hidden="true"/></button>
    </header>
    <p>Files merge from top to bottom. Reorder with the arrows or by dragging a row.</p>
    <ol className="pdf-merge-list" aria-label="PDFs to merge, in order">
      {entries.map((entry, index) => <li key={entry.id} draggable
        onDragStart={(event) => { draggedRef.current = entry.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', entry.id); }}
        onDragOver={(event) => { if (draggedRef.current) event.preventDefault(); }}
        onDrop={(event) => { event.preventDefault(); if (draggedRef.current) moveTo(draggedRef.current, entry.id); draggedRef.current = null; }}
        onDragEnd={() => { draggedRef.current = null; }}>
        <span className="pdf-merge-name">{index + 1}. {entry.name}{entry.current ? ' (open document)' : ''}</span>
        <button type="button" aria-label={`Move ${entry.name} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} aria-hidden="true"/></button>
        <button type="button" aria-label={`Move ${entry.name} down`} disabled={index === entries.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} aria-hidden="true"/></button>
        {!entry.current && <button type="button" aria-label={`Remove ${entry.name} from merge`}
          onClick={() => setEntries((current) => current.filter((item) => item.id !== entry.id))}><X size={14} aria-hidden="true"/></button>}
      </li>)}
    </ol>
    <input ref={inputRef} className="visually-hidden" type="file" accept="application/pdf,.pdf" multiple aria-hidden="true" tabIndex={-1}
      onChange={(event) => { void addFiles(event.target.files); event.target.value = ''; }}/>
    <button type="button" onClick={() => inputRef.current?.click()}><FilePlus2 size={15} aria-hidden="true"/> Add PDFs…</button>
    <label>Bookmarks<select aria-label="Merged bookmarks" value={options.bookmarks}
      onChange={(event) => setOptions({ ...options, bookmarks: event.target.value as PdfMergeOptions['bookmarks'] })}>
      <option value="keep">Keep each file's bookmarks</option>
      <option value="per-file">Group bookmarks under each file name</option>
      <option value="none">No bookmarks</option>
    </select></label>
    <label>Document information<select aria-label="Merged document information" value={options.metadata}
      onChange={(event) => setOptions({ ...options, metadata: event.target.value as PdfMergeOptions['metadata'] })}>
      <option value="first">Use the first file's title, author, subject and keywords</option>
      <option value="none">Leave document information empty</option>
    </select></label>
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    <button type="button" className="primary-action" disabled={busy || working || entries.length < 2} onClick={() => void merge()}>
      {working ? 'Merging…' : `Merge ${entries.length} PDFs`}
    </button>
    <small>Merged pages replace the working copy; Undo restores it. Interactive form fields and signatures are not carried over.</small>
  </section>;
}
