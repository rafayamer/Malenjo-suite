import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Bot, Database, FileOutput, FileText, FolderOpen, HardDrive, HelpCircle,
  Home, ScanLine, Search, Settings, ShieldCheck, Stethoscope, Receipt, UserRound, Ruler,
  Workflow, PenTool, FileStack, Pencil, Layers, WandSparkles, FormInput, Eye, Lock, Grid2X2,
  Ellipsis, X, type LucideIcon,
} from 'lucide-react';
import type { ModuleId } from '../core/types';
import { PDF_COMMANDS, type PDFRibbonCategory } from '../commands/masterCatalog';
import { defaultRibbonTab, RIBBON_TABS, specialistRibbonActions, type RibbonTabId } from './ribbonModel';

interface Props {
  workspace: ModuleId;
  onNavigate(id: ModuleId): void;
  onOpenFiles(): void;
}

const icons: Record<string, LucideIcon> = {
  open: FolderOpen, start: Home, library: FolderOpen, pdf: FileText,
  viewer: FileText, metadata: FileStack, 'to-word': FileOutput,
  'to-excel': FileOutput, 'to-slides': FileOutput,
  sign: PenTool, security: ShieldCheck,
  scanner: ScanLine, ocr: Search, ai: Bot,
  cad: HardDrive, dicom: Stethoscope,
  automation: Workflow, dms: Database, backup: HardDrive,
  settings: Settings, help: HelpCircle,
};

export default function RibbonShell({ workspace, onNavigate, onOpenFiles }: Props) {
  const [selected, setSelected] = useState<RibbonTabId>(() => defaultRibbonTab(workspace));
  const tabListRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreSearchRef = useRef<HTMLInputElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  // Large per-requirement icon pack loads only when the 90-command catalogue
  // is opened; it must not penalize first paint of Home or other workspaces.
  const [requirementIcons,setRequirementIcons]=useState<Readonly<Record<string,LucideIcon>>|null>(null);
  useEffect(()=>{
    if(!moreOpen||requirementIcons)return;
    let alive=true;
    void import('../pdf/masterFeatureIcons').then(module=>{
      if(alive)setRequirementIcons(module.MASTER_FEATURE_ICON_BY_ID);
    });
    return()=>{alive=false;};
  },[moreOpen,requirementIcons]);
  const [moreQuery, setMoreQuery] = useState('');
  useEffect(() => {setSelected(defaultRibbonTab(workspace));setMoreOpen(false);}, [workspace]);
  useEffect(() => { if(moreOpen)moreSearchRef.current?.focus(); }, [moreOpen]);
  const current = RIBBON_TABS.find((tab) => tab.id === selected)!;
  const specialistCommands = selected === defaultRibbonTab(workspace)
    ? specialistRibbonActions(workspace) : null;
  const actions = specialistCommands ?? current.actions;
  const matchingCommands = useMemo(() => PDF_COMMANDS.filter(command => {
    const q=moreQuery.trim().toLowerCase();
    return !q || (command.id+' '+command.label+' '+command.category+' '+command.requirementGroup)
      .toLowerCase().includes(q);
  }), [moreQuery]);
  const categories = useMemo(() => Array.from(new Set(PDF_COMMANDS.map(item=>item.category))), []);
  const commandIcons:Record<PDFRibbonCategory,LucideIcon> = {
    Home:Home, Edit:Pencil, Organize:Layers, Optimize:WandSparkles,
    Convert:FileOutput, Forms:FormInput, Review:Eye, Protect:Lock,
    Automate:Workflow, Tools:Grid2X2,
  };
  const specialistIcon = workspace === 'cad' ? Ruler : workspace === 'dicom' ? Stethoscope
    : workspace === 'invoice' ? Receipt : UserRound;

  function tabKeyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const next = event.key === 'Home' ? 0 : event.key === 'End'
      ? RIBBON_TABS.length - 1 : direction
        ? (index + direction + RIBBON_TABS.length) % RIBBON_TABS.length
        : null;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      actionsRef.current?.querySelector<HTMLButtonElement>('.suite-ribbon-action:not(:disabled)')?.focus();
      return;
    }
    if (next === null) return;
    event.preventDefault();
    setSelected(RIBBON_TABS[next].id);
    tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return <section className="suite-ribbon" aria-label="MALENJO document and workspace ribbon">
    <div className="suite-ribbon-tabs" role="tablist" aria-label="Ribbon categories" ref={tabListRef}>
      {RIBBON_TABS.map((tab, index) => <button
        key={tab.id}
        type="button"
        role="tab"
        aria-selected={selected === tab.id}
        aria-controls="suite-ribbon-actions"
        id={'suite-ribbon-tab-' + tab.id}
        tabIndex={selected === tab.id ? 0 : -1}
        onClick={() => setSelected(tab.id)}
        onKeyDown={(event) => tabKeyboard(event, index)}
      >{tab.label}</button>)}
    </div>
    <div className="suite-ribbon-actions" id="suite-ribbon-actions" ref={actionsRef} role="tabpanel"
      aria-labelledby={'suite-ribbon-tab-' + selected}>
      {actions.map((action) => {
        const Icon = icons[action.id] ?? (specialistCommands ? specialistIcon : commandIcons[current.label as PDFRibbonCategory] ?? FileText);
        return <button
          key={action.id}
          type="button"
          className="suite-ribbon-action"
          title={action.unavailableReason || action.description || action.label}
          disabled={Boolean(action.unavailableReason)}
          aria-label={action.label}
          onClick={() => {
            if (action.unavailableReason) return;
            if (action.opensFiles) onOpenFiles();
            else if (action.destination) onNavigate(action.destination);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              tabListRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
            }
          }}
        ><Icon size={22} strokeWidth={1.7}/><span>{action.label}</span></button>;
      })}
      <button type="button" ref={moreButtonRef} className="suite-ribbon-more"
        aria-label="More PDF tools" title="More PDF tools — search all 90 requirements"
        aria-expanded={moreOpen} aria-controls="malenjo-complete-feature-catalog"
        onClick={()=>setMoreOpen(value=>!value)}>
        <Ellipsis size={20} aria-hidden="true"/><span>More Tools</span>
      </button>
      {selected === 'convert' && <p className="suite-ribbon-hint" role="note">
        Office outputs will open only after verified PDF conversion. Direct Office file imports remain a temporary development path until the replacement workflow is ready.
      </p>}
    </div>
    {moreOpen && <section id="malenjo-complete-feature-catalog" role="dialog"
      aria-label="All 90 PDF tools" className="ml-command-catalog"
      onKeyDown={event=>{
        if(event.key==='Escape'){event.preventDefault();setMoreOpen(false);moreButtonRef.current?.focus();}
      }}>
      <header>
        <div><strong>PDF Tools</strong><small>All 90 features · unverified tools are unavailable</small></div>
        <button type="button" aria-label="Close PDF tools" title="Close PDF tools"
          onClick={()=>{setMoreOpen(false);moreButtonRef.current?.focus();}}><X size={18}/></button>
      </header>
      <label htmlFor="malenjo-feature-search">Find a PDF tool</label>
      <input id="malenjo-feature-search" ref={moreSearchRef} type="search"
        value={moreQuery} onChange={event=>setMoreQuery(event.target.value)}
        placeholder="Search 90 PDF features by name or MAL number"/>
      <div className="ml-command-catalog-scroll">
        {categories.map(category=>{
          const subset=matchingCommands.filter(item=>item.category===category);
          if(!subset.length)return null;
          return <section key={category} aria-label={category+' features'}>
            <h3>{category} <small>{subset.length}</small></h3>
            <div className="ml-command-catalog-grid">
              {subset.map(command=><div key={command.id} className="ml-command-catalog-entry" tabIndex={0}
                role="group" aria-label={command.id+' '+command.label+' — Not release-ready. '+command.tooltip}
                title={command.tooltip} data-mal-command={command.id}>
                <span className="ml-command-catalog-icon">
                  {(() => {const Glyph=requirementIcons?.[command.id] ?? commandIcons[category];return <Glyph size={20} aria-hidden="true"/>;})()}
                </span>
                <span className="ml-command-catalog-label"><b>{command.label}</b><small>{command.id} · Not release-ready</small></span>
                <button type="button" disabled aria-label={command.label+' — '+command.id+' unavailable'}
                  title={command.tooltip}>Unavailable</button>
              </div>)}
            </div>
          </section>;
        })}
        {!matchingCommands.length && <p role="status">No PDF tools match your search.</p>}
      </div>
    </section>}
  </section>;
}
