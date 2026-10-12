import {
  Bot, ClipboardCheck, Copy, Download, FileImage, FilePlus2, FileSearch, FileText, FileType,
  FolderOpen, FormInput, Highlighter, Image, Languages, LayoutTemplate, LockKeyhole,
  MessageSquare, PanelRight, PenTool, Presentation, Printer, Redo2,
  RotateCw, ScanText, Scissors, Settings2, ShieldCheck, Sparkles, Table2,
  Trash2, Undo2, Workflow, type LucideIcon,
} from 'lucide-react';

/** Meaningful, stable symbols rather than the same generic document icon for every command. */
const icons: Record<string,LucideIcon> = {
  files:FolderOpen,open:FolderOpen,export:Download,print:Printer,inspector:PanelRight,
  'local-provider-tools':Settings2,
  undo:Undo2,redo:Redo2,'place-text':FileType,rectangle:Highlighter,'configure-edit':Settings2,
  'edit-existing-text':FileType,'redact-pdf':ShieldCheck,
  'to-docx':FileType,'to-xlsx':Table2,'to-pptx':Presentation,
  'export-text':FileText,'export-page-images':FileImage,'export-page-jpeg':Image,'images-to-pdf':Image,'compare-pdf':FileSearch,
  'turn-pages':RotateCw,'remove-pages':Trash2,'copy-page':Copy,'extract-pages':Download,
  split:Scissors,insert:FilePlus2,append:FilePlus2,blank:FilePlus2,'page-labels':FileText,
  earlier:Undo2,later:Redo2,'comments-panel':MessageSquare,'add-comment':MessageSquare,
  'markup-region':Highlighter,'highlight-text':Highlighter,'digital-sign-pdf':PenTool,
  'signatures-panel':PenTool,'encrypt-pdf':LockKeyhole,'redact-sensitive':ShieldCheck,
  'add-form-field':FormInput,'fill-form':ClipboardCheck,'flatten-form':ClipboardCheck,
  'form-designer':LayoutTemplate,'configure-forms':Settings2,
  'ai-summarize':Sparkles,'ai-translate':Languages,'searchable-ocr':ScanText,
  'batch-pdf':Workflow,
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
  const Icon=icons[id]??fallback;
  return <Icon size={size} aria-hidden="true" strokeWidth={1.8}/>;
}
