import type { ModuleId } from '../core/types';
import { CAPABILITY_WORKSPACES, type CapabilityModuleId } from './CapabilityWorkspace';

export type RibbonTabId = 'home' | 'edit' | 'organize' | 'optimize' | 'convert' |
  'forms' | 'review' | 'protect' | 'automate' | 'tools';

export interface RibbonAction {
  id: string;
  label: string;
  description?: string;
  destination?: ModuleId;
  opensFiles?: boolean;
  unavailableReason?: string;
}

export interface RibbonTab {
  id: RibbonTabId;
  label: string;
  actions: RibbonAction[];
}

import { PDF_COMMAND_BY_ID, type PDFRequirementId } from '../commands/masterCatalog';

function required(id: PDFRequirementId): RibbonAction {
  const feature = PDF_COMMAND_BY_ID.get(id);
  if (!feature) throw new Error('Missing MALENJO PDF feature: '+id);
  return {
    id,
    label:feature.label,
    description:feature.tooltip,
    unavailableReason:feature.tooltip,
  };
}

/** Exactly the ten primary categories from MALENJO Master Specification v2.0.
 * An entry navigates to an existing working surface or is disabled; it never
 * pretends to execute a PDF engine that has not passed release acceptance. */
export const RIBBON_TABS: RibbonTab[] = [
  { id:'home', label:'Home', actions:[
    {id:'open',label:'Open File',description:'Select a local PDF, CAD or DICOM document',opensFiles:true},
    {id:'start',label:'Start',description:'Open MALENJO Home and recent files',destination:'home'},
    {id:'library',label:'Recent Files',description:'Browse the local document library',destination:'files'},
    {id:'pdf',label:'PDF Viewer',description:'Open the PDF manipulation workspace',destination:'pdf'},
  ]},
  { id:'edit',label:'Edit',actions:[
    {id:'pdf',label:'PDF Workspace',description:'View and edit supported PDF content',destination:'pdf'},
    required('MAL-011'),required('MAL-014'),required('MAL-015'),required('MAL-023'),
  ]},
  { id:'organize',label:'Organize',actions:[
    {id:'pdf',label:'PDF Workspace',description:'Work with PDF pages and thumbnails',destination:'pdf'},
    required('MAL-001'),required('MAL-002'),required('MAL-003'),required('MAL-008'),
  ]},
  { id:'optimize',label:'Optimize',actions:[
    {id:'scanner',label:'Scan',destination:'scanner',description:'Open scanning workspace'},
    {id:'ocr',label:'OCR',destination:'ocr',description:'Open OCR workspace'},
    required('MAL-024'),required('MAL-025'),required('MAL-026'),
  ]},
  { id:'convert',label:'Convert',actions:[
    required('MAL-037'),required('MAL-039'),required('MAL-038'),
    {id:'pdf',label:'PDF Workspace',destination:'pdf',description:'Open PDF conversion tools'},
    required('MAL-040'),
  ]},
  { id:'forms',label:'Forms',actions:[
    {id:'pdf',label:'PDF Workspace',destination:'pdf',description:'Inspect existing PDF form fields'},
    required('MAL-046'),required('MAL-047'),required('MAL-052'),
  ]},
  { id:'review',label:'Review',actions:[
    {id:'pdf',label:'PDF Workspace',destination:'pdf',description:'Open PDF markup and review tools'},
    {id:'sign',label:'Sign',destination:'sign',description:'Open document signing workspace'},
    required('MAL-054'),required('MAL-059'),
  ]},
  { id:'protect',label:'Protect',actions:[
    {id:'security',label:'Security',destination:'security',description:'Open local PDF security workspace'},
    {id:'sign',label:'Sign',destination:'sign',description:'Open signing and certificate workspace'},
    required('MAL-061'),required('MAL-063'),required('MAL-065'),
  ]},
  { id:'automate',label:'Automate',actions:[
    {id:'automation',label:'Automation',destination:'automation',description:'Open automation workspace'},
    {id:'invoice',label:'Invoice',destination:'invoice',description:'Open invoice workspace'},
    {id:'dms',label:'Documents',destination:'dms',description:'Open document management'},
    required('MAL-083'),
  ]},
  { id:'tools',label:'Tools',actions:[
    {id:'cad',label:'CAD',destination:'cad',description:'Open supported CAD documents'},
    {id:'dicom',label:'DICOM',destination:'dicom',description:'Open medical image workspace'},
    {id:'settings',label:'Settings',destination:'settings',description:'Light and Dark appearance'},
    {id:'help',label:'Help',destination:'help',description:'Documentation and diagnostics'},
    required('MAL-087'),
  ]},
];

export function defaultRibbonTab(workspace: ModuleId): RibbonTabId {
  if (workspace === 'pdf' || workspace === 'home' || workspace === 'files') return 'home';
  if (workspace === 'word' || workspace === 'spreadsheet' || workspace === 'presentation') return 'convert';
  if (workspace === 'scanner' || workspace === 'ocr') return 'optimize';
  if (workspace === 'sign') return 'review';
  if (workspace === 'security' || workspace === 'metadata') return 'protect';
  if (workspace === 'automation' || workspace === 'invoice' || workspace === 'dms') return 'automate';
  if (workspace === 'cad' || workspace === 'dicom' || workspace === 'settings' || workspace === 'account' || workspace === 'help') return 'tools';
  if (workspace === 'ai') return 'tools';
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
