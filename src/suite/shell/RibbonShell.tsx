import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  ChevronDown, Database, FileOutput, FileStack, FileText, FolderOpen,
  HardDrive, HelpCircle, Home, ScanLine, Search, Settings, ShieldCheck,
  Stethoscope, Receipt, UserRound, Ruler, Workflow, PenTool,
  type LucideIcon,
} from 'lucide-react';
import type { ModuleId } from '../core/types';
import { PDF_COMMANDS, PDF_COMMAND_BY_ID, type PDFCommand } from '../commands/masterCatalog';
import FeatureGallery, { PdfFeatureIcon } from './FeatureGallery';
import {
  defaultRibbonTab, RIBBON_TABS, specialistRibbonActions, type RibbonTabId,
} from './ribbonModel';

interface Props {
  workspace: ModuleId;
  onNavigate(id: ModuleId): void;
  onOpenFiles(): void;
}

const icons: Record<string, LucideIcon> = {
  open: FolderOpen, start: Home, library: FolderOpen, pdf: FileText,
  'pdf-edit': PenTool, metadata: FileStack, 'pdf-organize': FileText,
  ocr: Search, scanner: ScanLine, 'to-word': FileOutput,
  'to-excel': FileOutput, 'to-slides': FileOutput, 'form-pdf': FileText,
  'review-pdf': PenTool, sign: PenTool, security: ShieldCheck,
  'metadata-protect': ShieldCheck, automation: Workflow, invoice: Receipt,
  cad: HardDrive, dicom: Stethoscope, dms: Database, settings: Settings,
  help: HelpCircle,
};

export default function RibbonShell({workspace,onNavigate,onOpenFiles}:Props) {
  const [selected,setSelected]=useState<RibbonTabId>(()=>defaultRibbonTab(workspace));
  const [galleryOpen,setGalleryOpen]=useState(false);
  const tabListRef=useRef<HTMLDivElement>(null);
  const actionsRef=useRef<HTMLDivElement>(null);
  const galleryTriggerRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{setSelected(defaultRibbonTab(workspace));setGalleryOpen(false);},[workspace]);
  const current=RIBBON_TABS.find(tab=>tab.id===selected)!;
  const specialistCommands=selected===defaultRibbonTab(workspace)
    ?specialistRibbonActions(workspace):null;
  const actions=specialistCommands??current.actions;
  const specialistIcon=workspace==='cad'?Ruler:workspace==='dicom'?Stethoscope
    :workspace==='invoice'?Receipt:UserRound;
  const featured:readonly PDFCommand[] = current.label==='Home'
    ?['MAL-001','MAL-027','MAL-037','MAL-061']
      .map(id=>PDF_COMMAND_BY_ID.get(id)!).filter(Boolean)
    :PDF_COMMANDS.filter(command=>command.category===current.label).slice(0,3);

  function closeGallery(){
    setGalleryOpen(false);
    galleryTriggerRef.current?.focus();
  }
  function tabKeyboard(event:KeyboardEvent<HTMLButtonElement>,index:number) {
    const direction=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;
    const next=event.key==='Home'?0:event.key==='End'
      ?RIBBON_TABS.length-1:direction
        ?(index+direction+RIBBON_TABS.length)%RIBBON_TABS.length:null;
    if(event.key==='ArrowDown'){
      event.preventDefault();
      actionsRef.current?.querySelector<HTMLButtonElement>('.suite-ribbon-action:not(:disabled)')?.focus();
      return;
    }
    if(next===null)return;
    event.preventDefault();
    setSelected(RIBBON_TABS[next].id);setGalleryOpen(false);
    tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return <section className="suite-ribbon" aria-label="MALENJO PDF ribbon">
    <div className="suite-ribbon-tabs" role="tablist" aria-label="Ribbon categories" ref={tabListRef}>
      {RIBBON_TABS.map((tab,index)=><button key={tab.id} type="button" role="tab"
        aria-selected={selected===tab.id} aria-controls="suite-ribbon-actions"
        id={'suite-ribbon-tab-'+tab.id} tabIndex={selected===tab.id?0:-1}
        onClick={()=>{setSelected(tab.id);setGalleryOpen(false);}}
        onKeyDown={event=>tabKeyboard(event,index)}>{tab.label}</button>)}
    </div>
    <div className="suite-ribbon-actions" id="suite-ribbon-actions" ref={actionsRef} role="tabpanel"
      aria-labelledby={'suite-ribbon-tab-'+selected}>
      {actions.map(action=>{
        const Icon=icons[action.id]??(specialistCommands?specialistIcon:FileText);
        const title=action.unavailableReason
          ?action.label+' — '+action.unavailableReason
          :action.tooltip?action.label+' — '+action.tooltip:action.label;
        return <span key={action.id} className="ml-ribbon-tooltip-wrap" title={title}>
          <button type="button" className="suite-ribbon-action ml-ribbon-primary-action" disabled={Boolean(action.unavailableReason)}
            aria-label={title} title={title}
            onClick={()=>{
              if(action.unavailableReason)return;
              if(action.opensFiles)onOpenFiles();
              else if(action.destination)onNavigate(action.destination);
            }}
            onKeyDown={event=>{
              if(event.key==='Escape'){
                event.preventDefault();
                tabListRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
              }
            }}>
            <Icon size={22} strokeWidth={1.8} aria-hidden="true"/><span>{action.label}</span>
          </button>
        </span>;
      })}
      <span className="ml-ribbon-separator" aria-hidden="true"/>
      {featured.map(command=><span className="ml-ribbon-tooltip-wrap"
        title={command.tooltip} key={command.id}>
        <button type="button" className="suite-ribbon-action ml-ribbon-placeholder" disabled
          aria-label={command.id+' '+command.label+' — Not release-ready'}
          title={command.tooltip}>
          <PdfFeatureIcon icon={command.icon}/>
          <span>{command.label}</span>
        </button>
      </span>)}
      <button type="button" className="suite-ribbon-action ml-ribbon-gallery-trigger"
        ref={galleryTriggerRef}
        title={'Browse '+(current.label==='Home'?'all PDF':'the '+current.label)+' tools (MAL-001–MAL-090)'}
        aria-label="Browse PDF features"
        aria-expanded={galleryOpen} aria-controls="malenjo-ribbon-gallery"
        onClick={()=>setGalleryOpen(value=>!value)}
        onKeyDown={event=>{
          if(event.key==='Escape'){event.preventDefault();tabListRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();}
        }}>
        <FileStack size={21} strokeWidth={1.8} aria-hidden="true"/>
        <ChevronDown size={12} aria-hidden="true"/>
        <span>More PDF tools</span>
      </button>
    </div>
    <FeatureGallery id="malenjo-ribbon-gallery" category={current.label}
      open={galleryOpen} onClose={closeGallery}/>
  </section>;
}
