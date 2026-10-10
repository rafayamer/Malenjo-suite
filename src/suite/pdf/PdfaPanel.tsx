import {useState} from 'react';
import {invoke,isTauri} from '@tauri-apps/api/core';
import type {PdfToolProvider} from './backend';

interface PdfaProviderStatus{available:boolean;message:string}
interface PdfaOutput{bytes:number[];profile:string;verified:boolean}
export default function PdfaPanel({
  sourceBytes,sourceName,provider,
}:{sourceBytes:Uint8Array;sourceName:string;provider:PdfToolProvider}){
  const [status,setStatus]=useState<PdfaProviderStatus|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  async function refresh(){
    if(!isTauri())throw new Error('PDF/A conversion needs the desktop runtime.');
    setStatus(await invoke<PdfaProviderStatus>('pdfa_provider_status'));
  }
  async function convert(){
    if(busy||!status?.available)return;
    if(!window.confirm(
      'Create a new PDF/A-2b candidate using user-installed LibreOffice, then require independent veraPDF validation? PDF import may alter layout and lose forms or signatures. Noncompliant output will be discarded. Original PDF is unchanged. Continue?'
    ))return;
    setBusy(true);setError('');setNotice('');
    try{
      if(sourceBytes.length<5||sourceBytes.length>32*1024*1024)throw new Error('PDF/A source must be at most 32 MB.');
      const result=await invoke<PdfaOutput>('convert_validated_pdfa_2b',{
        sourceBytes:Array.from(sourceBytes),
      });
      if(!result.verified||result.profile!=='PDF/A-2b'){
        throw new Error('A separately validated PDF/A-2b result was not returned.');
      }
      const filename=sourceName.replace(/\.pdf$/i,'').replace(/[^a-z0-9._-]/gi,'_').slice(0,90)||'document';
      const saved=await provider.saveResponse({
        status:200,contentType:'application/pdf',bytes:result.bytes,
      },filename+'-pdfa-2b');
      setNotice(saved?'Saved independently veraPDF-validated PDF/A-2b copy: '+saved:
        'PDF/A export cancelled.');
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  }
  return <details className="stirling-component-details" aria-label="Verified archival PDF/A 2b conversion">
    <summary>Convert to PDF/A-2b (optional LibreOffice + veraPDF)</summary>
    <p>Requires separately installed local LibreOffice and veraPDF tools configured by MALENJO_SOFFICE_BIN and MALENJO_VERAPDF_BIN, or MALENJO_VERAPDF_JAR plus MALENJO_JAVA_BIN. LibreOffice converts the input PDF; only a PDF/A-2b output positively validated by veraPDF can be saved. This route does not silently mark an ordinary PDF as archival. PDF reimport may affect layout, fonts and interactive content; visually inspect the copy.</p>
    <button type="button" disabled={busy||!isTauri()} onClick={()=>void refresh().catch(e=>setError(String(e)))}>Check offline PDF/A conversion and validation tools</button>
    <p>{status?.message??'No standards-conformance verifier has been checked.'}</p>
    <button type="button" disabled={busy||!status?.available} onClick={()=>void convert()}>
      Convert and verify PDF/A-2b copy
    </button>
    {error&&<p role="alert">{error}</p>}
    {notice&&<p>{notice}</p>}
  </details>;
}