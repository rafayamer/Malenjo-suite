import { useMemo, useState } from 'react';
import { Activity, Command, FilePlus2, FolderOpen, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { modules } from '../modules/registry';
import type { ModuleId } from '../core/types';
import FileLibrary from '../files/FileLibrary';
import RecentDocuments from '../files/RecentDocuments';
import { workspaceForDocument } from '../files/route';
import { createDocumentSession, markDocumentDirty, markDocumentSaved, type DocumentSession } from '../files/session';
import type { LibraryDocument } from '../files/types';
import { saveAsLibraryDocument } from '../files/api';
import PdfWorkspace from '../pdf/PdfWorkspace';
import OfficeWorkspace from '../office/OfficeWorkspace';
import ScannerWorkspace from '../scanner/ScannerWorkspace';
import AiWorkspace from '../ai/AiWorkspace';

const quick: Array<{label:string; icon:typeof FolderOpen; target:ModuleId}> = [
  {label:'Open document', icon: FolderOpen, target:'files'},
  {label:'New document', icon: FilePlus2, target:'word'},
  {label:'Private AI', icon: Sparkles, target:'ai'},
  {label:'Security scan', icon: ShieldCheck, target:'security'},
];

export default function App() {
  const [active, setActive] = useState<ModuleId>('home');
  const [query, setQuery] = useState('');
  const [session, setSession] = useState<DocumentSession | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const module = modules.find((item) => item.id === active) ?? modules[0];
  const groups = useMemo(() => ['Core','Create','Intelligence','Enterprise','System'] as const, []);

  function selectModule(id: ModuleId) {
    setActive(id);
    setWorkspaceNotice('');
    if (id === 'home' || id === 'files') setSession(null);
  }

  function openFromLibrary(document: LibraryDocument) {
    setSession(createDocumentSession(document));
    setWorkspaceNotice('');
    setActive(workspaceForDocument(document.kind));
  }

  async function saveSessionAs() {
    if (!session) return;
    try {
      const copy = await saveAsLibraryDocument(session.document);
      if (!copy) return;
      setSession((current) => current ? markDocumentSaved(current, copy) : current);
      setActive(workspaceForDocument(copy.kind));
      setWorkspaceNotice(`Saved a copy as ${copy.name} and added it to the MALENJO library.`);
    } catch (error) {
      setWorkspaceNotice(String(error));
    }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">M</div><div><strong>MALENJO</strong><span>SUITE</span></div></div>
      <nav>
        {groups.map(group => <section key={group}><h3>{group}</h3>{modules.filter(item=>item.group===group).map(item =>
          <button className={active===item.id?'nav-item active':'nav-item'} onClick={()=>selectModule(item.id)} key={item.id}>
            <span>{item.name}</span><small>{item.status==='ready'?'●':'○'}</small>
          </button>
        )}</section>)}
      </nav>
      <div className="local-state"><Activity size={16}/><div><b>Local-first</b><span>Core shell ready · network optional</span></div></div>
    </aside>

    <main className="workspace">
      <header className="topbar">
        <div className="search"><Search size={17}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search files, tools and commands"/><kbd>Ctrl K</kbd></div>
        <button className="command"><Command size={17}/> Commands</button>
      </header>

      {active === 'home'
        ? <Home onSelect={selectModule} onOpen={openFromLibrary}/>
        : active === 'files'
          ? <FileLibrary onOpen={openFromLibrary}/>
          : active === 'pdf'
            ? <PdfWorkspace session={session} notice={workspaceNotice} onSaveAs={saveSessionAs} onBackToFiles={()=>selectModule('files')}/>
            : active === 'word'
              ? <OfficeWorkspace kind="docx" session={session} onBackToFiles={()=>selectModule('files')} onDirtyChange={(dirty)=>setSession((current)=>current && dirty ? markDocumentDirty(current) : current)}/>
              : active === 'spreadsheet'
                ? <OfficeWorkspace kind="xlsx" session={session} onBackToFiles={()=>selectModule('files')} onDirtyChange={(dirty)=>setSession((current)=>current && dirty ? markDocumentDirty(current) : current)}/>
                : active === 'presentation'
                  ? <OfficeWorkspace kind="pptx" session={session} onBackToFiles={()=>selectModule('files')} onDirtyChange={(dirty)=>setSession((current)=>current && dirty ? markDocumentDirty(current) : current)}/>
                  : active === 'scanner'
                    ? <ScannerWorkspace mode="scanner" onBackToFiles={()=>selectModule('files')}/>
                    : active === 'ocr'
                      ? <ScannerWorkspace mode="ocr" onBackToFiles={()=>selectModule('files')}/>
                      : active === 'ai'
                        ? <AiWorkspace onBackToFiles={()=>selectModule('files')}/>
                        : <ModuleView module={module} session={session} notice={workspaceNotice} onSaveAs={saveSessionAs} onBackToFiles={()=>selectModule('files')}/>}
    </main>
  </div>
}

function Home({onSelect,onOpen}:{onSelect:(id:ModuleId)=>void;onOpen:(document:LibraryDocument)=>void}) {
  return <div className="content">
    <div className="hero"><div><p className="eyebrow">LOCAL-FIRST DOCUMENT PLATFORM</p><h1>Your documents. One private workspace.</h1><p>MALENJO combines PDF, Office, OCR, private AI, signing, metadata, automation and enterprise tools behind one consistent desktop shell.</p></div><div className="hero-mark">M</div></div>
    <div className="quick-grid">{quick.map(({label,icon:Icon,target})=><button key={label} onClick={()=>onSelect(target)}><Icon size={21}/><span>{label}</span></button>)}</div>
    <div className="section-head"><div><h2>Workspaces</h2><p>Heavy engines are adapters and load only when a task needs them.</p></div><span className="pill">All student features enabled</span></div>
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
        {session && <span className={session.dirty ? 'session-state dirty' : 'session-state'}>{session.dirty ? 'Unsaved changes' : 'Saved'}</span>}
        <span className={'status large '+module.status}>{module.status}</span>
      </div>
    </div>
    <div className="canvas-placeholder">
      <div className="canvas-toolbar">
        <button onClick={onBackToFiles}>Files</button>
        <button disabled={!session?.dirty}>Save</button>
        <button disabled={!document} onClick={() => void onSaveAs()}>Save As</button>
        <button disabled={!document}>Export</button>
        <button disabled={!document}>Print</button>
        <button>More</button>
      </div>
      {notice && <div className="workspace-notice">{notice}</div>}
      <div className="empty-state">
        <div className="empty-icon">M</div>
        <h2>{document ? document.name : `${module.name} adapter boundary is ready`}</h2>
        <p>{document
          ? <>The document is registered in the MALENJO library and routed to this workspace. Editing/rendering is the next adapter phase for <strong>{module.engine}</strong>.</>
          : <>The shell, routing, feature registration and engine contract are established. The next implementation phase connects <strong>{module.engine}</strong> without exposing it as a second application.</>}</p>
        <div className="notice"><ShieldCheck size={18}/>External engines must pass license, security, offline and fidelity tests before permanent integration.</div>
      </div>
    </div>
  </div>
}
