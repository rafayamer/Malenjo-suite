import { useMemo, useRef, useState } from 'react';
import {
  BookOpenCheck,
  CheckCircle2,
  Clipboard,
  Download,
  ExternalLink,
  HelpCircle,
  Info,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { modules } from '../modules/registry';
import { isDesktopRuntime } from '../files/api';
import {
  buildSupportBundle,
  filterHelpGuides,
  THIRD_PARTY_NOTICE_SUMMARY,
  type ProviderDiagnostic,
  type SupportBundle,
} from './supportModel';
import {
  collectSupportRuntime,
  copySupportBundle,
  exportSupportBundle,
  type SupportRuntimeSnapshot,
} from './api';

interface Props {
  openDocumentCount: number;
}

function providerStateLabel(provider: ProviderDiagnostic): string {
  if (provider.state === 'ready') return 'Ready';
  if (provider.state === 'not-applicable') return 'Not applicable';
  if (provider.state === 'checking') return 'Checking';
  return 'Unavailable';
}

export default function HelpWorkspace({ openDocumentCount }: Props) {
  const [query,setQuery]=useState('');
  const [runtime,setRuntime]=useState<SupportRuntimeSnapshot|null>(null);
  const [bundle,setBundle]=useState<SupportBundle|null>(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const noticesRef=useRef<HTMLElement>(null);
  const guides=useMemo(()=>filterHelpGuides(query),[query]);

  function currentBundle(snapshot: SupportRuntimeSnapshot): SupportBundle {
    return buildSupportBundle({
      version:snapshot.version,
      build:snapshot.build,
      runtime:isDesktopRuntime()?'desktop':'browser',
      userAgent:navigator.userAgent,
      language:navigator.language,
      platform:navigator.platform || 'unknown',
      online:navigator.onLine,
      openDocumentCount,
      modules,
      providers:snapshot.providers,
      systemStatus:snapshot.systemStatus,
    });
  }

  async function refresh() {
    setBusy(true);
    setNotice('');
    try {
      const snapshot=await collectSupportRuntime();
      setRuntime(snapshot);
      setBundle(currentBundle(snapshot));
      setNotice('Diagnostics refreshed. No documents were opened or inspected by this check.');
    } catch(reason) {
      setNotice(`Unable to refresh diagnostics: ${reason instanceof Error?reason.message:String(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function ensureBundle():Promise<SupportBundle|null>{
    if(bundle)return bundle;
    setBusy(true);
    try{
      const snapshot=runtime??await collectSupportRuntime();
      if(!runtime)setRuntime(snapshot);
      const next=currentBundle(snapshot);
      setBundle(next);
      return next;
    }catch(reason){
      setNotice(`Unable to prepare diagnostics: ${reason instanceof Error?reason.message:String(reason)}`);
      return null;
    }finally{
      setBusy(false);
    }
  }

  async function exportBundle(){
    const value=await ensureBundle();
    if(!value)return;
    try{
      const destination=await exportSupportBundle(value);
      if(destination)setNotice(`Diagnostic bundle exported: ${destination}`);
    }catch(reason){
      setNotice(`Diagnostic export failed: ${reason instanceof Error?reason.message:String(reason)}`);
    }
  }

  async function copyBundle(){
    const value=await ensureBundle();
    if(!value)return;
    try{
      const copied=await copySupportBundle(value);
      setNotice(copied?'Diagnostic bundle copied to clipboard.':'Clipboard access is unavailable in this runtime. Use Export diagnostics instead.');
    }catch(reason){
      setNotice(`Unable to copy diagnostics: ${reason instanceof Error?reason.message:String(reason)}`);
    }
  }

  return <div className="content help-workspace">
    <div className="help-hero">
      <div>
        <p className="eyebrow">HELP / SUPPORT</p>
        <h1>Malenjo Suite help and diagnostics</h1>
        <p>Search practical guides, troubleshoot local providers and export a privacy-redacted diagnostic bundle without sending document content anywhere.</p>
      </div>
      <div className="help-hero-mark"><HelpCircle size={34}/><span>Local support tools</span></div>
    </div>

    <div className="help-search" role="search">
      <Search size={17}/>
      <input
        value={query}
        onChange={(event)=>setQuery(event.target.value)}
        placeholder="Search help: OCR, signing, keyboard, saving, Codespaces…"
        aria-label="Search MALENJO help guides"
      />
      <span>{guides.length} guide{guides.length===1?'':'s'}</span>
    </div>

    <div className="help-layout">
      <section className="help-panel" aria-labelledby="help-guides-title">
        <div className="help-panel-head"><BookOpenCheck size={18}/><div><h2 id="help-guides-title">Guides</h2><p>Task-focused help for the current MALENJO build.</p></div></div>
        <div className="help-guide-list">
          {guides.map((guide)=><details key={guide.id} className="help-guide">
            <summary><span><b>{guide.title}</b><small>{guide.summary}</small></span></summary>
            <ol>{guide.steps.map((step)=><li key={step}>{step}</li>)}</ol>
          </details>)}
          {!guides.length&&<div className="help-empty">No help guide matches “{query}”. Try a workspace or task name.</div>}
        </div>
      </section>

      <section className="help-panel" aria-labelledby="diagnostics-title">
        <div className="help-panel-head">
          <Wrench size={18}/>
          <div><h2 id="diagnostics-title">Diagnostics</h2><p>Provider and runtime checks only; no document inspection.</p></div>
          <button className="help-inline-action" disabled={busy} onClick={()=>void refresh()}>
            <RefreshCw size={14}/>{busy?'Checking…':'Refresh diagnostics'}
          </button>
        </div>

        <div className="help-diagnostic-actions">
          <button disabled={busy} onClick={()=>void copyBundle()}><Clipboard size={15}/>Copy diagnostics</button>
          <button disabled={busy} onClick={()=>void exportBundle()}><Download size={15}/>Export diagnostics</button>
        </div>

        <div className="help-privacy">
          <ShieldCheck size={17}/>
          <div><b>Privacy boundary</b><span>Bundle excludes document names, file paths, document content, OCR text, passwords, tokens and private keys by design.</span></div>
        </div>

        {runtime
          ? <div className="provider-list" aria-live="polite">
              {runtime.providers.map((provider)=><article key={provider.id} className={`provider-row ${provider.state}`}>
                <span className="provider-state-icon">{provider.state==='ready'?<CheckCircle2 size={15}/>:provider.state==='unavailable'?<TriangleAlert size={15}/>:<Info size={15}/>}</span>
                <div><b>{provider.name}</b><small>{provider.detail}</small>{provider.version&&<em>{provider.version}</em>}</div>
                <strong>{providerStateLabel(provider)}</strong>
              </article>)}
            </div>
          : <div className="help-placeholder">Run diagnostics to inspect optional local provider availability. This check does not launch heavyweight engines.</div>}
      </section>

      <section className="help-panel help-about" aria-labelledby="about-title">
        <div className="help-panel-head"><Info size={18}/><div><h2 id="about-title">About</h2><p>Product identity and current build information.</p></div></div>
        <dl>
          <div><dt>Product</dt><dd>Malenjo Suite</dd></div>
          <div><dt>Publisher / intended owner</dt><dd>Rafius Tech LLC</dd></div>
          <div><dt>Edition</dt><dd>Student / noncommercial</dd></div>
          <div><dt>Version</dt><dd>{runtime?.version??'0.1.0'}</dd></div>
          <div><dt>Build</dt><dd>{runtime?.build??'student-noncommercial'}</dd></div>
          <div><dt>Runtime</dt><dd>{isDesktopRuntime()?'Tauri desktop':'Browser / Codespaces'}</dd></div>
        </dl>
        <button className="help-notices-link" onClick={()=>noticesRef.current?.scrollIntoView({behavior:'smooth',block:'start'})}>
          Third-party notices <ExternalLink size={13}/>
        </button>
      </section>

      <section ref={noticesRef} className="help-panel help-notices" aria-labelledby="third-party-title">
        <div className="help-panel-head"><ShieldCheck size={18}/><div><h2 id="third-party-title">Third-party notices</h2><p>Current build policy and attribution boundary.</p></div></div>
        <ul>{THIRD_PARTY_NOTICE_SUMMARY.map((item)=><li key={item}>{item}</li>)}</ul>
        <p className="help-notice-copy">Customer-facing UI uses MALENJO names. Third-party engine names appear here and in diagnostics only when they are technically relevant. Release redistribution still requires exact dependency/SBOM review.</p>
        <a
          className="help-policy-link"
          href="https://github.com/rafayamer/Malenjo-suite/blob/main/docs/THIRD_PARTY_POLICY.md"
          target="_blank"
          rel="noreferrer"
        >Open repository third-party policy <ExternalLink size={13}/></a>
      </section>
    </div>

    {notice&&<div className="help-status" role="status">{notice}</div>}
  </div>;
}
