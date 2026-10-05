import { useEffect, useState } from 'react';
import { FileSignature, RefreshCw, ShieldCheck } from 'lucide-react';
import { listLibraryDocuments } from '../files/api';
import type { LibraryDocument } from '../files/types';
import { pyhankoStatus, signPdfCopy, validateSignedPdf } from './api';
import type { AdapterStatus, SignatureValidationResult } from './types';

export default function SignWorkspace({ onBackToFiles }:{ onBackToFiles():void }) {
  const [documents,setDocuments]=useState<LibraryDocument[]>([]);
  const [selected,setSelected]=useState('');
  const [status,setStatus]=useState<AdapterStatus|null>(null);
  const [validation,setValidation]=useState<SignatureValidationResult|null>(null);
  const [passphrase,setPassphrase]=useState('');
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');

  useEffect(()=>{void refresh();},[]);

  async function refresh(){
    const [docs,nextStatus]=await Promise.all([
      listLibraryDocuments().catch(()=>[]),
      pyhankoStatus().catch((reason)=>({available:false,version:'',detail:String(reason)})),
    ]);
    setDocuments(docs.filter((item)=>item.available&&item.kind==='pdf'));
    setStatus(nextStatus);
  }

  async function validate(){
    if(!selected)return;
    setBusy(true);setError('');setValidation(null);
    try{setValidation(await validateSignedPdf(selected));}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  }

  async function sign(){
    const document=documents.find((item)=>item.id===selected);
    if(!document)return;
    setBusy(true);setError('');
    try{
      const ok=await signPdfCopy(document.id,document.name,passphrase);
      setPassphrase('');
      if(ok)setNotice('Signed PDF copy created. The original library document was not modified.');
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));setPassphrase('');}
    finally{setBusy(false);}
  }

  return <div className="security-workspace">
    <header className="security-toolbar"><button onClick={onBackToFiles}>Files</button><button disabled={busy} onClick={()=>void refresh()}><RefreshCw size={15}/> Refresh pyHanko</button></header>
    {(notice||error)&&<div className={error?'security-message error':'security-message'}>{error||notice}</div>}
    <div className="sign-layout">
      <section className="security-card">
        <div className="security-section-title"><FileSignature size={16}/> PDF signing</div>
        <div className={status?.available?'adapter-state ready':'adapter-state'}><b>{status?.available?'pyHanko ready':'pyHanko optional'}</b><span>{status?.version||status?.detail||'Install pyHanko 0.37.x in the desktop Python environment.'}</span></div>
        <label>Library PDF<select value={selected} onChange={(event)=>{setSelected(event.target.value);setValidation(null);}}>
          <option value="">Choose PDF</option>{documents.map((document)=><option value={document.id} key={document.id}>{document.name}</option>)}
        </select></label>
        <label>PKCS#12 passphrase<input type="password" autoComplete="off" value={passphrase} onChange={(event)=>setPassphrase(event.target.value)}/></label>
        <button disabled={!status?.available||!selected||busy} onClick={()=>void validate()}><ShieldCheck size={15}/> Validate signatures</button>
        <button disabled={!status?.available||!selected||busy} onClick={()=>void sign()}><FileSignature size={15}/> Create signed copy</button>
        <div className="security-warning">The passphrase is placed in a native ephemeral zeroizing store, consumed once, and supplied to the pyHanko worker through stdin. It is not placed in Git, localStorage, or command-line arguments.</div>
      </section>
      <section className="security-card signature-output">
        <div className="security-section-title">Validation output</div>
        {validation?<><div className={validation.validCommand?'validation-badge ready':'validation-badge'}>{validation.validCommand?'pyHanko completed':'Validation reported problems'} · {validation.elapsedMs} ms</div><pre>{validation.output||'No textual validation output.'}</pre></>:<p>Choose a library PDF and run validation. Trust/revocation conclusions remain subject to the pyHanko trust configuration and available validation data.</p>}
      </section>
    </div>
  </div>;
}
