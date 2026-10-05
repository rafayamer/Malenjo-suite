import { useRef, useState } from 'react';
import { Download, Eraser, FileSearch, ShieldCheck } from 'lucide-react';
import { inspectMetadata, sanitizeMetadata } from './metadata';
import type { MetadataRecord } from './types';
import { recordAuditEvent } from './api';

function downloadBytes(bytes: Uint8Array, name: string) {
  const owned = Uint8Array.from(bytes);
  const url = URL.createObjectURL(new Blob([owned.buffer], { type:'application/octet-stream' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function MetadataWorkspace({ onBackToFiles }:{ onBackToFiles():void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [name, setName] = useState('');
  const [metadata, setMetadata] = useState<MetadataRecord | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function openFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setNotice('');
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const next = await inspectMetadata(data, file.name);
      setBytes(data);
      setName(file.name);
      setMetadata(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function exportSanitized() {
    if (!bytes || !metadata) return;
    setError('');
    try {
      const output = await sanitizeMetadata(bytes, metadata);
      const base = name.replace(/(\.[^.]+)$/,'');
      const extension = name.match(/\.[^.]+$/)?.[0] ?? '';
      downloadBytes(output, `${base}-metadata-sanitized${extension}`);
      setNotice('Sanitized copy exported. For high-assurance PDF sanitization, use Security Center CDR.');
      await recordAuditEvent('metadata-sanitize', 'info', name, `Sanitized ${metadata.format} standard metadata fields.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function update(field: keyof Pick<MetadataRecord,'title'|'author'|'subject'|'keywords'>, value: string) {
    setMetadata((current) => current ? { ...current, [field]:value } : current);
  }

  return <div className="security-workspace">
    <input ref={inputRef} className="visually-hidden" type="file" accept=".pdf,.docx,.xlsx,.pptx" onChange={(event)=>void openFile(event)}/>
    <header className="security-toolbar">
      <button onClick={onBackToFiles}>Files</button>
      <button onClick={()=>inputRef.current?.click()}><FileSearch size={16}/> Inspect document</button>
      <button disabled={!metadata || metadata.format === 'other'} onClick={()=>void exportSanitized()}><Download size={16}/> Export sanitized copy</button>
    </header>
    {(notice || error) && <div className={error ? 'security-message error' : 'security-message'}>{error || notice}</div>}

    {!metadata
      ? <div className="security-empty"><div className="empty-icon">M</div><h1>Metadata Studio</h1><p>Inspect standard PDF or OOXML metadata locally, edit selected fields, and export a sanitized copy without modifying the original.</p><button className="primary-action" onClick={()=>inputRef.current?.click()}><FileSearch size={17}/> Choose document</button></div>
      : <div className="metadata-layout">
        <main className="metadata-card">
          <div className="security-section-title"><Eraser size={16}/> Editable metadata</div>
          {(['title','author','subject','keywords'] as const).map((field)=><label key={field}>{field}<input value={metadata[field]} onChange={(event)=>update(field,event.target.value)}/></label>)}
          <div className="metadata-readonly">
            <div><span>Format</span><b>{metadata.format.toUpperCase()}</b></div>
            <div><span>Creator</span><b>{metadata.creator || '—'}</b></div>
            <div><span>Producer</span><b>{metadata.producer || '—'}</b></div>
            <div><span>Created</span><b>{metadata.created || '—'}</b></div>
            <div><span>Modified</span><b>{metadata.modified || '—'}</b></div>
          </div>
        </main>
        <aside className="security-inspector">
          <div className="security-section-title"><ShieldCheck size={16}/> Sanitize preview</div>
          <p>Export creates a new copy. The original file remains untouched.</p>
          <ul>
            <li>Rewrites selected standard metadata fields.</li>
            <li>Clears PDF creator/producer/date fields.</li>
            <li>Removes OOXML custom property part when present.</li>
            <li>Does not claim to remove every hidden object or revision artifact.</li>
          </ul>
          {metadata.warnings.map((warning)=><div className="security-warning" key={warning}>{warning}</div>)}
        </aside>
      </div>}
  </div>;
}
