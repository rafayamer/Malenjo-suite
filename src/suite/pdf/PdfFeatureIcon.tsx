import { MASTER_FEATURE_ICON_BY_ID } from './masterFeatureIcons';
import {
  Bot, ClipboardCheck, Copy, Download, FileImage, FilePlus2, FileText, FileType,
  FolderOpen, FormInput, Highlighter, Image, Languages, LayoutTemplate, LockKeyhole,
  MessageSquare, PanelRight, PenTool, Presentation, Printer, Redo2,
  RotateCw, ScanText, Scissors, Settings2, ShieldCheck, Sparkles, Table2,
  Trash2, Undo2, Workflow, Crop, FileCode2, GitCompare,
  Hash, LockOpen, Minimize2, Stamp, Wrench, type LucideIcon,
} from 'lucide-react';

/** Each of the existing 33 PDF shortcut tiles has exactly one matching,
 * unique master feature glyph. Do not silently collapse them to FileText. */
export const PDF_SHORTCUT_MASTER_IDS: Readonly<Record<string,string>> = {
  'merge-pdf':'MAL-001',
  'split-pdf':'MAL-002',
  'remove-pages':'MAL-004',
  'extract-pages':'MAL-005',
  'organize-pdf':'MAL-003',
  'scan-to-pdf':'MAL-028',
  'compress-pdf':'MAL-024',
  'repair-pdf':'MAL-026',
  'ocr-pdf':'MAL-027',
  'jpg-to-pdf':'MAL-030',
  'word-to-pdf':'MAL-031',
  'powerpoint-to-pdf':'MAL-032',
  'excel-to-pdf':'MAL-033',
  'html-to-pdf':'MAL-034',
  'pdf-to-jpg':'MAL-036',
  'pdf-to-word':'MAL-037',
  'pdf-to-powerpoint':'MAL-038',
  'pdf-to-excel':'MAL-039',
  'pdf-to-pdfa':'MAL-040',
  'rotate-pdf':'MAL-007',
  'page-numbers':'MAL-018',
  'watermark-pdf':'MAL-019',
  'crop-pdf':'MAL-008',
  'edit-pdf':'MAL-016',
  'pdf-forms':'MAL-046',
  'unlock-pdf':'MAL-062',
  'protect-pdf':'MAL-061',
  'sign-pdf':'MAL-065',
  'redact-pdf':'MAL-063',
  'compare-pdf':'MAL-059',
  'ai-summarizer':'MAL-073',
  'translate-pdf':'MAL-074',
  'pdf-to-markdown':'MAL-041',
};

/** Meaningful, stable symbols rather than the same generic document icon for every command. */
const icons: Record<string,LucideIcon> = {
  files:FolderOpen,open:FolderOpen,export:Download,print:Printer,inspector:PanelRight,
  'local-provider-tools':Settings2,
  undo:Undo2,redo:Redo2,'place-text':FileType,rectangle:Highlighter,'configure-edit':Settings2,
  'edit-existing-text':FileType,'redact-pdf':ShieldCheck,
  'to-docx':FileType,'to-xlsx':Table2,'to-pptx':Presentation,
  'export-text':FileText,'export-page-images':FileImage,'export-page-jpeg':Image,'images-to-pdf':Image,'compare-pdf':GitCompare,
  'turn-pages':RotateCw,'remove-pages':Trash2,'copy-page':Copy,'extract-pages':Download,
  split:Scissors,insert:FilePlus2,append:FilePlus2,blank:FilePlus2,'page-labels':FileText,
  earlier:Undo2,later:Redo2,'comments-panel':MessageSquare,'add-comment':MessageSquare,
  'markup-region':Highlighter,'highlight-text':Highlighter,'digital-sign-pdf':PenTool,
  'signatures-panel':PenTool,'encrypt-pdf':LockKeyhole,'redact-sensitive':ShieldCheck,
  'add-form-field':FormInput,'fill-form':ClipboardCheck,'flatten-form':ClipboardCheck,
  'form-designer':LayoutTemplate,'configure-forms':Settings2,
  'ai-summarize':Sparkles,'ai-translate':Languages,'searchable-ocr':ScanText,
  'batch-pdf':Workflow,
  'merge-pdf':FilePlus2,'split-pdf':Scissors,
  'organize-pdf':FileText,'scan-to-pdf':ScanText,
  'compress-pdf':Minimize2,'repair-pdf':Wrench,'ocr-pdf':ScanText,
  'jpg-to-pdf':FileImage,'word-to-pdf':FileType,'powerpoint-to-pdf':Presentation,
  'excel-to-pdf':Table2,'html-to-pdf':FileCode2,
  'pdf-to-jpg':FileImage,'pdf-to-word':FileType,'pdf-to-powerpoint':Presentation,
  'pdf-to-excel':Table2,'pdf-to-pdfa':FileText,'rotate-pdf':RotateCw,
  'page-numbers':Hash,'watermark-pdf':Stamp,'crop-pdf':Crop,
  'edit-pdf':FileType,'pdf-forms':FormInput,'unlock-pdf':LockOpen,
  'protect-pdf':LockKeyhole,'sign-pdf':PenTool,
  'ai-summarizer':Sparkles,'translate-pdf':Languages,
  'pdf-to-markdown':FileText,
};
export function PdfFeatureIcon({id,label,size=20}:{id:string;label:string;size?:number}) {
  const fallback = /sign/i.test(label) ? PenTool
    : /security|protect/i.test(label) ? ShieldCheck
    : /scan|ocr/i.test(label) ? ScanText
    : /automation/i.test(label) ? Workflow
    : /ai/i.test(label) ? Bot
    : /undo/i.test(label) ? Undo2
    : /redo/i.test(label) ? Redo2
    : /convert|export/i.test(label) ? Download
    : /page/i.test(label) ? FileText
    : FileText;
  const Icon=MASTER_FEATURE_ICON_BY_ID[id]??
    MASTER_FEATURE_ICON_BY_ID[PDF_SHORTCUT_MASTER_IDS[id]]??icons[id]??fallback;
  return <Icon size={size} aria-hidden="true" strokeWidth={1.8}/>;
}
