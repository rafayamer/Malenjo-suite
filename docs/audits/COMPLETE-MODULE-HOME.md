# Home module correction audit — OSS structural source

## Decision state

**Module:** Home  
**Original completion issue:** #134  
**Correction issue:** #139  
**Registry state during correction:** `foundation` until corrected implementation CI and final-head verification pass.

## Why this correction exists

The earlier Home implementation named `satnaing/shadcn-admin` as its structural design basis, but the resulting Home structure did not closely follow that repository. The user correctly rejected that provenance claim.

This correction removes the inaccurate attribution and rebuilds Home from source-level UI patterns taken from a repository that is actually an offline/local desktop office launcher.

## Correct OSS design source

- repository: `CasualOffice/desktop`
- pinned commit: `39fe70960462a9f16ea4f1e9aaa8b963d5da6ef1`
- shell/UI license: Apache-2.0
- product architecture: Tauri desktop office launcher; local files, no required cloud/server

Directly adapted upstream files:

- `packages/casual-office-ui/src/components/ActionCard.tsx`
- `RecentCard.tsx`
- `SearchInput.tsx`
- `SegmentedFilter.tsx`
- `ContextMenu.tsx`
- `packages/casual-office-ui/demo/App.tsx`
- `apps/shell/src/styles.css`
- `docs/UX-AUDIT.md`

MALENJO's adapted components are in `src/suite/home/CasualOfficeUi.tsx` and retain an Apache-2.0 attribution header. Full upstream license/provenance are retained under `third_party/casualoffice/`.

The old `third_party/shadcn-admin/` Home provenance is deleted by this correction because it was not a truthful source description.

## Relationship to the supplied WPS reference

The WPS screenshot remains a composition target only: an office start page with prominent create/open actions and recent/pinned work.

MALENJO does not copy WPS branding, ads, premium cards, proprietary icons, artwork, exact dimensions or trade dress.

The corrected implementation gets its reusable code/structural pattern from CasualOffice, not WPS.

## Corrected structural mapping

| CasualOffice source pattern | MALENJO adaptation |
|---|---|
| launcher greeting/header | MALENJO Start Center / local-first runtime badge |
| three ActionCards | eight canonical Home actions: Open, Document, Spreadsheet, Presentation, PDF, Scan, OCR, Malenjo AI |
| recent-file SearchInput | MALENJO library recent-file search |
| segmented Documents/Sheets filter | All/PDF/Documents/Sheets/Slides/Images/Other |
| pinned recent cards | Starred MALENJO documents shown in a separate Pinned group |
| Office-Backstage time groups | Today / Yesterday / Earlier this week / Earlier |
| recent card context menu | Open / Pin-Unpin / Files-Library |
| launcher keyboard footer | Ctrl+O, Ctrl+K and Ctrl+Tab shortcuts |
| local launcher behavior | Windows/Tauri library + browser/Codespaces fallback |

MALENJO-specific additions required by its source contract remain outside the copied pattern: Continue Working sessions, pinned native locations, honest updater state and optional Student Hub state.

## Canonical MALENJO requirement coverage

The Home source contract remains unchanged:

- recent documents;
- pinned work and pinned locations;
- continue-work cards;
- scan/import shortcuts;
- update notice;
- optional classroom state;
- six-to-nine primary actions;
- keyboard/accessibility;
- MALENJO-owned state;
- failure recovery;
- no heavy provider startup from Home.

The corrected UI keeps all operational behavior while replacing the unsupported design-source claim.

## Local Windows architecture

The design source is especially appropriate because CasualOffice itself is a Tauri local desktop office launcher. MALENJO nevertheless retains its own Tauri/Rust library/session implementation and does not vendor CasualOffice's document editors.

Home uses native MALENJO file pickers and canonical library APIs on Windows. No external Home web server is introduced.

## Tests

- `model.test.ts` pins CasualOffice repo, commit and Apache-2.0 license.
- filter tests verify the adapted segmented file-type filter.
- recent grouping tests verify Office-style time buckets.
- storage/recovery tests remain.
- `HomeWorkspace.test.tsx` verifies the adapted launcher structure, search/filter surface, Continue Working, pinned locations, honest update/account states, and absence of WPS/premium/ad UI.
- registry tests deliberately demote Home during correction; promotion occurs only after green implementation CI.

## Completion boundary

The corrected Home module may return to `complete` only after:

1. frontend typecheck/tests/build pass;
2. Windows Rust check/tests pass;
3. Codespaces/Linux validation passes;
4. registry/traceability are promoted on the exact corrected tree;
5. final-head CI passes;
6. post-merge main CI passes.

This correction does not complete any destination module.
