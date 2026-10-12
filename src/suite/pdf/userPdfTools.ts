import type { PdfTaskCategory } from './taskToolbar';

export type UserPdfToolGroup =
  | 'Organize PDF' | 'Optimize PDF' | 'Convert to PDF' | 'Convert from PDF'
  | 'Edit PDF' | 'PDF Security' | 'PDF Intelligence';

export interface UserPdfTool {
  id:string;
  label:string;
  group:UserPdfToolGroup;
  category:PdfTaskCategory;
  /** Only connect to an operation that really exists in the current PDF workspace. */
  actionId?:string;
  /** An existing working workspace may be reached instead of running a transformation. */
  destination?:'scanner'|'sign'|'security'|'ai';
  explanation:string;
}

export const USER_PDF_TOOL_GROUPS: readonly UserPdfToolGroup[] = [
  'Organize PDF','Optimize PDF','Convert to PDF','Convert from PDF',
  'Edit PDF','PDF Security','PDF Intelligence',
];

export const USER_PDF_TOOLS: readonly UserPdfTool[] = [
  {id:'merge-pdf',label:'Merge PDF',group:'Organize PDF',category:'organize',actionId:'append',explanation:'Append another local PDF to the current document; verify page order before exporting.'},
  {id:'split-pdf',label:'Split PDF',group:'Organize PDF',category:'organize',actionId:'split',explanation:'Split at the selected page boundary. Requires at least two pages.'},
  {id:'remove-pages',label:'Remove pages',group:'Organize PDF',category:'organize',actionId:'remove-pages',explanation:'Permanently remove selected pages after review.'},
  {id:'extract-pages',label:'Extract pages',group:'Organize PDF',category:'organize',actionId:'extract-pages',explanation:'Export selected pages as a separate PDF.'},
  {id:'organize-pdf',label:'Organize PDF',group:'Organize PDF',category:'organize',explanation:'Select, reorder, duplicate, insert and remove pages using the Organize ribbon and page panel.'},
  {id:'scan-to-pdf',label:'Scan to PDF',group:'Organize PDF',category:'scan',destination:'scanner',explanation:'Open the local scanning workspace; remote mobile-to-browser transfer is not release-ready.'},

  {id:'compress-pdf',label:'Compress PDF',group:'Optimize PDF',category:'convert',explanation:'Validated size reduction and image-quality comparison remain required.'},
  {id:'repair-pdf',label:'Repair PDF',group:'Optimize PDF',category:'organize',explanation:'Recovering malformed PDFs without dropping content has not passed acceptance.'},
  {id:'ocr-pdf',label:'OCR PDF',group:'Optimize PDF',category:'scan',explanation:'Searchable PDF OCR requires verified placement, Unicode support and independent text extraction.'},

  {id:'jpg-to-pdf',label:'JPG to PDF',group:'Convert to PDF',category:'convert',actionId:'images-to-pdf',explanation:'Create a local PDF from selected JPEG/PNG images.'},
  {id:'word-to-pdf',label:'Word to PDF',group:'Convert to PDF',category:'convert',explanation:'Full DOC/DOCX formatting and page fidelity have not been verified.'},
  {id:'powerpoint-to-pdf',label:'PowerPoint to PDF',group:'Convert to PDF',category:'convert',explanation:'Full PPT/PPTX shapes, fonts and pagination have not been verified.'},
  {id:'excel-to-pdf',label:'Excel to PDF',group:'Convert to PDF',category:'convert',explanation:'XLS/XLSX sheets, print areas and formula-value fidelity have not been verified.'},
  {id:'html-to-pdf',label:'HTML to PDF',group:'Convert to PDF',category:'convert',explanation:'Full CSS, images, fonts and secure URL rendering are not release-ready.'},

  {id:'pdf-to-jpg',label:'PDF to JPG',group:'Convert from PDF',category:'convert',actionId:'export-page-jpeg',explanation:'Rasterize each page to a JPEG; download a numbered ZIP. This does not extract embedded originals.'},
  {id:'pdf-to-word',label:'PDF to Word',group:'Convert from PDF',category:'convert',explanation:'Editable DOCX conversion with layout fidelity and automatic viewer handoff is not release-ready.'},
  {id:'pdf-to-powerpoint',label:'PDF to PowerPoint',group:'Convert from PDF',category:'convert',explanation:'Editable PPTX conversion with slide/layout fidelity and automatic viewer handoff is not release-ready.'},
  {id:'pdf-to-excel',label:'PDF to Excel',group:'Convert from PDF',category:'convert',explanation:'Workbook/table reconstruction and automatic XLSX viewer handoff are not release-ready.'},
  {id:'pdf-to-pdfa',label:'PDF to PDF/A',group:'Convert from PDF',category:'convert',explanation:'PDF/A compliance requires independent veraPDF verification of a generated archive.'},

  {id:'rotate-pdf',label:'Rotate PDF',group:'Edit PDF',category:'organize',actionId:'turn-pages',explanation:'Apply a permanent rotation to selected pages.'},
  {id:'page-numbers',label:'Page numbers',group:'Edit PDF',category:'organize',explanation:'Burned-in configurable page-number positioning and validation are not release-ready.'},
  {id:'watermark-pdf',label:'Watermark',group:'Edit PDF',category:'edit',explanation:'Verified text/image watermarks with placement, opacity and external reader fidelity remain required.'},
  {id:'crop-pdf',label:'Crop PDF',group:'Edit PDF',category:'edit',explanation:'Interactive crop boxes with independent page-boundary verification are not release-ready.'},
  {id:'edit-pdf',label:'Edit PDF',group:'Edit PDF',category:'edit',actionId:'configure-edit',explanation:'Use the existing text/rectangle overlay tools; replacement of original text is not yet supported.'},
  {id:'pdf-forms',label:'PDF Forms',group:'Edit PDF',category:'forms',actionId:'configure-forms',explanation:'Add and fill supported AcroForm fields; complete automatic field detection is not release-ready.'},

  {id:'unlock-pdf',label:'Unlock PDF',group:'PDF Security',category:'protect',explanation:'Authorized PDF password removal and cross-reader output validation remain required.'},
  {id:'protect-pdf',label:'Protect PDF',group:'PDF Security',category:'protect',explanation:'Strong PDF encryption with verified reader behavior remains required.'},
  {id:'sign-pdf',label:'Sign PDF',group:'PDF Security',category:'sign',destination:'sign',explanation:'Open the signature workspace; certified signatures and remote requests remain separate acceptance requirements.'},
  {id:'redact-pdf',label:'Redact PDF',group:'PDF Security',category:'protect',explanation:'Permanent source-content erasure and post-export leakage scans remain required.'},
  {id:'compare-pdf',label:'Compare PDF',group:'PDF Security',category:'convert',actionId:'compare-pdf',explanation:'Compare the selectable text of two PDFs; graphical side-by-side comparison is not yet supported.'},

  {id:'ai-summarizer',label:'AI Summarizer',group:'PDF Intelligence',category:'ai',explanation:'Verified grounded one-click summaries and model availability are not release-ready. The top AI chat remains available.'},
  {id:'translate-pdf',label:'Translate PDF',group:'PDF Intelligence',category:'ai',explanation:'Language translation with fully preserved PDF fonts and page layout is not release-ready.'},
  {id:'pdf-to-markdown',label:'PDF to Markdown',group:'PDF Intelligence',category:'convert',explanation:'Full headings, tables, links and image fidelity in Markdown output are not release-ready.'},
];

export function userPdfToolsByGroup(group:UserPdfToolGroup): readonly UserPdfTool[] {
  return USER_PDF_TOOLS.filter(item=>item.group===group);
}
