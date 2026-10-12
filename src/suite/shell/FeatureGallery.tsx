import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, Bot, CalendarClock, CheckSquare, ChevronDown, ClipboardCheck,
  Crop, FileCog, FileText, FolderOpen, HeartPulse, Image, Layers, ListOrdered,
  Lock, MailCheck, Merge, MessageSquare, PenTool, Printer, RotateCw, Ruler,
  ScanLine, Scissors, Search, Shield, ShieldCheck, Stamp, Table2, Type,
  Workflow, X, type LucideIcon,
} from 'lucide-react';
import {
  PDF_COMMANDS, UNVERIFIED_COMMAND_REASON,
  type PDFCommand, type PDFRibbonCategory,
} from '../commands/masterCatalog';

const ICONS: Record<string, LucideIcon> = {
  files: Merge, scissors: Scissors, 'list-ordered': ListOrdered,
  'trash-2': X, copy: FileText, 'file-plus-2': FileText,
  'rotate-cw': RotateCw, crop: Crop, 'layout-grid': Layers,
  layers: Layers, type: Type, 'align-left': FileText,
  baseline: Type, image: Image, shapes: Layers, pencil: PenTool,
  'panel-top': FileText, stamp: Stamp, 'file-cog': FileCog,
  bookmark: FileText, history: RotateCw, 'minimize-2': Archive,
  archive: Archive, wrench: ClipboardCheck, 'scan-text': ScanLine,
  'scan-line': ScanLine, 'image-off': Image, images: Image,
  'file-text': FileText, presentation: FileText, 'table-2': Table2,
  'code-2': FileText, 'file-code-2': FileText, folders: FolderOpen,
  'form-input': FileText, 'text-cursor-input': Type,
  'check-square': CheckSquare, 'pen-tool': PenTool,
  workflow: Workflow, 'scan-search': Search, 'file-check-2': ClipboardCheck,
  database: Layers, highlighter: PenTool, 'message-square': MessageSquare,
  'messages-square': MessageSquare, ruler: Ruler, 'git-compare': Layers,
  users: MessageSquare, 'shield-check': ShieldCheck, unlock: Lock,
  'scan-eye': Shield, 'shield-alert': Shield, signature: PenTool,
  'mail-check': MailCheck, hash: FileText, 'clipboard-check': ClipboardCheck,
  shield: Shield, eraser: PenTool, bot: Bot, list: ListOrdered,
  languages: FileText, 'spell-check': FileText, table: Table2,
  'search-check': Search, receipt: FileText, 'credit-card': Lock,
  'mail-merge': MailCheck, plug: Workflow, 'calendar-clock': CalendarClock,
  box: Layers, 'heart-pulse': HeartPulse, printer: Printer,
};

export function PdfFeatureIcon({ icon, size = 21 }: { icon: string; size?: number }) {
  const Icon = ICONS[icon] ?? FileText;
  return <Icon size={size} strokeWidth={1.8} aria-hidden="true"/>;
}

interface Props {
  category: PDFRibbonCategory;
  open: boolean;
  onClose(): void;
  id: string;
  /** Category-filtered by default; searchable full catalog from the All tab. */
}

/** One reusable view over the actual MAL-001–MAL-090 source of truth.
 * No unavailable capability is rendered as a working command. */
export default function FeatureGallery({category, open, onClose, id}: Props) {
  const [query,setQuery] = useState('');
  const [all,setAll] = useState(false);
  const searchRef=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(open)searchRef.current?.focus();},[open]);
  useEffect(()=>{setQuery('');setAll(false);},[category]);
  const items=useMemo(()=>{
    const q=query.trim().toLowerCase();
    const source=all || category==='Home' || q ? PDF_COMMANDS
      : PDF_COMMANDS.filter(command=>command.category===category);
    return source.filter(command=>
      !q || [command.id,command.label,command.category,command.requirementGroup,command.expectedOutput]
        .join(' ').toLowerCase().includes(q));
  },[category,all,query]);

  if(!open)return null;
  return <section className="ml-feature-gallery" id={id} aria-label="PDF capability gallery"
    onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();onClose();}}}>
    <header className="ml-feature-gallery-header">
      <div><strong>PDF tools</strong><span>90 capabilities · verified actions only</span></div>
      <button type="button" title="Close PDF tools" aria-label="Close PDF tools" onClick={onClose}><X size={18}/></button>
    </header>
    <div className="ml-feature-gallery-controls">
      <label htmlFor={id+'-search'} className="visually-hidden">Search all PDF tools</label>
      <Search size={17} aria-hidden="true"/>
      <input ref={searchRef} id={id+'-search'} type="search" placeholder="Search by name or MAL-001…MAL-090"
        value={query} onChange={event=>setQuery(event.target.value)}/>
      <button type="button" className={all?'selected':''} aria-pressed={all}
        title="Show all 90 PDF capabilities" onClick={()=>setAll(value=>!value)}>
        {all?'All 90':'All tools'} <ChevronDown size={14} aria-hidden="true"/>
      </button>
    </div>
    <div className="ml-feature-gallery-scroll">
      <div className="ml-feature-gallery-count" role="status">{items.length} tools · unavailable items are shown for planning, not execution</div>
      <div className="ml-feature-gallery-grid">
        {items.map((command:PDFCommand)=><div className="ml-feature-gallery-item"
          key={command.id} title={command.tooltip}>
          <span className="ml-feature-gallery-symbol"><PdfFeatureIcon icon={command.icon}/></span>
          <span className="ml-feature-gallery-copy">
            <strong>{command.label}</strong>
            <small>{command.id} · {command.category}</small>
            <span>{command.expectedOutput}</span>
          </span>
          <button type="button" disabled aria-label={command.id+' '+command.label+' — Not release-ready'}
            title={command.tooltip} aria-description={UNVERIFIED_COMMAND_REASON}>
            Unavailable
          </button>
        </div>)}
      </div>
      {!items.length&&<p role="status">No PDF command matches “{query}”. Try a name or MAL requirement number.</p>}
    </div>
  </section>;
}
