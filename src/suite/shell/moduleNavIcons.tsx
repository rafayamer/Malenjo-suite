import {
  BrainCircuit, CircleHelp, Database, FilePenLine, FileText, FolderOpen,
  HardDriveDownload, HeartPulse, House, PenTool, Presentation, Receipt,
  Ruler, ScanLine, ScanText, Settings, ShieldCheck, Table2, Tags,
  UserRound, Users, Workflow, type LucideIcon,
} from 'lucide-react';
import type { ModuleId } from '../core/types';

// One icon for every registered module, rather than ambiguous two-letter
// initials. The full accessible module name is owned by the navigation button.
export const MODULE_NAV_ICONS: Record<ModuleId, LucideIcon> = {
  home: House,
  files: FolderOpen,
  pdf: FileText,
  word: FilePenLine,
  spreadsheet: Table2,
  presentation: Presentation,
  scanner: ScanLine,
  ocr: ScanText,
  ai: BrainCircuit,
  sign: PenTool,
  invoice: Receipt,
  metadata: Tags,
  automation: Workflow,
  dms: Database,
  security: ShieldCheck,
  cad: Ruler,
  dicom: HeartPulse,
  admin: Users,
  backup: HardDriveDownload,
  settings: Settings,
  account: UserRound,
  help: CircleHelp,
};

export function ModuleNavIcon({ module }: { module: ModuleId }) {
  const Icon = MODULE_NAV_ICONS[module];
  return <Icon size={18} strokeWidth={1.8} aria-hidden="true" />;
}
