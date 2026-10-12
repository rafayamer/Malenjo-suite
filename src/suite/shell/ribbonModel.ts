import type { ModuleId } from '../core/types';
import { CAPABILITY_WORKSPACES, type CapabilityModuleId } from './CapabilityWorkspace';
import type { PDFRibbonCategory } from '../commands/masterCatalog';

export type RibbonTabId =
  | 'home' | 'edit' | 'organize' | 'optimize' | 'convert'
  | 'forms' | 'review' | 'protect' | 'automate' | 'tools';

export interface RibbonAction {
  id: string;
  label: string;
  destination?: ModuleId;
  opensFiles?: boolean;
  unavailableReason?: string;
  tooltip?: string;
}

export interface RibbonTab {
  id: RibbonTabId;
  label: PDFRibbonCategory;
  actions: RibbonAction[];
}

/** Ten canonical tabs from MALENJO Master Development Specification v2.0.
 * Actual verified functions remain in the respective PDF workspace; a UI
 * entry never implies that the complete MAL capability has been accepted. */
export const RIBBON_TABS: RibbonTab[] = [
  { id:'home', label:'Home', actions:[
    {id:'open',label:'Open File',opensFiles:true,tooltip:'Choose a PDF, CAD or DICOM file'},
    {id:'start',label:'Start Center',destination:'home'},
    {id:'library',label:'Recent Files',destination:'files'},
    {id:'pdf',label:'PDF Viewer',destination:'pdf'},
  ]},
  { id:'edit', label:'Edit', actions:[
    {id:'pdf-edit',label:'PDF Editing',destination:'pdf',tooltip:'Open the PDF editor and select Edit'},
    {id:'metadata',label:'PDF Metadata',destination:'metadata'},
  ]},
  { id:'organize', label:'Organize', actions:[
    {id:'pdf-organize',label:'Organize Pages',destination:'pdf',tooltip:'Open the PDF page assembly and organize tools'},
  ]},
  { id:'optimize', label:'Optimize', actions:[
    {id:'ocr',label:'OCR',destination:'ocr'},
    {id:'scanner',label:'Scan',destination:'scanner'},
  ]},
  { id:'convert', label:'Convert', actions:[
    {id:'to-word',label:'PDF to Word',unavailableReason:'PDF-to-DOCX conversion and automatic result opening are not release-verified.'},
    {id:'to-excel',label:'PDF to Excel',unavailableReason:'PDF-to-XLSX conversion and automatic result opening are not release-verified.'},
    {id:'to-slides',label:'PDF to Slides',unavailableReason:'PDF-to-PPTX conversion and automatic result opening are not release-verified.'},
  ]},
  { id:'forms', label:'Forms', actions:[
    {id:'form-pdf',label:'PDF Forms',destination:'pdf',tooltip:'Open PDF and use verified form tools'},
  ]},
  { id:'review', label:'Review', actions:[
    {id:'review-pdf',label:'PDF Comments',destination:'pdf',tooltip:'Review the current PDF with annotations and comments'},
    {id:'sign',label:'Sign',destination:'sign'},
  ]},
  { id:'protect', label:'Protect', actions:[
    {id:'security',label:'Security',destination:'security'},
    {id:'metadata-protect',label:'Sanitize Metadata',destination:'metadata'},
  ]},
  { id:'automate', label:'Automate', actions:[
    {id:'automation',label:'Automation',destination:'automation'},
    {id:'invoice',label:'Invoice Studio',destination:'invoice'},
  ]},
  { id:'tools', label:'Tools', actions:[
    {id:'cad',label:'CAD',destination:'cad'},
    {id:'dicom',label:'DICOM',destination:'dicom'},
    {id:'dms',label:'Documents',destination:'dms'},
    {id:'settings',label:'Settings',destination:'settings'},
    {id:'help',label:'Help',destination:'help'},
  ]},
];

export function defaultRibbonTab(workspace:ModuleId):RibbonTabId {
  if(workspace==='scanner'||workspace==='ocr')return 'optimize';
  if(workspace==='sign')return 'review';
  if(workspace==='security')return 'protect';
  if(workspace==='metadata')return 'edit';
  if(workspace==='automation'||workspace==='invoice')return 'automate';
  if(workspace==='cad'||workspace==='dicom'||workspace==='dms'||
    workspace==='admin'||workspace==='backup'||workspace==='settings'||
    workspace==='account'||workspace==='help')return 'tools';
  if(workspace==='word'||workspace==='spreadsheet'||workspace==='presentation')return 'convert';
  return 'home';
}

export function specialistRibbonActions(workspace:ModuleId):RibbonAction[]|null {
  if(!(workspace in CAPABILITY_WORKSPACES))return null;
  const model=CAPABILITY_WORKSPACES[workspace as CapabilityModuleId];
  const navigation=workspace==='account'?'settings':'files';
  return [
    ...model.tools.map((label,index)=>({
      id:'capability-'+workspace+'-tool-'+index,label,unavailableReason:model.limitation,
    })),
    {id:'capability-'+workspace+'-navigate',
      label:navigation==='settings'?'Appearance settings':'Files / Library',destination:navigation},
    {id:'capability-'+workspace+'-help',label:'Help',destination:'help'},
  ];
}
