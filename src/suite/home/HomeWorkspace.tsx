import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  CircleCheck,
  Clock3,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  MapPin,
  Plus,
  Presentation,
  RefreshCw,
  ScanLine,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Workflow,
} from 'lucide-react';
import packageJson from '../../../package.json';
import type { ModuleId } from '../core/types';
import {
  isDesktopRuntime,
  listLibraryDocuments,
  openLibraryDocument,
} from '../files/api';
import { listBrowserDocuments, markBrowserDocumentOpened } from '../files/browserStore';
import type { DocumentSession } from '../files/session';
import type { LibraryDocument } from '../files/types';
import { browsePinnedFolder, choosePinnedFolder } from './api';
import {
  HOME_PRIMARY_ACTIONS,
  addPinnedLocation,
  homeDocumentsForView,
  pruneMissingStarredDocuments,
  removePinnedLocation,
  toggleStarredDocument,
  type HomePinnedLocation,
  type HomeStateV1,
  type HomeView,
} from './model';
import { loadHomeState, saveHomeState } from './storage';

/**
 * The information architecture for this start center adapts the MIT-licensed
 * satnaing/shadcn-admin dashboard composition (header/search + main + tabs +
 * cards) pinned in third_party/shadcn-admin/PROVENANCE.md. MALENJO retains its
 * own navigation, brand, document model and dark visual system.
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

const ACTION_ICONS = {
  open:FolderOpen,
  document:FileText,
  spreadsheet:FileSpreadsheet,
  presentation:Presentation,
  pdf:FileText,
  scan:ScanLine,
  ocr:Search,
  ai:Sparkles,
} as const;

function dateLabel(timestamp: number | null): string {
  if (!timestamp) return 'Added to library';
  const date=new Date(timestamp);
  const today=new Date();
  const sameDay=date.getFullYear()===today.getFullYear()
    && date.getMonth()===today.getMonth()
    && date.getDate()===today.getDate();
  return sameDay
    ? new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(date)
    : new Intl.DateTimeFormat(undefined,{dateStyle:'medium'}).format(date);
}

function typeLabel(document: LibraryDocument): string {
  return document.kind==='docx' ? 'DOCX'
    : document.kind==='xlsx' ? 'XLSX'
      : document.kind==='pptx' ? 'PPTX'
        : document.kind.toUpperCase();
}

function updateState(
  current: HomeStateV1,
  next: HomeStateV1,
  setState: (value: HomeStateV1)=>void,
  setNotice: (value:string)=>void,
): void {
  setState(next);
  const result=saveHomeState(next);
  if (!result.ok && result.error) setNotice(result.error);
  else if (current.activeView!==next.activeView) setNotice('');
}

export default function HomeWorkspace({
  sessions,
  activeSessionId,
  onSelectModule,
  onActivateSession,
  onOpenDocument,
  onOpenDocuments,
  onOpenCommandPalette,
}: Props) {
  const desktop=isDesktopRuntime();
  const [documents,setDocuments]=useState<LibraryDocument[]>([]);
  const [state,setState]=useState<HomeStateV1>(()=>loadHomeState());
  const [query,setQuery]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');

  const loadDocuments=useCallback(async()=>{
    setLoading(true);
    try {
      const next=desktop ? await listLibraryDocuments() : listBrowserDocuments();
      setDocuments(next);
      setState((current)=>{
        const pruned=pruneMissingStarredDocuments(current,next);
        if (pruned!==current) saveHomeState(pruned);
        return pruned;
      });
      setNotice('');
    } catch(reason) {
      setDocuments([]);
      setNotice(`Home could not load the document library: ${reason instanceof Error?reason.message:String(reason)}`);
    } finally {
      setLoading(false);
    }
  },[desktop]);

  useEffect(()=>{ void loadDocuments(); },[loadDocuments,sessions.length]);

  const visibleDocuments=useMemo(
    ()=>state.activeView==='locations'
      ? []
      : homeDocumentsForView(documents,state,state.activeView,query),
    [documents,state,query],
  );

  const continueSessions=useMemo(
    ()=>[...sessions].sort((a,b)=>b.openedAt-a.openedAt).slice(0,4),
    [sessions],
  );

  function setView(view: HomeView) {
    updateState(state,{...state,activeView:view},setState,setNotice);
    setQuery('');
  }

  function toggleStar(documentId: string) {
    const next=toggleStarredDocument(state,documentId);
    updateState(state,next,setState,setNotice);
  }

  async function openDocument(document: LibraryDocument) {
    if (!document.available) {
      setNotice(`“${document.name}” is no longer available at its indexed location. Open Files / Library to refresh or remove the entry.`);
      return;
    }
    setBusy(true);
    try {
      const opened=desktop
        ? await openLibraryDocument(document.id)
        : markBrowserDocumentOpened(document);
      onOpenDocument(opened);
    } catch(reason) {
      setNotice(`Unable to open “${document.name}”: ${reason instanceof Error?reason.message:String(reason)}`);
      await loadDocuments();
    } finally {
      setBusy(false);
    }
  }

  async function addPinnedFolder() {
    if (!desktop) {
      setNotice('Pinned local folders are available in the Windows desktop runtime. Browser/Codespaces files remain session-only.');
      return;
    }
    try {
      const location=await choosePinnedFolder();
      if (!location) return;
      const next=addPinnedLocation(state,location);
      updateState(state,next,setState,setNotice);
      setNotice(`Pinned ${location.label} to Home.`);
    } catch(reason) {
      setNotice(`Unable to pin this folder: ${reason instanceof Error?reason.message:String(reason)}`);
    }
  }

  async function browseLocation(location: HomePinnedLocation) {
    setBusy(true);
    try {
      const result=await browsePinnedFolder(location);
      if (!result) return;
      if (!result.documents.length && result.errors.length) {
        setNotice(`No documents were opened from ${location.label}; ${result.errors.length} selected file(s) were rejected.`);
        return;
      }
      for (const document of result.documents) {
        const opened=await openLibraryDocument(document.id);
        onOpenDocument(opened);
      }
      if (result.errors.length) {
        setNotice(`Opened ${result.documents.length} document(s); ${result.errors.length} selected file(s) could not be added.`);
      }
    } catch(reason) {
      setNotice(`Unable to browse ${location.label}: ${reason instanceof Error?reason.message:String(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  function removeLocation(id: string) {
    const next=removePinnedLocation(state,id);
    updateState(state,next,setState,setNotice);
  }

  return <div className="content home-start-center">
    <header className="home-welcome">
      <div>
        <p className="eyebrow">MALENJO START CENTER</p>
        <h1>Home</h1>
        <p>Open recent work, start a document task, or jump into a local workspace. Heavy providers stay off until a feature needs them.</p>
      </div>
      <div className="home-local-badge"><ShieldCheck size={17}/><span><b>Local-first</b><small>{desktop?'Windows desktop runtime':'Browser / Codespaces session'}</small></span></div>
    </header>

    <section className="home-launcher" aria-labelledby="home-launcher-title">
      <div className="home-section-title">
        <div><h2 id="home-launcher-title">Start</h2><p>High-frequency document actions</p></div>
        <button className="home-search-button" onClick={onOpenCommandPalette}><Search size={14}/>Search everything <kbd>Ctrl K</kbd></button>
      </div>
      <div className="home-launcher-grid">
        {HOME_PRIMARY_ACTIONS.map((action)=>{
          const Icon=ACTION_ICONS[action.id as keyof typeof ACTION_ICONS] ?? FileText;
          return <button
            key={action.id}
            className={`home-launch-tile ${action.id}`}
            onClick={()=>action.opensFiles ? void onOpenDocuments() : action.target && onSelectModule(action.target)}
          >
            <span className="home-launch-icon"><Icon size={24}/></span>
            <span><b>{action.label}</b><small>{action.detail}</small></span>
          </button>;
        })}
      </div>
      <div className="home-secondary-actions" aria-label="Additional Home actions">
        <button onClick={()=>onSelectModule('files')}><FolderOpen size={14}/>Files / Library</button>
        <button onClick={()=>setView('recent')}><Clock3 size={14}/>Recent</button>
        <button onClick={()=>setView('starred')}><Star size={14}/>Starred</button>
        <button onClick={()=>setView('locations')}><MapPin size={14}/>Pinned locations</button>
        <button onClick={()=>onSelectModule('automation')}><Workflow size={14}/>New workflow</button>
      </div>
    </section>

    {continueSessions.length>0 && <section className="home-continue" aria-labelledby="continue-title">
      <div className="home-section-title"><div><h2 id="continue-title">Continue working</h2><p>Open MALENJO document sessions keep independent state.</p></div></div>
      <div className="home-continue-grid">
        {continueSessions.map((session)=><button
          key={session.id}
          className={session.id===activeSessionId?'home-continue-card active':'home-continue-card'}
          onClick={()=>onActivateSession(session.id)}
        >
          <FileText size={18}/>
          <span><b>{session.document.name}</b><small>{typeLabel(session.document)} · {session.saving?'Saving…':session.dirty?'Unsaved changes':'Saved'}</small></span>
          <em>{dateLabel(session.openedAt)}</em>
        </button>)}
      </div>
    </section>}

    <div className="home-dashboard-grid">
      <section className="home-work-panel" aria-label="Home documents and pinned locations">
        <div className="home-work-head">
          <div className="home-tabs" role="tablist" aria-label="Home document views">
            {(['recent','starred','locations'] as HomeView[]).map((view)=><button
              key={view}
              role="tab"
              aria-selected={state.activeView===view}
              className={state.activeView===view?'active':''}
              onClick={()=>setView(view)}
            >{view==='locations'?'Locations':view[0].toUpperCase()+view.slice(1)}</button>)}
          </div>
          {state.activeView!=='locations'
            ? <label className="home-filter"><Search size={14}/><span className="visually-hidden">Filter Home documents</span><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Filter documents"/></label>
            : <button className="home-add-location" disabled={busy} onClick={()=>void addPinnedFolder()}><Plus size={14}/>Pin folder</button>}
        </div>

        <div className="home-work-content" role="tabpanel" aria-live="polite">
          {state.activeView==='locations'
            ? <div className="home-location-list">
                {desktop && state.pinnedLocations.map((location)=><article key={location.id} className="home-location-card">
                  <span className="home-location-icon"><FolderOpen size={19}/></span>
                  <div><b>{location.label}</b><small title={location.path}>{location.path}</small></div>
                  <button disabled={busy} onClick={()=>void browseLocation(location)}>Browse & open</button>
                  <button className="text-action" onClick={()=>removeLocation(location.id)}>Remove</button>
                </article>)}
                {!desktop && <article className="home-location-card unavailable">
                  <span className="home-location-icon"><FolderOpen size={19}/></span>
                  <div><b>Browser session</b><small>Local folder pins are not exposed by browser/Codespaces. Session files remain available through Files / Library.</small></div>
                  <button onClick={()=>onSelectModule('files')}>View files</button>
                </article>}
                {desktop && !state.pinnedLocations.length && <div className="home-empty-state"><MapPin size={25}/><b>No pinned folders yet</b><span>Pin frequently used document folders. Browsing a pin opens a native file picker rooted at that folder; MALENJO does not scan the folder in the background.</span><button onClick={()=>void addPinnedFolder()}><Plus size={14}/>Pin a folder</button></div>}
              </div>
            : loading
              ? <div className="home-empty-state"><RefreshCw size={24}/><b>Loading library…</b></div>
              : visibleDocuments.length
                ? <div className="home-document-list" role="table" aria-label={state.activeView==='recent'?'Recent documents':'Starred documents'}>
                    {visibleDocuments.map((document)=>{
                      const starred=state.starredDocumentIds.includes(document.id);
                      return <div key={document.id} className={document.available?'home-document-row':'home-document-row unavailable'} role="row">
                        <button className="home-document-open" disabled={!document.available||busy} onClick={()=>void openDocument(document)}>
                          <span className={`home-file-badge ${document.kind}`}>{typeLabel(document).slice(0,4)}</span>
                          <span><b>{document.name}</b><small>{document.locationLabel}</small></span>
                        </button>
                        <span className="home-document-date">{dateLabel(document.lastOpenedMs ?? document.addedMs)}</span>
                        <button
                          className={starred?'home-star active':'home-star'}
                          aria-label={starred?`Remove ${document.name} from starred`:`Add ${document.name} to starred`}
                          aria-pressed={starred}
                          onClick={()=>toggleStar(document.id)}
                        ><Star size={16} fill={starred?'currentColor':'none'}/></button>
                      </div>;
                    })}
                  </div>
                : <div className="home-empty-state">
                    {state.activeView==='starred'?<Star size={25}/>:<Clock3 size={25}/>}
                    <b>{state.activeView==='starred'?'No starred documents':'No recent documents'}</b>
                    <span>{query?'No document matches this filter.':'Open a local document and it will appear here.'}</span>
                    <button onClick={()=>void onOpenDocuments()}><FolderOpen size={14}/>Open documents</button>
                  </div>}
        </div>

        <footer className="home-work-footer">
          <span>{documents.length} library document{documents.length===1?'':'s'}</span>
          <button className="text-action" onClick={()=>onSelectModule('files')}>View full library</button>
        </footer>
      </section>

      <aside className="home-info-rail" aria-label="Home status and notices">
        <section className="home-info-card system">
          <div className="home-info-icon"><CircleCheck size={18}/></div>
          <div><p className="eyebrow">SYSTEM</p><h3>Ready for local work</h3><dl>
            <div><dt>Runtime</dt><dd>{desktop?'Desktop':'Browser'}</dd></div>
            <div><dt>Open tabs</dt><dd>{sessions.length}</dd></div>
            <div><dt>Library</dt><dd>{loading?'…':documents.length}</dd></div>
          </dl></div>
        </section>

        <section className="home-info-card">
          <div className="home-info-icon"><RefreshCw size={18}/></div>
          <div><p className="eyebrow">UPDATES</p><h3>Malenjo Suite {packageJson.version}</h3><p>The updater module is not operational yet. Home does not contact an update server or claim that this build is current.</p><button onClick={()=>onSelectModule('help')}>About this build</button></div>
        </section>

        <section className="home-info-card">
          <div className="home-info-icon"><Bot size={18}/></div>
          <div><p className="eyebrow">STUDENT HUB</p><h3>Local-only session</h3><p>No classroom account provider is connected. Local documents and workspaces remain available without sign-in.</p><button onClick={()=>onSelectModule('account')}>Account status</button></div>
        </section>
      </aside>
    </div>

    {notice && <div className="home-status" role="status">{notice}</div>}
  </div>;
}
