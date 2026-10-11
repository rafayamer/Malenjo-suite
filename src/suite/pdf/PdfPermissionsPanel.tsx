import {useEffect,useMemo,useState} from 'react';
import type {PdfToolProvider,PdfProviderComponentStatus} from './backend';
import {listLibraryDocuments,isDesktopRuntime} from '../files/api';
import type {LibraryDocument} from '../files/types';
import {eligiblePdfSigningDocuments} from './pdfCertificateSigning';
import {changePdfPermissionsCopy,type PdfPermissionSettings} from '../security/api';

export default function PdfPermissionsPanel({provider}:{provider:PdfToolProvider}){
  const [components,setComponents]=useState<PdfProviderComponentStatus[]>([]);
  const [docs,setDocs]=useState<LibraryDocument[]>([]);
  const [selected,setSelected]=useState('');
  const [owner,setOwner]=useState('');
  const [user,setUser]=useState('');
  const [settings,setSettings]=useState<PdfPermissionSettings>({
    printing:'none',modification:'none',allowCopy:false,allowAnnotate:false,allowFormFill:false,
  });
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const documents=useMemo(()=>eligiblePdfSigningDocuments(docs),[docs]);
  const doc=documents.find(x=>x.id===selected);
  const ready=components.some(x=>x.id==='qpdf'&&x.available);
  const refresh=async()=>{
    if(!isDesktopRuntime())return;
    const [list,status]=await Promise.all([listLibraryDocuments(),provider.componentStatus()]);
    setDocs(list);setComponents(status);
  };
  useEffect(()=>{void refresh().catch(e=>setError(String(e)));},[provider]);
  async function execute(){
    if(!doc||!ready||busy)return;
    const ownerPass=owner,userPass=user;
    setOwner('');setUser('');
    if(!window.confirm(
      'Create a NEW AES-256 PDF with owner/user passwords and reader permission flags? Viewers can ignore restrictions. Original saved library PDF remains unchanged; unsaved editor changes are not included. This rewrites the PDF and may invalidate existing signatures. Proceed?'
    ))return;
    setBusy(true);setError('');setNotice('');
    try{
      const saved=await changePdfPermissionsCopy(doc.id,doc.name,ownerPass,userPass,settings);
      setNotice(saved?'Saved a new AES-256 PDF permissions copy through local qpdf. Reader enforcement varies by viewer. Original preserved.':
        'Permission export cancelled.');
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  const update=<K extends keyof PdfPermissionSettings>(key:K,value:PdfPermissionSettings[K])=>
    setSettings(s=>({...s,[key]:value}));
  return <details className="stirling-component-details" aria-label="Native PDF owner and viewer permission settings">
    <summary>Change PDF viewer permissions (local qpdf)</summary>
    <p>Choose an existing SAVED PDF from the MALENJO library. The local reviewed qpdf 12.x binary writes a distinct AES-256-encrypted PDF with print, copy, modify, comment and form-fill flags. The original PDF remains unchanged. These are reader permission hints, NOT unbreakable DRM. Requires the optional qpdf pack.</p>
    {!isDesktopRuntime()?<p>Desktop runtime required.</p>:<>
      <button type="button" disabled={busy} onClick={()=>void refresh().catch(e=>setError(String(e)))}>Refresh local qpdf and saved PDFs</button>
      <p>{ready?'Reviewed local qpdf is available.':'No reviewed local qpdf pack is currently available.'}</p>
      <label className="stirling-field">Saved source PDF
        <select value={selected} disabled={busy} onChange={e=>setSelected(e.target.value)}>
          <option value="">Choose a saved PDF</option>
          {documents.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}
        </select>
      </label>
      <label className="stirling-field">Owner password (10–128 characters)
        <input type="password" autoComplete="new-password" value={owner} disabled={busy}
          onChange={e=>setOwner(e.target.value)}/>
      </label>
      <label className="stirling-field">User/open password (optional; distinct from owner)
        <input type="password" autoComplete="new-password" value={user} disabled={busy}
          onChange={e=>setUser(e.target.value)}/>
      </label>
      <label className="stirling-field">Printing
        <select value={settings.printing} disabled={busy} onChange={e=>update('printing',e.target.value as PdfPermissionSettings['printing'])}>
          <option value="none">None</option><option value="low">Low-resolution only</option><option value="full">Full</option>
        </select>
      </label>
      <label className="stirling-field">Modification
        <select value={settings.modification} disabled={busy} onChange={e=>update('modification',e.target.value as PdfPermissionSettings['modification'])}>
          <option value="none">None</option><option value="assembly">Assemble</option><option value="form">Form</option><option value="annotate">Annotate</option><option value="all">Full editing</option>
        </select>
      </label>
      {([
        ['allowCopy','Permit text/image extraction'],
        ['allowAnnotate','Permit annotations'],
        ['allowFormFill','Permit form filling'],
      ] as const).map(([key,label])=><label key={key} className="stirling-field">
        <input type="checkbox" checked={settings[key]} disabled={busy}
          onChange={e=>update(key,e.target.checked)}/>{label}
      </label>)}
      <button type="button" disabled={busy||!ready||!doc||owner.length<10}
        onClick={()=>void execute()}>Save new PDF with viewer permission flags</button>
      {error&&<p role="alert">{error}</p>}
      {notice&&<p>{notice}</p>}
    </>}
  </details>;
}
