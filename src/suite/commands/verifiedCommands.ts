/**
 * Verified command adapter: the ONLY way a Master Spec v2 capability becomes
 * RELEASE_READY. A binding names the real UI path that performs the
 * operation and the exact acceptance checks that prove it end to end (real
 * UI -> saved PDF -> independent reopen with PDF.js and pdf-lib). Those checks
 * run in CI on every PR; masterCatalog.test.ts fails if any evidence name is
 * missing from the acceptance scripts.
 *
 * Do not add a binding without passing evidence for every clause of the
 * requirement text in docs/MALENJO_MASTER_SPEC_V2.md. Partial capabilities
 * stay unbound (NOT_RELEASE_READY) with their limits stated in the tooltip.
 */
import type { PDFRibbonCategory, PDFRequirementId } from './masterCatalog';

export interface VerifiedCommandBinding {
  id: PDFRequirementId;
  /** PDF workspace ribbon tab where the verified controls live. */
  workspaceTab: PDFRibbonCategory;
  /** How to perform the operation in the real UI (shown to users). */
  guidance: string;
  /** Exact acceptance check names that must pass in CI. */
  evidence: readonly string[];
}

/** Acceptance scripts that hold the evidence; all run in CI (pdf-ui-browser.yml). */
export const VERIFIED_EVIDENCE_SCRIPTS = [
  'scripts/pdf-phase2-browser-acceptance.mjs',
  'scripts/pdf-ui-browser-smoke.mjs',
  'scripts/pdf-phase2-organize-acceptance.mjs',
  'scripts/pdf-phase2-layout-acceptance.mjs',
  'scripts/pdf-phase2-stamp-acceptance.mjs',
  'scripts/pdf-phase2-navigation-acceptance.mjs',
  'scripts/pdf-phase2-optimize-acceptance.mjs',
  'scripts/pdf-phase2-markup-acceptance.mjs',
  'scripts/pdf-phase2-textedit-acceptance.mjs',
  'scripts/pdf-phase2-objects-acceptance.mjs',
  'scripts/pdf-phase2-paragraph-acceptance.mjs',
  'scripts/pdf-phase3-forms-acceptance.mjs',
  'scripts/pdf-phase3-export-acceptance.mjs',
  'scripts/pdf-phase3-office-acceptance.mjs',
  'scripts/pdf-phase3-topdf-acceptance.mjs',
  'scripts/pdf-phase4-security-acceptance.mjs',
  'scripts/pdf-phase4-redact-acceptance.mjs',
  'scripts/pdf-phase4-review-acceptance.mjs',
] as const;

export const VERIFIED_COMMAND_BINDINGS: readonly VerifiedCommandBinding[] = Object.freeze([
  {
    id: 'MAL-001', workspaceTab: 'Organize',
    guidance: 'Choose Merge PDFs…, add files, set their order with the arrows or by dragging, choose how bookmarks and document information are kept, then Merge. Undo restores the original.',
    evidence: ['MAL-001 merge files in a user-chosen order, keeping pages, annotations, bookmarks and metadata',
      'MAL-001 merge options: bookmarks grouped by file, no document information'],
  },
  {
    id: 'MAL-002', workspaceTab: 'Organize',
    guidance: 'Choose Split… and split by page ranges, every N pages, top-level bookmarks or a maximum file size. Parts are saved as one ZIP; the open document is unchanged.',
    evidence: ['MAL-002 split by page ranges', 'MAL-002 split every N pages', 'MAL-002 split by top-level bookmarks',
      'MAL-002 split by size threshold'],
  },
  {
    id: 'MAL-003', workspaceTab: 'Organize',
    guidance: 'Drag a page thumbnail to its new position, or use Move earlier / Move later. Undo and Redo restore the order.',
    evidence: ['MAL-003 drag-and-drop thumbnail reorder, undo and redo', 'move later, undo and redo', 'move earlier'],
  },
  {
    id: 'MAL-004', workspaceTab: 'Organize',
    guidance: 'Select pages, choose Delete, and confirm. Pages renumber immediately; Undo restores them.',
    evidence: ['delete with confirmation, then undo'],
  },
  {
    id: 'MAL-005', workspaceTab: 'Organize',
    guidance: 'Select pages (Ctrl-click to add, Shift-click for a range) and choose Extract selected. The open document is not changed.',
    evidence: ['MAL-005 extract a Ctrl-click selection and a Shift-click range; original unchanged', 'extract selected page'],
  },
  {
    id: 'MAL-006', workspaceTab: 'Organize',
    guidance: 'Use Blank after, Insert PDF… or Append PDF… to add pages, and Replace on a selected page to swap it for a page from another PDF.',
    evidence: ['blank page after', 'insert PDF after page 2', 'append PDF',
      'PHASE2 real PDF page replacement, independent Save/Undo/Redo reopen and original preservation'],
  },
  {
    id: 'MAL-007', workspaceTab: 'Organize',
    guidance: 'Select one page, a range, or All, then rotate selected pages permanently in 90° steps.',
    evidence: ['MAL-007 rotate a selected range, then the entire document', 'permanent page rotation'],
  },
  {
    id: 'MAL-008', workspaceTab: 'Edit',
    guidance: 'Draw a crop on the page or enter margins under Edit settings → Crop and page boxes; trim, bleed and art boxes apply to selected or all pages.',
    evidence: ['MAL-008 trim box on all pages and art box on one page',
      'PHASE2 visual crop with measured margins and real Delete/Undo independently reopened'],
  },
  {
    id: 'MAL-009', workspaceTab: 'Organize',
    guidance: 'Choose Pages per sheet…, pick 2, 4, 6, 9 or 16 pages per sheet, the sheet size and orientation, margin and spacing, and the page order, then Arrange pages. Undo restores the original pages.',
    evidence: ['MAL-009 N-up: 4 pages per portrait Letter sheet, left to right then down, undoable',
      'MAL-009 N-up: 6 pages per landscape A4 sheet, top to bottom order, chosen spacing'],
  },
  {
    id: 'MAL-010', workspaceTab: 'Organize',
    guidance: 'Choose Batch organize…, add PDFs, add rules (rotate, remove pages, keep only pages, pages per sheet) in order, then run. Results and a JSON and CSV manifest with status and SHA-256 per file are saved as one ZIP.',
    evidence: ['MAL-010 batch: rules applied across several files with a JSON and CSV manifest',
      'MAL-010 batch: keep-range and N-up rules'],
  },
  {
    id: 'MAL-017', workspaceTab: 'Edit',
    guidance: 'Choose Header & footer…, type text for any of the six header and footer positions using fields such as {file}, {date}, {label}, {title} and {page}, pick the font, margins and pages, then Apply. Undo removes them.',
    evidence: ['MAL-017 headers and footers with file name, date, page label, document fields and custom text'],
  },
  {
    id: 'MAL-018', workspaceTab: 'Edit',
    guidance: 'Choose Page numbers…, pick the format (1, i, I, a, A), start number, prefix, suffix, optional “of total”, position, margins and pages, then Apply.',
    evidence: ['MAL-018 page numbers: roman format with prefix, suffix, total, alignment and margins',
      'MAL-018 page numbers: start number, letters, top-left, first page skipped'],
  },
  {
    id: 'MAL-019', workspaceTab: 'Edit',
    guidance: 'Choose Text watermark…, enter the text and choose font, size, colour, rotation, opacity, position, layer and pages, then Apply.',
    evidence: ['MAL-019 text watermark: typography, orientation, transparency, position and page scope'],
  },
  {
    id: 'MAL-020', workspaceTab: 'Edit',
    guidance: 'Choose Image watermark…, choose a PNG or JPEG, set its width, position, rotation, opacity, above or below the page content, and pages, then Apply.',
    evidence: ['MAL-020 image watermark: scaling, position, transparency and layer order'],
  },
  {
    id: 'MAL-021', workspaceTab: 'Edit',
    guidance: 'Choose Document properties… to see and edit the title, author, subject, keywords, creator, producer and custom properties, keep XMP metadata in step or remove it, or clear every property. Undo restores the earlier values.',
    evidence: ['MAL-021 inspect, modify and save Info and XMP metadata with custom properties', 'MAL-021 remove XMP, then clear every property'],
  },
  {
    id: 'MAL-022', workspaceTab: 'Edit',
    guidance: 'Choose Navigation…: add, nest, rename, retarget, reorder and delete bookmarks; add web or page links, change their destination or remove them; or generate a linked table of contents from the bookmarks.',
    evidence: ['MAL-022 bookmarks: create, nest, rename, retarget, reorder and remove',
      'MAL-022 links: add web and page links, change a destination, remove a link',
      'MAL-022 generated table of contents from bookmarks, with working links'],
  },
  {
    id: 'MAL-024', workspaceTab: 'Optimize',
    guidance: 'Choose Compress… and Lossless. Unfiltered streams are compressed, duplicate objects merged and unused objects removed; page content is checked to be identical and the size change is reported.',
    evidence: ['MAL-024 lossless compression: smaller file, identical page content and images'],
  },
  {
    id: 'MAL-025', workspaceTab: 'Optimize',
    guidance: 'Choose Compress… and Reduce images, pick a quality profile or a custom resolution and JPEG quality, then Compress. The report shows the size before and after and how many images changed.',
    evidence: ['MAL-025 image compression profile: downsampled JPEG, size report, same page text, faithful colours',
      'MAL-025 custom resolution and quality'],
  },
  {
    id: 'MAL-054', workspaceTab: 'Review',
    guidance: 'Choose Markup tools…, select text on the page, then Highlight, Underline, Strike out or Squiggly. Pick a markup in the list to change its colour or delete it.',
    evidence: ['MAL-054 highlight, underline, strikeout and squiggly on selected text', 'MAL-054 change a markup colour, then delete it',
      'MAL-054 a selection across pages is marked on every page'],
  },
  {
    id: 'MAL-055', workspaceTab: 'Review',
    guidance: 'Choose Markup tools…, pick Pen, Line, Arrow, Rectangle, Ellipse, Text box, Callout or Sticky note, then drag or click on the page. Colour, opacity, line width and text are set in the panel; markup can be edited or deleted from the list.',
    evidence: ['MAL-055 freehand, arrow, rectangle, ellipse, text box, callout and sticky note drawn on the page',
      'MAL-055 shapes on a rotated page land where they were drawn'],
  },
  {
    id: 'MAL-011', workspaceTab: 'Edit',
    guidance: 'Choose Edit text…, click the text on the page (or pick it in the list), change it and choose Replace text. The PDF\'s own text is rewritten in its original font; characters the font does not contain are refused, with an option to add a clearly labelled overlay instead.',
    evidence: ['MAL-011 edit existing text in place, in its own font, by clicking it on the page',
      'MAL-011 characters missing from the font are refused, and an overlay is offered and labelled'],
  },
  {
    id: 'MAL-023', workspaceTab: 'Edit',
    guidance: 'Choose Find and replace… to find text and replace it in place. Every edit is a revision: undo and redo, restore any earlier revision, or save any revision as its own PDF. Revisions are kept for the editing session.',
    evidence: ['MAL-023 find and replace in place across the document',
      'MAL-023 revision history: restore an earlier revision, save any revision, undo and redo'],
  },
  {
    id: 'MAL-014', workspaceTab: 'Edit',
    guidance: 'Choose Edit objects…, click an image on the page, then move it, resize it, rotate it, crop it, replace it with a PNG or JPEG, adjust brightness, contrast or greyscale, or delete it. The page\'s own drawing changes; Undo restores it.',
    evidence: ['MAL-014 move, resize and rotate an image', 'MAL-014 crop, adjust, replace and delete an image'],
  },
  {
    id: 'MAL-015', workspaceTab: 'Edit',
    guidance: 'Choose Edit objects…, click a line or shape on the page, then change its line colour, fill and width, move, resize or rotate it, or delete it.',
    evidence: ['MAL-015 restyle, move and delete a vector shape'],
  },
  {
    id: 'MAL-016', workspaceTab: 'Edit',
    guidance: 'Choose Edit objects…, pick Text, Rectangle, Ellipse, Line or Arrow under Insert, set colour, fill, width and text, and drag on the page. Inserted items become part of the page and can be edited again.',
    evidence: ['MAL-016 insert text and shapes as page content, then edit the inserted text'],
  },
  {
    id: 'MAL-012', workspaceTab: 'Edit',
    guidance: 'Choose Paragraphs…, click a paragraph on the page, change its text and alignment (left, centre, right, justify), size, line height and spacing, then Apply. Text reflows inside the paragraph\'s width; text that would not fit is refused unless you allow it to grow.',
    evidence: ['MAL-012 rewrite a paragraph: reflow inside its width, centred, other text untouched',
      'MAL-012 overflow is detected, and growing is an explicit choice'],
  },
  {
    id: 'MAL-013', workspaceTab: 'Edit',
    guidance: 'In Paragraphs…, the detected font (and whether it is embedded or a subset) is shown. Change size, weight (font), letter and word spacing and line height; any font substitution is reported. Save settings as a named style and apply it to other paragraphs.',
    evidence: ['MAL-013 font detection, substitution warning, size, weight, spacing, line height and reusable styles'],
  },
  {
    id: 'MAL-046', workspaceTab: 'Forms',
    guidance: 'Choose Design form…, pick a field type and its settings, choose Place on the page and drag where the field goes. Click a field\'s outline on the page to select it, then move or resize it by dragging, rename it or delete it.',
    evidence: ['MAL-046 design by dragging fields onto the page, select on the page, move, rename and delete'],
  },
  {
    id: 'MAL-047', workspaceTab: 'Forms',
    guidance: 'In Design form…, place Text, Number or Date fields with a tooltip, required flag, maximum length, comb boxes, several lines, number decimals, separators and currency, date formats, ranges and patterns. The rules are saved as standard form scripts and checked in Fill form….',
    evidence: ['MAL-047 text, number and date fields with required, length, comb and format rules'],
  },
  {
    id: 'MAL-048', workspaceTab: 'Forms',
    guidance: 'In Design form…, place a check box, radio group, dropdown or list box. Options are typed as “export value | label”; choose a default selection and whether several can be selected.',
    evidence: ['MAL-048 check box, radio group, dropdown and list box with export values and labels'],
  },
  {
    id: 'MAL-049', workspaceTab: 'Forms',
    guidance: 'In Design form…, place a Signature field: an unsigned placeholder with a tooltip, required flag and the fields that signing locks (all, only some, or all except some). Signing itself happens in a signing tool.',
    evidence: ['MAL-049 signature placeholder with tooltip, required flag and locked fields'],
  },
  {
    id: 'MAL-050', workspaceTab: 'Forms',
    guidance: 'Select a field in Design form… to make it a sum, product, average, minimum or maximum of other fields, show it only when another field has a value, and add range or pattern validation. Renaming a field updates the fields that use it. Fill form… applies these rules without running any script from the document; other scripts are listed and kept but never run.',
    evidence: ['MAL-050 calculations, dependencies, visibility and validation, evaluated without running document scripts'],
  },
  {
    id: 'MAL-052', workspaceTab: 'Forms',
    guidance: 'Choose Fill form…, enter values (calculated and hidden fields update as you type, problems are shown per field), then Save values. Flatten chosen fields or all fields into the page.',
    evidence: ['MAL-052 fill and save values, then flatten selected fields and all fields'],
  },
  {
    id: 'MAL-053', workspaceTab: 'Forms',
    guidance: 'In Fill form…, export the values as CSV, JSON, FDF or XFDF, or import one of those files and Save values. Names not in the form, and read-only or calculated fields, are reported and skipped.',
    evidence: ['MAL-053 export and import CSV, JSON, FDF and XFDF'],
  },
  {
    id: 'MAL-029', workspaceTab: 'Convert',
    guidance: 'Choose Export as… → PNG image. Keep “Transparent page background” on to keep alpha where the PDF draws nothing, turn on “Remove a background colour” to make a colour (with a tolerance) transparent, or choose “Drag a region on the page” to export just that part.',
    evidence: ['MAL-029 transparent PNG of a page and of a dragged region, with background removal'],
  },
  {
    id: 'MAL-036', workspaceTab: 'Convert',
    guidance: 'Choose Export as… → PNG, JPG or TIFF image, enter the pages (for example 1-3, 5), the resolution in dpi and, for JPG, the quality. TIFF can be one multi-page file or one file per page, with lossless Deflate or no compression. Several files download as a ZIP.',
    evidence: ['MAL-036 export chosen pages to PNG, JPG and TIFF at a chosen resolution and quality'],
  },
  {
    id: 'MAL-041', workspaceTab: 'Convert',
    guidance: 'Choose Export as… → Markdown. Headings (from text size and bold lines), paragraphs, bulleted and numbered lists and tables are rebuilt from the layout; images are saved as PNG files referenced from the Markdown. The export report lists what could not be converted.',
    evidence: ['MAL-041 Markdown with headings, lists, a table and image files'],
  },
  {
    id: 'MAL-042', workspaceTab: 'Convert',
    guidance: 'Choose Export as… → HTML. “Structured” writes headings, paragraphs, lists, tables and images; “As on the page” places each piece of text and image where it is on the page.',
    evidence: ['MAL-042 HTML with structure, tables and images, or positioned layout'],
  },
  {
    id: 'MAL-043', workspaceTab: 'Convert',
    guidance: 'Choose Export as… → SVG. Paths (lines, curves, rectangles) with their fill, stroke and width, text and JPEG or RGB/grey images become SVG elements; the export report names anything left out (for example gradients, clipping or embedded drawings).',
    evidence: ['MAL-043 SVG keeps vector paths, text and images where they are on the page'],
  },
  {
    id: 'MAL-044', workspaceTab: 'Convert',
    guidance: 'Choose Export as… → Plain text, pick the reading order (top to bottom, columns, or as stored) and what goes between pages (blank line, nothing, page break or a custom line with {n} and {total}). Text added by OCR is included.',
    evidence: ['MAL-044 plain text with reading order, page separators and OCR text'],
  },
  {
    id: 'MAL-037', workspaceTab: 'Convert',
    guidance: 'Choose Convert to Office… with a Word profile. Headings, paragraphs (size, bold, italic), bulleted and numbered lists, tables and images are rebuilt from the page layout; the DOCX opens in the Word result editor for review, correction and Export copy. The fidelity report lists what could not be reconstructed.',
    evidence: ['MAL-037 PDF to Word: headings, lists, table and image, opened in the Word editor, edited and exported'],
  },
  {
    id: 'MAL-038', workspaceTab: 'Convert',
    guidance: 'Choose Convert to Office… with the PowerPoint profile. Each page becomes a slide at the page size with editable text boxes where the text is, pictures, and rectangles from the page drawing; the PPTX opens in the presentation result editor.',
    evidence: ['MAL-038 PDF to PowerPoint: a slide per page with positioned text boxes, picture and shape, edited and exported'],
  },
  {
    id: 'MAL-039', workspaceTab: 'Convert',
    guidance: 'Choose Convert to Office… with the Excel tables profile. Each table found becomes a sheet with numbers stored as numbers; pages without a table get their lines as rows. The XLSX opens in the spreadsheet result editor.',
    evidence: ['MAL-039 PDF to Excel: the table as a sheet with numbers, edited and exported'],
  },
  {
    id: 'MAL-045', workspaceTab: 'Convert',
    guidance: 'In Convert to Office…, pick or save a conversion profile (format, pages, images), add several PDFs and Convert. Every file gets a fidelity report (failures say why); successful DOCX, XLSX and PPTX results open in their result editors, and all results download as a ZIP with a JSON report.',
    evidence: ['MAL-045 batch conversion with a saved profile, a fidelity report per file and results opened in editors'],
  },
  {
    id: 'MAL-030', workspaceTab: 'Convert',
    guidance: 'Choose Create PDF from files… → Images, add JPG, PNG, TIFF (every page), WebP or BMP files, put them in order with the arrows, and choose the page size (or the image size), orientation, margins and whether each image fits the page or keeps its actual size.',
    evidence: ['MAL-030 images to PDF: several images, page size, orientation, margins and order'],
  },
  {
    id: 'MAL-031', workspaceTab: 'Convert',
    guidance: 'Choose Create PDF from files… → Word. Styles, headings, alignment, spacing, numbered and bulleted lists, tables, pictures and the document\'s page size and margins are drawn with standard PDF fonts; the report lists anything not reproduced (for example headers, footnotes, charts or characters outside the standard fonts).',
    evidence: ['MAL-031 Word to PDF: styles, lists, table and picture at the document page size'],
  },
  {
    id: 'MAL-032', workspaceTab: 'Convert',
    guidance: 'Choose Create PDF from files… → PowerPoint. Each slide becomes a page at the slide size with its backgrounds, shapes, text boxes, pictures, groups and simple tables; charts, SmartArt and rotation are reported.',
    evidence: ['MAL-032 PowerPoint to PDF: a page per slide at the slide size with shapes, text and pictures'],
  },
  {
    id: 'MAL-033', workspaceTab: 'Convert',
    guidance: 'Choose Create PDF from files… → Excel, pick the page size, orientation, gridlines and sheets. A sheet\'s print area is used when it has one; number formats, fonts, fills, widths, heights and merged cells are kept, and wide sheets continue on following pages.',
    evidence: ['MAL-033 Excel to PDF: the print area with formats, widths, merges, gridlines and orientation'],
  },
  {
    id: 'MAL-034', workspaceTab: 'Convert',
    guidance: 'Choose Create PDF from files… → HTML. MALENJO\'s own renderer lays out headings, paragraphs, lists, tables, embedded images and a CSS subset (colours, sizes, weights, alignment, margins, page breaks); it never runs scripts or downloads anything, and reports unsupported CSS and elements.',
    evidence: ['MAL-034 HTML to PDF through the controlled renderer: supported CSS applied, scripts and remote content blocked'],
  },
  {
    id: 'MAL-057', workspaceTab: 'Review',
    guidance: 'Choose Stamps…, pick a stamp from the library or make your own (status line for the approval state, detail line with {user}, {date}, {time}, {docid}, {file} and {status}, and a colour), then Place on the page and click where it goes. Your stamps and name are kept on this device for next time. Placed stamps are Stamp annotations with the values filled in when placed.',
    evidence: ['MAL-057 reusable stamps with date, time, user, document identifier and approval-state variables'],
  },
  {
    id: 'MAL-058', workspaceTab: 'Review',
    guidance: 'Choose Measure…, set the scale (for example 1 in = 10 ft) or calibrate it by clicking both ends of a known length, choose Distance, Perimeter, Area or Angle, and click the points on the page (Finish shape for perimeter and area). Measurements are saved as standard measurement annotations carrying the scale and the value in your units and decimal places.',
    evidence: ['MAL-058 calibrated distance, angle, area and perimeter measurements with units and scale factors'],
  },
  {
    id: 'MAL-059', workspaceTab: 'Review',
    guidance: 'Choose Compare…, then Another PDF… or an earlier revision of the open document. View the pages side by side, as an overlay (red for what is new, blue for what went away) or as a list of text changes by page, and save the comparison as an HTML report. Pages are paired by position.',
    evidence: ['MAL-059 compare revisions side by side, by text differences and as a visual overlay'],
  },
  {
    id: 'MAL-061', workspaceTab: 'Protect',
    guidance: 'Choose Protect PDF…, enter an optional open password and an owner password (twice), choose printing and the other permissions, then Save protected copy. The copy uses AES-256 (PDF 2.0 security handler, revision 6); the open document is unchanged. Permissions are honoured by conforming readers; software that ignores them can still print or copy.',
    evidence: ['MAL-061 protect a PDF with AES-256, an open password, an owner password and permission flags'],
  },
  {
    id: 'MAL-062', workspaceTab: 'Protect',
    guidance: 'Open the protected PDF (with its open password if it has one), choose Remove protection…, enter the owner password and the unprotected copy opens in a new tab. Files protected with RC4, AES-128 or AES-256 passwords are supported; certificate (public-key) protection is refused with a message, because it needs the recipient\'s private key.',
    evidence: ['MAL-062 remove protection with the owner password, refusing a password that does not permit it'],
  },
  {
    id: 'MAL-063', workspaceTab: 'Protect',
    guidance: 'Choose Redact…, mark areas by drawing on the page or by finding text, then Apply. Text under an area is removed character by character (the text around it keeps its place), image pixels there are replaced by black, drawings with points there, comments, links and form fields there are removed, and shared drawings are rewritten as private copies. Optionally the removed words are also taken out of document information, metadata, bookmarks, comments, form values and tags. Nothing that was redacted is left in the saved file; Undo restores it until you save. Signed PDFs are refused.',
    evidence: ['MAL-063 permanently remove selected text, images, graphics and associated hidden content'],
  },
  {
    id: 'MAL-064', workspaceTab: 'Protect',
    guidance: 'In Redact…, choose what to look for (names, addresses and postcodes, email addresses, phone numbers, national identity numbers, payment cards, IBANs, dates of birth, and your own phrases or /patterns/), Find candidates, untick any you want to keep, and mark the rest. Detection runs on this device and is rule-based (patterns, check digits such as Luhn and mod 97, and name and address cues), not a learned model; review every candidate. Scanned pages need OCR first.',
    evidence: ['MAL-064 privately detect candidate identifiers, financial data, names and addresses for reviewed redaction'],
  },
  {
    id: 'MAL-067', workspaceTab: 'Protect',
    guidance: 'Choose Bates numbering across files…, add PDFs and put them in order, set the prefix ({vol} adds the file number), start number, padding, suffix, position and margins, and whether numbering continues, restarts or jumps to the next round number between files. The numbered files are saved as one ZIP named by their first number, with bates-log.csv; the open document can be numbered in place.',
    evidence: ['MAL-067 Bates numbers across files with prefix, padding, placement and continuation rules'],
  },
  {
    id: 'MAL-068', workspaceTab: 'Protect',
    guidance: 'Choose Preflight…, select PDF/A-1b, 2b or 3b, PDF/X-1a or 4 and/or PDF/UA-1, and Run preflight. Each profile lists its checks — fonts, colour spaces and output intents, transparency, metadata, actions and attachments, annotations and forms, tagging, page boxes and file structure — as passed or failed, with where each failure is; Save report keeps it as text. MALENJO checks these listed conditions; it is not a certified validator such as veraPDF.',
    evidence: ['MAL-068 preflight against selected PDF/A, PDF/X and PDF/UA profiles'],
  },
  {
    id: 'MAL-070', workspaceTab: 'Protect',
    guidance: 'Choose Sanitize… to list document information and XMP metadata, embedded files, scripts and actions, links, hidden content (layers that are off, invisible text, hidden annotations) and other resources; untick what to keep and choose Remove selected. Undo restores the document. Signed PDFs are refused.',
    evidence: ['MAL-070 inspect and remove selected metadata, attachments, scripts, links and hidden content'],
  },
]);

export const VERIFIED_COMMAND_BY_ID: ReadonlyMap<string, VerifiedCommandBinding> =
  new Map(VERIFIED_COMMAND_BINDINGS.map((binding) => [binding.id, binding]));
