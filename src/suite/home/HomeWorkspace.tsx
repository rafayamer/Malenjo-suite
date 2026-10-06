import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot, FileSpreadsheet, FileText, FolderOpen, MapPin, MoreHorizontal,
  Presentation, ScanLine, Search, ShieldCheck, Sparkles, Star, Workflow,
} from 'lucide-react';
import packageJson from '../../../package.json';
import type { ModuleId } from '../core/types';
import { isDesktopRuntime, listLibraryDocuments, openLibraryDocument } from '../files/api';
import { listBrowserDocuments, markBrowserDocumentOpened } from '../files/browserStore';
import type { DocumentSession } from '../files/session';
import type { LibraryDocument } from '../files/types';
import { browsePinnedFolder, choosePinnedFolder } from './api';
import {
  HOME_PRIMARY_ACTIONS, addPinnedLocation, groupRecentDocuments,
  matchesHomeFileFilter, pruneMissingStarredDocuments, removePinnedLocation,
  sortRecentDocuments, toggleStarredDocument,
  type HomeFileFilter, type HomePinnedLocation, type HomeStateV1,
} from './model';
import { loadHomeState, saveHomeState } from './storage';
import {
  OfficeActionCard, OfficeContextMenu, OfficeRecentCard,
  OfficeSearchInput, OfficeSegmentedFilter,
} from './CasualOfficeUi';

/**
 * Home launcher structure is source-adapted from CasualOffice/desktop
 * (Apache-2.0), pinned in third_party/casualoffice/PROVENANCE.md.
 * MALENJO keeps its own shell, document/session model and product branding.
 */
interface Props {
  sessions: DocumentSession[];
  activeSessionId: string | null;
  onSelectModule(id: ModuleId): void;
  onActivateSession(sessionId: string): void;
  onOpenDocument(document: LibraryDocument): void;
  onOpenDocuments(): void | Promise<void>;
  onOpenCommandPalette(): void;
}

const ACTION_ICONS={
  open:FolderOpen, document:FileText, spreadsheet:FileSpreadsheet,
  presentation:Presentation, pdf:FileText, scan:ScanLine, ocr:Search, ai:Sparkles,
} as const;

const FILTERS:Array<{value:HomeFileFilter;label:string}>=[
  {value:'all',label:'All'},
  {value:'pdf',label:'PDF'},
  {value:'documents',label:'Documents'},
  {value:'sheets',label:'Sheets'},
  {value:'slides',label:'Slides'},
  {value:'images',label:'Images'},
  {value:'other',label:'Other'},
];

function actionTone(id:string):'document'|'sheets'|'slides'|'pdf'|'scan'|'ai'|'neutral'{
  if(id==='document')return 'document';
  if(id==='spreadsheet')return 'sheets';
  if(id==='presentation')return 'slides';
  if(id==='pdf')return 'pdf';
  if(id==='scan'||id==='ocr')return 'scan';
  if(id==='ai')return 'ai';
  return 'neutral';
}

function fileTone(document:LibraryDocument):'document'|'sheets'|'slides'|'pdf'|'image'|'other'{
  if(document.kind==='docx')return 'document';
  if(document.kind==='xlsx')return 'sheets';
  if(document.kind==='pptx')return 'slides';
  if(document.kind==='pdf')return 'pdf';
  if(document.kind==='image')return 'image';
  return 'other';
}

function typeLabel(document:LibraryDocument):string{
  if(document.kind==='docx')return 'DOCX';
  if(document.kind==='xlsx')return 'XLSX';
  if(document.kind==='pptx')return 'PPTX';
  return document.kind.toUpperCase();
}

function timeLabel(timestamp:number|null):string{
  if(!timestamp)return 'Added to library';
  const now=Date.now();
  const delta=Math.max(0,now-timestamp);
  const mins=Math.floor(delta/60000);
  if(mins<1)return 'Just now';
  if(mins<60)return `${mins} min ago`;
  const hours=Math.floor(mins/60);
  if(hours<24)return `${hours} hr${hours===1?'':'s'} ago`;
  const days=Math.floor(hours/24);
  if(days<7)return `${days} day${days===1?'':'s'} ago`;
  return new Intl.DateTimeFormat(undefined,{dateStyle:'medium'}).format(new Date(timestamp));
}

function saveState(next:HomeStateV1,setState:(state:HomeStateV1)=>void,setNotice:(value:string)=>void){
  setState(next);
  const result=saveHomeState(next);
  if(!result.ok&&result.error)setNotice(result.error);
}

export default function HomeWorkspace({
  sessions,activeSessionId,onSelectModule,onActivateSession,onOpenDocument,
  onOpenDocuments,onOpenCommandPalette,
}:Props){
  const desktop=isDesktopRuntime();
  const [documents,setDocuments]=useState<LibraryDocument[]>([]);
  const [state,setState]=useState<HomeStateV1>(()=>loadHomeState());
  const [query,setQuery]=useState('');
  const [filter,setFilter]=useState<HomeFileFilter>('all');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [menuDocumentId,setMenuDocumentId]=useState<string|null>(null);

  const loadDocuments=useCallback(async()=>{
    setLoading(true);
    try{
      const next=desktop?await listLibraryDocuments():listBrowserDocuments();
      setDocuments(next);
      setState((current)=>{
        const pruned=pruneMissingStarredDocuments(current,next);
        if(pruned!==current)saveHomeState(pruned);
        return pruned;
      });
      setNotice('');
    }catch(reason){
      setDocuments([]);
      setNotice(`Home could not load the document library: ${reason instanceof Error?reason.message:String(reason)}`);
    }finally{setLoading(false);}
  },[desktop]);

  useEffect(()=>{void loadDocuments();},[loadDocuments,sessions.length]);

  const searched=useMemo(()=>{
    const terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return sortRecentDocuments(documents).filter((document)=>{
      if(!matchesHomeFileFilter(document,filter))return false;
      if(!terms.length)return true;
      const haystack=[document.name,document.extension,document.kind,document.locationLabel].join(' ').toLowerCase();
      return terms.every((term)=>haystack.includes(term));
    });
  },[documents,filter,query]);

  const pinnedDocuments=useMemo(()=>{
    const byId=new Map(searched.map((document)=>[document.id,document]));
    return state.starredDocumentIds.map((id)=>byId.get(id)).filter((document):document is LibraryDocument=>Boolean(document));
  },[searched,state.starredDocumentIds]);

  const recentGroups=useMemo(()=>{
    const pinned=new Set(state.starredDocumentIds);
    return groupRecentDocuments(searched.filter((document)=>!pinned.has(document.id)));
  },[searched,state.starredDocumentIds]);

  const continueSessions=useMemo(()=>[...sessions].sort((a,b)=>b.openedAt-a.openedAt).slice(0,4),[sessions]);

  function toggleStar(documentId:string){
    saveState(toggleStarredDocument(state,documentId),setState,setNotice);
    setMenuDocumentId(null);
  }

  async function openDocument(document:LibraryDocument){
    setMenuDocumentId(null);
    if(!document.available){
      setNotice(`“${document.name}” is no longer available at its indexed location. Use Files / Library to refresh it.`);
      return;
    }
    setBusy(true);
    try{
      const opened=desktop?await openLibraryDocument(document.id):markBrowserDocumentOpened(document);
      onOpenDocument(opened);
    }catch(reason){
      setNotice(`Unable to open “${document.name}”: ${reason instanceof Error?reason.message:String(reason)}`);
      await loadDocuments();
    }finally{setBusy(false);}
  }

  async function addPinnedFolder(){
    if(!desktop){
      setNotice('Pinned local folders are available in the Windows desktop runtime. Browser/Codespaces files remain session-only.');
      return;
    }
    try{
      const location=await choosePinnedFolder();
      if(!location)return;
      saveState(addPinnedLocation(state,location),setState,setNotice);
      setNotice(`Pinned ${location.label} to Home.`);
    }catch(reason){
      setNotice(`Unable to pin this folder: ${reason instanceof Error?reason.message:String(reason)}`);
    }
  }

  async function browseLocation(location:HomePinnedLocation){
    setBusy(true);
    try{
      const result=await browsePinnedFolder(location);
      if(!result)return;
      for(const document of result.documents){
        const opened=await openLibraryDocument(document.id);
        onOpenDocument(opened);
      }
      if(result.errors.length)setNotice(`Opened ${result.documents.length} document(s); ${result.errors.length} selected file(s) could not be added.`);
    }catch(reason){
      setNotice(`Unable to browse ${location.label}: ${reason instanceof Error?reason.message:String(reason)}`);
    }finally{setBusy(false);}
  }

  function removeLocation(id:string){
    saveState(removePinnedLocation(state,id),setState,setNotice);
  }

  function renderDocumentCard(document:LibraryDocument,pinned:boolean){
    return <div className="ml-home-recent-wrap" key={document.id}>
      <OfficeRecentCard
        name={document.name}
        path={document.locationLabel}
        time={timeLabel(document.lastOpenedMs??document.addedMs)}
        kindLabel={typeLabel(document)}
        tone={fileTone(document)}
        pinned={pinned}
        unavailable={!document.available}
        disabled={!document.available||busy}
        onClick={()=>void openDocument(document)}
      />
      <button
        className="ml-home-more"
        aria-label={`More actions for ${document.name}`}
        aria-expanded={menuDocumentId===document.id}
        onClick={()=>setMenuDocumentId((current)=>current===document.id?null:document.id)}
      ><MoreHorizontal size={15}/></button>
      {menuDocumentId===document.id&&<OfficeContextMenu
        className="ml-home-file-menu"
        items={[
          {label:'Open',disabled:!document.available,onSelect:()=>void openDocument(document)},
          {label:pinned?'Unpin from Home':'Pin to Home',onSelect:()=>toggleStar(document.id)},
          {label:'Open Files / Library',onSelect:()=>{setMenuDocumentId(null);onSelectModule('files');}},
        ]}
      />}
    </div>;
  }

  return <div className="content home-start-center ml-co-launcher">
    <header className="ml-co-home-head">
      <div>
        <p className="eyebrow">MALENJO START CENTER</p>
        <h1>Welcome to Malenjo Suite</h1>
        <p>Open something, or start a local document task.</p>
      </div>
      <div className="ml-home-runtime"><ShieldCheck size={16}/><span><b>Local-first</b><small>{desktop?'Windows desktop':'Browser / Codespaces'}</small></span></div>
    </header>

    <section className="ml-co-actions" aria-label="Start a document task">
      {HOME_PRIMARY_ACTIONS.map((action)=>{
        const Icon=ACTION_ICONS[action.id as keyof typeof ACTION_ICONS]??FileText;
        return <OfficeActionCard
          key={action.id}
          title={action.label}
          subtitle={action.detail}
          icon={<Icon size={21}/>} 
          tone={actionTone(action.id)}
          dashed={action.id==='open'}
          onClick={()=>action.opensFiles?void onOpenDocuments():action.target&&onSelectModule(action.target)}
        />;
      })}
    </section>

    <div className="ml-home-shortcuts" aria-label="Home shortcuts">
      <button onClick={onOpenCommandPalette}><Search size={13}/>Search everything <kbd>Ctrl K</kbd></button>
      <button onClick={()=>onSelectModule('files')}><FolderOpen size={13}/>Files / Library</button>
      <button onClick={()=>onSelectModule('automation')}><Workflow size={13}/>New workflow</button>
      <span>{desktop?'Local Windows files':'Session files'} · network optional</span>
    </div>

    {continueSessions.length>0&&<section className="ml-home-section" aria-labelledby="ml-home-continue-title">
      <div className="ml-co-section-head"><div><h2 id="ml-home-continue-title">Continue working</h2><p>Existing MALENJO tabs keep independent editor state.</p></div></div>
      <div className="ml-home-session-grid">
        {continueSessions.map((session)=><button
          key={session.id}
          className={session.id===activeSessionId?'ml-home-session active':'ml-home-session'}
          onClick={()=>onActivateSession(session.id)}
        ><FileText size={18}/><span><b>{session.document.name}</b><small>{typeLabel(session.document)} · {session.saving?'Saving…':session.dirty?'Unsaved changes':'Saved'}</small></span></button>)}
      </div>
    </section>}

    <section className="ml-home-section ml-co-files" aria-labelledby="ml-home-files-title">
      <div className="ml-co-recent-head">
        <div><h2 id="ml-home-files-title">Your files</h2><p>Recent and pinned items from the canonical MALENJO library.</p></div>
        <div className="ml-co-recent-tools">
          <OfficeSearchInput value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search recent…" aria-label="Search recent MALENJO files"/>
          <OfficeSegmentedFilter<HomeFileFilter> aria-label="Filter recent files by type" value={filter} onChange={setFilter} options={FILTERS}/>
        </div>
      </div>

      {loading?<div className="ml-co-empty">Loading recent files…</div>:<>
        {pinnedDocuments.length>0&&<div className="ml-co-recent-group">
          <div className="ml-co-group-head"><h3>Pinned</h3><span>{pinnedDocuments.length}</span></div>
          <div className="ml-co-recent-grid">{pinnedDocuments.map((document)=>renderDocumentCard(document,true))}</div>
        </div>}
        {recentGroups.map((group)=><div className="ml-co-recent-group" key={group.label}>
          <div className="ml-co-group-head"><h3>{group.label}</h3><span>{group.documents.length}</span></div>
          <div className="ml-co-recent-grid">{group.documents.map((document)=>renderDocumentCard(document,false))}</div>
        </div>)}
        {!pinnedDocuments.length&&!recentGroups.length&&<div className="ml-co-empty">
          <ClockEmpty/>
          <b>{query?'No recent files match that search.':'No recent files yet.'}</b>
          <span>{query?'Change the search or file-type filter.':'Open a local document to get started.'}</span>
          <button onClick={()=>void onOpenDocuments()}><FolderOpen size={14}/>Open file</button>
        </div>}
      </>}
    </section>

    <section className="ml-home-section" aria-labelledby="ml-home-locations-title">
      <div className="ml-co-section-head">
        <div><h2 id="ml-home-locations-title">Pinned locations</h2><p>Shortcuts to folders you use often. MALENJO does not crawl them in the background.</p></div>
        <button className="ml-home-pin-folder" onClick={()=>void addPinnedFolder()} disabled={busy}><MapPin size={13}/>Pin folder</button>
      </div>
      <div className="ml-home-location-grid">
        {desktop&&state.pinnedLocations.map((location)=><article className="ml-home-location" key={location.id}>
          <FolderOpen size={18}/><div><b>{location.label}</b><small title={location.path}>{location.path}</small></div>
          <button disabled={busy} onClick={()=>void browseLocation(location)}>Browse & open</button>
          <button className="text-action" onClick={()=>removeLocation(location.id)}>Remove</button>
        </article>)}
        {!desktop&&<article className="ml-home-location muted"><FolderOpen size={18}/><div><b>Browser session</b><small>Native folder pins are available only in the Windows desktop runtime.</small></div><button onClick={()=>onSelectModule('files')}>View files</button></article>}
        {desktop&&!state.pinnedLocations.length&&<div className="ml-home-location-empty">No pinned folders yet.</div>}
      </div>
    </section>

    <section className="ml-home-status-row" aria-label="Home service status">
      <div><ShieldCheck size={15}/><span><b>System</b><small>{documents.length} library item{documents.length===1?'':'s'} · {sessions.length} tab{sessions.length===1?'':'s'} open</small></span></div>
      <div><Search size={15}/><span><b>Updates</b><small>Malenjo Suite {packageJson.version} · updater not operational yet</small></span></div>
      <div><Bot size={15}/><span><b>Student Hub</b><small>Not connected · local work remains available</small></span></div>
    </section>

    <footer className="ml-co-shortcut-footer">
      <span><kbd>Ctrl</kbd>+<kbd>O</kbd> Open</span>
      <span><kbd>Ctrl</kbd>+<kbd>K</kbd> Search</span>
      <span><kbd>Ctrl</kbd>+<kbd>Tab</kbd> Next document</span>
      <button className="text-action" onClick={()=>onSelectModule('help')}>About this build</button>
    </footer>

    {notice&&<div className="home-status" role="status">{notice}</div>}
  </div>;
}

function ClockEmpty(){
  return <span className="ml-co-empty-glyph" aria-hidden="true">◷</span>;
}