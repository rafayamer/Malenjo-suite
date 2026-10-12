# MALENJO — FINAL MASTER DEVELOPMENT PROMPT

## Enterprise PDF Editor, Manipulation & AI Document Suite

**Document Type:** Software Engineering & UI/UX Implementation Specification\
**Version:** 2.0 — Consolidated Development Baseline\
**Target:** Windows Desktop, Web Application, and Cloud Processing Services\
**Objective:** Build a complete, functional, minimalist, professional PDF editing and manipulation application.

---

# 1. MASTER INSTRUCTIONS TO THE DEVELOPER

You are acting as a Senior Software Architect, Desktop Application Engineer, PDF Engine Specialist, and Senior UI/UX Designer.

Your task is to develop **MALENJO**, a professional, enterprise-grade PDF manipulation and editing suite.

MALENJO must combine:

- The straightforward simplicity of Foxit Reader.
- The PDF manipulation capabilities commonly found in tools such as iLovePDF.
- Advanced native PDF editing comparable to professional desktop PDF editors.
- AI document assistance through a conversational interface.
- Secure business-document processing and automation.
- Specialized CAD, 3D PDF, and DICOM viewing capabilities.

## Critical Product Definition

**MALENJO IS A PDF APPLICATION FIRST.**

It is NOT intended to be a standalone Microsoft Word, Excel, or PowerPoint competitor.

Word, Excel, and PowerPoint viewers/editors exist specifically to open and modify the converted outputs produced when a user converts a PDF into DOCX, XLSX, or PPTX.

The central workspace must remain optimized for PDF viewing, editing, organizing, converting, signing, and processing.

Do not create independent Word, Excel, or PowerPoint applications or a large multi-module administrative dashboard.

Every required feature must have a discoverable UI entry, an appropriate icon, valid input controls, actual execution logic, error handling, and a verifiable output.

**Do not substitute decorative buttons, simulated processing, fake outputs, or inert placeholders for implementation.**

---

# 2. FINAL UI/UX ARCHITECTURE

## 2.1 Mandatory Single-Window Layout

MALENJO shall use one cohesive desktop-style application window.

The layout shall contain five primary horizontal areas:

1. Top application title and quick-actions bar.
2. Compact contextual tools ribbon.
3. Document tab strip.
4. Central document workspace.
5. Compact bottom status and navigation bar.

No permanent left-hand application navigation rail shall appear.

The PDF viewer shall occupy the maximum available content area.

### Layout Reference
```
┌──────────────────────────────────────────────────────────────────────┐
│ MALENJO   Home  Open  Save  Undo  Redo      Search   AI  Theme  User │
├──────────────────────────────────────────────────────────────────────┤
│ Home  Edit  Organize  Optimize  Convert  Forms  Review  Protect  ...│
│                                                                      │
│ [Tool] [Tool] [Tool] [Tool] [Tool] [Tool] [More Tools ▾]             │
├──────────────────────────────────────────────────────────────────────┤
│ document.pdf ×    another-document.pdf ×                           │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│                                                                      │
│                    CENTRAL PDF DOCUMENT                             │
│                                                                      │
│                   Actual interactive pages                           │
│                                                                      │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│ Page 1 / 12       Previous  Next         Zoom −  100%  +   Fit      │
└──────────────────────────────────────────────────────────────────────┘
```

This is a structural illustration, not a request to render ASCII inside the application.

## 2.2 Top Application Bar

The top bar shall contain:

**Left side**

- MALENJO logo and application identity.
- Home button.
- Open File button.
- Save button.
- Undo and Redo controls.

**Right side**

- Search tools / command launcher.
- MALENJO AI logo.
- Light/Dark theme toggle.
- Compact user/settings menu.

The AI logo must remain visible at all supported desktop window widths.

The top bar shall not contain large text descriptions or unnecessary decorative sections.

## 2.3 Ribbon Structure

Implement a compact, Foxit-inspired contextual ribbon.

Primary ribbon tabs:

| Ribbon Tab | Primary Responsibilities                          |
| ---------- | ------------------------------------------------- |
| Home       | Common PDF actions and navigation                 |
| Edit       | Native PDF content modification                   |
| Organize   | Page manipulation and assembly                    |
| Optimize   | Compression, OCR, repair, scanning                |
| Convert    | PDF and supported external format conversions     |
| Forms      | Form authoring, filling, data export              |
| Review     | Annotations, comments, comparison, measurements   |
| Protect    | Encryption, redaction, signatures, compliance     |
| Automate   | Batch processing, invoice workflows, integrations |
| Tools      | Technical tools and specialized viewers           |

The AI assistant must remain accessible independently through its persistent top-bar icon.

### Ribbon Design Rules

- Use recognizable vector icons.
- Use a consistent icon style and stroke weight.
- Use concise labels only where necessary.
- Display explanatory tooltips on hover or keyboard focus.
- Group commonly used commands together.
- Prefer contextual controls over permanently occupying toolbar space.
- Use separators between logical command groups.
- Collapse less frequently used commands into labeled, icon-rich flyout galleries.
- Allow users to discover every feature without memorizing its location.
- Provide searchable access to the complete command catalog.
- Do not compress 90 icons into one permanently visible row.

### Suggested Ribbon Measurements

| Element                    | Target                                  |
| -------------------------- | --------------------------------------- |
| Top application bar        | 44–48 px                                |
| Ribbon tab row             | 32–36 px                                |
| Main ribbon command region | 48–72 px                                |
| Document tab strip         | 34–40 px                                |
| Bottom status bar          | 28–34 px                                |
| Standard ribbon icon       | 20–24 px                                |
| Minimum interactive target | 40 × 40 px                              |
| AI chat width              | 340–400 px on sufficiently wide windows |

Actual component sizes must adapt to operating-system scaling, accessibility settings, and viewport constraints.

## 2.4 Home Screen

The Home screen must be extremely simple.

The center of the window shall primarily display:

### Open File

- An animated folder/document icon.
- A readable **Open File** label.
- A clickable surface that launches the actual operating-system or browser file picker.
- Drag-and-drop support for supported files.

The icon animation must be subtle and should use the supplied reference animation when the asset becomes available.

### Recent Files

- A recognizable history/recent-document icon.
- A readable **Recent Files** label.
- Clicking opens a compact recent-file collection.
- Recent items should show filename, format, and last-opened information.
- Selecting a valid item must reopen the actual file.
- Missing or inaccessible documents must generate a clear recovery message.

No large dashboard, promotional cards, statistical widgets, or permanent workspace list should occupy the Home screen.

### Home Screen Reference
```
┌───────────────────────────────────────────────────────┐
│ MALENJO                                      AI   ◐   │
├───────────────────────────────────────────────────────┤
│ Home   Edit   Organize   Convert   Protect   Tools    │
├───────────────────────────────────────────────────────┤
│                                                       │
│                                                       │
│              Welcome to MALENJO                       │
│                                                       │
│                                                       │
│          ┌────────────┐   ┌────────────┐              │
│          │            │   │            │              │
│          │   📂       │   │    ◷       │              │
│          │ Open File  │   │Recent Files│              │
│          │            │   │            │              │
│          └────────────┘   └────────────┘              │
│                                                       │
│                                                       │
└───────────────────────────────────────────────────────┘
```

The final implementation should use professional SVG icons rather than text emojis.

## 2.5 PDF Editing Workspace

Opening a PDF shall replace the Home content with the interactive document canvas.

Requirements:

- Display real rendered PDF pages.
- Support selectable text and page navigation.
- Support zoom, fit-to-page, fit-to-width, and continuous scrolling.
- Display tools appropriate to the current selection.
- Allow multiple document tabs.
- Support keyboard shortcuts.
- Preserve viewport position during non-disruptive commands.
- Support undo/redo where applicable.
- Allow optional, user-invoked thumbnail, bookmark, and property panels.

Permanent sidebars are prohibited.

Optional panels shall be closed by default and shall be collapsible.

## 2.6 MALENJO AI Assistant Interface

The MALENJO AI logo shall appear in the top application bar.

Clicking the logo shall open a right-side conversational assistant.

### Required Behavior

- Chat interface inspired by Messenger or WhatsApp.
- Distinct user and AI message bubbles.
- Text-input box fixed to the bottom of the panel.
- Send button.
- Scrollable conversation history.
- Clear loading and processing indicators.
- Context awareness of the active PDF.
- Document citation links where applicable.
- Suggested prompts and available document actions.
- Minimize and close controls.
- Session persistence during panel resizing or closing.

Example conversation:

**User:** Summarize this PDF.

**MALENJO AI:** This document contains five major sections. Here is a summary with references to the corresponding pages.

**User:** Find the termination clause.

**MALENJO AI:** The relevant clause appears on page 12. [Open page 12]

**User:** Highlight it.

**MALENJO AI:** I located the clause. Review the proposed highlight before applying it.

The AI must be capable of invoking approved PDF commands through a permission-checked tool interface.

The AI shall not execute irreversible redactions, external submissions, financial transactions, or other sensitive actions without the configured confirmation and authorization.

### Panel Interaction Rules

- The PDF remains accessible while the chat is open.
- On wide windows, the PDF canvas resizes to accommodate the AI panel.
- On narrow windows, the assistant uses an explicitly opened compact view.
- The chat must not silently cover essential document controls.
- Closing the panel restores the available PDF viewing area.
- The chat must never open automatically on startup.

## 2.7 Themes

Implement exactly two appearance themes:

1. Light.
2. Dark.

Use the product owner's established MALENJO blue/cyan branding through centralized design tokens.

Do not invent a new unrelated color identity.

Both themes must have consistent icons, border styling, interactive feedback, dialogs, typography, and selected states.

Changing themes shall not change the appearance of document content or reset the active session.

## 2.8 Responsive Behavior

The interface shall be tested at minimum at these viewport sizes:

| Viewport            | Expected Behavior                                                       |
| ------------------- | ----------------------------------------------------------------------- |
| 1920 × 1080         | Full desktop ribbon                                                     |
| 1440 × 900          | Comfortable desktop layout                                              |
| 1366 × 768          | Compact ribbon with no clipping                                         |
| 1024 × 768          | Adaptive icon grouping and overflow menus                               |
| 768 × 600           | Compact workspace with reachable commands                               |
| Narrow web viewport | Explicit reduced-layout mode with accessible document and tool controls |

Mandatory rules:

- No overlapping panels.
- No clipped icons.
- No toolbar controls rendered outside the viewport.
- No horizontal overflow across the application shell.
- No tooltips or menus extending beyond the visible window.
- No unreachable primary commands.
- No excessively large buttons.
- No permanently expanded feature panels.
- No broken document layout when AI chat opens.
- No visual shift that causes the current document position to be lost.

---

# 3. COMPLETE 90-FEATURE PDF CAPABILITY CATALOG

**These are 90 required functional capabilities, numbered MAL-001 through MAL-090.**

Each feature shall be registered with a unique command ID, an appropriate icon, ribbon category, tooltip, keyboard accessibility behavior, required inputs, execution handler, and defined output.

Where features contain multiple related suboperations, all explicitly described suboperations are part of the required capability.

## CATEGORY A — ORGANIZE PDF

**MAL-001 — Merge PDF Files**

Combine multiple PDFs in a user-selected order, preserving pages, supported annotations, bookmarks, and metadata according to configured merge options.

**MAL-002 — Split PDF Files**

Split PDFs by page ranges, page count, bookmarks, size thresholds, or configured document boundaries.

**MAL-003 — Reorder PDF Pages**

Provide visual thumbnail drag-and-drop page reordering with undo and redo support.

**MAL-004 — Remove PDF Pages**

Delete selected pages from a working revision with a visible confirmation and updated page numbering.

**MAL-005 — Extract PDF Pages**

Extract selected pages or ranges into independent PDF files without altering the original document.

**MAL-006 — Insert and Replace Pages**

Insert blank pages, imported pages, or pages from other PDFs and replace existing pages.

**MAL-007 — Rotate PDF Pages**

Rotate individual pages, selected ranges, or the entire document by supported 90-degree increments.

**MAL-008 — Crop PDF Pages**

Crop pages visually and provide controls for applicable PDF page boxes.

**MAL-009 — Multiple Pages into One Page (N-up)**

Reformat multiple source pages onto one destination page, supporting common grid layouts, page orientation, spacing, and order.

**MAL-010 — Batch Document Assembly**

Apply selected page organization rules across multiple source files and generate a result manifest.

## CATEGORY B — EDIT PDF & LAYOUT

**MAL-011 — Native Inline Text Editing**

Allow direct modification of editable PDF text, including selecting, inserting, deleting, and replacing characters without merely placing a text overlay.

**MAL-012 — Paragraph Reflow and Reconstruction**

Group editable text into paragraphs or text containers and support reflow, alignment, spacing, and overflow detection.

**MAL-013 — Font, Typography, and Styles**

Support font detection and substitution warnings, size, weight, spacing, line height, paragraph formatting, and reusable styles for structurally editable content.

**MAL-014 — Image Editing**

Move, resize, rotate, crop, replace, delete, and adjust raster images embedded in PDFs.

**MAL-015 — Vector Object Editing**

Select and manipulate supported paths, lines, shapes, fills, strokes, and vector object positioning.

**MAL-016 — Insert Text, Shapes, and Graphics**

Add new text containers, graphical objects, arrows, and editable design elements.

**MAL-017 — Headers and Footers**

Insert dynamic headers and footers containing filenames, dates, page labels, document variables, and custom text.

**MAL-018 — PDF Page Numbering**

Apply configurable visible page numbers with alignment, margins, prefixes, suffixes, and numbering formats.

**MAL-019 — Styled Text Watermarks**

Create watermark text with configurable typography, orientation, transparency, positioning, and page scope.

**MAL-020 — Image Watermarks**

Apply image-based watermarks with configurable scaling, position, transparency, and layer order.

**MAL-021 — PDF Information and Metadata**

Inspect, modify, clear, and save supported PDF information dictionary and XMP metadata attributes.

**MAL-022 — Bookmarks, Links, and Contents Navigation**

Create, edit, and remove bookmarks, hyperlinks, destinations, and generated tables of contents where suitable document structure exists.

**MAL-023 — Search, Replace, and Editing History**

Provide text search and replacement, reversible editing transactions, undo/redo, and saved document revision history.

## CATEGORY C — OPTIMIZE, SCAN & REPAIR

**MAL-024 — Lossless PDF Compression**

Reduce file sizes without intentional alteration of decoded page content through supported non-destructive optimization.

**MAL-025 — Advanced PDF Compression**

Provide configurable image compression, downsampling, quality profiles, and output-size reporting.

**MAL-026 — Repair PDF**

Detect malformed PDF structures and reconstruct recoverable objects where possible while reporting unrecoverable content.

**MAL-027 — OCR PDF**

Convert scanned image content into searchable text layers, supporting multilingual OCR, correction, confidence results, and OCR-assisted editing.

**MAL-028 — Scan to Image or PDF**

Acquire pages from supported scanners using available platform interfaces, with document feeder, resolution, rotation, color mode, and multipage output options.

**MAL-029 — Create Transparent PNG**

Export supported graphical content or page regions to PNG with transparency options, alpha preservation, and optional background-removal processing.

## CATEGORY D — CONVERT PDF & EXTERNAL FILES

**MAL-030 — JPG/PNG/TIFF to PDF**

Convert one or multiple raster images into PDF pages with configurable sizes, orientation, margins, and order.

**MAL-031 — Word to PDF**

Convert DOCX documents into rendered PDF output with high visual fidelity.

**MAL-032 — PowerPoint to PDF**

Convert PPTX presentation slides into PDF pages.

**MAL-033 — Excel to PDF**

Convert XLSX worksheets and configured print areas into PDF pages.

**MAL-034 — HTML to PDF**

Convert supported HTML/CSS content into PDF output through a controlled renderer.

**MAL-035 — PostScript to PDF**

Convert supported PostScript documents into valid PDF files using a sandboxed processing engine.

**MAL-036 — PDF to Images**

Export selected PDF pages to JPG, PNG, or TIFF with configurable resolution and quality.

**MAL-037 — PDF to Word**

Convert PDF content into editable DOCX documents using structured text, image, and layout reconstruction.

**MAL-038 — PDF to PowerPoint**

Convert PDF pages into PPTX slides with editable content reconstruction where feasible.

**MAL-039 — PDF to Excel**

Extract recognized tables and spreadsheet-like content into structured XLSX workbooks.

**MAL-040 — PDF to PDF/A**

Convert eligible PDFs into supported archival conformance profiles and independently validate the output.

**MAL-041 — PDF to Markdown**

Convert structured PDF content to Markdown with supported headings, lists, tables, and image references.

**MAL-042 — PDF to HTML**

Export supported text, layout elements, tables, and images into HTML.

**MAL-043 — PDF to SVG**

Export eligible PDF page graphics into SVG, preserving supported vector constructs.

**MAL-044 — PDF to Plain Text**

Export extractable or OCR-recognized text using selectable reading-order and page-separator settings.

**MAL-045 — Batch Conversion and Result Workspace**

Convert multiple documents using conversion profiles, display fidelity reports, and automatically open successful DOCX, XLSX, or PPTX outputs in their respective internal conversion-result editors.

### Mandatory Office Conversion Workflow

When PDF-to-Word completes, open the generated DOCX in the internal Word-style viewer/editor.

When PDF-to-Excel completes, open the generated XLSX in the internal spreadsheet viewer/editor.

When PDF-to-PowerPoint completes, open the generated PPTX in the internal presentation viewer/editor.

These editors shall provide basic review, correction, editing, saving, and export functionality for converted output.

They shall not become separate general-purpose Office application modules.

Cross-format conversion cannot universally preserve every native Office or PDF object. The system must detect unsupported features and report fidelity limitations rather than falsely claiming mathematically lossless conversion.

## CATEGORY E — PDF FORMS & STRUCTURED DATA

**MAL-046 — Drag-and-Drop Form Designer**

Create and position interactive form fields directly on PDF pages through a visual authoring interface.

**MAL-047 — Text, Number, and Date Fields**

Support typed text inputs, required-field rules, formatting constraints, and validation.

**MAL-048 — Checkbox, Radio, and Selection Fields**

Support checkboxes, radio groups, dropdowns, and list boxes.

**MAL-049 — Signature Form Fields**

Insert digital signature placeholders and configure their form properties.

**MAL-050 — Conditional Form Logic**

Support calculated values, conditional visibility, field dependencies, validations, and sandboxed supported JavaScript actions.

**MAL-051 — AI Automatic Form Field Detection**

Detect candidate field locations and types from static or scanned forms using privately hosted AI, with confidence reporting and human review.

**MAL-052 — Fill, Save, and Flatten PDF Forms**

Fill interactive forms, save their values, and flatten fields into visible static content when requested.

**MAL-053 — Form Data Import and Export**

Import and export supported form data using CSV, JSON, FDF, and XFDF where applicable.

## CATEGORY F — REVIEW & COLLABORATION

**MAL-054 — Text Markup Annotations**

Provide highlight, underline, strikeout, and related text-review markup.

**MAL-055 — Drawing, Shapes, and Sticky Notes**

Provide freehand markup, arrows, callouts, rectangles, circles, text comments, and sticky notes.

**MAL-056 — Threaded Comments and Mentions**

Support asynchronous comment threads, replies, user mentions, resolution, and notifications.

**MAL-057 — Dynamic and Custom Stamps**

Create reusable stamps with dynamic date, time, user, document identifier, and approval-state variables.

**MAL-058 — Precision Measurement**

Support calibrated distance, angle, area, and perimeter measurements with selectable units and scale factors.

**MAL-059 — Compare PDF Documents**

Compare PDF revisions using side-by-side rendering, text differences, and visual overlays.

**MAL-060 — Collaborative Review**

Support document sharing, version-associated annotations, review assignments, and conflict-aware synchronization.

## CATEGORY G — PDF SECURITY & COMPLIANCE

**MAL-061 — Protect PDF**

Support password-based AES-256 PDF encryption and configurable permission flags for supported document actions.

**MAL-062 — Unlock and Decrypt PDF**

Allow authorized users with the necessary credentials or cryptographic rights to decrypt or remove protection where permitted.

**MAL-063 — Permanent PDF Redaction**

Permanently remove selected text, images, graphics, and associated targeted hidden content from released redacted artifacts.

**MAL-064 — Smart Sensitive-Information Redaction**

Privately detect candidate personal identifiers, financial identifiers, names, addresses, and configured sensitive data patterns for user-reviewed redaction.

**MAL-065 — Cryptographic Digital Signatures**

Support certificate-based signing, trusted timestamps, signature validation, and configured PAdES profiles.

**MAL-066 — Electronic Signature Requests**

Provide document signing workflows, recipient assignment, signing status, and supporting audit evidence.

**MAL-067 — Bates Numbering**

Apply sequential Bates identifiers across files using configurable prefixes, counters, padding, placement, and batch continuation rules.

**MAL-068 — Document Preflight**

Check supported PDF/A, PDF/X, PDF/UA, font, color-space, transparency, and structural conditions against selected profiles.

**MAL-069 — Managed Document Rights**

Support managed-viewer access expiration, dynamic user-identifying watermarks, and access revocation for centrally controlled documents.

Access revocation shall not be represented as retroactive control over unrestricted plaintext PDFs already downloaded into unmanaged external software.

**MAL-070 — Metadata and Hidden Content Sanitization**

Inspect and remove selected metadata, embedded files, scripts, hidden content, and other supported potentially sensitive resources.

## CATEGORY H — AI & DOCUMENT INTELLIGENCE

**MAL-071 — AI Chat with PDF**

Allow the user to converse with the current document through the top-bar MALENJO AI chat interface using source-grounded answers and navigable citations.

**MAL-072 — Multi-Document AI Analysis**

Create permission-controlled document collections for private RAG-based retrieval and comparison across multiple PDFs.

**MAL-073 — AI PDF Summarization**

Generate structured summaries, key points, action items, and user-requested section summaries with source references.

**MAL-074 — Format-Preserving PDF Translation**

Translate recognized document text while retaining compatible layouts, images, tables, and styling. Detect and report language-expansion overflow and unpreservable formatting.

**MAL-075 — Context-Aware AI Rewriting**

Suggest rewording, grammar improvements, tone changes, and replacement text within selected editable PDF content.

**MAL-076 — Intelligent Table and Data Extraction**

Identify tables and structured data from native or scanned PDFs and export validated data to CSV, JSON, or XLSX.

**MAL-077 — AI Contract and Document Cross-Referencing**

Locate clauses, obligations, discrepancies, references, and other supported evidence across authorized documents.

**MAL-078 — AI-Assisted Multi-Step Document Workflows**

Allow permission-limited agents to plan and execute supported document processing tasks, with explicit confirmation before sensitive or irreversible actions.

### Mandatory AI Privacy Requirements

- No training or fine-tuning on customer documents.
- No use of customer prompts or outputs for shared model improvement.
- No cross-tenant retrieval or inference context.
- No unapproved public AI endpoints.
- Encryption of source content and embeddings.
- Enforcement of current document permissions before retrieval.
- Region-restricted inference where required.
- Auditing of AI operations without routine logging of confidential contents.
- Prompt-injection defense and tool-use restrictions.
- Configurable document retention and deletion.
- Human approval of irreversible and consequential actions.

AI shall be optional at tenant-policy level and shall not be necessary for deterministic PDF operations.

## CATEGORY I — AUTOMATION & BUSINESS DOCUMENTS

**MAL-079 — Dynamic Invoice Generation**

Generate structured PDF invoices from templates, validated data, and authenticated APIs.

**MAL-080 — AI Invoice Parsing**

Extract vendor details, amounts, tax values, due dates, line items, and other supported accounts-payable fields with confidence and source evidence.

**MAL-081 — Smart Invoice Batch Splitting**

Detect invoice boundaries in multi-document PDF batches and generate independently identifiable invoice files.

**MAL-082 — Secure Payment Integration**

Embed or launch approved hosted payment flows and associate verified payment events with invoice records.

**MAL-083 — PDF Mail Merge**

Populate PDF templates from CSV, databases, spreadsheets, or authenticated APIs to generate batch personalized documents.

**MAL-084 — Approval and Conditional Workflow Builder**

Create document workflows with sequential or parallel approvals, conditions, role assignments, reminders, and escalations.

**MAL-085 — Enterprise APIs, Webhooks, and Connectors**

Expose secured document APIs and integrate with approved platforms such as SharePoint, Salesforce, Jira, and supported storage/accounting systems.

**MAL-086 — Batch Scheduler and Processing Profiles**

Save reusable automation profiles, schedule supported processing jobs, monitor progress, inspect results, and retry eligible failures.

## CATEGORY J — SPECIALIZED TECHNICAL TOOLS

**MAL-087 — Interactive 3D PDF**

Display supported embedded 3D model content with orbit, zoom, selection, model-tree navigation, and applicable measurement controls.

**MAL-088 — CAD Document Integration**

Provide a technical drawing viewer for specifically supported CAD formats, with layer visibility, page/scale management, and drawing-to-PDF export.

**MAL-089 — DICOM Document Viewer**

Provide controlled viewing of supported DICOM image series with window/level adjustments, basic measurements, privacy safeguards, and PDF reporting/export.

**MAL-090 — Advanced Print and Prepress**

Support print-ready export profiles, color-management configuration, supported separations, transparency handling, and professional PDF/X preparation and validation.

---

# 4. LEGACY TOOL COMPATIBILITY

The original 15 PDF tools from the product owner's screenshot are mandatory.

The implementation must explicitly map them into the new MALENJO tool registry:

| Legacy Tool                               | MALENJO Capability      |
| ----------------------------------------- | ----------------------- |
| Merge PDF Files                           | MAL-001                 |
| Split or Reorder PDF Pages                | MAL-002, MAL-003        |
| Encrypt and Decrypt with Security Options | MAL-061, MAL-062        |
| Rotate or Crop PDF Pages                  | MAL-007, MAL-008        |
| Reformat Multiple Pages into One Page     | MAL-009                 |
| Add Header and Footer Information         | MAL-017                 |
| Add Watermark by Styled Text              | MAL-019                 |
| Add Watermark by Image                    | MAL-020                 |
| Convert Images to PDF                     | MAL-030                 |
| Convert PDF to Images                     | MAL-036                 |
| PDF Form Field Operations                 | MAL-046 through MAL-053 |
| Convert PostScript File into PDF          | MAL-035                 |
| Add PDF Information                       | MAL-021                 |
| Scan into Image or PDF                    | MAL-028                 |
| Create Transparent Image (PNG)            | MAL-029                 |

Do not omit or merge away these original commands merely because newer functions appear similar.

The modern UI may use different icons and command grouping, but the original capabilities must remain accessible.

---

# 5. ADVANCED PDF EDITING ENGINE

This is a major technical requirement.

MALENJO must not be a simple PDF viewer with text-box overlays.

It must provide genuine manipulation of PDF content where technically feasible.

## 5.1 Native Editing

The editing engine shall support:

- Reading PDF content streams.
- Identifying text objects and their geometry.
- Mapping glyphs to Unicode text.
- Editing text and serializing the resulting content.
- Managing font resources and substitutions.
- Regrouping editable text into logical paragraphs.
- Recalculating text positioning when paragraph content changes.
- Editing supported embedded images.
- Editing supported vector objects.
- Preserving graphical object stacking order.
- Detecting broken layout after editing.
- Producing valid, independently readable PDF output.

## 5.2 DOCX-Like Editing Experience

When a user double-clicks an editable PDF paragraph, MALENJO should enter a direct text-editing mode.

The user should be able to:

1. Position a text caret.
2. Select words and paragraphs.
3. Change text.
4. Delete or insert lines.
5. Apply supported text formatting.
6. Reflow affected paragraph content where supported.
7. Resize or reposition the text container.
8. Preview layout changes before committing.
9. Undo changes.
10. Save a valid new PDF revision.

### Important Technical Constraint

PDF is primarily a fixed-layout format. Arbitrary PDFs do not necessarily contain the paragraph, style, font, or table information required for DOCX-equivalent editing.

MALENJO shall provide three explicit editing pathways:

**Mode A — Native Content Editing**

Used when the PDF contains extractable and modifiable text and graphical objects.

**Mode B — OCR-Assisted Reconstruction**

Used when the PDF contains scanned pages or rasterized text. The system recognizes content, reconstructs editable regions, and preserves an association with the original page.

**Mode C — Visual Editing Fallback**

Used for unsupported or non-reconstructable content. The system provides explicitly identified overlays, replacement regions, or raster-based transformations.

The application shall clearly indicate when an operation is using the fallback rather than native text modification.

Signed, protected, malformed, or unusual PDFs may require additional authorization, reconstruction, or conversion and shall not be silently modified.

## 5.3 PDF Editing Verification

Include test documents containing:

- Digitally generated PDFs.
- Multi-column documents.
- Scanned PDFs.
- Embedded and subsetted fonts.
- Complex tables.
- Forms.
- Raster and vector illustrations.
- Arabic and other right-to-left scripts.
- Unicode and multilingual text.
- Transparent elements.
- Encrypted documents.
- Signed documents.
- Mixed page rotations and page sizes.

Tests shall verify not only that a file saves, but also that intended edits survive reopening in independent PDF readers.

---

# 6. OFFICE CONVERSION RESULT EDITORS

MALENJO shall provide three limited internal output editors.

## 6.1 Word Result Editor

Triggered by PDF → DOCX conversion.

Required capabilities:

- Render converted DOCX content.
- Correct converted text.
- Edit recognized tables and images where supported.
- Adjust basic paragraph formatting.
- Save modified DOCX.
- Export revised content back to PDF.

## 6.2 Excel Result Editor

Triggered by PDF → XLSX conversion.

Required capabilities:

- Display worksheets and extracted tables.
- Edit cells.
- Support basic spreadsheet formatting.
- Preserve or recalculate supported cell formulas where applicable.
- Save the XLSX result.
- Export selected sheets to PDF.

## 6.3 PowerPoint Result Editor

Triggered by PDF → PPTX conversion.

Required capabilities:

- Display reconstructed slides.
- Edit supported text boxes and graphics.
- Reorder slides.
- Save the PPTX result.
- Export the presentation to PDF.

### Restrictions

- No standalone Office productivity dashboard.
- No requirement to implement the entirety of Microsoft Office.
- No automatic default file association for DOCX, XLSX, or PPTX.
- No unrelated Office toolbars in the PDF workspace.

The internal editors are only conversion-result workspaces.

---

# 7. DESKTOP FILE ASSOCIATIONS

On Windows, MALENJO shall provide optional file associations for:

- PDF files.
- Specifically supported CAD file extensions.
- Specifically supported DICOM file extensions.

Installation must not silently replace existing default applications.

Users should be able to select MALENJO as their preferred opener for supported file types through normal operating-system mechanisms.

Opening a supported file externally shall route it to the appropriate viewer in the existing MALENJO window or a controlled new window, according to the application's documented multi-instance behavior.

---

# 8. TECHNICAL SYSTEM ARCHITECTURE

## 8.1 Recommended Component Boundaries

Implement the application with separable components:

| Component              | Responsibilities                                      |
| ---------------------- | ----------------------------------------------------- |
| Application Shell      | Windowing, top ribbon, menus, tabs, themes            |
| PDF Viewer             | Page rendering, navigation, search, zoom              |
| PDF Editing Engine     | Content parsing, editing, saving                      |
| Page Operations Engine | Merge, split, rotate, crop, reorder                   |
| Conversion Engine      | Office, image, HTML, PostScript, archival conversions |
| OCR Engine             | Text recognition and searchable layers                |
| Forms Engine           | Form authoring, filling, validation                   |
| Annotation Engine      | Markup, comments, stamps, measurements                |
| Security Engine        | Encryption, redaction, certificates, signing          |
| AI Gateway             | Private inference, retrieval, approved tool actions   |
| Automation Engine      | Jobs, queues, workflows, scheduling                   |
| Integration Layer      | REST APIs, webhooks, external systems                 |
| Specialty Viewers      | Supported CAD, 3D PDF, and DICOM processing           |
| Persistence Layer      | Documents, versions, metadata, settings               |
| Observability Layer    | Logs, tracing, diagnostics, audit events              |

## 8.2 Technology Requirements

Technology selection shall prioritize:

1. Correct PDF rendering and serialization.
2. Native or near-native desktop responsiveness.
3. Stable memory usage on large documents.
4. Secure handling of untrusted files.
5. Modular implementation.
6. Maintainable code.
7. Commercially acceptable dependency licenses.
8. Reuse of common processing logic between desktop and cloud.

Suitable implementation choices may include a desktop shell such as Tauri or another production-supported native framework, a component-based UI, and proven PDF processing libraries.

The developer shall evaluate rendering, editing, font handling, and licensing requirements before selecting the primary PDF engine.

Do not attempt to create a complete PDF parser from scratch if a suitable maintained implementation exists.

Do not select a library solely because it can display a PDF. Rendering capability and native content editing capability are different requirements.

## 8.3 Document Processing Model

All modifications shall create a controlled working state.

The system shall:

- Preserve the source artifact.
- Validate requested operations.
- Record relevant revision information.
- Execute work through suitable processing components.
- Validate generated output.
- Publish successful results.
- Report partial or failed operations.
- Support safe cancellation.
- Prevent corrupt outputs from replacing known-good files.

Background jobs shall expose progress and clear failure messages.

## 8.4 Shared Command Registry

Implement all 90 features through a centralized command registry.

Each command definition shall contain at least:
```
interface PDFCommand {
  id: string;
  label: string;
  category: string;
  icon: string;
  tooltip: string;
  shortcut?: string;
  requiresDocument: boolean;
  requiresSelection?: boolean;
  permissions: string[];
  isAvailable: (context: CommandContext) => boolean;
  execute: (context: CommandContext) => Promise<CommandResult>;
}
```

The exact internal types may differ, but equivalent functionality is required.

The same registry shall power:

- Ribbon buttons.
- Compact overflow galleries.
- Searchable command launcher.
- Contextual menus.
- Keyboard shortcuts.
- Authorized AI tool invocation.
- Feature availability tests.

No independent hardcoded toolbar duplicate logic should be necessary.

---

# 9. COMPONENT AND INTERACTION REQUIREMENTS

## 9.1 All Visible Buttons Must Work

Every enabled button shall:

1. Invoke the correct command.
2. Open a functional dialog or execute its permitted action.
3. Collect required user inputs.
4. Display validation errors.
5. Display real processing feedback when needed.
6. Produce an actual state change or artifact.
7. Display a clear success or failure result.
8. Remain usable at supported window sizes.

For functionality not yet implemented, development builds may expose a clearly disabled feature entry with a reason.

An unfinished feature must not appear to have completed a real operation.

## 9.2 Dialog Behavior

All dialogs shall:

- Fit within the application viewport.
- Remain keyboard accessible.
- Offer close or cancel behavior.
- Validate fields before execution.
- Avoid covering unrelated critical controls.
- Restore focus appropriately when closed.
- Use consistent typography and spacing.

Examples of real dialogs include:

- Merge Files.
- Split Pages.
- Crop Pages.
- Compress PDF.
- OCR Options.
- Export Settings.
- Encryption Settings.
- Signature Configuration.
- Watermark Editor.
- Form Properties.
- Batch Processing.
- Document Conversion.

## 9.3 File Open Behavior

The Open File action must invoke an actual native or browser file-selection mechanism.

After selection:

- Validate file type.
- Validate file accessibility.
- Open the document.
- Display processing errors if opening fails.
- Add it to Recent Files.
- Show a document tab.
- Render the first usable page.
- Enable appropriate contextual commands.

Do not simulate a file dialog with non-functional file cards.

## 9.4 Hover Tooltips

Every important feature icon shall display a tooltip indicating:

- Feature name.
- Short functional description.
- Shortcut where available.
- Reason for disabled state where relevant.

Example:

**Merge PDFs**\
Combine multiple PDF documents into one file.

**Redact PDF**\
Permanently remove selected sensitive content.

Tooltip placement must be viewport-aware.

## 9.5 Animation Requirements

Use short, restrained animations:

- Folder animation for Open File.
- Smooth AI panel opening and closing.
- Hover feedback.
- Ribbon selection transitions.
- Processing spinners and progress indicators.
- Tab activation transitions.

Respect the operating system's reduced-motion preference.

Do not add decorative continuously animated elements across the workspace.

---

# 10. SECURITY, PRIVACY & DATA INTEGRITY

Security controls are product requirements, not optional deployment improvements.

The system shall support:

- Enterprise authentication and configurable MFA.
- Role-based and document-level permissions.
- TLS for network communication.
- Encryption of sensitive stored content.
- Tenant-isolated storage and processing.
- Restricted background worker execution.
- Sandboxed document scripts.
- Secure credential handling.
- Audit trails for sensitive actions.
- Immutable references to signed document revisions.
- Secure deletion and configurable retention.
- Approval checks for consequential automation.

Redaction must permanently remove targeted content from the released artifact, not merely draw black rectangles.

Cryptographic signing must use authorized signing credentials and validate supported trust evidence.

Document permission flags must not be incorrectly presented as universally enforceable DRM controls in arbitrary third-party PDF software.

The system must not transmit customer documents to public AI services by default or use their content for model training.

---

# 11. PERFORMANCE & RELIABILITY TARGETS

Use documented benchmark environments and representative document corpora.

| Metric                            | Target                               |
| --------------------------------- | ------------------------------------ |
| Open typical 100-page PDF         | p95 ≤ 3 seconds to first usable page |
| Switch between cached pages       | p95 ≤ 250 ms                         |
| Local ordinary text edit feedback | p95 ≤ 200 ms                         |
| Render standard page              | p95 ≤ 1.5 seconds                    |
| OCR clean 300-DPI page            | p95 ≤ 5 seconds on benchmark worker  |
| Search indexed 1,000-page PDF     | p95 ≤ 3 seconds                      |
| Ordinary metadata API response    | p95 ≤ 300 ms                         |
| API monthly availability          | ≥ 99.95%                             |
| Maximum supported document        | 2 GB baseline                        |
| Maximum supported page count      | 10,000-page baseline                 |

Processing constraints shall be established for each document complexity tier.

Large operations shall use cancellable, background processing and shall not freeze the application shell.

The application shall remain responsive during conversion, OCR, AI, compression, and batch processing.

---

# 12. ACCESSIBILITY, THEMES & VISUAL CONSISTENCY

The developer shall create a small shared design system rather than styling each screen independently.

Required reusable components include:

- Icon button.
- Ribbon tab.
- Ribbon command group.
- Feature gallery.
- Tooltip.
- Dialog.
- Dropdown.
- File card.
- Document tab.
- PDF page canvas.
- Progress indicator.
- Toast notification.
- Status bar.
- AI message bubble.
- AI composer.
- Contextual property control.

Requirements:

- Accessible keyboard focus.
- Consistent pointer and hover states.
- Light and dark theme variables.
- Predictable tab navigation.
- Sufficient foreground/background contrast.
- Screen-reader names for icon-only controls.
- High-DPI scaling support.
- No mismatched icon families.
- No oversized spacing.
- No unnecessary ornamental gradients, dashboard cards, or shadows.

Professional appearance must come from alignment, consistency, visual hierarchy, and restrained styling.

---

# 13. MANDATORY TEST SCENARIOS

## 13.1 Home and Navigation

**TEST-UI-001:** Open File launches the correct picker.

**TEST-UI-002:** Selecting a PDF renders its actual contents.

**TEST-UI-003:** Recent Files persists and reopens accessible files.

**TEST-UI-004:** Multiple open PDFs display correct tabs.

**TEST-UI-005:** Closing a tab does not incorrectly close unrelated documents.

**TEST-UI-006:** Tooltips appear for ribbon icons and remain inside the window.

## 13.2 Responsive UI

**TEST-UI-007:** All major ribbon categories remain reachable at 1366 × 768.

**TEST-UI-008:** At 1024 × 768, icons compact into accessible galleries without clipping.

**TEST-UI-009:** No essential application control becomes unreachable at 768 × 600.

**TEST-UI-010:** Opening the AI panel does not produce uncontrolled overlap with the PDF workspace.

**TEST-UI-011:** Closing the AI panel restores document canvas width and viewport position.

**TEST-UI-012:** Light/Dark switching does not reset open files or document states.

## 13.3 Core PDF Operations

**TEST-PDF-001:** Merge two valid PDFs and reopen the merged output.

**TEST-PDF-002:** Split a PDF by page range and independently verify each result.

**TEST-PDF-003:** Reorder, remove, extract, crop, and rotate selected pages.

**TEST-PDF-004:** Generate a correct N-up output.

**TEST-PDF-005:** Add both text and image watermarks.

**TEST-PDF-006:** Add headers, footers, and dynamic page numbering.

**TEST-PDF-007:** Modify existing editable text and save a valid PDF.

**TEST-PDF-008:** Perform OCR on scanned content and verify searchable text.

**TEST-PDF-009:** Compress a PDF while respecting the selected fidelity mode.

**TEST-PDF-010:** Convert between supported PDF, image, and document formats.

## 13.4 Security

**TEST-SEC-001:** Encrypt and decrypt using valid authorization.

**TEST-SEC-002:** Verify correct rejection of invalid credentials.

**TEST-SEC-003:** Permanently redact content and attempt extraction using independent PDF tools.

**TEST-SEC-004:** Verify signed document integrity and invalidation behavior.

**TEST-SEC-005:** Confirm unauthorized users cannot access restricted documents.

**TEST-SEC-006:** Confirm deleted or access-revoked documents are unavailable to AI retrieval after the defined invalidation deadline.

## 13.5 AI

**TEST-AI-001:** Chat with an uploaded PDF and retrieve correct document citations.

**TEST-AI-002:** Compare two authorized PDFs.

**TEST-AI-003:** Reject retrieval from unauthorized documents.

**TEST-AI-004:** Generate a summary based on retrieved content.

**TEST-AI-005:** Translate a document and report formatting conflicts.

**TEST-AI-006:** Demonstrate that AI cannot initiate an unauthorized irreversible operation.

**TEST-AI-007:** Verify that enterprise content is not transmitted to prohibited inference or training destinations.

## 13.6 Converted Office Outputs

**TEST-CONV-001:** PDF → DOCX conversion automatically opens the Word result editor.

**TEST-CONV-002:** PDF → XLSX conversion automatically opens the spreadsheet result editor.

**TEST-CONV-003:** PDF → PPTX conversion automatically opens the presentation result editor.

**TEST-CONV-004:** Editing and saving a converted document creates a valid destination-format file.

**TEST-CONV-005:** Unsupported conversion features generate fidelity warnings.

## 13.7 Full Feature Coverage

**TEST-FEAT-001:** Every feature from MAL-001 through MAL-090 appears in the command registry.

**TEST-FEAT-002:** Every shipped feature has an accessible UI entry.

**TEST-FEAT-003:** Every shipped feature invokes a real handler.

**TEST-FEAT-004:** Every shipped feature has valid input and error handling.

**TEST-FEAT-005:** Every document-producing feature generates an independently verifiable output.

**TEST-FEAT-006:** Every feature has a traceable automated or documented manual acceptance test.

---

# 14. EXPECTED DEVELOPMENT DELIVERABLES

The completed engineering project shall include:

| Deliverable              | Minimum Content                                             |
| ------------------------ | ----------------------------------------------------------- |
| Source Code              | Maintainable desktop, frontend, and service implementations |
| UI Component Library     | Reusable shell, ribbon, dialogs, themes, and AI chat        |
| Command Registry         | All 90 capabilities with implementation status              |
| PDF Engine               | Rendering, editing, transformation, validation              |
| Conversion Services      | Supported import/export pipelines                           |
| Security Components      | Authentication, permissions, signing, redaction, isolation  |
| AI Components            | Approved isolated inference and retrieval infrastructure    |
| API Documentation        | OpenAPI schema and operational examples                     |
| Test Suite               | Functional, regression, integration, UI, security tests     |
| Compatibility Matrix     | Supported formats, versions, fidelity limitations           |
| Feature Traceability     | MAL requirement → component → test → result                 |
| Deployment Documentation | Installation, configuration, upgrades, recovery             |
| Technical Documentation  | Architecture, interfaces, data flows, key constraints       |

## Development Implementation Order

Implementation shall proceed through controlled engineering milestones:

**Milestone 1 — Application Foundation**

Single-window shell, branding, themes, Home, real Open File, Recent Files, document tabs, PDF rendering, responsive ribbon, and command registry.

**Milestone 2 — Core PDF Manipulation**

Page organization, text editing foundation, annotations, watermarks, metadata, compression, scanning, and OCR.

**Milestone 3 — Conversion & Forms**

Office interoperability, conversion-result editors, form authoring, validation, extraction, and batch conversion.

**Milestone 4 — Security & Collaboration**

Encryption, redaction, signatures, compliance validation, comments, document versions, and access controls.

**Milestone 5 — AI & Automation**

Private RAG, document chat, extraction, summarization, translation, workflow orchestration, invoicing, and integrations.

**Milestone 6 — Specialized Tools**

3D PDF, supported CAD formats, DICOM viewing, advanced print production, and specialty preflight.

**Milestone 7 — Stabilization**

All 90 feature acceptance tests, conversion benchmarks, accessibility checks, security assessments, performance qualification, and release preparation.

Development milestones do not authorize declaring incomplete requirements implemented.

---

# 15. FINAL DEFINITION OF DONE

MALENJO shall not be considered complete merely because its user interface appears polished.

The final deliverable must satisfy the following:

- The interface is minimalist, professional, and PDF-focused.
- The Home screen centers on Open File and Recent Files.
- Open File invokes a real file picker.
- The central PDF workspace renders real content.
- The top ribbon provides icon-based access to every required feature.
- Icon hover/focus tooltips explain commands.
- No permanent navigation sidebar exists.
- No panels overlap unexpectedly.
- All controls adapt to supported window sizes.
- The top-bar MALENJO AI logo opens a functional chat interface.
- The AI assistant uses authorized PDF context and citations.
- Word, Excel, and PowerPoint editors open as conversion-result workspaces.
- Native PDF editing works on supported content, including actual text-content modification rather than only visual overlays.
- OCR-assisted reconstruction supports editing of supported scanned material.
- All 15 original screenshot tools are implemented.
- All 90 catalog capabilities are implemented, tested, and discoverable before claiming full feature completion.
- Security-sensitive operations enforce permissions and audit requirements.
- AI operates under strict enterprise privacy and data-isolation policies.
- Produced files are valid and independently verifiable.
- Failed operations produce actionable errors rather than fake success states.
- All critical functional and non-functional acceptance gates pass.

## Final Instruction

**Build MALENJO as a complete, practical, powerful PDF editor with a deliberately restrained user interface.**

It should be immediately understandable to a beginner, efficient for a professional, and architecturally suitable for enterprise use.

Do not replace the requested PDF-focused structure with a dashboard.

Do not introduce permanent navigation rails.

Do not add unrelated full-featured Office applications.

Do not hide most capabilities behind non-discoverable interfaces.

Do not use fake tool buttons.

Do not claim complete DOCX-equivalent editing of arbitrary PDFs when the document structure makes that technically impossible.

**The intended result is a genuine PDF manipulation and editing suite with 90 verified capabilities, a compact top-ribbon interface, reliable document workflows, and an integrated AI assistant—not just a visually attractive prototype.**

---

**END OF MALENJO MASTER DEVELOPMENT SPECIFICATION — VERSION 2.0**