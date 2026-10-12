/** Master Specification v2.0: authoritative capability DISCOVERY catalog.
 * All 90 entries exist in Phase 1. Presence does not mean an engine is ready.
 * Later phases must register independently verified handlers and change
 * availability at the engine boundary, not by merely enabling a button. */
export const PDF_RIBBON_GROUPS = ['Home','Edit','Organize','Optimize','Convert','Forms','Review','Protect','Automate','Tools'] as const;
export type PdfRibbonGroup = typeof PDF_RIBBON_GROUPS[number];
export type PdfFeatureGroup = Exclude<PdfRibbonGroup,'Home'>;
export interface PdfFeatureCommand {
  readonly id: string;
  readonly label: string;
  readonly category: PdfFeatureGroup;
  readonly tooltip: string;
  readonly icon: string;
  readonly requiresDocument: boolean;
  readonly requiresSelection?: boolean;
  readonly permissions: readonly string[];
  readonly linkedAction?: {readonly category: string;readonly id:string};
}
/** No fake success handler. An entry can run only when the live PDF workspace
 * provides an existing enabled action for the explicit linked ID. */
export const MALENJO_PDF_COMMANDS: readonly PdfFeatureCommand[] = [
  {
    "id": "MAL-001",
    "label": "Merge PDF Files",
    "category": "Organize",
    "tooltip": "Combine multiple PDF documents in a chosen order.",
    "icon": "files",
    "requiresDocument": true,
    "permissions": [],
    "linkedAction": {
      "category": "organize",
      "id": "append"
    }
  },
  {
    "id": "MAL-002",
    "label": "Split PDF Files",
    "category": "Organize",
    "tooltip": "Split by ranges, page count, bookmarks, size, or boundaries.",
    "icon": "files",
    "requiresDocument": true,
    "permissions": [],
    "linkedAction": {
      "category": "organize",
      "id": "split"
    }
  },
  {
    "id": "MAL-003",
    "label": "Reorder PDF Pages",
    "category": "Organize",
    "tooltip": "Drag and reorder thumbnails with undo and redo.",
    "icon": "files",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-004",
    "label": "Remove PDF Pages",
    "category": "Organize",
    "tooltip": "Delete selected pages from the working revision after confirmation.",
    "icon": "files",
    "requiresDocument": true,
    "permissions": [],
    "linkedAction": {
      "category": "organize",
      "id": "remove-pages"
    }
  },
  {
    "id": "MAL-005",
    "label": "Extract PDF Pages",
    "category": "Organize",
    "tooltip": "Save selected pages or ranges as independent PDFs.",
    "icon": "files",
    "requiresDocument": true,
    "permissions": [],
    "linkedAction": {
      "category": "organize",
      "id": "extract-pages"
    }
  },
  {
    "id": "MAL-006",
    "label": "Insert and Replace Pages",
    "category": "Organize",
    "tooltip": "Insert blank or imported pages and replace existing pages.",
    "icon": "files",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-007",
    "label": "Rotate PDF Pages",
    "category": "Organize",
    "tooltip": "Rotate pages or selected ranges in 90-degree increments.",
    "icon": "files",
    "requiresDocument": true,
    "permissions": [],
    "linkedAction": {
      "category": "organize",
      "id": "turn-pages"
    }
  },
  {
    "id": "MAL-008",
    "label": "Crop PDF Pages",
    "category": "Organize",
    "tooltip": "Crop visually and configure PDF page boxes.",
    "icon": "files",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-009",
    "label": "Multiple Pages into One Page (N-up)",
    "category": "Organize",
    "tooltip": "Arrange several source pages on a destination sheet.",
    "icon": "files",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-010",
    "label": "Batch Document Assembly",
    "category": "Organize",
    "tooltip": "Assemble multiple files with a verifiable result manifest.",
    "icon": "files",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-011",
    "label": "Native Inline Text Editing",
    "category": "Edit",
    "tooltip": "Modify actual editable PDF text rather than overlaying text.",
    "icon": "edit",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-012",
    "label": "Paragraph Reflow and Reconstruction",
    "category": "Edit",
    "tooltip": "Reconstruct text containers and preview reflow/overflow.",
    "icon": "edit",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-013",
    "label": "Font, Typography, and Styles",
    "category": "Edit",
    "tooltip": "Detect fonts and edit supported typography and styles.",
    "icon": "edit",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-014",
    "label": "Image Editing",
    "category": "Edit",
    "tooltip": "Move, resize, rotate, crop, replace, or delete embedded images.",
    "icon": "edit",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-015",
    "label": "Vector Object Editing",
    "category": "Edit",
    "tooltip": "Select and change supported vector shapes and paths.",
    "icon": "edit",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-016",
    "label": "Insert Text, Shapes, and Graphics",
    "category": "Edit",
    "tooltip": "Insert editable text containers and graphics.",
    "icon": "edit",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-017",
    "label": "Headers and Footers",
    "category": "Edit",
    "tooltip": "Insert document variables and repeating headers or footers.",
    "icon": "edit",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-018",
    "label": "PDF Page Numbering",
    "category": "Edit",
    "tooltip": "Configure visible page numbers, scope, and placement.",
    "icon": "edit",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-019",
    "label": "Styled Text Watermarks",
    "category": "Edit",
    "tooltip": "Apply configurable typography, angle, placement and opacity.",
    "icon": "edit",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-020",
    "label": "Image Watermarks",
    "category": "Edit",
    "tooltip": "Apply image watermarks with scale, opacity and layer order.",
    "icon": "edit",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-021",
    "label": "PDF Information and Metadata",
    "category": "Edit",
    "tooltip": "Inspect, change or remove PDF Info and XMP metadata.",
    "icon": "edit",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-022",
    "label": "Bookmarks, Links, and Contents Navigation",
    "category": "Edit",
    "tooltip": "Edit bookmarks, links, destinations and contents navigation.",
    "icon": "edit",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-023",
    "label": "Search, Replace, and Editing History",
    "category": "Edit",
    "tooltip": "Search and replace supported content with reversible transactions.",
    "icon": "edit",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-024",
    "label": "Lossless PDF Compression",
    "category": "Optimize",
    "tooltip": "Optimize without intentional decoded page content changes.",
    "icon": "compress",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-025",
    "label": "Advanced PDF Compression",
    "category": "Optimize",
    "tooltip": "Apply configurable image compression and downsampling.",
    "icon": "compress",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-026",
    "label": "Repair PDF",
    "category": "Optimize",
    "tooltip": "Detect broken structures and reconstruct recoverable objects.",
    "icon": "compress",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-027",
    "label": "OCR PDF",
    "category": "Optimize",
    "tooltip": "Generate multilingual searchable text with confidence and correction.",
    "icon": "compress",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-028",
    "label": "Scan to Image or PDF",
    "category": "Optimize",
    "tooltip": "Capture scanner pages and export images or multipage PDF.",
    "icon": "compress",
    "requiresDocument": false,
    "permissions": []
  },
  {
    "id": "MAL-029",
    "label": "Create Transparent PNG",
    "category": "Optimize",
    "tooltip": "Export transparent PNGs with preserved alpha options.",
    "icon": "compress",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-030",
    "label": "JPG/PNG/TIFF to PDF",
    "category": "Convert",
    "tooltip": "Make configurable PDFs from one or more raster images.",
    "icon": "convert",
    "requiresDocument": false,
    "permissions": [],
    "linkedAction": {
      "category": "convert",
      "id": "images-to-pdf"
    }
  },
  {
    "id": "MAL-031",
    "label": "Word to PDF",
    "category": "Convert",
    "tooltip": "Render DOCX documents to PDFs with fidelity reporting.",
    "icon": "convert",
    "requiresDocument": false,
    "permissions": []
  },
  {
    "id": "MAL-032",
    "label": "PowerPoint to PDF",
    "category": "Convert",
    "tooltip": "Render PPTX slides into PDF pages.",
    "icon": "convert",
    "requiresDocument": false,
    "permissions": []
  },
  {
    "id": "MAL-033",
    "label": "Excel to PDF",
    "category": "Convert",
    "tooltip": "Render XLSX print areas and worksheets into PDF.",
    "icon": "convert",
    "requiresDocument": false,
    "permissions": []
  },
  {
    "id": "MAL-034",
    "label": "HTML to PDF",
    "category": "Convert",
    "tooltip": "Use a controlled HTML and CSS PDF renderer.",
    "icon": "convert",
    "requiresDocument": false,
    "permissions": []
  },
  {
    "id": "MAL-035",
    "label": "PostScript to PDF",
    "category": "Convert",
    "tooltip": "Convert supported PostScript with a sandboxed engine.",
    "icon": "convert",
    "requiresDocument": false,
    "permissions": []
  },
  {
    "id": "MAL-036",
    "label": "PDF to Images",
    "category": "Convert",
    "tooltip": "Export pages as JPG, PNG or TIFF at selected quality.",
    "icon": "convert",
    "requiresDocument": true,
    "permissions": [],
    "linkedAction": {
      "category": "convert",
      "id": "export-page-jpeg"
    }
  },
  {
    "id": "MAL-037",
    "label": "PDF to Word",
    "category": "Convert",
    "tooltip": "Reconstruct editable DOCX output and open its result editor.",
    "icon": "convert",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-038",
    "label": "PDF to PowerPoint",
    "category": "Convert",
    "tooltip": "Reconstruct editable PPTX slides and open its result editor.",
    "icon": "convert",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-039",
    "label": "PDF to Excel",
    "category": "Convert",
    "tooltip": "Extract tables into editable XLSX and open its result editor.",
    "icon": "convert",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-040",
    "label": "PDF to PDF/A",
    "category": "Convert",
    "tooltip": "Generate and independently validate archival PDF profiles.",
    "icon": "convert",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-041",
    "label": "PDF to Markdown",
    "category": "Convert",
    "tooltip": "Export headings, lists, tables and image references.",
    "icon": "convert",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-042",
    "label": "PDF to HTML",
    "category": "Convert",
    "tooltip": "Export supported layout, text, tables and images into HTML.",
    "icon": "convert",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-043",
    "label": "PDF to SVG",
    "category": "Convert",
    "tooltip": "Export eligible PDF page vectors into SVG.",
    "icon": "convert",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-044",
    "label": "PDF to Plain Text",
    "category": "Convert",
    "tooltip": "Extract selectable or OCR text with reading-order controls.",
    "icon": "convert",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-045",
    "label": "Batch Conversion and Result Workspace",
    "category": "Convert",
    "tooltip": "Batch-convert, report fidelity, and open verified Office outputs.",
    "icon": "convert",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-046",
    "label": "Drag-and-Drop Form Designer",
    "category": "Forms",
    "tooltip": "Visually create and position PDF form fields.",
    "icon": "form",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-047",
    "label": "Text, Number, and Date Fields",
    "category": "Forms",
    "tooltip": "Create typed fields with validation and formatting.",
    "icon": "form",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-048",
    "label": "Checkbox, Radio, and Selection Fields",
    "category": "Forms",
    "tooltip": "Create checkbox, radio and choice input controls.",
    "icon": "form",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-049",
    "label": "Signature Form Fields",
    "category": "Forms",
    "tooltip": "Place and configure digital signature field placeholders.",
    "icon": "form",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-050",
    "label": "Conditional Form Logic",
    "category": "Forms",
    "tooltip": "Define sandboxed calculations, visibility and dependencies.",
    "icon": "form",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-051",
    "label": "AI Automatic Form Field Detection",
    "category": "Forms",
    "tooltip": "Detect suggested fields privately with human review.",
    "icon": "form",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-052",
    "label": "Fill, Save, and Flatten PDF Forms",
    "category": "Forms",
    "tooltip": "Fill, save, or flatten interactive PDF form fields.",
    "icon": "form",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-053",
    "label": "Form Data Import and Export",
    "category": "Forms",
    "tooltip": "Transfer data using CSV, JSON, FDF and XFDF.",
    "icon": "form",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-054",
    "label": "Text Markup Annotations",
    "category": "Review",
    "tooltip": "Highlight, underline or strike through selected PDF text.",
    "icon": "comment",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-055",
    "label": "Drawing, Shapes, and Sticky Notes",
    "category": "Review",
    "tooltip": "Add markup, callouts, freehand shapes and notes.",
    "icon": "comment",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-056",
    "label": "Threaded Comments and Mentions",
    "category": "Review",
    "tooltip": "Review comments with replies, mentions and resolution.",
    "icon": "comment",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-057",
    "label": "Dynamic and Custom Stamps",
    "category": "Review",
    "tooltip": "Apply dynamic and reusable approval stamps.",
    "icon": "comment",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-058",
    "label": "Precision Measurement",
    "category": "Review",
    "tooltip": "Calibrate distance, angle, perimeter and area.",
    "icon": "comment",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-059",
    "label": "Compare PDF Documents",
    "category": "Review",
    "tooltip": "Compare PDF revisions with text differences and visual overlays.",
    "icon": "comment",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-060",
    "label": "Collaborative Review",
    "category": "Review",
    "tooltip": "Share assigned reviews and synchronize annotations.",
    "icon": "comment",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-061",
    "label": "Protect PDF",
    "category": "Protect",
    "tooltip": "Encrypt supported PDFs with AES-256 and permissions.",
    "icon": "shield",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-062",
    "label": "Unlock and Decrypt PDF",
    "category": "Protect",
    "tooltip": "Decrypt only with permitted credentials and rights.",
    "icon": "shield",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-063",
    "label": "Permanent PDF Redaction",
    "category": "Protect",
    "tooltip": "Permanently erase targeted visible and hidden content.",
    "icon": "shield",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-064",
    "label": "Smart Sensitive-Information Redaction",
    "category": "Protect",
    "tooltip": "Review privately detected sensitive content before redaction.",
    "icon": "shield",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-065",
    "label": "Cryptographic Digital Signatures",
    "category": "Protect",
    "tooltip": "Sign and validate certificates, timestamps and PAdES profiles.",
    "icon": "shield",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-066",
    "label": "Electronic Signature Requests",
    "category": "Protect",
    "tooltip": "Assign recipients, collect signatures and audit status.",
    "icon": "shield",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-067",
    "label": "Bates Numbering",
    "category": "Protect",
    "tooltip": "Apply sequential identifiers across document batches.",
    "icon": "shield",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-068",
    "label": "Document Preflight",
    "category": "Protect",
    "tooltip": "Check PDF/A, PDF/X, PDF/UA, font and structure profiles.",
    "icon": "shield",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-069",
    "label": "Managed Document Rights",
    "category": "Protect",
    "tooltip": "Manage controlled-viewer access without falsely claiming downloaded-file revocation.",
    "icon": "shield",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-070",
    "label": "Metadata and Hidden Content Sanitization",
    "category": "Protect",
    "tooltip": "Remove selected metadata, attachments, scripts and hidden resources.",
    "icon": "shield",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-071",
    "label": "AI Chat with PDF",
    "category": "Tools",
    "tooltip": "Ask grounded PDF questions with page citations from the top AI chat.",
    "icon": "tools",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-072",
    "label": "Multi-Document AI Analysis",
    "category": "Tools",
    "tooltip": "Analyze authorized document collections privately.",
    "icon": "tools",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-073",
    "label": "AI PDF Summarization",
    "category": "Tools",
    "tooltip": "Generate grounded summaries with document references.",
    "icon": "tools",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-074",
    "label": "Format-Preserving PDF Translation",
    "category": "Tools",
    "tooltip": "Translate supported text and report layout overflow.",
    "icon": "tools",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-075",
    "label": "Context-Aware AI Rewriting",
    "category": "Tools",
    "tooltip": "Suggest rewriting within selectable/editable PDF regions.",
    "icon": "tools",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-076",
    "label": "Intelligent Table and Data Extraction",
    "category": "Tools",
    "tooltip": "Extract structured tables to CSV, JSON or XLSX.",
    "icon": "tools",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-077",
    "label": "AI Contract and Document Cross-Referencing",
    "category": "Tools",
    "tooltip": "Find evidence and clauses in authorized documents.",
    "icon": "tools",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-078",
    "label": "AI-Assisted Multi-Step Document Workflows",
    "category": "Tools",
    "tooltip": "Approve scoped multi-step commands before sensitive execution.",
    "icon": "tools",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-079",
    "label": "Dynamic Invoice Generation",
    "category": "Automate",
    "tooltip": "Produce structured PDF invoices using validated templates.",
    "icon": "workflow",
    "requiresDocument": false,
    "permissions": []
  },
  {
    "id": "MAL-080",
    "label": "AI Invoice Parsing",
    "category": "Automate",
    "tooltip": "Extract invoice fields privately with confidence and evidence.",
    "icon": "workflow",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-081",
    "label": "Smart Invoice Batch Splitting",
    "category": "Automate",
    "tooltip": "Detect boundaries and output independently identified invoices.",
    "icon": "workflow",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-082",
    "label": "Secure Payment Integration",
    "category": "Automate",
    "tooltip": "Launch approved hosted payment and verify webhooks.",
    "icon": "workflow",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-083",
    "label": "PDF Mail Merge",
    "category": "Automate",
    "tooltip": "Populate PDF templates from validated structured sources.",
    "icon": "workflow",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-084",
    "label": "Approval and Conditional Workflow Builder",
    "category": "Automate",
    "tooltip": "Configure assignments, conditions and escalations.",
    "icon": "workflow",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-085",
    "label": "Enterprise APIs, Webhooks, and Connectors",
    "category": "Automate",
    "tooltip": "Integrate secured document APIs and approved platforms.",
    "icon": "workflow",
    "requiresDocument": false,
    "permissions": []
  },
  {
    "id": "MAL-086",
    "label": "Batch Scheduler and Processing Profiles",
    "category": "Automate",
    "tooltip": "Schedule, monitor, cancel and retry batch jobs.",
    "icon": "workflow",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-087",
    "label": "Interactive 3D PDF",
    "category": "Tools",
    "tooltip": "Inspect supported embedded 3D assets and model trees.",
    "icon": "tools",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-088",
    "label": "CAD Document Integration",
    "category": "Tools",
    "tooltip": "View supported CAD drawings with layers and PDF export.",
    "icon": "tools",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-089",
    "label": "DICOM Document Viewer",
    "category": "Tools",
    "tooltip": "View supported DICOM series privately with reporting.",
    "icon": "tools",
    "requiresDocument": true,
    "permissions": []
  },
  {
    "id": "MAL-090",
    "label": "Advanced Print and Prepress",
    "category": "Tools",
    "tooltip": "Configure print color, separations and PDF/X validation.",
    "icon": "tools",
    "requiresDocument": true,
    "permissions": []
  }
] as const;
export const MALENJO_COMMANDS_BY_ID: ReadonlyMap<string,PdfFeatureCommand> =
  new Map(MALENJO_PDF_COMMANDS.map(command=>[command.id,command]));
export const MALENJO_LEGACY_COMMANDS = {
  merge: ['MAL-001'], splitReorder:['MAL-002','MAL-003'],
  encryption:['MAL-061','MAL-062'], rotateCrop:['MAL-007','MAL-008'],
  nUp:['MAL-009'], headerFooter:['MAL-017'], styledWatermark:['MAL-019'],
  imageWatermark:['MAL-020'], imageToPdf:['MAL-030'], pdfToImage:['MAL-036'],
  forms:['MAL-046','MAL-047','MAL-048','MAL-049','MAL-050','MAL-051','MAL-052','MAL-053'],
  postScript:['MAL-035'], information:['MAL-021'], scan:['MAL-028'], transparentPng:['MAL-029'],
} as const;
/** Phase 1 is an honest structural UI gate; unlinked editing commands are
 * discoverable but disabled. Never return a fabricated processing result. */
export function pdfCommandUnavailableReason(feature:PdfFeatureCommand): string {
  return `${feature.id}: ${feature.label} is not release-verified for this document. This feature will be enabled only after its engine, inputs, permissions and output validation pass.`;
}
