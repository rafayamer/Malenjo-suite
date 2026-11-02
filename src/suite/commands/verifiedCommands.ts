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
] as const;

export const VERIFIED_COMMAND_BINDINGS: readonly VerifiedCommandBinding[] = Object.freeze([
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
]);

export const VERIFIED_COMMAND_BY_ID: ReadonlyMap<string, VerifiedCommandBinding> =
  new Map(VERIFIED_COMMAND_BINDINGS.map((binding) => [binding.id, binding]));
