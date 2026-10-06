import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Activity, Command, FilePlus2, FolderOpen, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { modules } from '../modules/registry';
import type { ModuleId } from '../core/types';
import FileLibrary from '../files/FileLibrary';
import RecentDocuments from '../files/RecentDocuments';
import { workspaceForDocument } from '../files/route';
import {
  createDocumentSession,
  markDocumentDirty,
  cycleDocumentSessionId,
  markDocumentSaved,
  markDocumentSaving,
  reorderDocumentSessions,
  setDocumentDirty,
  type DocumentSession,
} from '../files/session';
import type { LibraryDocument } from '../files/types';
import {
  addLibraryDocumentsByPaths,
  chooseAndAddDocuments,
  isDesktopRuntime,
  listLibraryDocuments,
  openLibraryDocument,
  saveAsLibraryDocument,
} from '../files/api';
import { listBrowserDocuments, markBrowserDocumentOpened, registerBrowserFiles } from '../files/browserStore';
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
import { CANONICAL_COMMAND_PALETTE_EXAMPLES } from './commandPaletteModel';
import type { DocumentCommandController } from '../commands/types';

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sessions, setSessions] = useState<DocumentSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [workspaceNotices, setWorkspaceNotices] = useState<Record<string,string>>({});
  const [paletteDocuments, setPaletteDocuments] = useState<LibraryDocument[]>([]);
  const commandControllersRef = useRef(new Map<string, DocumentCommandController>());
  const browserOpenInputRef = useRef<HTMLInputElement>(null);
  const module = modules.find((item) => item.id === active) ?? modules[0];
  const groups = useMemo(() => ['Core','Create','Intelligence','Enterprise','System'] as const, []);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

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

  async function openPaletteDocument(document: LibraryDocument) {
    try {
      const opened = isDesktopRuntime()
        ? await openLibraryDocument(document.id)
        : markBrowserDocumentOpened(document);
      openFromLibrary(opened);
    } catch (error) {
      setWorkspaceNotices((current) => ({ ...current, __open: String(error) }));
      selectModule('files');
    }
  }

  function openBrowserFiles(files: FileList | File[]) {
    const documents = registerBrowserFiles(files);
    documents.forEach((document) => openFromLibrary(markBrowserDocumentOpened(document)));
  }

  async function openDocumentsFromPicker() {
    if (!isDesktopRuntime()) {
      browserOpenInputRef.current?.click();
      return;
    }

    try {
      const result = await chooseAndAddDocuments();
      if (!result) return;
      result.documents.forEach(openFromLibrary);
      if (result.errors.length) {
        setWorkspaceNotices((current) => ({
          ...current,
          __open: `${result.errors.length} selected file(s) could not be opened.`,
        }));
      }
    } catch (error) {
      setWorkspaceNotices((current) => ({ ...current, __open: String(error) }));
    }
  }

  function reorderSessions(draggedId: string, targetId: string) {
    setSessions((current) => reorderDocumentSessions(current, draggedId, targetId));
  }

  function cycleSession(direction: 1 | -1) {
    const nextId = cycleDocumentSessionId(sessions, activeSessionId, direction);
    if (nextId) activateSession(nextId);
  }

  function updateSession(sessionId: string, updater: (session: DocumentSession) => DocumentSession) {
    setSessions((current) => current.map((session) => session.id === sessionId ? updater(session) : session));
  }

  function markSessionDirty(sessionId: string, dirty: boolean) {
    updateSession(sessionId, (session) => setDocumentDirty(session, dirty));
  }

  function registerSessionCommands(sessionId: string, controller: DocumentCommandController | null) {
    if (controller) commandControllersRef.current.set(sessionId, controller);
    else commandControllersRef.current.delete(sessionId);
  }

  function closeSessions(sessionIds: string[]) {
    const remove = new Set(sessionIds);
    const targets = sessions.filter((session) => remove.has(session.id));
    if (!targets.length) return;
    const dirty = targets.filter((session) => session.dirty);
    if (dirty.length && !window.confirm(`Close ${targets.length} tab(s)? ${dirty.length} contain unsaved edits that will be discarded.`)) return;

    const remaining = sessions.filter((session) => !remove.has(session.id));
    setSessions(remaining);
    setWorkspaceNotices((current) => {
      const next = { ...current };
      sessionIds.forEach((id) => {
        delete next[id];
        commandControllersRef.current.delete(id);
      });
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

    const remaining = sessions.filter((session) => session.id !== sessionId);
    setSessions(remaining);
    setWorkspaceNotices((current) => {
      const next = { ...current };
      delete next[sessionId];
      commandControllersRef.current.delete(sessionId);
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
    if (!commandOpen) return;
    let cancelled = false;

    async function loadPaletteDocuments() {
      try {
        const documents = isDesktopRuntime()
          ? await listLibraryDocuments()
          : listBrowserDocuments();
        if (!cancelled) setPaletteDocuments(documents.filter((document) => document.available));
      } catch {
        if (!cancelled) setPaletteDocuments([]);
      }
    }

    void loadPaletteDocuments();
    return () => { cancelled = true; };
  }, [commandOpen, sessions]);

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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void openDocumentsFromPicker();
        return;
      }
      if (event.ctrlKey && event.key === 'Tab') {
        event.preventDefault();
        cycleSession(event.shiftKey ? -1 : 1);
        return;
      }
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
    openBrowserFiles(files);
  }

  function closeCommandPalette() {
    setCommandOpen(false);
    setQuery('');
  }

  const activeDocumentCommands = activeSession
    ? commandControllersRef.current.get(activeSession.id)?.list() ?? []
    : [];

  const commandItems: CommandPaletteItem[] = [
    {
      id:'open-documents',
      label:'Open document(s)…',
      group:'File',
      keywords:'open import multiple files tabs ctrl o',
      detail:'Ctrl/Cmd+O',
      kind:'action',
      run:()=>{ void openDocumentsFromPicker(); },
    },
    ...modules.map((item) => ({
      id:`workspace-${item.id}`,
      label:item.id === 'home' ? 'Home' : `Open ${item.name}`,
      group:item.id === 'settings' ? 'Settings' : 'Workspaces',
      keywords:`${item.name} ${item.description} ${item.engine} ${item.group}`,
      detail:item.id === 'settings' ? 'Suite preferences and settings' : item.description,
      kind:item.id === 'settings' ? ('setting' as const) : ('action' as const),
      run:()=>selectModule(item.id),
    })),
    ...CANONICAL_COMMAND_PALETTE_EXAMPLES.map((example,index) => ({
      id:`source-example-${index}`,
      label:example.phrase,
      group:example.unavailableReason ? 'Source-truth discovery' : 'Actions',
      keywords:example.keywords,
      detail:example.detail,
      kind:'action' as const,
      hiddenWhenEmpty:true,
      disabled:!!example.unavailableReason,
      disabledReason:example.unavailableReason,
      run:()=>{ if (example.target) selectModule(example.target); },
    })),
    ...sessions.map((session) => ({
      id:`tab-${session.id}`,
      label:`Switch to ${session.document.name}`,
      group:'Open documents',
      detail:`${session.document.kind.toUpperCase()} · ${session.dirty ? 'unsaved changes' : 'saved'}`,
      keywords:`${session.document.name} ${session.document.kind}`,
      kind:'document' as const,
      run:()=>activateSession(session.id),
    })),
    ...paletteDocuments
      .filter((document) => !sessions.some((session) => session.document.id === document.id))
      .map((document) => ({
        id:`library-${document.id}`,
        label:document.name,
        group:'Documents',
        detail:`${document.kind.toUpperCase()} · ${document.locationLabel}`,
        keywords:`${document.name} ${document.extension} ${document.kind} ${document.locationLabel}`,
        kind:'document' as const,
        disabled:!document.available,
        disabledReason:document.available ? undefined : 'This library document is currently unavailable.',
        run:()=>{ void openPaletteDocument(document); },
      })),
    ...(activeSession ? [
      ...activeDocumentCommands.map((command) => ({
        id:`active-command-${command.id}`,
        label:command.label,
        group:'Current document',
        keywords:command.keywords,
        detail:command.detail,
        kind:'action' as const,
        disabled:!command.enabled,
        disabledReason:command.disabledReason,
        run:()=>{ if(command.enabled) void command.run(); },
      })),
      ...(!activeSession.document.browserFile && !['pdf','docx','xlsx','pptx'].includes(activeSession.document.kind) ? [{
        id:'active-save-as',
        label:`Save a copy of ${activeSession.document.name}`,
        group:'Current document',
        keywords:'save as export copy',
        kind:'action' as const,
        run:()=>{ void saveSessionAs(activeSession.id); },
      }] : []),
      {
        id:'active-close',
        label:`Close ${activeSession.document.name}`,
        group:'Current document',
        keywords:'close tab',
        kind:'action' as const,
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
        onNavigateModule={(id)=>selectModule(id)}
        onDirtyChange={(dirty)=>markSessionDirty(session.id,dirty)}
        onSavingChange={(saving)=>updateSession(session.id,(current)=>markDocumentSaving(current,saving))}
        registerCommands={(controller)=>registerSessionCommands(session.id,controller)}
      />;
    }
    if (route === 'word') {
      return <OfficeWorkspace
        kind="docx"
        session={session}
        active={session.id === activeSessionId}
        onBackToFiles={() => selectModule('files')}
        onDirtyChange={(dirty) => markSessionDirty(session.id, dirty)}
        onSavingChange={(saving)=>updateSession(session.id,(current)=>markDocumentSaving(current,saving))}
        registerCommands={(controller)=>registerSessionCommands(session.id,controller)}
      />;
    }
    if (route === 'spreadsheet') {
      return <OfficeWorkspace
        kind="xlsx"
        session={session}
        active={session.id === activeSessionId}
        onBackToFiles={() => selectModule('files')}
        onDirtyChange={(dirty) => markSessionDirty(session.id, dirty)}
        onSavingChange={(saving)=>updateSession(session.id,(current)=>markDocumentSaving(current,saving))}
        registerCommands={(controller)=>registerSessionCommands(session.id,controller)}
      />;
    }
    if (route === 'presentation') {
      return <OfficeWorkspace
        kind="pptx"
        session={session}
        active={session.id === activeSessionId}
        onBackToFiles={() => selectModule('files')}
        onDirtyChange={(dirty) => markSessionDirty(session.id, dirty)}
        onSavingChange={(saving)=>updateSession(session.id,(current)=>markDocumentSaving(current,saving))}
        registerCommands={(controller)=>registerSessionCommands(session.id,controller)}
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

  return <div className={sidebarCollapsed?'app-shell sidebar-collapsed':'app-shell'}>
    <aside className="sidebar" aria-label="MALENJO workspace navigation">
      <div className="brand">
        <div className="brand-mark">M</div>
        <div className="brand-copy"><strong>MALENJO</strong><span>SUITE</span></div>
        <button className="sidebar-toggle" onClick={()=>setSidebarCollapsed((value)=>!value)} aria-label={sidebarCollapsed?'Expand workspace navigation':'Collapse workspace navigation'} title={sidebarCollapsed?'Expand navigation':'Collapse navigation'}>{sidebarCollapsed?'›':'‹'}</button>
      </div>
      <nav>
        {groups.map(group => <section key={group}><h3>{group}</h3>{modules.filter(item=>item.group===group).map(item =>
          <button className={!activeSessionId && active===item.id?'nav-item active':'nav-item'} onClick={()=>selectModule(item.id)} key={item.id} title={item.name} aria-label={item.name}>
            <span className="nav-glyph" aria-hidden="true">{item.name.slice(0,2).toUpperCase()}</span>
            <span className="nav-label">{item.name}</span>
            <small>{item.status==='complete'?'●':item.status==='partial'?'◐':'○'}</small>
          </button>
        )}</section>)}
      </nav>
      <div className="local-state"><Activity size={16}/><div className="local-state-copy"><b>Local-first</b><span>{sessions.length} document{sessions.length===1?'':'s'} open · network optional</span></div></div>
    </aside>

    <main
      className={dropActive ? 'workspace drop-active' : 'workspace'}
      onDragEnter={(event) => { if (!isDesktopRuntime() && event.dataTransfer.types.includes('Files')) setDropActive(true); }}
      onDragOver={(event) => { if (!isDesktopRuntime() && event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
      onDragLeave={(event) => { if (!isDesktopRuntime() && event.currentTarget === event.target) setDropActive(false); }}
      onDrop={handleBrowserDrop}
    >
      {dropActive && <div className="global-drop-overlay"><FolderOpen size={34}/><b>Drop files to open in MALENJO</b><span>{isDesktopRuntime() ? 'They will be added to the persistent local library.' : 'They will open as temporary Codespaces/browser sessions.'}</span></div>}
      <input
        ref={browserOpenInputRef}
        className="visually-hidden"
        type="file"
        multiple
        accept=".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.webp,.tif,.tiff,.bmp,.dxf,.dwg,.dcm,.dicom"
        onChange={(event) => {
          if (event.target.files) openBrowserFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <header className="topbar">
        <div className="search"><Search size={17}/><input value={query} onFocus={()=>setCommandOpen(true)} onChange={event=>{setQuery(event.target.value);setCommandOpen(true);}} placeholder="Search files, tools and commands"/><kbd>Ctrl K</kbd></div>
        <div className="topbar-actions">
          <button className="command" onClick={()=>void openDocumentsFromPicker()}><FolderOpen size={17}/> Open</button>
          <button className="command" onClick={()=>setCommandOpen(true)}><Command size={17}/> Commands</button>
        </div>
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
        onReorder={reorderSessions}
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
