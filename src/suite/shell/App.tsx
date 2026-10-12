import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Bot, ChevronDown, Command, FolderOpen, House, LayoutGrid, Redo2, Save, Search, Settings2, ShieldCheck, Moon, Sun, Undo2, X } from 'lucide-react';
import { modules } from '../modules/registry';
import type { ModuleId } from '../core/types';
import FileLibrary from '../files/FileLibrary';
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
import { isMalenjoDirectOpenExtension, isMalenjoDirectOpenKind } from '../files/openPolicy';
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
import HelpWorkspace from '../help/HelpWorkspace';
import HomeWorkspace from '../home/HomeWorkspace';
import SettingsWorkspace from './SettingsWorkspace';
import CapabilityWorkspace from './CapabilityWorkspace';
import DocumentTabs from './DocumentTabs';
import RibbonShell from './RibbonShell';
import { ModuleNavIcon } from './moduleNavIcons';
import { nextSuiteTheme, readSuiteTheme, saveSuiteTheme, type SuiteTheme } from './appearance';
import { applySuitePalette } from './themePalette';
import CommandPalette, { type CommandPaletteItem } from './CommandPalette';
import { CANONICAL_COMMAND_PALETTE_EXAMPLES } from './commandPaletteModel';
import { pdfCatalogDiscovery } from '../commands/masterCatalog';
import type { DocumentCommandController } from '../commands/types';

export default function App() {
  const [active, setActive] = useState<ModuleId>('home');
  const [query, setQuery] = useState('');
  const [commandOpen, setCommandOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [moduleMenuOpen, setModuleMenuOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiHasOpened, setAiHasOpened] = useState(false);
  const moduleMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [theme, setTheme] = useState<SuiteTheme>(() => {
    try { return readSuiteTheme(window.localStorage); } catch { return 'dark'; }
  });
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    applySuitePalette(document.documentElement.style, theme);
    try { saveSuiteTheme(window.localStorage, theme); } catch { /* private context */ }
  }, [theme]);
  const [sessions, setSessions] = useState<DocumentSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [workspaceNotices, setWorkspaceNotices] = useState<Record<string,string>>({});
  const [paletteDocuments, setPaletteDocuments] = useState<LibraryDocument[]>([]);
  const commandControllersRef = useRef(new Map<string, DocumentCommandController>());
  const commandPaletteOpenerRef = useRef<HTMLElement | null>(null);
  const browserOpenInputRef = useRef<HTMLInputElement>(null);
  const module = modules.find((item) => item.id === active) ?? modules[0];
  const groups = useMemo(() => ['Core','Create','Intelligence','Enterprise','System'] as const, []);
  useEffect(() => {
    if (!moduleMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && !target.closest('.ml-tools-popup') &&
        !target.closest('.topbar-tool-trigger')) setModuleMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [moduleMenuOpen]);


  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );
  const openDocumentsForAi = useMemo(
    () => sessions.map((session)=>session.document),
    [sessions],
  );

  function selectModule(id: ModuleId) {
    setModuleMenuOpen(false);
    if (id === 'ai') { setAiHasOpened(true); setAiOpen(true); return; }
    if (id === 'word' || id === 'spreadsheet' || id === 'presentation') {
      setWorkspaceNotices(current=>({...current,__open:
        'Office viewers are PDF conversion results, not separate MALENJO tools. Open a PDF and use a verified conversion first.'}));
      setActive('pdf');
      setActiveSessionId(null);
      return;
    }
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
    if (!isMalenjoDirectOpenKind(document.kind)) {
      setWorkspaceNotices(current=>({...current,__open:
        'Only PDF, CAD and DICOM files open directly. Word, Excel and PowerPoint viewers are available solely after successful PDF conversion.'}));
      setActive('pdf');
      setActiveSessionId(null);
      return;
    }
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
    const selected=Array.from(files);
    const supported=selected.filter(file=>isMalenjoDirectOpenExtension(file.name));
    if (supported.length!==selected.length) {
      setWorkspaceNotices(current=>({...current,__open:
        'Only PDF, CAD and DICOM can open directly. DOCX, XLSX and PPTX open only as verified PDF conversion outputs.'}));
    }
    registerBrowserFiles(supported).forEach(document=>openFromLibrary(markBrowserDocumentOpened(document)));
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

  // Local browser files remain available in tabs when navigating, but have
  // not been persisted to disk; warn before leaving with unsaved PDF edits.
  useEffect(()=>{
    if(!sessions.some(item=>item.dirty))return;
    function warnBeforeUnload(event:BeforeUnloadEvent){
      event.preventDefault();
      event.returnValue='';
    }
    window.addEventListener('beforeunload',warnBeforeUnload);
    return()=>window.removeEventListener('beforeunload',warnBeforeUnload);
  },[sessions]);

  function closeSessions(sessionIds: string[]) {
    const remove = new Set(sessionIds);
    const targets = sessions.filter((session) => remove.has(session.id));
    if (!targets.length) return;
    const dirty = targets.filter((session) => session.dirty);
    const temporary = targets.filter((session) => !!session.document.browserFile);
    if ((dirty.length||temporary.length) && !window.confirm(
      `Close ${targets.length} tab(s)? ${dirty.length} have unsaved changes; ${temporary.length} are temporary browser files. Original files are untouched, but temporary tabs are lost when closed.`
    )) return;

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
    if ((target.dirty||target.document.browserFile) && !window.confirm(
      `Close "${target.document.name}"? ${target.dirty?'Unsaved edits will be lost. ':' '}This browser tab is temporary; your original local file remains untouched.`
    )) return;

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
        if (!cancelled) setPaletteDocuments(documents);
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
        openCommandPalette();
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

  function openCommandPalette() {
    if (!commandOpen) commandPaletteOpenerRef.current = document.activeElement as HTMLElement | null;
    setCommandOpen(true);
  }

  function closeCommandPalette() {
    setCommandOpen(false);
    setQuery('');
    const opener = commandPaletteOpenerRef.current;
    commandPaletteOpenerRef.current = null;
    window.requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus();
    });
  }

  const activeDocumentCommands = activeSession
    ? commandControllersRef.current.get(activeSession.id)?.list() ?? []
    : [];

  const saveQuickAction = activeDocumentCommands.find(action=>action.id==='save')
    ?? activeDocumentCommands.find(action=>action.id==='save-as')
    ?? activeDocumentCommands.find(action=>action.id==='export');
  const undoQuickAction = activeDocumentCommands.find(action=>action.id==='undo');
  const redoQuickAction = activeDocumentCommands.find(action=>action.id==='redo');

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
    ...modules.filter(item=>!['word','spreadsheet','presentation','ai'].includes(item.id)).map((item) => ({
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
    // Master v2.0 catalog is source-of-truth for 90 requirements.
    // Unreleased capabilities appear in search with an explanation, never
    // as executable actions until their implementation is independently accepted.
    ...pdfCatalogDiscovery(),
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

    if (route === 'cad' || route === 'dicom') {
      return <CapabilityWorkspace module={route}
        documentName={session.document.name} onNavigate={selectModule}/>;
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

  return <div className="app-shell app-shell-top-only" data-shell="malenjo-ribbon">
    <a className="skip-to-workspace" href="#malenjo-workspace-content">Skip to workspace content</a>
    <aside className={moduleMenuOpen ? 'sidebar ml-tools-popup is-open' : 'sidebar ml-tools-popup'}
      role="dialog" aria-label="All MALENJO tools" aria-hidden={!moduleMenuOpen}
      inert={!moduleMenuOpen}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault(); setModuleMenuOpen(false);
          moduleMenuButtonRef.current?.focus();
        }
      }}>
      <header className="ml-tools-popup-head">
        <strong>Tools</strong><span>All MALENJO workspaces</span>
        <button aria-label="Close tools menu" title="Close tools menu"
          onClick={() => { setModuleMenuOpen(false); moduleMenuButtonRef.current?.focus(); }}>
          <X size={17} aria-hidden="true"/>
        </button>
      </header>
      <nav aria-label="All workspaces">
        {groups.map(group => <section key={group} aria-label={group}>
          <h3>{group}</h3>
          {modules.filter(item=>item.group===group &&
            !['word','spreadsheet','presentation','ai'].includes(item.id)).map(item =>
            <button className={!activeSessionId && active===item.id?'nav-item active':'nav-item'}
              onClick={()=>selectModule(item.id)} key={item.id}
              title={item.name} aria-label={item.name}>
              <span className="nav-glyph" aria-hidden="true"><ModuleNavIcon module={item.id}/></span>
              <span className="nav-label">{item.name}</span>
            </button>
          )}
        </section>)}
      </nav>
    </aside>

    <main
      id="malenjo-workspace-content"
      tabIndex={-1}
      className={'workspace'+(dropActive ? ' drop-active' : '')+(aiOpen ? ' ai-panel-open' : '')}
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
        accept=".pdf,.dxf,.dwg,.dcm,.dicom"
        onChange={(event) => {
          if (event.target.files) openBrowserFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <header className="topbar">
        <div className="suite-title"><strong>MALENJO</strong><small title={activeSession?.document.name ?? module.name}>{activeSession?.document.name ?? module.name}</small></div>
        <div className="topbar-primary">
          <button type="button" className="command topbar-home"
            aria-label="Home" title="Home — start and recent files" onClick={()=>selectModule('home')}>
            <House size={18} aria-hidden="true"/>
          </button>
          <button type="button" className="command topbar-tool-trigger" ref={moduleMenuButtonRef}
            aria-label="All tools" title="All tools — browse MALENJO modules"
            aria-expanded={moduleMenuOpen} aria-haspopup="dialog"
            onClick={()=>setModuleMenuOpen(value=>!value)}>
            <LayoutGrid size={18} aria-hidden="true"/><span>Tools</span><ChevronDown size={12} aria-hidden="true"/>
          </button>
          <span className="ml-top-quick-divider" aria-hidden="true"/>
          <button className="command" type="button" aria-label="Open files"
            title="Open file (Ctrl+O)" onClick={()=>void openDocumentsFromPicker()}>
            <FolderOpen size={18} aria-hidden="true"/>
          </button>
          {([
            ['Save document',saveQuickAction,Save],
            ['Undo document change',undoQuickAction,Undo2],
            ['Redo document change',redoQuickAction,Redo2],
          ] as const).map(([label,action,Icon])=><button
            key={label} type="button" className="command ml-top-document-action"
            aria-label={label}
            title={action?.enabled ? label : action?.disabledReason ?? label+' unavailable until a supported document operation exists'}
            disabled={!action?.enabled}
            onClick={()=>{if(action?.enabled)void action.run();}}>
            <Icon size={18} aria-hidden="true"/>
          </button>)}
        </div>
        <div className="search"><Search size={17}/><input value={query} onFocus={()=>setCommandOpen(true)} onChange={event=>{setQuery(event.target.value);openCommandPalette();}} placeholder="Search commands" aria-label="Search commands"/><kbd>Ctrl K</kbd></div>
        <div className="topbar-actions">
          <button type="button" className="command ml-top-ai" aria-label="MALENJO AI"
            title="MALENJO AI — document assistant" aria-expanded={aiOpen}
            aria-controls="ml-ai-assistant"
            onClick={()=>{setAiHasOpened(true);setAiOpen(value=>!value);setModuleMenuOpen(false);}}>
            <Bot size={20} aria-hidden="true"/>
          </button>
          <button className="command" aria-label="Open command palette" title="Commands (Ctrl+K)" onClick={()=>setCommandOpen(true)}><Command size={19}/></button>
          <button className="theme-toggle command" type="button"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-pressed={theme === 'light'}
            title={theme === 'dark' ? 'Light appearance' : 'Dark appearance'}
            onClick={() => setTheme(current=>nextSuiteTheme(current))}>
            {theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}
          </button>
          <button type="button" className="command" aria-label="User and settings"
            title="Settings and appearance" onClick={()=>selectModule('settings')}>
            <Settings2 size={18} aria-hidden="true"/>
          </button>
        </div>
      </header>

      {workspaceNotices.__open && <div className="ml-open-feedback" role="status">
        <span>{workspaceNotices.__open}</span>
        <button type="button" title="Dismiss file notice" aria-label="Dismiss file notice"
          onClick={()=>setWorkspaceNotices(current=>({...current,__open:''}))}><X size={14} aria-hidden="true"/></button>
      </div>}

      {(activeSession ? workspaceForDocument(activeSession.document.kind) : active) !== 'pdf' && <RibbonShell
        workspace={activeSession ? workspaceForDocument(activeSession.document.kind) : active}
        onNavigate={selectModule}
        onOpenFiles={() => void openDocumentsFromPicker()}
      />}

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

      {aiHasOpened && <aside id="ml-ai-assistant" className={aiOpen?'ml-ai-drawer is-open':'ml-ai-drawer'}
        aria-label="MALENJO AI document assistant" aria-hidden={!aiOpen} inert={!aiOpen}>
        <div className="ml-ai-drawer-title">
          <Bot size={19} aria-hidden="true"/><strong>MALENJO AI</strong>
          <span>Local assistant</span>
          <button type="button" aria-label="Close MALENJO AI" title="Close assistant"
            onClick={()=>setAiOpen(false)}><X size={18} aria-hidden="true"/></button>
        </div>
        <AiWorkspace compact openDocuments={openDocumentsForAi}
          onBackToFiles={()=>{setAiOpen(false);selectModule('files');}}/>
      </aside>}

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
          inert={session.id !== activeSessionId}
        >{renderDocumentWorkspace(session)}</section>)}
      </div>}

      {!activeSession && (active === 'home'
        ? <HomeWorkspace
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectModule={selectModule}
            onActivateSession={activateSession}
            onOpenDocument={openFromLibrary}
            onOpenDocuments={()=>void openDocumentsFromPicker()}
            onOpenCommandPalette={()=>{setQuery('');openCommandPalette();}}
          />
        : active === 'files'
          ? <FileLibrary onOpen={openFromLibrary}/>
          : active === 'pdf'
            ? <PdfWorkspace
                session={null}
                active
                notice={workspaceNotices.__open ?? ''}
                onBackToFiles={()=>selectModule('files')}
                onOpenBrowserPdf={(file)=>openBrowserFiles([file])}
                onNavigateModule={(id)=>selectModule(id)}
              />
            : active === 'word' || active === 'spreadsheet' || active === 'presentation'
              ? <OfficeWorkspace
                  kind={active === 'word' ? 'docx' : active === 'spreadsheet' ? 'xlsx' : 'pptx'}
                  session={null}
                  active
                  onBackToFiles={()=>selectModule('files')}
                  onOpenBrowserOffice={(file)=>openBrowserFiles([file])}
                />
            : active === 'scanner'
            ? <ScannerWorkspace mode="scanner" onBackToFiles={()=>selectModule('files')}/>
            : active === 'ocr'
              ? <ScannerWorkspace mode="ocr" onBackToFiles={()=>selectModule('files')}/>
              : active === 'ai'
                ? <AiWorkspace openDocuments={openDocumentsForAi} onBackToFiles={()=>selectModule('files')}/>
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
                              : active === 'settings'
                                ? <SettingsWorkspace theme={theme} onThemeChange={setTheme}/>
                                : active === 'help'
                                  ? <HelpWorkspace openDocumentCount={sessions.length}/>
                                  : active === 'cad' || active === 'dicom' || active === 'invoice' || active === 'account'
                                    ? <CapabilityWorkspace module={active} onNavigate={selectModule}/>
                                    : <ModuleView module={module} session={null} notice="" onSaveAs={async()=>{}} onBackToFiles={()=>selectModule('files')}/>)}
    </main>
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
        <span className="status large foundation">NOT RELEASE-READY</span>
      </div>
    </div>
    <div className="canvas-placeholder">
      <div className="canvas-toolbar">
        <button onClick={onBackToFiles}>Files</button>
        <button disabled={!document || session?.saving || !!document?.browserFile} onClick={() => void onSaveAs()}>Save a copy</button>
        <span className="module-unavailable-reason">Editing, export and printing are unavailable in this workspace.</span>
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
