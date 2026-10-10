import {useState} from 'react';
import {invoke,isTauri} from '@tauri-apps/api/core';
import type {PdfToolProvider} from './backend';

interface LocalTsaStatus{available:boolean;message:string}
export default function PdfLocalTimestampPanel({
  sourceBytes,sourceName,provider,
}:{sourceBytes:Uint8Array;sourceName:string;provider:PdfToolProvider}){
  const [status,setStatus]=useState<LocalTsaStatus|null>(null);
  const [port,setPort]=useState('8443');
  const [path,setPath]=useState('/timestamp');
  const [authorized,setAuthorized]=useState(false);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  async function check(){
    if(!isTauri())throw new Error('Local RFC 3161 PDF timestamping requires the Tauri desktop runtime.');
    setStatus(await invoke<LocalTsaStatus>('local_tsa_status'));
  }
  async function run(){
    if(busy||!authorized||!status?.available)return;
    const portValue=Number(port);
    if(!Number.isSafeInteger(portValue)||portValue<1024||portValue>65535){
      setError('Choose local TSA port 1024–65535.');return;
    }
    if(!window.confirm(
      'Request an RFC 3161 document timestamp from ONLY a local 127.0.0.1 timestamp authority? A secure SHA-256 timestamp request will be sent to that local service, with certificate validation against your configured trusted root. The original PDF remains unchanged. Continue?'
    ))return;
    setBusy(true);setError('');setNotice('');
    try{
      if(sourceBytes.length<5||sourceBytes.length>32*1024*1024){
        throw new Error('PDF timestamp source must be at most 32 MB.');
      }
      const bytes=await invoke<number[]>('timestamp_pdf_local_tsa',{
        sourceBytes:Array.from(sourceBytes),tsaPort:portValue,tsaPath:path,
      });
      const stem=sourceName.replace(/\.pdf$/i,'').replace(/[^a-z0-9._-]/gi,'_').slice(0,90)||'document';
      const saved=await provider.saveResponse({
        status:200,contentType:'application/pdf',bytes,
      },stem+'-rfc3161-timestamped');
      setNotice(saved?'Saved trusted local RFC 3161 document-timestamp PDF copy: '+saved:
        'Timestamp export cancelled.');
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));setNotice('');}
    finally{setBusy(false);}
  }
  return <details className="stirling-component-details" aria-label="Cryptographic RFC 3161 local TSA PDF timestamp">
    <summary>RFC 3161 PDF document timestamp (optional local TSA)</summary>
    <p>Add a real signed document timestamp in a separate PDF copy using optional local pyHanko and an operator-managed RFC 3161 authority at 127.0.0.1. MALENJO_TSA_PYTHON_BIN and MALENJO_TSA_TRUST_ROOT must point to installed local Python and an explicit trusted TSA root certificate. The worker refuses off-device HTTP requests and fails unless the embedded timestamp validates cryptographically. This does not implement an internet public TSA or prove the local service has an externally audited time source.</p>
    <button type="button" disabled={busy||!isTauri()} onClick={()=>void check().catch(e=>setError(String(e)))}>Check local timestamp prerequisites</button>
    <p>{status?.message??'The optional trusted local timestamp authority has not been checked.'}</p>
    <label className="stirling-field">Loopback TSA port
      <input type="number" min="1024" max="65535" value={port} disabled={busy}
        onChange={e=>setPort(e.target.value)}/>
    </label>
    <label className="stirling-field">TSA endpoint path
      <input type="text" maxLength={120} value={path} disabled={busy}
        onChange={e=>setPath(e.target.value)}/>
    </label>
    <label className="stirling-field">
      <input type="checkbox" checked={authorized} disabled={busy} onChange={e=>setAuthorized(e.target.checked)}/>
      I authorize sending the PDF SHA-256 timestamp request to this local TSA.
    </label>
    <button type="button" disabled={busy||!status?.available||!authorized} onClick={()=>void run()}>
      Create and validate local RFC 3161 timestamp PDF
    </button>
    {error&&<p role="alert">{error}</p>}
    {notice&&<p>{notice}</p>}
  </details>;
}