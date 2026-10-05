import { useEffect, useMemo, useState } from 'react';
import {
  Archive, Database, GitBranch, HardDrive, Play, RefreshCw, Save, ShieldCheck,
  Trash2, Workflow,
} from 'lucide-react';
import { listLibraryDocuments } from '../files/api';
import type { LibraryDocument } from '../files/types';
import {
  applyAuditRetention, applyRetention, createBackupWithPicker, enterpriseNative, getEnterprisePolicy,
  inspectBackupWithPicker, kopiaSnapshot, kopiaStatus, listDmsRecords, listWorkflows,
  previewRetention, registerDmsDocument, restoreBackup, runLocalWorkflow, saveWorkflow,
  snapshotDmsRecord, startTemporalWorkflow, temporalStatus, updateDmsRetention,
  updateEnterprisePolicy,
} from './api';
import { addAuditStep, addSnapshotStep, describeStep, newWorkflow, validateWorkflow } from './contracts';
import type {
  AdapterStatus, BackupInspection, DmsRecord, EnterprisePolicy, RetentionCandidate,
  RoleProfile, WorkflowContract,
} from './types';

export type EnterpriseMode='dms'|'automation'|'backup'|'admin';

export default function EnterpriseWorkspace({mode,onBackToFiles}:{mode:EnterpriseMode;onBackToFiles():void}){
  return <div className="enterprise-workspace">
    <header className="enterprise-toolbar"><button onClick={onBackToFiles}>Files</button><div><span>ENTERPRISE LOCAL</span><b>{mode==='dms'?'DMS':mode==='automation'?'Automation Studio':mode==='backup'?'Backup / DR':'Administration'}</b></div><span className={enterpriseNative()?'enterprise-native ready':'enterprise-native'}>{enterpriseNative()?'Desktop native boundary':'Browser preview'}</span></header>
    {mode==='dms'&&<DmsPanel/>}
    {mode==='automation'&&<AutomationPanel/>}
    {mode==='backup'&&<BackupPanel/>}
    {mode==='admin'&&<AdminPanel/>}
  </div>;
}

function Message({error,notice}:{error:string;notice:string}){
  if(!error&&!notice)return null;
  return <div className={error?'enterprise-message error':'enterprise-message'}>{error||notice}</div>;
}

function DmsPanel(){
  const [documents,setDocuments]=useState<LibraryDocument[]>([]);
  const [records,setRecords]=useState<DmsRecord[]>([]);
  const [selected,setSelected]=useState('');
  const [tags,setTags]=useState('student, local');
  const [retention,setRetention]=useState(365);
  const [candidates,setCandidates]=useState<RetentionCandidate[]>([]);
  const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [notice,setNotice]=useState('');

  useEffect(()=>{void refresh();},[]);
  async function refresh(){
    setError('');
    const [docs,nextRecords]=await Promise.all([
      listLibraryDocuments().catch(()=>[]),
      listDmsRecords().catch((reason)=>{setError(String(reason));return[];}),
    ]);
    setDocuments(docs.filter((item)=>item.available));
    setRecords(nextRecords);
    setCandidates(await previewRetention().catch(()=>[]));
  }
  async function register(){
    if(!selected)return; setBusy(true);setError('');
    try{await registerDmsDocument(selected,tags.split(',').map(x=>x.trim()).filter(Boolean),retention);setNotice('Document registered in the local DMS with an immutable initial snapshot.');await refresh();}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}
  }
  async function snapshot(record:DmsRecord){
    setBusy(true);setError('');
    try{await snapshotDmsRecord(record.id,'Manual version snapshot');setNotice('New immutable DMS version created.');await refresh();}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}
  }
  async function updatePolicy(record:DmsRecord,legalHold:boolean){
    setBusy(true);setError('');
    try{await updateDmsRetention(record.id,record.retentionDays,legalHold);setNotice(legalHold?'Legal hold enabled. Retention deletion is blocked.':'Legal hold disabled.');await refresh();}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}
  }
  async function purge(){
    if(!candidates.length)return;setBusy(true);setError('');
    try{const removed=await applyRetention(candidates.map(x=>x.versionId));setNotice(`Removed ${removed} explicitly previewed expired version(s). The newest version and legal-hold records were protected.`);await refresh();}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}
  }

  return <><Message error={error} notice={notice}/><div className="enterprise-grid">
    <section className="enterprise-card"><h2><Database size={18}/> Register document</h2>
      <label>Library document<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choose document</option>{documents.map(d=><option value={d.id} key={d.id}>{d.name}</option>)}</select></label>
      <label>Tags<input value={tags} onChange={e=>setTags(e.target.value)}/></label>
      <label>Retention days<input type="number" min="0" max="36500" value={retention} onChange={e=>setRetention(Number(e.target.value))}/></label>
      <button disabled={!selected||busy||!enterpriseNative()} onClick={()=>void register()}><Archive size={15}/> Register + snapshot</button>
      {!enterpriseNative()&&<p>Native DMS persistence is available in the Tauri desktop build. Codespaces can review and test the UI/contracts.</p>}
    </section>
    <section className="enterprise-card retention-card"><h2><Trash2 size={18}/> Retention preview</h2>
      {candidates.length?candidates.map(c=><div className="retention-item" key={c.versionId}><b>{c.recordName}</b><span>{new Date(c.createdMs).toLocaleString()}</span><small>{c.reason}</small></div>):<p>No versions currently qualify for retention deletion.</p>}
      <button disabled={!candidates.length||busy} onClick={()=>void purge()}>Apply previewed retention</button>
    </section>
    <section className="enterprise-card records-card"><div className="enterprise-card-head"><h2>DMS records</h2><button onClick={()=>void refresh()}><RefreshCw size={14}/></button></div>
      <div className="dms-record-list">{records.map(record=><article key={record.id}><div><strong>{record.name}</strong><span>{record.tags.join(' · ')||'untagged'}</span></div><div className="dms-stats"><span>{record.versions.length} version(s)</span><span>{record.retentionDays}d retention</span><span>{record.legalHold?'LEGAL HOLD':'normal'}</span></div><div className="enterprise-actions"><button disabled={busy} onClick={()=>void snapshot(record)}>Snapshot</button><button disabled={busy} onClick={()=>void updatePolicy(record,!record.legalHold)}>{record.legalHold?'Release hold':'Legal hold'}</button></div><details><summary>Version history</summary>{record.versions.slice().reverse().map(v=><p key={v.id}><b>{new Date(v.createdMs).toLocaleString()}</b> · {v.sizeBytes} bytes · <code>{v.sha256.slice(0,16)}…</code><br/>{v.note}</p>)}</details></article>)}</div>
    </section>
  </div></>;
}

function AutomationPanel(){
  const [records,setRecords]=useState<DmsRecord[]>([]);
  const [workflows,setWorkflows]=useState<WorkflowContract[]>([]);
  const [contract,setContract]=useState<WorkflowContract>(()=>newWorkflow('Document review workflow'));
  const [note,setNote]=useState('Review checkpoint');
  const [recordId,setRecordId]=useState('');
  const [temporal,setTemporal]=useState<AdapterStatus|null>(null);
  const [busy,setBusy]=useState(false);const[error,setError]=useState('');const[notice,setNotice]=useState('');

  useEffect(()=>{void refresh();},[]);
  async function refresh(){
    const [r,w,t]=await Promise.all([listDmsRecords().catch(()=>[]),listWorkflows().catch(()=>[]),temporalStatus().catch(()=>null)]);
    setRecords(r);setWorkflows(w);setTemporal(t);
  }
  async function persist(){
    const errors=validateWorkflow(contract);if(errors.length){setError(errors.join(' '));return;}
    setBusy(true);setError('');
    try{const saved=await saveWorkflow(contract);setContract(saved);setNotice('Workflow contract saved locally.');await refresh();}catch(reason){setError(String(reason));}finally{setBusy(false);}
  }
  async function run(id:string,external=false){
    setBusy(true);setError('');
    try{
      if(external){await startTemporalWorkflow(id);setNotice('Temporal workflow start command completed on fixed loopback endpoint.');}
      else{const result=await runLocalWorkflow(id);setNotice(result.messages.join(' '));}
    }catch(reason){setError(String(reason));}finally{setBusy(false);}
  }
  return <><Message error={error} notice={notice}/><div className="enterprise-grid">
    <section className="enterprise-card workflow-builder"><h2><Workflow size={18}/> Workflow contract</h2>
      <label>Name<input value={contract.name} onChange={e=>setContract({...contract,name:e.target.value})}/></label>
      <label>Step note<input value={note} onChange={e=>setNote(e.target.value)}/></label>
      <div className="enterprise-actions"><button onClick={()=>setContract(addAuditStep(contract,note))}>Add audit step</button><select value={recordId} onChange={e=>setRecordId(e.target.value)}><option value="">DMS record</option>{records.map(r=><option value={r.id} key={r.id}>{r.name}</option>)}</select><button disabled={!recordId} onClick={()=>{try{setContract(addSnapshotStep(contract,recordId,note));}catch(reason){setError(String(reason));}}}>Add snapshot</button></div>
      <ol className="workflow-steps">{contract.steps.map((step,index)=><li key={index}>{describeStep(step)}<button onClick={()=>setContract({...contract,steps:contract.steps.filter((_,i)=>i!==index)})}>×</button></li>)}</ol>
      <button disabled={busy||!enterpriseNative()} onClick={()=>void persist()}><Save size={15}/> Save workflow</button>
    </section>
    <section className="enterprise-card"><h2><GitBranch size={18}/> Temporal adapter</h2>
      <div className={temporal?.available?'adapter-state ready':'adapter-state'}><b>{temporal?.available?'Temporal CLI ready':'Temporal optional'}</b><span>{temporal?.version||temporal?.detail||'Fixed loopback target: 127.0.0.1:7233'}</span></div>
      <p>MALENJO sends only the saved workflow contract ID/steps to a fixed local Temporal endpoint. A compatible <code>MalenjoDocumentWorkflow</code> worker must already be running.</p>
    </section>
    <section className="enterprise-card records-card"><h2>Saved workflows</h2>{workflows.map(w=><article key={w.id}><strong>{w.name}</strong><span>{w.steps.length} step(s)</span><div className="enterprise-actions"><button disabled={busy} onClick={()=>void run(w.id)}><Play size={14}/> Run local</button><button disabled={busy||!temporal?.available} onClick={()=>void run(w.id,true)}>Start in Temporal</button></div></article>)}</section>
  </div></>;
}

function BackupPanel(){
  const [kopia,setKopia]=useState<AdapterStatus|null>(null);
  const [inspection,setInspection]=useState<BackupInspection|null>(null);
  const [backupPath,setBackupPath]=useState('');
  const [busy,setBusy]=useState(false);const[error,setError]=useState('');const[notice,setNotice]=useState('');
  useEffect(()=>{void kopiaStatus().then(setKopia).catch(()=>setKopia(null));},[]);
  async function create(){
    setBusy(true);setError('');try{const path=await createBackupWithPicker();if(path){setBackupPath(path);setNotice(`Verified offline backup created at ${path}`);}}catch(reason){setError(String(reason));}finally{setBusy(false);}
  }
  async function inspect(){
    setBusy(true);setError('');try{const result=await inspectBackupWithPicker();if(result){setBackupPath(result.path);setInspection(result.inspection);setNotice(result.inspection.valid?'Backup integrity verified.':'Backup failed integrity validation.');}}catch(reason){setError(String(reason));}finally{setBusy(false);}
  }
  async function restore(){
    if(!backupPath)return;setBusy(true);setError('');try{await restoreBackup(backupPath);setNotice('Verified backup restored. A recovery copy of the prior enterprise/security state was retained in app data.');}catch(reason){setError(String(reason));}finally{setBusy(false);}
  }
  async function snapshotKopia(){
    setBusy(true);setError('');try{await kopiaSnapshot();setNotice('Kopia snapshot command completed.');}catch(reason){setError(String(reason));}finally{setBusy(false);}
  }
  return <><Message error={error} notice={notice}/><div className="enterprise-grid">
    <section className="enterprise-card"><h2><HardDrive size={18}/> Offline backup</h2><p>Creates a directory backup of MALENJO enterprise/security app state, hashes every file and refuses to report success if verification fails.</p><div className="enterprise-actions"><button disabled={busy||!enterpriseNative()} onClick={()=>void create()}>Create verified backup</button><button disabled={busy||!enterpriseNative()} onClick={()=>void inspect()}>Inspect backup</button></div>{inspection&&<div className={inspection.valid?'backup-status ready':'backup-status'}><b>{inspection.valid?'VALID':'INVALID'}</b><span>{inspection.fileCount} files · {inspection.totalBytes} bytes</span>{inspection.errors.map(e=><small key={e}>{e}</small>)}</div>}<button disabled={!inspection?.valid||!backupPath||busy} onClick={()=>void restore()}>Restore verified backup</button></section>
    <section className="enterprise-card"><h2>Kopia adapter</h2><div className={kopia?.available?'adapter-state ready':'adapter-state'}><b>{kopia?.available?'Kopia ready':'Kopia optional'}</b><span>{kopia?.version||kopia?.detail||'External repository must already be configured.'}</span></div><button disabled={!kopia?.available||busy} onClick={()=>void snapshotKopia()}>Snapshot enterprise state with Kopia</button><p>Kopia credentials/repository configuration are not stored by this UI. Restore-to-explicit-directory is available through the native adapter.</p></section>
    <section className="enterprise-card records-card"><h2>Restore safety</h2><ul><li>Manifest and every SHA-256 are verified before live state changes.</li><li>Current enterprise/security state is copied into a recovery directory first.</li><li>Only MALENJO app-data state is restored; user documents are never deleted.</li><li>On replacement failure MALENJO attempts recovery from the pre-restore copy.</li></ul></section>
  </div></>;
}

function AdminPanel(){
  const [policy,setPolicy]=useState<EnterprisePolicy|null>(null);
  const [profiles,setProfiles]=useState<RoleProfile[]>([]);
  const [retention,setRetention]=useState(365);const[auditDays,setAuditDays]=useState(365);
  const [error,setError]=useState('');const[notice,setNotice]=useState('');const[busy,setBusy]=useState(false);
  useEffect(()=>{void refresh();},[]);
  async function refresh(){
    try{const [p,r]=await getEnterprisePolicy();setPolicy(p);setProfiles(r);setRetention(p.defaultRetentionDays);setAuditDays(p.auditRetentionDays);}catch(reason){setError(String(reason));}
  }
  async function save(){
    if(!policy)return;setBusy(true);setError('');try{const next=await updateEnterprisePolicy(policy.currentRole,retention,auditDays);setPolicy(next);setNotice('Shared enterprise policy updated.');}catch(reason){setError(String(reason));}finally{setBusy(false);}
  }
  async function rotateAudit(){
    setBusy(true);setError('');try{const result=await applyAuditRetention();setNotice(`Audit retention archived ${result.archived} old event(s) and kept ${result.kept}.`);}catch(reason){setError(String(reason));}finally{setBusy(false);}
  }
  return <><Message error={error} notice={notice}/><div className="enterprise-grid">
    <section className="enterprise-card"><h2><ShieldCheck size={18}/> Shared policy</h2>{policy?<><label>Active local role<input value={policy.currentRole} disabled/></label><label>Default DMS retention days<input type="number" min="0" max="36500" value={retention} onChange={e=>setRetention(Number(e.target.value))}/></label><label>Audit retention target days<input type="number" min="0" max="36500" value={auditDays} onChange={e=>setAuditDays(Number(e.target.value))}/></label><div className="enterprise-actions"><button disabled={busy} onClick={()=>void save()}><Save size={15}/> Save policy</button><button disabled={busy} onClick={()=>void rotateAudit()}>Apply audit retention</button></div></>:<p>Native policy unavailable.</p>}<div className="security-warning">Phase 7 uses a single local active role for policy enforcement. Multi-user identity binding arrives with the future identity provider layer; the UI does not allow lowering the active role and accidentally locking out the local owner.</div></section>
    <section className="enterprise-card records-card"><h2>Role permissions</h2><div className="role-grid">{profiles.map(profile=><article key={profile.role}><strong>{profile.role}</strong>{profile.permissions.map(permission=><span key={permission}>{permission}</span>)}</article>)}</div></section>
  </div></>;
}
