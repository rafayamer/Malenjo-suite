import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown, LayoutGrid, Search, X,
  Files,
  Scissors,
  ListOrdered,
  Trash2,
  Copy,
  FilePlus2,
  RotateCw,
  Crop,
  Layers,
  Type,
  AlignLeft,
  Baseline,
  Image,
  Shapes,
  Pencil,
  PanelTop,
  Stamp,
  FileCog,
  Bookmark,
  History,
  Minimize2,
  Archive,
  Wrench,
  ScanText,
  ScanLine,
  ImageOff,
  Images,
  FileText,
  Presentation,
  Table2,
  Code2,
  FileCode2,
  Folders,
  FormInput,
  TextCursorInput,
  CheckSquare,
  PenTool,
  Workflow,
  ScanSearch,
  FileCheck2,
  Database,
  Highlighter,
  MessageSquare,
  MessagesSquare,
  Ruler,
  GitCompare,
  Users,
  ShieldCheck,
  Unlock,
  ScanEye,
  ShieldAlert,
  Signature,
  MailCheck,
  Hash,
  ClipboardCheck,
  Shield,
  Eraser,
  Bot,
  List,
  Languages,
  SpellCheck,
  Table,
  SearchCheck,
  Receipt,
  CreditCard,
  Mail,
  Plug,
  CalendarClock,
  Box,
  HeartPulse,
  Printer,
  type LucideIcon,
} from 'lucide-react';
import {
  PDF_COMMANDS, LEGACY_TOOL_REQUIREMENTS,
  type PDFCommand, type PDFRibbonCategory,
} from '../commands/masterCatalog';

const CATALOG_ICONS: Record<string,LucideIcon> = {
  "files":Files,
  "scissors":Scissors,
  "list-ordered":ListOrdered,
  "trash-2":Trash2,
  "copy":Copy,
  "file-plus-2":FilePlus2,
  "rotate-cw":RotateCw,
  "crop":Crop,
  "layout-grid":LayoutGrid,
  "layers":Layers,
  "type":Type,
  "align-left":AlignLeft,
  "baseline":Baseline,
  "image":Image,
  "shapes":Shapes,
  "pencil":Pencil,
  "panel-top":PanelTop,
  "stamp":Stamp,
  "file-cog":FileCog,
  "bookmark":Bookmark,
  "history":History,
  "minimize-2":Minimize2,
  "archive":Archive,
  "wrench":Wrench,
  "scan-text":ScanText,
  "scan-line":ScanLine,
  "image-off":ImageOff,
  "images":Images,
  "file-text":FileText,
  "presentation":Presentation,
  "table-2":Table2,
  "code-2":Code2,
  "file-code-2":FileCode2,
  "folders":Folders,
  "form-input":FormInput,
  "text-cursor-input":TextCursorInput,
  "check-square":CheckSquare,
  "pen-tool":PenTool,
  "workflow":Workflow,
  "scan-search":ScanSearch,
  "file-check-2":FileCheck2,
  "database":Database,
  "highlighter":Highlighter,
  "message-square":MessageSquare,
  "messages-square":MessagesSquare,
  "ruler":Ruler,
  "git-compare":GitCompare,
  "users":Users,
  "shield-check":ShieldCheck,
  "unlock":Unlock,
  "scan-eye":ScanEye,
  "shield-alert":ShieldAlert,
  "signature":Signature,
  "mail-check":MailCheck,
  "hash":Hash,
  "clipboard-check":ClipboardCheck,
  "shield":Shield,
  "eraser":Eraser,
  "bot":Bot,
  "list":List,
  "languages":Languages,
  "spell-check":SpellCheck,
  "table":Table,
  "search-check":SearchCheck,
  "receipt":Receipt,
  "credit-card":CreditCard,
  "mail-merge":Mail,
  "plug":Plug,
  "calendar-clock":CalendarClock,
  "box":Box,
  "heart-pulse":HeartPulse,
  "printer":Printer,
};

/** This validation is checked in CI so a new feature can't silently display a generic icon. */
export function catalogMissingIcons():readonly string[] {
  return [...new Set(PDF_COMMANDS.filter(command=>!CATALOG_ICONS[command.icon]).map(command=>command.icon))];
}

export function pdfCatalogCommands(category:PDFRibbonCategory):readonly PDFCommand[]{
  if(category !== 'Home') return PDF_COMMANDS.filter(command=>command.category===category);
  const ids=new Set(LEGACY_TOOL_REQUIREMENTS.flatMap(item=>item.requirementIds));
  return PDF_COMMANDS.filter(command=>ids.has(command.id));
}

export default function PdfCatalogGallery({category}:{category:PDFRibbonCategory}){
  const [open,setOpen]=useState(false);
  const [query,setQuery]=useState('');
  const [position,setPosition]=useState({left:8,top:90,width:380,maxHeight:500});
  const trigger=useRef<HTMLButtonElement>(null);
  const search=useRef<HTMLInputElement>(null);
  const popup=useRef<HTMLElement>(null);
  const popupId=useId();

  const commands=pdfCatalogCommands(category);
  const filtered=commands.filter(command=>{
    const text=`${command.id} ${command.label} ${command.expectedOutput} ${command.tooltip}`.toLowerCase();
    return query.trim().toLowerCase().split(/\s+/).every(term=>text.includes(term));
  });

  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{
      const box=trigger.current?.getBoundingClientRect();
      if(!box)return;
      const width=Math.min(420,window.innerWidth-16);
      const top=Math.max(8,Math.min(box.bottom+5,window.innerHeight-245));
      setPosition({
        left:Math.max(8,Math.min(box.left,window.innerWidth-width-8)),
        top,width,maxHeight:Math.max(205,window.innerHeight-top-8),
      });
    };
    place();
    window.addEventListener('resize',place);
    window.addEventListener('scroll',place,true);
    return()=>{
      window.removeEventListener('resize',place);
      window.removeEventListener('scroll',place,true);
    };
  },[open,category]);

  useEffect(()=>{
    if(!open)return;
    search.current?.focus();
    const handleKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const handlePointer=(event:PointerEvent)=>{
      if(event.target instanceof Node &&
        !trigger.current?.contains(event.target) &&
        !popup.current?.contains(event.target))setOpen(false);
    };
    document.addEventListener('keydown',handleKey);
    document.addEventListener('pointerdown',handlePointer);
    return()=>{
      document.removeEventListener('keydown',handleKey);
      document.removeEventListener('pointerdown',handlePointer);
    };
  },[open]);

  return <div className="ml-catalog-trigger-wrap">
    <button ref={trigger} type="button" className="ml-catalog-trigger"
      aria-label={`Browse ${category} tools`} title={`More ${category} tools — browse features and availability`}
      aria-expanded={open} aria-controls={open?popupId:undefined}
      aria-haspopup="dialog"
      onClick={()=>{setQuery('');setOpen(value=>!value);}}>
      <LayoutGrid size={19} strokeWidth={1.7} aria-hidden="true"/>
      <span>More tools</span><ChevronDown size={13} aria-hidden="true"/>
    </button>
    {open && createPortal(
      <aside ref={popup} id={popupId} className="ml-catalog-popup"
        role="dialog" aria-label={`${category} PDF feature catalog`}
        style={{left:position.left,top:position.top,width:position.width,maxHeight:position.maxHeight}}>
        <header>
          <div><strong>{category==='Home'?'Original PDF tools':category+' tools'}</strong>
            <p>Feature discovery · unverified commands are not executable</p></div>
          <button type="button" aria-label="Close feature catalog" title="Close feature catalog"
            onClick={()=>{setOpen(false);trigger.current?.focus();}}>
            <X size={17} aria-hidden="true"/>
          </button>
        </header>
        <div className="ml-catalog-search">
          <Search size={15} aria-hidden="true"/>
          <input ref={search} type="search" value={query}
            onChange={event=>setQuery(event.target.value)}
            aria-label={`Search ${category} PDF tools`} placeholder="Find a tool by name or MAL ID"/>
        </div>
        <ul className="ml-catalog-items" aria-label={`${category} feature list`}>
          {filtered.map(command=>{
            const Icon=CATALOG_ICONS[command.icon] ?? LayoutGrid;
            return <li key={command.id}>
              <div tabIndex={0} role="note" className="ml-catalog-unavailable"
                title={command.tooltip} aria-label={`${command.id} — ${command.label}: Not release-ready`}>
                <Icon size={19} strokeWidth={1.7} aria-hidden="true"/>
                <span className="ml-catalog-item-label">
                  <strong>{command.label}</strong><small>{command.id} · {command.expectedOutput}</small>
                </span>
                <span className="ml-catalog-state">Unavailable</span>
              </div>
            </li>;
          })}
        </ul>
        {!filtered.length && <p role="status" className="ml-catalog-empty">No matching {category.toLowerCase()} features.</p>}
        <footer>These commands become available only after verified processing and output acceptance.</footer>
      </aside>,document.body)}
  </div>;
}
