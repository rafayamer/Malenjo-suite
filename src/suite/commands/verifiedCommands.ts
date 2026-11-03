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
    evidence: ['MAL-054 highlight, underline, strikeout and squiggly on selected text', 'MAL-054 change a markup colour, then delete it'],
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
]);

export const VERIFIED_COMMAND_BY_ID: ReadonlyMap<string, VerifiedCommandBinding> =
  new Map(VERIFIED_COMMAND_BINDINGS.map((binding) => [binding.id, binding]));
