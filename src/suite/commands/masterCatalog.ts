/**
 * MALENJO Master Development Specification v2.0 — 90-capability source of truth.
 * This is a DISCOVERY and ACCEPTANCE contract, NOT an implementation claim.
 *
 * Unverified capabilities MUST remain disabled until an independently tested
 * handler is bound. Never substitute a decorative no-op for file generation.
 */
export type PDFRibbonCategory =
  | 'Home' | 'Edit' | 'Organize' | 'Optimize' | 'Convert'
  | 'Forms' | 'Review' | 'Protect' | 'Automate' | 'Tools';

export type PDFRequirementId = `MAL-${string}`;
export type PDFCommandStatus = 'NOT_RELEASE_READY' | 'RELEASE_READY';

export interface PDFCommandContext {
  documentId?: string;
  selectedPages?: readonly number[];
  permissions: readonly string[];
  confirmedSensitiveOperation?: boolean;
}

export interface PDFCommandResult {
  artifactIds: readonly string[];
  outputFormat: string;
  evidenceId: string;
}

export interface PDFCommand {
  id: PDFRequirementId;
  label: string;
  category: PDFRibbonCategory;
  requirementGroup: string;
  icon: string;
  tooltip: string;
  shortcut?: string;
  requiresDocument: boolean;
  requiresSelection: boolean;
  permissions: readonly string[];
  expectedOutput: string;
  status: PDFCommandStatus;
  isAvailable(context: PDFCommandContext): boolean;
  execute(context: PDFCommandContext): Promise<PDFCommandResult>;
}

export const UNVERIFIED_COMMAND_REASON =
  'Not release-ready: execution, output fidelity and independent verification are not approved.';

export class PDFCommandUnavailableError extends Error {
  readonly code = 'MALENJO_COMMAND_NOT_RELEASE_READY';
  constructor(public readonly commandId: PDFRequirementId) {
    super(`${commandId}: ${UNVERIFIED_COMMAND_REASON}`);
    this.name = 'PDFCommandUnavailableError';
  }
}

// [number, exact specification label, ribbon group, requirement group, icon, output contract]
// When an engine passes every acceptance check, bind it through the verified
// command adapter; do not simply flip a Boolean in the catalog.
const SPEC_CATALOG: readonly (readonly [number,string,PDFRibbonCategory,string,string,string])[] = [
  [ 1,"Merge PDF Files","Organize","Organize PDF","files","Merged PDF"],
  [ 2,"Split PDF Files","Organize","Organize PDF","scissors","Split PDF files and manifest"],
  [ 3,"Reorder PDF Pages","Organize","Organize PDF","list-ordered","Reordered PDF"],
  [ 4,"Remove PDF Pages","Organize","Organize PDF","trash-2","Revised PDF"],
  [ 5,"Extract PDF Pages","Organize","Organize PDF","copy","Extracted PDF files"],
  [ 6,"Insert and Replace Pages","Organize","Organize PDF","file-plus-2","Revised PDF"],
  [ 7,"Rotate PDF Pages","Organize","Organize PDF","rotate-cw","Rotated PDF"],
  [ 8,"Crop PDF Pages","Organize","Organize PDF","crop","Cropped PDF"],
  [ 9,"Multiple Pages into One Page (N-up)","Organize","Organize PDF","layout-grid","N-up PDF"],
  [10,"Batch Document Assembly","Organize","Organize PDF","layers","Batch PDF files and manifest"],
  [11,"Native Inline Text Editing","Edit","Edit PDF & Layout","type","Revised PDF"],
  [12,"Paragraph Reflow and Reconstruction","Edit","Edit PDF & Layout","align-left","Revised PDF and layout report"],
  [13,"Font, Typography, and Styles","Edit","Edit PDF & Layout","baseline","Revised PDF and font report"],
  [14,"Image Editing","Edit","Edit PDF & Layout","image","Revised PDF"],
  [15,"Vector Object Editing","Edit","Edit PDF & Layout","shapes","Revised PDF"],
  [16,"Insert Text, Shapes, and Graphics","Edit","Edit PDF & Layout","pencil","Revised PDF"],
  [17,"Headers and Footers","Edit","Edit PDF & Layout","panel-top","Revised PDF"],
  [18,"PDF Page Numbering","Edit","Edit PDF & Layout","list-ordered","Numbered PDF"],
  [19,"Styled Text Watermarks","Edit","Edit PDF & Layout","stamp","Watermarked PDF"],
  [20,"Image Watermarks","Edit","Edit PDF & Layout","image","Watermarked PDF"],
  [21,"PDF Information and Metadata","Edit","Edit PDF & Layout","file-cog","Revised PDF metadata"],
  [22,"Bookmarks, Links, and Contents Navigation","Edit","Edit PDF & Layout","bookmark","Revised PDF navigation"],
  [23,"Search, Replace, and Editing History","Edit","Edit PDF & Layout","history","Revised PDF and revision history"],
  [24,"Lossless PDF Compression","Optimize","Optimize, Scan & Repair","minimize-2","Optimized PDF and byte comparison"],
  [25,"Advanced PDF Compression","Optimize","Optimize, Scan & Repair","archive","Compressed PDF and fidelity report"],
  [26,"Repair PDF","Optimize","Optimize, Scan & Repair","wrench","Recovered PDF and repair report"],
  [27,"OCR PDF","Optimize","Optimize, Scan & Repair","scan-text","Searchable PDF and OCR confidence report"],
  [28,"Scan to Image or PDF","Optimize","Optimize, Scan & Repair","scan-line","Acquired images or PDF"],
  [29,"Create Transparent PNG","Optimize","Optimize, Scan & Repair","image-off","Transparent PNG"],
  [30,"JPG/PNG/TIFF to PDF","Convert","Convert PDF & External Files","images","PDF"],
  [31,"Word to PDF","Convert","Convert PDF & External Files","file-text","PDF"],
  [32,"PowerPoint to PDF","Convert","Convert PDF & External Files","presentation","PDF"],
  [33,"Excel to PDF","Convert","Convert PDF & External Files","table-2","PDF"],
  [34,"HTML to PDF","Convert","Convert PDF & External Files","code-2","PDF"],
  [35,"PostScript to PDF","Convert","Convert PDF & External Files","file-code-2","PDF"],
  [36,"PDF to Images","Convert","Convert PDF & External Files","images","Image files"],
  [37,"PDF to Word","Convert","Convert PDF & External Files","file-text","DOCX with fidelity report"],
  [38,"PDF to PowerPoint","Convert","Convert PDF & External Files","presentation","PPTX with fidelity report"],
  [39,"PDF to Excel","Convert","Convert PDF & External Files","table-2","XLSX with fidelity report"],
  [40,"PDF to PDF/A","Convert","Convert PDF & External Files","archive","Validated PDF/A"],
  [41,"PDF to Markdown","Convert","Convert PDF & External Files","file-text","Markdown and linked assets"],
  [42,"PDF to HTML","Convert","Convert PDF & External Files","code-2","HTML and linked assets"],
  [43,"PDF to SVG","Convert","Convert PDF & External Files","shapes","SVG file"],
  [44,"PDF to Plain Text","Convert","Convert PDF & External Files","file-text","Plain text file"],
  [45,"Batch Conversion and Result Workspace","Convert","Convert PDF & External Files","folders","Converted files, manifest and verified Office handoff"],
  [46,"Drag-and-Drop Form Designer","Forms","PDF Forms & Structured Data","form-input","PDF with authored form fields"],
  [47,"Text, Number, and Date Fields","Forms","PDF Forms & Structured Data","text-cursor-input","PDF with validated fields"],
  [48,"Checkbox, Radio, and Selection Fields","Forms","PDF Forms & Structured Data","check-square","PDF with selection fields"],
  [49,"Signature Form Fields","Forms","PDF Forms & Structured Data","pen-tool","PDF with signature fields"],
  [50,"Conditional Form Logic","Forms","PDF Forms & Structured Data","workflow","Validated interactive PDF form"],
  [51,"AI Automatic Form Field Detection","Forms","PDF Forms & Structured Data","scan-search","Field proposals and confidence report"],
  [52,"Fill, Save, and Flatten PDF Forms","Forms","PDF Forms & Structured Data","file-check-2","Filled or flattened PDF"],
  [53,"Form Data Import and Export","Forms","PDF Forms & Structured Data","database","CSV, JSON, FDF or XFDF data"],
  [54,"Text Markup Annotations","Review","Review & Collaboration","highlighter","Annotated PDF"],
  [55,"Drawing, Shapes, and Sticky Notes","Review","Review & Collaboration","message-square","Annotated PDF"],
  [56,"Threaded Comments and Mentions","Review","Review & Collaboration","messages-square","Versioned discussion threads"],
  [57,"Dynamic and Custom Stamps","Review","Review & Collaboration","stamp","Stamped PDF"],
  [58,"Precision Measurement","Review","Review & Collaboration","ruler","Calibrated measurements and PDF"],
  [59,"Compare PDF Documents","Review","Review & Collaboration","git-compare","PDF visual and text diff"],
  [60,"Collaborative Review","Review","Review & Collaboration","users","Permissioned review revision"],
  [61,"Protect PDF","Protect","PDF Security & Compliance","shield-check","Encrypted PDF"],
  [62,"Unlock and Decrypt PDF","Protect","PDF Security & Compliance","unlock","Authorized decrypted PDF"],
  [63,"Permanent PDF Redaction","Protect","PDF Security & Compliance","scan-eye","Independently validated redacted PDF"],
  [64,"Smart Sensitive-Information Redaction","Protect","PDF Security & Compliance","shield-alert","Human-reviewed redaction proposals"],
  [65,"Cryptographic Digital Signatures","Protect","PDF Security & Compliance","signature","Signed PDF and validation evidence"],
  [66,"Electronic Signature Requests","Protect","PDF Security & Compliance","mail-check","Signing workflow and audit evidence"],
  [67,"Bates Numbering","Protect","PDF Security & Compliance","hash","Bates-numbered PDFs"],
  [68,"Document Preflight","Protect","PDF Security & Compliance","clipboard-check","PDF conformance report"],
  [69,"Managed Document Rights","Protect","PDF Security & Compliance","shield","Managed document access policy"],
  [70,"Metadata and Hidden Content Sanitization","Protect","PDF Security & Compliance","eraser","Sanitized PDF and removal report"],
  [71,"AI Chat with PDF","Tools","AI & Document Intelligence","bot","Source-grounded conversation with citations"],
  [72,"Multi-Document AI Analysis","Tools","AI & Document Intelligence","files","Permissioned retrieval results"],
  [73,"AI PDF Summarization","Tools","AI & Document Intelligence","list","Source-cited summary"],
  [74,"Format-Preserving PDF Translation","Tools","AI & Document Intelligence","languages","Translated PDF and layout conflict report"],
  [75,"Context-Aware AI Rewriting","Tools","AI & Document Intelligence","spell-check","Reviewable PDF rewrite proposal"],
  [76,"Intelligent Table and Data Extraction","Tools","AI & Document Intelligence","table","CSV, JSON or XLSX with provenance"],
  [77,"AI Contract and Document Cross-Referencing","Tools","AI & Document Intelligence","search-check","Source-linked evidence report"],
  [78,"AI-Assisted Multi-Step Document Workflows","Tools","AI & Document Intelligence","workflow","Approved workflow manifest and audit trail"],
  [79,"Dynamic Invoice Generation","Automate","Automation & Business Documents","receipt","Validated PDF invoice"],
  [80,"AI Invoice Parsing","Automate","Automation & Business Documents","scan-text","Structured invoice data with confidence"],
  [81,"Smart Invoice Batch Splitting","Automate","Automation & Business Documents","scissors","Independently identified invoice PDFs"],
  [82,"Secure Payment Integration","Automate","Automation & Business Documents","credit-card","Hosted payment reference and verified event"],
  [83,"PDF Mail Merge","Automate","Automation & Business Documents","mail-merge","Personalized PDFs and manifest"],
  [84,"Approval and Conditional Workflow Builder","Automate","Automation & Business Documents","workflow","Audited document approval workflow"],
  [85,"Enterprise APIs, Webhooks, and Connectors","Automate","Automation & Business Documents","plug","Authenticated API/webhook result"],
  [86,"Batch Scheduler and Processing Profiles","Automate","Automation & Business Documents","calendar-clock","Job outputs, progress and retries"],
  [87,"Interactive 3D PDF","Tools","Specialized Technical Tools","box","Interactive embedded 3D PDF view"],
  [88,"CAD Document Integration","Tools","Specialized Technical Tools","ruler","Supported CAD view and PDF export"],
  [89,"DICOM Document Viewer","Tools","Specialized Technical Tools","heart-pulse","Supported DICOM series and PDF report"],
  [90,"Advanced Print and Prepress","Tools","Specialized Technical Tools","printer","Validated print-ready PDF"],
];

const NO_SOURCE_DOCUMENT = new Set<number>([1,10,28,30,31,32,33,34,35,45,71,72,79,80,81,82,83,84,85,86,88,89]);
const REQUIRES_SELECTION = new Set<number>([3,4,5,6,7,8,11,12,13,14,15,16,54,55,58,63,64,75]);
const AI_PERMISSIONS = new Set<number>([51,64,71,72,73,74,75,76,77,78,80,81]);
const SENSITIVE_OPERATIONS = new Set<number>([61,62,63,64,65,66,69,70,78,82,84,85]);

export const PDF_COMMANDS: readonly PDFCommand[] = Object.freeze(SPEC_CATALOG.map(
  ([index,label,category,requirementGroup,icon,expectedOutput]): PDFCommand => {
    const id = `MAL-${String(index).padStart(3,'0')}` as PDFRequirementId;
    const permissions = [
      'documents:read',
      ...(AI_PERMISSIONS.has(index) ? ['ai:invoke'] : []),
      ...(SENSITIVE_OPERATIONS.has(index) ? ['documents:sensitive-action'] : []),
      ...(!NO_SOURCE_DOCUMENT.has(index) ? ['documents:write'] : []),
    ];
    return Object.freeze({
      id, label, category, requirementGroup, icon,
      tooltip: `${label}. Expected result: ${expectedOutput}. ${UNVERIFIED_COMMAND_REASON}`,
      requiresDocument: !NO_SOURCE_DOCUMENT.has(index),
      requiresSelection: REQUIRES_SELECTION.has(index),
      permissions,
      expectedOutput,
      status: 'NOT_RELEASE_READY',
      isAvailable: (_context: PDFCommandContext) => false,
      async execute(_context: PDFCommandContext): Promise<PDFCommandResult> {
        throw new PDFCommandUnavailableError(id);
      },
    });
  },
));

export const PDF_COMMAND_BY_ID: ReadonlyMap<string,PDFCommand> = new Map(
  PDF_COMMANDS.map(command=>[command.id,command]),
);

export const LEGACY_TOOL_REQUIREMENTS: readonly {
  legacyTool: string;
  requirementIds: readonly PDFRequirementId[];
}[] = [
  {legacyTool:'Merge PDF Files',requirementIds:['MAL-001']},
  {legacyTool:'Split or Reorder PDF Pages',requirementIds:['MAL-002','MAL-003']},
  {legacyTool:'Encrypt and Decrypt with Security Options',requirementIds:['MAL-061','MAL-062']},
  {legacyTool:'Rotate or Crop PDF Pages',requirementIds:['MAL-007','MAL-008']},
  {legacyTool:'Reformat Multiple Pages into One Page',requirementIds:['MAL-009']},
  {legacyTool:'Add Header and Footer Information',requirementIds:['MAL-017']},
  {legacyTool:'Add Watermark by Styled Text',requirementIds:['MAL-019']},
  {legacyTool:'Add Watermark by Image',requirementIds:['MAL-020']},
  {legacyTool:'Convert Images to PDF',requirementIds:['MAL-030']},
  {legacyTool:'Convert PDF to Images',requirementIds:['MAL-036']},
  {legacyTool:'PDF Form Field Operations',requirementIds:['MAL-046','MAL-047','MAL-048','MAL-049','MAL-050','MAL-051','MAL-052','MAL-053']},
  {legacyTool:'Convert PostScript File into PDF',requirementIds:['MAL-035']},
  {legacyTool:'Add PDF Information',requirementIds:['MAL-021']},
  {legacyTool:'Scan into Image or PDF',requirementIds:['MAL-028']},
  {legacyTool:'Create Transparent Image (PNG)',requirementIds:['MAL-029']},
];

/** Convert requirements to searchable but NON-EXECUTABLE discovery entries.
 * This deliberately does not claim that existing legacy implementations
 * satisfy the stricter v2.0 acceptance criteria.
 */
export function pdfCatalogDiscovery() {
  return PDF_COMMANDS.map(command => ({
    id:command.id,
    label:command.label,
    group:command.category,
    icon:command.icon,
    keywords:`${command.id} ${command.requirementGroup} ${command.expectedOutput}`,
    detail:command.tooltip,
    hiddenWhenEmpty:true,
    disabled:true,
    disabledReason:command.tooltip,
    kind:'action' as const,
    run:():void => { throw new PDFCommandUnavailableError(command.id); },
  }));
}

export function pdfCommandsForCategory(category: PDFRibbonCategory): readonly PDFCommand[] {
  return PDF_COMMANDS.filter(command=>command.category===category);
}
