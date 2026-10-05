import { useMemo, useState } from 'react';
import { Activity, Command, FilePlus2, FolderOpen, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { modules } from '../modules/registry';
import type { ModuleId } from '../core/types';

const quick = [
  {label:'Open document', icon: FolderOpen},
  {label:'New document', icon: FilePlus2},
  {label:'Private AI', icon: Sparkles},
  {label:'Security scan', icon: ShieldCheck},
];

export default function App() {
  const [active, setActive] = useState<ModuleId>('home');
  const [query, setQuery] = useState('');
  const module = modules.find((m) => m.id === active) ?? modules[0];
  const groups = useMemo(() => ['Core','Create','Intelligence','Enterprise','System'] as const, []);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">M</div><div><strong>MALENJO</strong><span>SUITE</span></div></div>
      <nav>
        {groups.map(group => <section key={group}><h3>{group}</h3>{modules.filter(m=>m.group===group).map(m =>
          <button className={active===m.id?'nav-item active':'nav-item'} onClick={()=>setActive(m.id)} key={m.id}>
            <span>{m.name}</span><small>{m.status==='ready'?'●':'○'}</small>
          </button>
        )}</section>)}
      </nav>
      <div className="local-state"><Activity size={16}/><div><b>Local-first</b><span>Core shell ready · network optional</span></div></div>
    </aside>

    <main className="workspace">
      <header className="topbar">
        <div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search files, tools and commands"/><kbd>Ctrl K</kbd></div>
        <button className="command"><Command size={17}/> Commands</button>
      </header>
      {active === 'home' ? <Home onSelect={setActive}/> : <ModuleView module={module} />}
    </main>
  </div>
}

function Home({onSelect}:{onSelect:(id:ModuleId)=>void}) {
  return <div className="content">
    <div className="hero"><div><p className="eyebrow">LOCAL-FIRST DOCUMENT PLATFORM</p><h1>Your documents. One private workspace.</h1><p>MALENJO combines PDF, Office, OCR, private AI, signing, metadata, automation and enterprise tools behind one consistent desktop shell.</p></div><div className="hero-mark">M</div></div>
    <div className="quick-grid">{quick.map(({label,icon:Icon})=><button key={label}><Icon size={21}/><span>{label}</span></button>)}</div>
    <div className="section-head"><div><h2>Workspaces</h2><p>Heavy engines are adapters and load only when a task needs them.</p></div><span className="pill">All student features enabled</span></div>
    <div className="module-grid">{modules.filter(m=>!['home','settings','account','help'].includes(m.id)).map(m=><button className="module-card" key={m.id} onClick={()=>onSelect(m.id)}><div className="card-top"><span className={'status '+m.status}>{m.status}</span><span>↗</span></div><h3>{m.name}</h3><p>{m.description}</p><footer>{m.engine}</footer></button>)}</div>
  </div>
}

function ModuleView({module}:{module:(typeof modules)[number]}) {
  return <div className="content module-view">
    <div className="module-title"><div><p className="eyebrow">WORKSPACE</p><h1>{module.name}</h1><p>{module.description}</p></div><span className={'status large '+module.status}>{module.status}</span></div>
    <div className="canvas-placeholder"><div className="canvas-toolbar"><button>Open</button><button>Save</button><button>Export</button><button>Print</button><button>Share</button><button>More</button></div><div className="empty-state"><div className="empty-icon">M</div><h2>{module.name} adapter boundary is ready</h2><p>The shell, routing, feature registration and engine contract are established. The next implementation phase connects <strong>{module.engine}</strong> without exposing it as a second application.</p><div className="notice"><ShieldCheck size={18}/>External engines must pass license, security, offline and fidelity tests before permanent integration.</div></div></div>
  </div>
}
