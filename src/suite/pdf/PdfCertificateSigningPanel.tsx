import {useEffect,useMemo,useState} from 'react';
import {isDesktopRuntime,listLibraryDocuments} from '../files/api';
import type {LibraryDocument} from '../files/types';
import {pyhankoStatus,signPdfCopy,validateSignedPdf} from '../security/api';
import type {AdapterStatus} from '../security/types';
import {eligiblePdfSigningDocuments,safePdfSigningCopyName} from './pdfCertificateSigning';

/** Reuses MALENJO's native pyHanko incremental PKCS#12 signing command.
 * A library PDF must be explicitly selected: never sign an unsaved working
 * revision by accidentally substituting the wrong disk file. */
export default function PdfCertificateSigningPanel(){
  const [documents,setDocuments]=useState<LibraryDocument[]>([]);
  const [selected,setSelected]=useState('');
  const [status,setStatus]=useState<AdapterStatus|null>(null);
  const [passphrase,setPassphrase]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const eligible=useMemo(()=>eligiblePdfSigningDocuments(documents),[documents]);
  const chosen=eligible.find(x=>x.id===selected);
  const desktop=isDesktopRuntime();
  const refresh=async()=>{
    if(!desktop)return;
    setError('');
    const [s,files]=await Promise.all([
      pyhankoStatus(),listLibraryDocuments(),
    ]);
    setStatus(s);
    setDocuments(files);
  };
  useEffect(()=>{void refresh().catch(e=>setError(String(e)));},[]);
  async function sign(){
    if(!chosen||!status?.available||busy)return;
    const secret=passphrase;
    setPassphrase('');
    if(!window.confirm(
      'Create a cryptographically signed COPY of the chosen MALENJO library PDF? Only the SAVED library document will be signed. Unsaved PDF workspace edits are NOT included. PKCS#12 identity and output PDF destination are selected in native system dialogs. No timestamp authority is contacted. Continue?'
    ))return;
    setBusy(true);setError('');setMessage('');
    try{
      const output=await signPdfCopy(chosen.id,safePdfSigningCopyName(chosen),secret);
      setMessage(output
        ?'Signed PDF copy written to the destination selected in the system save dialog. Original library PDF remains unchanged. Independently validate the signature before distribution.'
        :'Certificate signing cancelled. No output was confirmed.');
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  }
  async function validate(){
    if(!chosen||!status?.available||busy)return;
    setBusy(true);setError('');setMessage('');
    try{
      const result=await validateSignedPdf(chosen.id);
      setMessage('pyHanko validation of selected SAVED library PDF: '+result.output.slice(0,4000)+
        (result.validCommand?'':' (validator reported non-success; do not treat this signature as valid).'));
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  }
  return <details className="stirling-component-details" aria-label="PKCS12 cryptographic PDF signing">
    <summary>Sign PDF with PKCS#12 digital certificate (local optional provider)</summary>
    <p>Use the local pyHanko signing provider to produce an incremental cryptographically signed copy. Choose a saved PDF from the MALENJO library below; unsaved editor changes are not included. The signing identity is a local .p12/.pfx file. This does not add a visible signature, RFC 3161 timestamp, or certificate trust-chain verification by itself.</p>
    {!desktop?<p>Native certificate signing is available only in the desktop runtime.</p>:<>
      <div className="stirling-provider-actions">
        <button type="button" onClick={()=>void refresh().catch(e=>setError(String(e)))} disabled={busy}>Check local pyHanko and saved library PDFs</button>
      </div>
      <p>{status?.available?'Local pyHanko ready: '+status.version:
        'Local pyHanko unavailable: '+(status?.detail??'Check provider status.')}</p>
      <label className="stirling-field"><span>Saved MALENJO library PDF (not the unsaved working copy)</span>
        <select value={selected} disabled={busy} onChange={e=>setSelected(e.target.value)}>
          <option value="">Choose saved PDF to sign</option>
          {eligible.map(doc=><option value={doc.id} key={doc.id}>{doc.name}</option>)}
        </select>
      </label>
      <label className="stirling-field"><span>PKCS#12 passphrase (never saved to browser storage)</span>
        <input type="password" autoComplete="off" disabled={busy} value={passphrase}
          onChange={e=>setPassphrase(e.target.value)}/>
      </label>
      <div className="stirling-provider-actions">
        <button type="button" disabled={busy||!chosen||!status?.available}
          onClick={()=>void sign()}>Choose .p12/.pfx and sign a new PDF copy</button>
        <button type="button" disabled={busy||!chosen||!status?.available}
          onClick={()=>void validate()}>Validate selected saved PDF signature</button>
      </div>
      {error&&<p role="alert">{error}</p>}
      {message&&<p>{message}</p>}
    </>}
  </details>;
}
