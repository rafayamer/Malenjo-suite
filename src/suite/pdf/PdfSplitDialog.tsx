import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { exportPdfPartsZip, pdfPartsZipLimit } from './api';
import { PDF_CHAPTER_SPLIT_MAX_OUTPUT_BYTES, splitPdfByChapters } from './pdfChapterSplit';
import { parsePageRanges, splitPdfByRanges, splitPdfBySize } from './pdfSplitModes';
import { describePdfError } from './pdfUserErrors';
import { splitPdfByPageCount } from './splitByPageCount';

type Mode = 'ranges' | 'count' | 'bookmarks' | 'size';

interface Props {
  domIdPrefix: string;
  sourceName: string;
  pageCount: number;
  busy: boolean;
  /** Latest working bytes at the moment Split runs. */
  getBytes(): Uint8Array | null;
  onDone(message: string): void;
  onClose(): void;
}

/** MAL-002: split by page ranges, page count, top-level bookmarks or a size limit. */
export default function PdfSplitDialog({ domIdPrefix, sourceName, pageCount, busy, getBytes, onDone, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('ranges');
  const [ranges, setRanges] = useState('1-' + Math.max(1, Math.ceil(pageCount / 2)) + (pageCount > 1 ? ', ' + (Math.ceil(pageCount / 2) + 1) + '-' : ''));
  const [perPart, setPerPart] = useState(Math.max(1, Math.min(10, pageCount - 1)));
  const [sizeMb, setSizeMb] = useState(5);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => { dialogRef.current?.querySelector<HTMLElement>('input[type="radio"]:checked')?.focus(); }, []);

  async function split() {
    const bytes = getBytes();
    if (!bytes) return;
    setWorking(true); setError('');
    try {
      let archive: Uint8Array; let parts: number; let extra = '';
      const budget = pdfPartsZipLimit();
      if (mode === 'ranges') {
        parsePageRanges(ranges, pageCount); // validate before work, with a plain message
        const result = await splitPdfByRanges(bytes, ranges, budget); archive = result.archive; parts = result.parts.length;
      } else if (mode === 'count') {
        const result = await splitPdfByPageCount(bytes, perPart, budget); archive = result.archive; parts = result.pageCounts.length;
      } else if (mode === 'bookmarks') {
        const result = await splitPdfByChapters(bytes, Math.min(budget, PDF_CHAPTER_SPLIT_MAX_OUTPUT_BYTES)); archive = result.archive; parts = result.chapters.length;
      } else {
        const result = await splitPdfBySize(bytes, Math.round(sizeMb * 1024 * 1024), budget); archive = result.archive; parts = result.parts.length;
        if (result.oversizedPages.length) extra = ` Page(s) ${result.oversizedPages.join(', ')} are larger than the limit on their own and were saved as single-page parts.`;
      }
      const base = sourceName.replace(/\.pdf$/i, '') || 'MALENJO-document';
      const saved = await exportPdfPartsZip(`${base}-split.zip`, archive);
      onDone(saved ? `Split into ${parts} PDF part(s), saved as one ZIP.${extra} The open document is unchanged.`
        : 'Split cancelled. No output was saved.');
      if (saved) onClose();
    } catch (reason) {
      setError(describePdfError(reason));
    } finally { setWorking(false); }
  }

  const titleId = `${domIdPrefix}-split-title`;
  const modeLabel: Record<Mode, string> = {
    ranges: 'Page ranges', count: 'Every N pages', bookmarks: 'By top-level bookmarks', size: 'By file size',
  };
  return <section ref={dialogRef} className="pdf-tool-dialog" role="dialog" aria-labelledby={titleId}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header>
      <h2 id={titleId}>Split PDF</h2>
      <button type="button" aria-label="Close split" title="Close split" onClick={onClose}><X size={16} aria-hidden="true"/></button>
    </header>
    <fieldset>
      <legend>Split mode</legend>
      {(Object.keys(modeLabel) as Mode[]).map((value) => <label key={value} className="pdf-tool-dialog-choice">
        <input type="radio" name={`${domIdPrefix}-split-mode`} value={value} checked={mode === value} onChange={() => setMode(value)}/>
        {modeLabel[value]}
      </label>)}
    </fieldset>
    {mode === 'ranges' && <label>Page ranges (one part each)<input aria-label="Page ranges to split" value={ranges}
      onChange={(event) => setRanges(event.target.value)} placeholder="1-3, 5, 8-"/></label>}
    {mode === 'count' && <label>Pages per part<input aria-label="Pages per part" type="number" min={1} max={pageCount}
      value={perPart} onChange={(event) => setPerPart(Math.max(1, Math.floor(Number(event.target.value) || 1)))}/></label>}
    {mode === 'bookmarks' && <p>Each top-level bookmark starts a new part.</p>}
    {mode === 'size' && <label>Maximum part size (MB)<input aria-label="Maximum part size in MB" type="number" min={0.01} step={0.5}
      value={sizeMb} onChange={(event) => setSizeMb(Math.max(0.01, Number(event.target.value) || 0.01))}/></label>}
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    <button type="button" className="primary-action" disabled={busy || working} onClick={() => void split()}>
      {working ? 'Splitting…' : 'Split and save ZIP'}
    </button>
    <small>Parts are saved as separate PDFs in one ZIP. The open document is not changed. Signed and interactive-form PDFs are refused to protect their signatures and fields.</small>
  </section>;
}
