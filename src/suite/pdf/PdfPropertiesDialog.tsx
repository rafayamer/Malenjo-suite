import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { STANDARD_INFO_KEYS, clearPdfDocumentInfo, readPdfDocumentInfo, writePdfDocumentInfo, type PdfDocumentInfo } from './pdfDocumentInfo';
import { describePdfError } from './pdfUserErrors';

type Operation = (latest: Uint8Array) => Promise<{ bytes: Uint8Array; summary: string }>;
interface Props {
  domIdPrefix: string;
  /** The current working bytes; the dialog re-reads properties when they change. */
  bytes: Uint8Array;
  busy: boolean;
  onApply(label: string, operation: Operation): Promise<boolean>;
  onClose(): void;
}

const LABELS: Record<(typeof STANDARD_INFO_KEYS)[number], string> = {
  Title: 'Title', Author: 'Author', Subject: 'Subject', Keywords: 'Keywords', Creator: 'Creator application', Producer: 'PDF producer',
};

/** MAL-021: inspect, edit, clear and save Info dictionary and XMP metadata. */
export default function PdfPropertiesDialog({ domIdPrefix, bytes, busy, onApply, onClose }: Props) {
  const [info, setInfo] = useState<PdfDocumentInfo | null>(null);
  const [standard, setStandard] = useState<PdfDocumentInfo['standard'] | null>(null);
  const [custom, setCustom] = useState<[string, string][]>([]);
  const [xmp, setXmp] = useState<'sync' | 'remove'>('sync');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let live = true;
    readPdfDocumentInfo(bytes).then((value) => {
      if (!live) return;
      setInfo(value); setStandard(value.standard); setCustom(value.custom); setError('');
    }).catch((reason) => { if (live) setError(describePdfError(reason)); });
    return () => { live = false; };
  }, [bytes]);
  useEffect(() => { if (standard) dialogRef.current?.querySelector<HTMLElement>('input')?.focus(); }, [!!standard]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(label: string, operation: Operation) {
    setWorking(true); setError('');
    try { await onApply(label, operation); } catch (reason) { setError(describePdfError(reason)); } finally { setWorking(false); }
  }
  const save = () => standard && run('Saved document properties.', async (latest) => ({
    bytes: await writePdfDocumentInfo(latest, { standard, custom: custom.filter(([key]) => key.trim()), xmp, now: new Date() }),
    summary: xmp === 'sync' ? 'Saved document properties and matching XMP metadata.' : 'Saved document properties; XMP metadata removed.',
  }));
  const clear = () => { if (window.confirm('Remove every document property, including dates and XMP metadata? Undo can restore them.')) void run('Cleared document properties.', async (latest) => ({ bytes: await clearPdfDocumentInfo(latest), summary: 'Cleared all document properties and XMP metadata.' })); };

  const titleId = `${domIdPrefix}-properties-title`;
  return <section ref={dialogRef} className="pdf-tool-dialog" role="dialog" aria-labelledby={titleId}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header>
      <h2 id={titleId}>Document properties</h2>
      <button type="button" aria-label="Close document properties" title="Close" onClick={onClose}><X size={16} aria-hidden="true"/></button>
    </header>
    {!standard && !error && <p role="status">Reading properties…</p>}
    {standard && info && <>
      <fieldset>
        <legend>Standard properties</legend>
        {STANDARD_INFO_KEYS.map((key) => <label key={key}>{LABELS[key]}<input aria-label={LABELS[key]} value={standard[key]}
          onChange={(e) => setStandard({ ...standard, [key]: e.target.value })}/></label>)}
        <p>Created {info.creationDate ?? '—'} · Modified {info.modDate ?? '—'}</p>
      </fieldset>
      <fieldset>
        <legend>Custom properties</legend>
        {custom.map(([key, value], index) => <div key={index} className="pdf-properties-row">
          <input aria-label={`Custom property ${index + 1} name`} value={key} onChange={(e) => setCustom(custom.map((row, i) => i === index ? [e.target.value, row[1]] : row))}/>
          <input aria-label={`Custom property ${index + 1} value`} value={value} onChange={(e) => setCustom(custom.map((row, i) => i === index ? [row[0], e.target.value] : row))}/>
          <button type="button" aria-label={`Remove custom property ${index + 1}`} onClick={() => setCustom(custom.filter((_, i) => i !== index))}><X size={14} aria-hidden="true"/></button>
        </div>)}
        <button type="button" onClick={() => setCustom([...custom, ['', '']])}><Plus size={14} aria-hidden="true"/> Add custom property</button>
      </fieldset>
      <fieldset>
        <legend>XMP metadata</legend>
        <p>{info.xmp ? `This PDF has XMP metadata (${info.xmp.length.toLocaleString()} characters)${info.xmpFields.title !== undefined && info.xmpFields.title !== info.standard.Title ? '; its title differs from the document title.' : '.'}` : 'This PDF has no XMP metadata.'}</p>
        {info.xmp && <details><summary>Show XMP</summary><pre className="pdf-properties-xmp">{info.xmp}</pre></details>}
        <label>When saving<select aria-label="XMP metadata when saving" value={xmp} onChange={(e) => setXmp(e.target.value as 'sync' | 'remove')}>
          <option value="sync">Write XMP that matches these properties</option><option value="remove">Remove XMP metadata</option></select></label>
      </fieldset>
    </>}
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    <div className="pdf-tool-dialog-actions">
      <button type="button" disabled={busy || working || !standard} onClick={clear}>Clear all properties</button>
      <button type="button" className="primary-action" disabled={busy || working || !standard} onClick={() => void save()}>{working ? 'Saving…' : 'Save properties'}</button>
    </div>
    <small>Changes apply to the working copy; Undo restores the earlier properties. Signed or certified PDFs are refused so their signatures stay valid.</small>
  </section>;
}
