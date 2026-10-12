import type { ModuleId } from '../core/types';
import { CAPABILITY_WORKSPACES, type CapabilityModuleId } from './CapabilityWorkspace';

export type RibbonTabId = 'home' | 'pdf' | 'convert' | 'review' | 'scan' | 'specialist' | 'tools';

export interface RibbonAction {
  id: string;
  label: string;
  destination?: ModuleId;
  opensFiles?: boolean;
  unavailableReason?: string;
}

export interface RibbonTab {
  id: RibbonTabId;
  label: string;
  actions: RibbonAction[];
}

export const RIBBON_TABS: RibbonTab[] = [
  { id: 'home', label: 'Home', actions: [
    { id: 'open', label: 'Open files', opensFiles: true },
    { id: 'start', label: 'Start Center', destination: 'home' },
    { id: 'library', label: 'My Files', destination: 'files' },
    { id: 'pdf', label: 'PDF Viewer', destination: 'pdf' },
  ] },
  { id: 'pdf', label: 'PDF Viewer', actions: [
    { id: 'open', label: 'Open PDF', opensFiles: true },
    { id: 'viewer', label: 'PDF Workspace', destination: 'pdf' },
    { id: 'library', label: 'Files / Library', destination: 'files' },
    { id: 'metadata', label: 'Metadata', destination: 'metadata' },
  ] },
  { id: 'convert', label: 'Convert', actions: [
    { id: 'to-word', label: 'PDF to Word', unavailableReason: 'PDF-to-DOCX conversion must be verified before the Office output editor is enabled.' },
    { id: 'to-excel', label: 'PDF to Excel', unavailableReason: 'PDF-to-XLSX conversion must be verified before the Office output editor is enabled.' },
    { id: 'to-slides', label: 'PDF to Slides', unavailableReason: 'PDF-to-PPTX conversion must be verified before the Office output editor is enabled.' },
  ] },
  { id: 'review', label: 'Review & Sign', actions: [
    { id: 'sign', label: 'Sign', destination: 'sign' },
    { id: 'security', label: 'Security', destination: 'security' },
    { id: 'metadata', label: 'Metadata', destination: 'metadata' },
  ] },
  { id: 'scan', label: 'Scan & OCR', actions: [
    { id: 'scanner', label: 'Scanner', destination: 'scanner' },
    { id: 'ocr', label: 'OCR', destination: 'ocr' },
  ] },
  { id: 'specialist', label: 'CAD & DICOM', actions: [
    { id: 'cad', label: 'CAD', destination: 'cad' },
    { id: 'dicom', label: 'DICOM', destination: 'dicom' },
    { id: 'library', label: 'Files / Library', destination: 'files' },
  ] },
  { id: 'tools', label: 'Suite Tools', actions: [
    { id: 'automation', label: 'Automation', destination: 'automation' },
    { id: 'dms', label: 'DMS', destination: 'dms' },
    { id: 'backup', label: 'Backup', destination: 'backup' },
    { id: 'settings', label: 'Settings', destination: 'settings' },
    { id: 'help', label: 'Help', destination: 'help' },
  ] },
];

export function defaultRibbonTab(workspace: ModuleId): RibbonTabId {
  if (workspace === 'pdf') return 'pdf';
  if (workspace === 'word' || workspace === 'spreadsheet' || workspace === 'presentation') return 'convert';
  if (workspace === 'scanner' || workspace === 'ocr' || workspace === 'ai') return 'scan';
  if (workspace === 'sign' || workspace === 'security' || workspace === 'metadata') return 'review';
  if (workspace === 'cad' || workspace === 'dicom') return 'specialist';
  if (workspace === 'home' || workspace === 'files') return 'home';
  return 'tools';
}

/**
 * A specialist module uses the existing shared ribbon action surface rather
 * than stacking a second, disconnected command strip under it.
 * Working navigation is separated from unavailable domain engine operations.
 */
export function specialistRibbonActions(workspace: ModuleId): RibbonAction[] | null {
  if (!(workspace in CAPABILITY_WORKSPACES)) return null;
  const id = workspace as CapabilityModuleId;
  const model = CAPABILITY_WORKSPACES[id];
  const navigation = id === 'account' ? 'settings' : 'files';
  return [
    ...model.tools.map((label, index) => ({
      id: 'capability-' + id + '-tool-' + index,
      label,
      unavailableReason: model.limitation,
    })),
    { id: 'capability-' + id + '-navigate', label: navigation === 'settings' ? 'Appearance settings' : 'Files / Library',
      destination: navigation },
    { id: 'capability-' + id + '-help', label: 'Help', destination: 'help' },
  ];
}
