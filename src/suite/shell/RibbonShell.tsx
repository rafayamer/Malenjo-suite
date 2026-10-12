import { useEffect, useState, type KeyboardEvent } from 'react';
import {
  Bot, Database, FileOutput, FileText, FolderOpen, HardDrive, HelpCircle,
  Home, Lock, ScanLine, Search, Settings, ShieldCheck, Stethoscope,
  Workflow, PenTool, FileStack, type LucideIcon,
} from 'lucide-react';
import type { ModuleId } from '../core/types';
import { defaultRibbonTab, RIBBON_TABS, type RibbonTabId } from './ribbonModel';

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
  useEffect(() => setSelected(defaultRibbonTab(workspace)), [workspace]);
  const current = RIBBON_TABS.find((tab) => tab.id === selected)!;

  function tabKeyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const next = event.key === 'Home' ? 0 : event.key === 'End'
      ? RIBBON_TABS.length - 1 : direction
        ? (index + direction + RIBBON_TABS.length) % RIBBON_TABS.length
        : null;
    if (next === null) return;
    event.preventDefault();
    setSelected(RIBBON_TABS[next].id);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return <section className="suite-ribbon" aria-label="MALENJO document and workspace ribbon">
    <div className="suite-ribbon-tabs" role="tablist" aria-label="Ribbon categories">
      {RIBBON_TABS.map((tab, index) => <button
        key={tab.id}
        type="button"
        role="tab"
        aria-selected={selected === tab.id}
        aria-controls="suite-ribbon-actions"
        tabIndex={selected === tab.id ? 0 : -1}
        onClick={() => setSelected(tab.id)}
        onKeyDown={(event) => tabKeyboard(event, index)}
      >{tab.label}</button>)}
    </div>
    <div className="suite-ribbon-actions" id="suite-ribbon-actions" role="tabpanel" aria-label={current.label + ' commands'}>
      {current.actions.map((action) => {
        const Icon = icons[action.id] ?? FileText;
        return <button
          key={action.id}
          type="button"
          className="suite-ribbon-action"
          title={action.unavailableReason || action.label}
          disabled={Boolean(action.unavailableReason)}
          aria-label={action.label}
          onClick={() => {
            if (action.unavailableReason) return;
            if (action.opensFiles) onOpenFiles();
            else if (action.destination) onNavigate(action.destination);
          }}
        ><Icon size={22} strokeWidth={1.7}/><span>{action.label}</span></button>;
      })}
      {selected === 'convert' && <p className="suite-ribbon-hint" role="note">
        Office outputs will open only after verified PDF conversion. Direct Office file imports remain a temporary development path until the replacement workflow is ready.
      </p>}
    </div>
  </section>;
}
