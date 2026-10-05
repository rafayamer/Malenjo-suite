import type { SuiteModule } from '../core/types';

export const modules: SuiteModule[] = [
  { id:'home', name:'Home', description:'Recent work, quick actions and system health.', status:'foundation', featureFlag:'core', engine:'MALENJO shell', group:'Core' },
  { id:'files', name:'Files / Library', description:'One local-first document library across every workspace.', status:'partial', featureFlag:'core', engine:'MALENJO document model', group:'Core' },
  { id:'pdf', name:'PDF Workspace', description:'Fast document-first PDF viewing surface with local rendering.', status:'partial', featureFlag:'core', engine:'PDF.js 6.4.299 + MALENJO native adapter', group:'Create' },
  { id:'word', name:'Document Workspace', description:'Word-like editing with OOXML fidelity tracking.', status:'partial', featureFlag:'wordEditor', engine:'Tiptap + docx4j/POI adapter', group:'Create' },
  { id:'spreadsheet', name:'Spreadsheet', description:'Workbook editing and local spreadsheet operations.', status:'partial', featureFlag:'spreadsheetEditor', engine:'Univer + POI adapter', group:'Create' },
  { id:'presentation', name:'Presentation', description:'Slide editing, preview and export workflow.', status:'partial', featureFlag:'presentationEditor', engine:'Univer/PPTX adapter', group:'Create' },
  { id:'scanner', name:'Scanner', description:'Camera capture, perspective correction and page assembly.', status:'partial', featureFlag:'scanner', engine:'Camera + OpenCV/Scanic adapter', group:'Intelligence' },
  { id:'ocr', name:'OCR', description:'Local searchable text and structured document understanding.', status:'partial', featureFlag:'intelligentOcr', engine:'PaddleOCR adapter', group:'Intelligence' },
  { id:'ai', name:'Malenjo AI', description:'Private local document chat, extraction and classification.', status:'partial', featureFlag:'localAi', engine:'Ollama/llama.cpp adapter', group:'Intelligence' },
  { id:'sign', name:'Sign', description:'Local signing, certificate validation and signature workflows.', status:'partial', featureFlag:'advancedSigning', engine:'MALENJO signing boundary + pyHanko adapter', group:'Create' },
  { id:'invoice', name:'Invoice Studio', description:'Invoice designer with product-owned template library.', status:'adapter', featureFlag:'invoiceStudio', engine:'MALENJO invoice domain adapter', group:'Create' },
  { id:'metadata', name:'Metadata Studio', description:'Inspect, edit and safely sanitize document metadata.', status:'partial', featureFlag:'metadataStudio', engine:'MALENJO PDF/OOXML metadata core', group:'Intelligence' },
  { id:'automation', name:'Automation Studio', description:'Visual local-first document workflow orchestration.', status:'partial', featureFlag:'automation', engine:'MALENJO workflow runner + Temporal adapter', group:'Enterprise' },
  { id:'dms', name:'Enterprise DMS', description:'Indexing, versioning, retention and records management.', status:'partial', featureFlag:'dms', engine:'MALENJO native DMS', group:'Enterprise' },
  { id:'security', name:'Security Center', description:'Threat status, sanitization, signing and audit controls.', status:'partial', featureFlag:'securityCenter', engine:'MALENJO security layer', group:'Enterprise' },
  { id:'cad', name:'CAD', description:'Optional local DXF/CAD workspace.', status:'adapter', featureFlag:'cad', engine:'cad-viewer/dxf-parser adapter', group:'Enterprise' },
  { id:'dicom', name:'DICOM', description:'Optional local medical image workspace.', status:'adapter', featureFlag:'dicom', engine:'OHIF/Cornerstone adapter', group:'Enterprise' },
  { id:'admin', name:'Administration', description:'Policies, roles, identity and deployment settings.', status:'partial', featureFlag:'enterpriseAdmin', engine:'MALENJO policy service + future identity adapter', group:'Enterprise' },
  { id:'backup', name:'Backup / DR', description:'Verified backup, restore and disaster-recovery orchestration.', status:'partial', featureFlag:'backup', engine:'MALENJO verified backup + Kopia adapter', group:'System' },
  { id:'settings', name:'Settings', description:'One settings system for the entire suite.', status:'foundation', featureFlag:'core', engine:'MALENJO settings', group:'System' },
  { id:'account', name:'Account', description:'Student/local account identity and device profile.', status:'foundation', featureFlag:'core', engine:'MALENJO account', group:'System' },
  { id:'help', name:'Help / Support', description:'Diagnostics, guides and troubleshooting information.', status:'foundation', featureFlag:'core', engine:'MALENJO diagnostics', group:'System' }
];
