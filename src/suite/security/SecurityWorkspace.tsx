import { useEffect, useRef, useState } from 'react';
import { Bug, Download, FileLock2, RefreshCw, ShieldAlert, ShieldCheck, Waves } from 'lucide-react';
import { listLibraryDocuments } from '../files/api';
import type { LibraryDocument } from '../files/types';
import { clamavStatus, listAuditEvents, recordAuditEvent, scanLibraryDocument } from './api';
import { destructivePdfCdr, encryptMalenjoEnvelope, watermarkPdfPreservingContent } from './secureExport';
import type { AdapterStatus, AuditEvent, RedactionRect } from './types';

function downloadBytes(bytes: Uint8Array, name: string, type='application/octet-stream') {
  const owned = Uint8Array.from(bytes);
  const url = URL.createObjectURL(new Blob([owned.buffer], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function SecurityWorkspace({ onBackToFiles }:{ onBackToFiles():void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState('');
  const [watermark, setWatermark] = useState('CONFIDENTIAL');
  const [password, setPassword] = useState('');
  const [redactions, setRedactions] = useState<RedactionRect[]>([]);
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [selectedDocument, setSelectedDocument] = useState('');
  const [clam, setClam] = useState<AdapterStatus | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(()=>{ void refreshNative(); },[]);

  async function refreshNative() {
    const [docs, events] = await Promise.all([
      listLibraryDocuments().catch(()=>[]),
      listAuditEvents().catch(()=>[]),
    ]);
    setDocuments(docs.filter((item)=>item.available));
    setAudit(events);
    const status = await clamavStatus().catch((reason)=>({ available:false, version:'', detail:String(reason) }));
    setClam(status);
  }

  async function openFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value='';
    if(!file) return;
    setFileBytes(new Uint8Array(await file.arrayBuffer()));
    setFileName(file.name);
    setRedactions([]);
    setNotice(`Loaded ${file.name} for local security export operations.`);
    setError('');
  }

  function addRedaction() {
    setRedactions((current)=>[...current,{ page:1, x:0.1, y:0.1, width:0.35, height:0.08 }]);
  }

  function updateRedaction(index:number, field:keyof RedactionRect, value:number) {
    setRedactions((current)=>current.map((item,i)=>i===index?{...item,[field]:value}:item));
  }

  async function cdrExport() {
    if(!fileBytes || !fileName.toLowerCase().endsWith('.pdf')) return;
    setBusy(true); setError('');
    try{
      const out=await destructivePdfCdr(fileBytes,{redactions,watermark});
      downloadBytes(out,fileName.replace(/\.pdf$/i,'-cdr-redacted.pdf'),'application/pdf');
      setNotice('Destructive CDR copy exported. Pages were rasterized into a new PDF; original scripts, attachments and selectable text are not carried forward.');
      await recordAuditEvent('pdf-cdr','high',fileName,`Rasterized PDF with ${redactions.length} redaction rectangle(s).`);
      setAudit(await listAuditEvents());
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  }

  async function watermarkExport() {
    if(!fileBytes || !fileName.toLowerCase().endsWith('.pdf')) return;
    setBusy(true); setError('');
    try{
      const out=await watermarkPdfPreservingContent(fileBytes,watermark || 'MALENJO');
      downloadBytes(out,fileName.replace(/\.pdf$/i,'-watermarked.pdf'),'application/pdf');
      setNotice('Watermarked PDF copy exported. This operation preserves document content and is not a sanitization operation.');
      await recordAuditEvent('pdf-watermark','info',fileName,'Watermarked PDF copy exported.');
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  }

  async function encryptExport() {
    if(!fileBytes) return;
    setBusy(true); setError('');
    try{
      const out=await encryptMalenjoEnvelope(fileBytes,password);
      downloadBytes(out,`${fileName || 'document'}.malenjo-secure`);
      setPassword('');
      setNotice('Encrypted MALENJO AES-256-GCM envelope exported. This is not standard PDF password encryption.');
      await recordAuditEvent('secure-envelope','info',fileName,'AES-256-GCM encrypted export created.');
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  }

  async function scan() {
    if(!selectedDocument) return;
    setBusy(true); setError('');
    try{
      const result=await scanLibraryDocument(selectedDocument);
      setNotice(result.infected?`ClamAV reported an infection: ${result.output}`:`ClamAV scan clean in ${result.elapsedMs} ms.`);
      setAudit(await listAuditEvents());
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  }

  return <div className="security-workspace">
    <input ref={inputRef} className="visually-hidden" type="file" onChange={(event)=>void openFile(event)}/>
    <header className="security-toolbar">
      <button onClick={onBackToFiles}>Files</button>
      <button onClick={()=>inputRef.current?.click()}><ShieldCheck size={16}/> Open local file</button>
      <button disabled={busy} onClick={()=>void refreshNative()}><RefreshCw size={15}/> Refresh security status</button>
    </header>
    {(notice||error)&&<div className={error?'security-message error':'security-message'}>{error||notice}</div>}

    <div className="security-grid">
      <section className="security-card">
        <div className="security-section-title"><Bug size={16}/> Malware scan</div>
        <div className={clam?.available?'adapter-state ready':'adapter-state'}><b>{clam?.available?'ClamAV ready':'ClamAV optional'}</b><span>{clam?.version||clam?.detail||'Check native desktop runtime.'}</span></div>
        <select value={selectedDocument} onChange={(event)=>setSelectedDocument(event.target.value)}>
          <option value="">Choose MALENJO library document</option>
          {documents.map((document)=><option value={document.id} key={document.id}>{document.name}</option>)}
        </select>
        <button disabled={!selectedDocument||!clam?.available||busy} onClick={()=>void scan()}><ShieldAlert size={15}/> Scan selected document</button>
        <p>ClamAV executes as a bounded external process with no shell command construction. Failure or timeout does not delete the source file.</p>
      </section>

      <section className="security-card">
        <div className="security-section-title"><Waves size={16}/> PDF CDR / redaction / watermark</div>
        <p>{fileName||'Open a PDF to create a clean-room rasterized copy.'}</p>
        <label>Watermark text<input value={watermark} onChange={(event)=>setWatermark(event.target.value)}/></label>
        <button disabled={!fileBytes||!fileName.toLowerCase().endsWith('.pdf')||busy} onClick={addRedaction}>Add redaction rectangle</button>
        <div className="redaction-list">{redactions.map((rect,index)=><div key={index}>
          <b>#{index+1}</b>
          {(['page','x','y','width','height'] as const).map((field)=><label key={field}>{field}<input type="number" step={field==='page'?1:0.01} value={rect[field]} onChange={(event)=>updateRedaction(index,field,Number(event.target.value))}/></label>)}
          <button onClick={()=>setRedactions((current)=>current.filter((_,i)=>i!==index))}>Remove</button>
        </div>)}</div>
        <div className="security-actions">
          <button disabled={!fileBytes||!fileName.toLowerCase().endsWith('.pdf')||busy} onClick={()=>void cdrExport()}>CDR + redact export</button>
          <button disabled={!fileBytes||!fileName.toLowerCase().endsWith('.pdf')||busy} onClick={()=>void watermarkExport()}>Watermark only</button>
        </div>
      </section>

      <section className="security-card">
        <div className="security-section-title"><FileLock2 size={16}/> Encrypted export</div>
        <p>Create a MALENJO secure envelope around the currently opened local file.</p>
        <label>Password<input type="password" autoComplete="new-password" value={password} onChange={(event)=>setPassword(event.target.value)}/></label>
        <button disabled={!fileBytes||password.length<10||busy} onClick={()=>void encryptExport()}><Download size={15}/> Export AES-GCM envelope</button>
        <div className="security-warning">This is application-level AES-256-GCM encryption with PBKDF2 key derivation, not Acrobat-compatible PDF password encryption.</div>
      </section>

      <section className="security-card audit-card">
        <div className="security-section-title">Recent audit events</div>
        <div className="audit-list">{audit.length?audit.slice(0,12).map((event,index)=><div key={`${event.timestampMs}-${index}`}><b>{event.action}</b><span>{new Date(event.timestampMs).toLocaleString()} · {event.severity}</span><small>{event.detail}</small></div>):<p>No native security events recorded yet.</p>}</div>
      </section>
    </div>
  </div>;
}
