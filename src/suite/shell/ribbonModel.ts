import type { ModuleId } from '../core/types';
import { CAPABILITY_WORKSPACES, type CapabilityModuleId } from './CapabilityWorkspace';

import type { PDFRibbonCategory } from '../commands/masterCatalog';

export type RibbonTabId = 'home'|'edit'|'organize'|'optimize'|'convert'
  |'forms'|'review'|'protect'|'automate'|'tools';

export interface RibbonAction {
  id: string;
  label: string;
  destination?: ModuleId;
  opensFiles?: boolean;
  unavailableReason?: string;
}

export interface RibbonTab {
  id: RibbonTabId;
  label: PDFRibbonCategory;
  actions: RibbonAction[];
}

// Exactly the ten tabs in Master Specification v2.0 §2.3. Category-specific
// requirements are pulled from the same master catalog by PdfCatalogGallery.
export const RIBBON_TABS: RibbonTab[] = [
  {id:'home',label:'Home',actions:[
    {id:'open',label:'Open files',opensFiles:true},
    {id:'start',label:'Start Center',destination:'home'},
    {id:'library',label:'Files / Library',destination:'files'},
    {id:'pdf',label:'PDF Viewer',destination:'pdf'},
  ]},
  {id:'edit',label:'Edit',actions:[
    {id:'viewer',label:'PDF Workspace',destination:'pdf'},
  ]},
  {id:'organize',label:'Organize',actions:[
    {id:'viewer',label:'PDF Workspace',destination:'pdf'},
    {id:'library',label:'Files / Library',destination:'files'},
  ]},
  {id:'optimize',label:'Optimize',actions:[
    {id:'scanner',label:'Scanner',destination:'scanner'},
    {id:'ocr',label:'OCR',destination:'ocr'},
  ]},
  {id:'convert',label:'Convert',actions:[
    {id:'to-word',label:'PDF to Word',unavailableReason:'PDF-to-DOCX conversion requires a verified output and automatic Word result-editor handoff.'},
    {id:'to-excel',label:'PDF to Excel',unavailableReason:'PDF-to-XLSX conversion requires a verified output and automatic spreadsheet result-editor handoff.'},
    {id:'to-slides',label:'PDF to PowerPoint',unavailableReason:'PDF-to-PPTX conversion requires a verified output and automatic presentation result-editor handoff.'},
  ]},
  {id:'forms',label:'Forms',actions:[
    {id:'viewer',label:'PDF Form Workspace',destination:'pdf'},
  ]},
  {id:'review',label:'Review',actions:[
    {id:'viewer',label:'PDF Review Workspace',destination:'pdf'},
    {id:'metadata',label:'Metadata',destination:'metadata'},
  ]},
  {id:'protect',label:'Protect',actions:[
    {id:'security',label:'Security',destination:'security'},
    {id:'sign',label:'Sign',destination:'sign'},
    {id:'metadata',label:'Metadata',destination:'metadata'},
  ]},
  {id:'automate',label:'Automate',actions:[
    {id:'automation',label:'Automation Studio',destination:'automation'},
    {id:'invoice',label:'Invoice Studio',destination:'invoice'},
  ]},
  {id:'tools',label:'Tools',actions:[
    {id:'cad',label:'CAD',destination:'cad'},
    {id:'dicom',label:'DICOM',destination:'dicom'},
    {id:'dms',label:'DMS',destination:'dms'},
    {id:'settings',label:'Settings',destination:'settings'},
    {id:'help',label:'Help',destination:'help'},
  ]},
];

export function defaultRibbonTab(workspace:ModuleId):RibbonTabId {
  if(['word','spreadsheet','presentation'].includes(workspace))return 'convert';
  if(workspace==='scanner'||workspace==='ocr')return 'optimize';
  if(workspace==='security'||workspace==='sign'||workspace==='metadata')return 'protect';
  if(workspace==='automation'||workspace==='invoice')return 'automate';
  if(workspace==='cad'||workspace==='dicom')return 'tools';
  return 'home';
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
