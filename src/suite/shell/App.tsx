import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { Activity, Command, FilePlus2, FolderOpen, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { modules } from '../modules/registry';
import type { ModuleId } from '../core/types';
import FileLibrary from '../files/FileLibrary';
import RecentDocuments from '../files/RecentDocuments';
import { workspaceForDocument } from '../files/route';
import {
  attachRecoveredWorkingCopy,
  createDocumentSession,
  markDocumentDirty,
  markDocumentSaved,
  markDocumentSaving,
  setDocumentDirty,
  type DocumentSession,
} from '../files/session';
import type { LibraryDocument } from '../files/types';
import { addLibraryDocumentsByPaths, isDesktopRuntime, openLibraryDocument, saveAsLibraryDocument } from '../files/api';
import { hydrateBrowserStore, markBrowserDocumentOpened, registerBrowserFiles } from '../files/browserStore';
import {
  deleteWorkingCopy,
  loadSessionManifest,
  loadWorkingCopy,
  saveSessionManifest,
  saveWorkingCopy,
} from '../files/recovery';
import PdfWorkspace from '../pdf/PdfWorkspace';
import OfficeWorkspace from '../office/OfficeWorkspace';
import ScannerWorkspace from '../scanner/ScannerWorkspace';
import AiWorkspace from '../ai/AiWorkspace';
import SecurityWorkspace from '../security/SecurityWorkspace';
import MetadataWorkspace from '../security/MetadataWorkspace';
import SignWorkspace from '../security/SignWorkspace';
import EnterpriseWorkspace from '../enterprise/EnterpriseWorkspace';
import DocumentTabs from './DocumentTabs';
import CommandPalette, { type CommandPaletteItem } from './CommandPalette';

const quick: Array<{label:string; icon:typeof FolderOpen; target:ModuleId}> = [
  {label:'Open document', icon: FolderOpen, target:'files'},
  {label:'New document', icon: FilePlus2, target:'word'},
  {label:'Private AI', icon: Sparkles, target:'ai'},
  {label:'Security scan', icon: ShieldCheck, target:'security'},
];

export default function App() {
  const [active, setActive] = useState<ModuleId>('home');
  const [query, setQuery] = useState('');
  const [commandOpen, setCommandOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [sessionRestoreReady, setSessionRestoreReady] = useState(false);
  const [sessions, setSessions] = useState<DocumentSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [workspaceNotices, setWorkspaceNotices] = useState<Record<string,string>>({});
  const module = modules.find((item) => item.id === active) ?? modules[0];
  const groups = useMemo(() => ['Core','Create','Intelligence','Enterprise','System'] as const, []);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  useEffect(() => {
    let cancelled = false;

    async function restoreSessions() {
      const manifest = loadSessionManifest();
      const desktop = isDesktopRuntime();
      const browserDocuments = desktop ? [] : await hydrateBrowserStore();
      const restored: DocumentSession[] = [];

      for (const descriptor of manifest.documents) {
        try {
          let document: LibraryDocument | undefined;
          if (descriptor.runtime === 'browser-session') {
            if (desktop) continue;
            document = browserDocuments.find((item) => item.id === descriptor.documentId);
          } else {
            if (!desktop) continue;
            document = await openLibraryDocument(descriptor.documentId);
          }
          if (!document) continue;

          let session = createDocumentSession(document, descriptor.openedAt);
          const recovery = await loadWorkingCopy(document.id);
          if (recovery && recovery.kind === document.kind) {
            session = attachRecoveredWorkingCopy(session, recovery.bytes, recovery.updatedAt);
          }
          restored.push(session);
        } catch {
          // Missing/moved documents are skipped; the remaining tab set is still restored.
        }
      }

      if (cancelled) return;
      setSessions(restored);

      const selected = restored.find((session) => session.document.id === manifest.activeDocumentId)
        ?? restored[0]
        ?? null;
      if (selected) {
        setActiveSessionId(selected.id);
        setActive(workspaceForDocument(selected.document.kind));
      }
      setSessionRestoreReady(true);
    }

    void restoreSessions();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!sessionRestoreReady) return;
    const activeDocumentId = sessions.find((session) => session.id === activeSessionId)?.document.id ?? null;
    saveSessionManifest({
      version: 1,
      activeDocumentId,
      documents: sessions.map((session) => ({
        documentId: session.document.id,
        openedAt: session.openedAt,
        runtime: session.document.browserFile ? 'browser-session' : 'native-library',
      })),
    });
  }, [activeSessionId, sessionRestoreReady, sessions]);


  function selectModule(id: ModuleId) {
    setActive(id);
    setActiveSessionId(null);
  }

  function activateSession(sessionId: string) {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    setActiveSessionId(sessionId);
    setActive(workspaceForDocument(session.document.kind));
  }

  function openFromLibrary(document: LibraryDocument) {
    const existing = sessions.find((session) => session.document.id === document.id);
    if (existing) {
      activateSession(existing.id);
      return;
    }

    const session = createDocumentSession(document);
    setSessions((current) => [...current, session]);
    setActiveSessionId(session.id);
    setActive(workspaceForDocument(document.kind));
  }

  function updateSession(sessionId: string, updater: (session: DocumentSession) => DocumentSession) {
    setSessions((current) => current.map((session) => session.id === sessionId ? updater(session) : session));
  }

  function persistWorkingCopy(sessionId: string, bytes: Uint8Array | null, dirty: boolean) {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    if (dirty && bytes?.byteLength) {
      void saveWorkingCopy(session.document, bytes);
    } else {
      void deleteWorkingCopy(session.document.id);
    }
  }

  function markSessionDirty(sessionId: string, dirty: boolean) {
    updateSession(sessionId, (session) => setDocumentDirty(session, dirty));
  }

  function closeSessions(sessionIds: string[]) {
    const remove = new Set(sessionIds);
    const targets = sessions.filter((session) => remove.has(session.id));
    if (!targets.length) return;
    const dirty = targets.filter((session) => session.dirty);
    if (dirty.length && !window.confirm(`Close ${targets.length} tab(s)? ${dirty.length} contain unsaved edits that will be discarded.`)) return;

    targets.forEach((session) => { void deleteWorkingCopy(session.document.id); });
    const remaining = sessions.filter((session) => !remove.has(session.id));
    setSessions(remaining);
    setWorkspaceNotices((current) => {
      const next = { ...current };
      sessionIds.forEach((id) => delete next[id]);
      return next;
    });

    if (activeSessionId && !remove.has(activeSessionId)) return;
    const next = remaining.at(-1) ?? null;
    if (next) {
      setActiveSessionId(next.id);
      setActive(workspaceForDocument(next.document.kind));
    } else {
      setActiveSessionId(null);
      setActive('files');
    }
  }

  function closeSession(sessionId: string) {
    const index = sessions.findIndex((session) => session.id === sessionId);
    if (index < 0) return;
    const target = sessions[index];
    if (target.dirty && !window.confirm(`Close "${target.document.name}" without saving its current edits?`)) return;

    void deleteWorkingCopy(target.document.id);
    const remaining = sessions.filter((session) => session.id !== sessionId);
    setSessions(remaining);
    setWorkspaceNotices((current) => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });

    if (activeSessionId !== sessionId) return;
    const next = remaining[Math.min(index, remaining.length - 1)] ?? null;
    if (next) {
      setActiveSessionId(next.id);
      setActive(workspaceForDocument(next.document.kind));
    } else {
      setActiveSessionId(null);
      setActive('files');
    }
  }

  async function saveSessionAs(sessionId: string) {
    const target = sessions.find((session) => session.id === sessionId);
    if (!target) return;

    updateSession(sessionId, (session) => markDocumentSaving(session, true));
    try {
      const copy = await saveAsLibraryDocument(target.document);
      if (!copy) {
        updateSession(sessionId, (session) => markDocumentSaving(session, false));
        return;
      }
      updateSession(sessionId, (session) => markDocumentSaved(session, copy));
      void deleteWorkingCopy(target.document.id);
      setWorkspaceNotices((current) => ({
        ...current,
        [sessionId]: `Saved a copy as ${copy.name} and added it to the MALENJO library.`,
      }));
      if (activeSessionId === sessionId) setActive(workspaceForDocument(copy.kind));
    } catch (error) {
      updateSession(sessionId, (session) => markDocumentSaving(session, false));
      setWorkspaceNotices((current) => ({ ...current, [sessionId]: String(error) }));
    }
  }

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let unlisten: (() => void) | undefined;

    void import('@tauri-apps/api/webview')
      .then(({ getCurrentWebview }) => getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === 'over') {
          setDropActive(true);
          return;
        }
        if (event.payload.type === 'leave') {
          setDropActive(false);
          return;
        }
        if (event.payload.type === 'drop') {
          setDropActive(false);
          void addLibraryDocumentsByPaths(event.payload.paths)
            .then((result) => {
              result.documents.forEach(openFromLibrary);
              if (result.errors.length) {
                setWorkspaceNotices((current) => ({
                  ...current,
                  __drop: `${result.errors.length} dropped file(s) could not be added.`,
                }));
              }
            })
            .catch((error) => setWorkspaceNotices((current) => ({ ...current, __drop: String(error) })));
        }
      }))
      .then((fn) => { unlisten = fn; })
      .catch(() => {});

    return () => unlisten?.();
  }, [sessions]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'w') {
        event.preventDefault();
        closeSessions(sessions.map((session) => session.id));
        return;
      }
      if (activeSessionId && (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'w') {
        event.preventDefault();
        closeSession(activeSessionId);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeSessionId, sessions]);

  function handleBrowserDrop(event: DragEvent<HTMLElement>) {
    if (isDesktopRuntime()) return;
    event.preventDefault();
    setDropActive(false);
    const files = Array.from(event.dataTransfer.files);
    if (!files.length) return;
    const documents = registerBrowserFiles(files);
    documents.forEach((document) => openFromLibrary(markBrowserDocumentOpened(document)));
  }

  function closeCommandPalette() {
    setCommandOpen(false);
    setQuery('');
  }

  const commandItems: CommandPaletteItem[] = [
    { id:'go-home', label:'Home', group:'Navigation', keywords:'start dashboard', run:()=>selectModule('home') },
    { id:'go-files', label:'Open Files / Library', group:'Navigation', keywords:'open import documents', run:()=>selectModule('files') },
    { id:'go-scan', label:'Scan document', group:'Tools', keywords:'camera capture scanner', run:()=>selectModule('scanner') },
    { id:'go-ocr', label:'OCR document', group:'Tools', keywords:'recognize searchable text', run:()=>selectModule('ocr') },
    { id:'go-ai', label:'Ask Malenjo AI', group:'Tools', keywords:'local rag ollama llama', run:()=>selectModule('ai') },
    { id:'go-sign', label:'Sign / validate PDF', group:'Tools', keywords:'signature certificate pyhanko', run:()=>selectModule('sign') },
    { id:'go-meta', label:'Open Metadata Studio', group:'Tools', keywords:'properties privacy sanitize metadata', run:()=>selectModule('metadata') },
    { id:'go-security', label:'Open Security Center', group:'Tools', keywords:'protect cdr redact clamav encrypt', run:()=>selectModule('security') },
    { id:'go-auto', label:'Run automation', group:'Enterprise', keywords:'workflow temporal', run:()=>selectModule('automation') },
    { id:'go-dms', label:'Open Enterprise DMS', group:'Enterprise', keywords:'versions retention records', run:()=>selectModule('dms') },
    { id:'go-backup', label:'Open Backup / DR', group:'Enterprise', keywords:'backup restore recovery kopia', run:()=>selectModule('backup') },
    { id:'go-admin', label:'Open Administration', group:'Enterprise', keywords:'roles permissions policy', run:()=>selectModule('admin') },
    ...sessions.map((session) => ({
      id:`tab-${session.id}`,
      label:`Switch to ${session.document.name}`,
      group:'Open documents',
      detail:`${session.document.kind.toUpperCase()} · ${session.dirty ? 'unsaved changes' : 'saved'}`,
      keywords:`${session.document.name} ${session.document.kind}`,
      run:()=>activateSession(session.id),
    })),
    ...(activeSession ? [
      ...(!activeSession.document.browserFile && !['pdf','docx','xlsx','pptx'].includes(activeSession.document.kind) ? [{
        id:'active-save-as',
        label:`Save a copy of ${activeSession.document.name}`,
        group:'Current document',
        keywords:'save as export copy',
        run:()=>{ void saveSessionAs(activeSession.id); },
      }] : []),
      {
        id:'active-close',
        label:`Close ${activeSession.document.name}`,
        group:'Current document',
        keywords:'close tab',
        run:()=>closeSession(activeSession.id),
      },
    ] : []),
  ];

  function renderDocumentWorkspace(session: DocumentSession) {
    const route = workspaceForDocument(session.document.kind);
    const notice = workspaceNotices[session.id] ?? '';

    if (route === 'pdf') {
      return <PdfWorkspace
        session={session}
        active={session.id === activeSessionId}
        notice={notice}
        onBackToFiles={() => selectModule('files')}
        onDirtyChange={(dirty)=>markSessionDirty(session.id,dirty)}
        onWorkingCopyChange={(bytes,dirty)=>persistWorkingCopy(session.id,bytes,dirty)}
      />;
    }
    if (route === 'word') {
      return <OfficeWorkspace
        kind="docx"
        session={session}
        onBackToFiles={() => selectModule('files')}
        onDirtyChange={(dirty) => markSessionDirty(session.id, dirty)}
        onWorkingCopyChange={(bytes,dirty)=>persistWorkingCopy(session.id,bytes,dirty)}
      />;
    }
    if (route === 'spreadsheet') {
      return <OfficeWorkspace
        kind="xlsx"
        session={session}
        onBackToFiles={() => selectModule('files')}
        onDirtyChange={(dirty) => markSessionDirty(session.id, dirty)}
      />;
    }
    if (route === 'presentation') {
      return <OfficeWorkspace
        kind="pptx"
        session={session}
        onBackToFiles={() => selectModule('files')}
        onDirtyChange={(dirty) => markSessionDirty(session.id, dirty)}
      />;
    }

    const targetModule = modules.find((item) => item.id === route) ?? modules[0];
    return <ModuleView
      module={targetModule}
      session={session}
      notice={notice}
      onSaveAs={() => saveSessionAs(session.id)}
      onBackToFiles={() => selectModule('files')}
    />;
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">M</div><div><strong>MALENJO</strong><span>SUITE</span></div></div>
      <nav>
        {groups.map(group => <section key={group}><h3>{group}</h3>{modules.filter(item=>item.group===group).map(item =>
          <button className={!activeSessionId && active===item.id?'nav-item active':'nav-item'} onClick={()=>selectModule(item.id)} key={item.id}>
            <span>{item.name}</span><small>{item.status==='complete'?'●':item.status==='partial'?'◐':'○'}</small>
          </button>
        )}</section>)}
      </nav>
      <div className="local-state"><Activity size={16}/><div><b>Local-first</b><span>{sessions.length} document{sessions.length===1?'':'s'} open · network optional</span></div></div>
    </aside>

    <main
      className={dropActive ? 'workspace drop-active' : 'workspace'}
      onDragEnter={(event) => { if (!isDesktopRuntime() && event.dataTransfer.types.includes('Files')) setDropActive(true); }}
      onDragOver={(event) => { if (!isDesktopRuntime() && event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
      onDragLeave={(event) => { if (!isDesktopRuntime() && event.currentTarget === event.target) setDropActive(false); }}
      onDrop={handleBrowserDrop}
    >
      {dropActive && <div className="global-drop-overlay"><FolderOpen size={34}/><b>Drop files to open in MALENJO</b><span>{isDesktopRuntime() ? 'They will be added to the persistent local library.' : 'They will open as temporary Codespaces/browser sessions.'}</span></div>}
      <header className="topbar">
        <div className="search"><Search size={17}/><input value={query} onFocus={()=>setCommandOpen(true)} onChange={event=>{setQuery(event.target.value);setCommandOpen(true);}} placeholder="Search files, tools and commands"/><kbd>Ctrl K</kbd></div>
        <button className="command" onClick={()=>setCommandOpen(true)}><Command size={17}/> Commands</button>
      </header>

      <DocumentTabs
        sessions={sessions}
        activeSessionId={activeSessionId}
        onActivate={activateSession}
        onClose={closeSession}
        onCloseOthers={(sessionId) => closeSessions(sessions.filter((session) => session.id !== sessionId).map((session) => session.id))}
        onCloseRight={(sessionId) => {
          const index = sessions.findIndex((session) => session.id === sessionId);
          closeSessions(sessions.slice(index + 1).map((session) => session.id));
        }}
        onCloseAll={() => closeSessions(sessions.map((session) => session.id))}
      />

      <CommandPalette
        open={commandOpen}
        query={query}
        items={commandItems}
        onQueryChange={setQuery}
        onClose={closeCommandPalette}
      />

      {!!sessions.length && <div className={activeSession ? 'document-session-stack' : 'document-session-stack parked'} aria-hidden={!activeSession}>
        {sessions.map((session) => <section
          className={session.id === activeSessionId ? 'document-session-panel active' : 'document-session-panel'}
          key={session.id}
          aria-hidden={session.id !== activeSessionId}
        >{renderDocumentWorkspace(session)}</section>)}
      </div>}

      {!activeSession && (active === 'home'
        ? <Home onSelect={selectModule} onOpen={openFromLibrary}/>
        : active === 'files'
          ? <FileLibrary onOpen={openFromLibrary}/>
          : active === 'scanner'
            ? <ScannerWorkspace mode="scanner" onBackToFiles={()=>selectModule('files')}/>
            : active === 'ocr'
              ? <ScannerWorkspace mode="ocr" onBackToFiles={()=>selectModule('files')}/>
              : active === 'ai'
                ? <AiWorkspace onBackToFiles={()=>selectModule('files')}/>
                : active === 'security'
                  ? <SecurityWorkspace onBackToFiles={()=>selectModule('files')}/>
                  : active === 'metadata'
                    ? <MetadataWorkspace onBackToFiles={()=>selectModule('files')}/>
                    : active === 'sign'
                      ? <SignWorkspace onBackToFiles={()=>selectModule('files')}/>
                      : active === 'dms'
                        ? <EnterpriseWorkspace mode="dms" onBackToFiles={()=>selectModule('files')}/>
                        : active === 'automation'
                          ? <EnterpriseWorkspace mode="automation" onBackToFiles={()=>selectModule('files')}/>
                          : active === 'backup'
                            ? <EnterpriseWorkspace mode="backup" onBackToFiles={()=>selectModule('files')}/>
                            : active === 'admin'
                              ? <EnterpriseWorkspace mode="admin" onBackToFiles={()=>selectModule('files')}/>
                              : <ModuleView module={module} session={null} notice="" onSaveAs={async()=>{}} onBackToFiles={()=>selectModule('files')}/>)}
    </main>
  </div>
}

function Home({onSelect,onOpen}:{onSelect:(id:ModuleId)=>void;onOpen:(document:LibraryDocument)=>void}) {
  return <div className="content">
    <div className="hero"><div><p className="eyebrow">LOCAL-FIRST DOCUMENT PLATFORM</p><h1>Your documents. One private workspace.</h1><p>MALENJO combines PDF, Office, OCR, private AI, signing, metadata, automation and enterprise tools behind one consistent desktop shell.</p></div><div className="hero-mark">M</div></div>
    <div className="quick-grid">{quick.map(({label,icon:Icon,target})=><button key={label} onClick={()=>onSelect(target)}><Icon size={21}/><span>{label}</span></button>)}</div>
    <div className="section-head"><div><h2>Workspaces</h2><p>Heavy engines are adapters and load only when a task needs them.</p></div><span className="pill">Student / classroom build</span></div>
    <div className="module-grid">{modules.filter(item=>!['home','settings','account','help'].includes(item.id)).map(item=><button className="module-card" key={item.id} onClick={()=>onSelect(item.id)}><div className="card-top"><span className={'status '+item.status}>{item.status}</span><span>↗</span></div><h3>{item.name}</h3><p>{item.description}</p><footer>{item.engine}</footer></button>)}</div>
    <RecentDocuments onOpen={onOpen} onViewAll={()=>onSelect('files')}/>
  </div>
}

function ModuleView({
  module,
  session,
  notice,
  onSaveAs,
  onBackToFiles,
}:{
  module:(typeof modules)[number];
  session:DocumentSession | null;
  notice:string;
  onSaveAs():Promise<void>;
  onBackToFiles():void;
}) {
  const document = session?.document;

  return <div className="content module-view">
    <div className="module-title">
      <div>
        <p className="eyebrow">WORKSPACE</p>
        <h1>{module.name}</h1>
        <p>{document ? `${document.name} · ${document.locationLabel}` : module.description}</p>
      </div>
      <div className="module-state">
        {session && <span className={session.saving ? 'session-state saving' : session.dirty ? 'session-state dirty' : 'session-state'}>{session.saving ? 'Saving…' : session.dirty ? 'Unsaved changes' : 'Saved'}</span>}
        <span className={'status large '+module.status}>{module.status}</span>
      </div>
    </div>
    <div className="canvas-placeholder">
      <div className="canvas-toolbar">
        <button onClick={onBackToFiles}>Files</button>
        <button disabled={!session?.dirty}>Save</button>
        <button disabled={!document || session?.saving || !!document?.browserFile} onClick={() => void onSaveAs()}>Save As</button>
        <button disabled={!document}>Export</button>
        <button disabled={!document}>Print</button>
        <button>More</button>
      </div>
      {notice && <div className="workspace-notice">{notice}</div>}
      <div className="empty-state">
        <div className="empty-icon">M</div>
        <h2>{document ? document.name : `${module.name} capability is not feature-complete yet`}</h2>
        <p>{document
          ? <>This file has its own persistent MALENJO tab/session. The remaining engine-specific commands for <strong>{module.engine}</strong> must be implemented before this workspace is feature-complete.</>
          : <>This module is registered in the shell, but the full master-README feature tree has not yet been implemented. Current registry status reflects vertical-slice readiness, not Adobe/Foxit-class completeness.</>}</p>
        <div className="notice"><ShieldCheck size={18}/>External engines must pass license, security, offline and fidelity tests before permanent integration.</div>
      </div>
    </div>
  </div>
}
