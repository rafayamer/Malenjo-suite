# Complete module audit — Home

## Decision state

**Module:** Home  
**Tracking issue:** #134  
**Registry state:** `complete` after implementation CI #211 passed. Final-head and post-merge `main` CI remain mandatory merge/release evidence.

## Source contract

Canonical source: `MALENJO_SUITE_FINAL_MASTER_README.md`  
SHA-256: `e24c8f238c01bfd455f2d9994789feaa5b674ac167d191e678452fc3cf5b13aa`.

The canonical README §29 Product shell / unified UX makes Home a first-class top-level workspace and requires a unified MALENJO shell in which users do not need to understand internal providers.

The reconciled implementation guide adds the complete Home-specific acceptance contract:

- §8.2 Home: recent documents, pinned locations, continue-work cards, scan/import shortcuts, update notices and optional classroom activity; Home reads MALENJO library metadata/cached status and missing providers must degrade without blocking the application.
- ARCH-003/004: Home capabilities and user-visible state belong to MALENJO-owned, versioned contracts/models.
- UI-001: approximately six-to-nine high-frequency primary actions.
- UI-002: keyboard-only primary workflow, visible focus and logical tab order.
- UI-003: optional secondary surfaces may not destroy the central work area.
- QA-004: happy-path plus realistic storage/provider failure recovery.
- QA-005: keyboard/accessibility coverage and visual-regression baseline.
- QA-006: abrupt-shutdown/cancellation exercise where Home performs long-running work. Home itself intentionally starts no long-running provider process, so cancellation is not applicable to this module; file/provider work is delegated to the owning module.

## OSS design instruction and legal review

The user explicitly requested that Home use an open-source repository design rather than being invented from scratch.

Selected source:

- `satnaing/shadcn-admin`
- pinned review commit: `e16c87f213a5ba5e45964e9b67c792105ec74d26`
- MIT License, Copyright (c) 2024 Sat Naing
- upstream provides responsive/accessibility-oriented sidebar, header/search, main, tabs and card dashboard patterns.

MALENJO adapts that information architecture to the existing Tauri/React shell. It does not bundle the upstream Clerk/auth stack and does not transplant the entire application.

The user-supplied WPS Office image is only a structural benchmark for an office start center. WPS branding, advertising, promotional artwork, proprietary icons and exact trade dress are not copied.

License and provenance are retained in:

- `third_party/shadcn-admin/LICENSE`
- `third_party/shadcn-admin/PROVENANCE.md`
- `docs/THIRD_PARTY_NOTICES.md`.

No new npm/Rust dependency is introduced.

## Implemented Home feature tree

### Office-style start launcher

Eight operational high-frequency actions:

- Open;
- Document;
- Spreadsheet;
- Presentation;
- PDF;
- Scan;
- OCR;
- Malenjo AI.

Open invokes the existing desktop/browser multi-file pipeline. The remaining tiles route to their actual registered MALENJO workspaces; Home does not claim those destination modules are complete.

Secondary navigation exposes Files / Library, Recent, Starred, Pinned locations, New workflow and global Ctrl+K search.

### Recent documents

Home loads the canonical MALENJO library on desktop and the browser-session library in Codespaces. Recent ordering prefers last-opened time, then added time. Unavailable indexed documents remain visible but disabled instead of failing silently.

Selecting an available recent document reopens it through the canonical library boundary before creating/activating the shared document session.

### Starred documents

Users can star/unstar library documents. Star state is versioned, bounded, deduplicated and stored locally. Removed library IDs are pruned, while indexed-but-unavailable entries retain their star state.

### Pinned locations

Desktop users can pin document folders through the native Tauri directory picker. A pin stores only bounded local Home state. Home does not crawl or index a folder in the background.

Choosing **Browse & open** opens the native file picker rooted at that folder, sends selected documents through the existing canonical MALENJO library import boundary, and opens them as normal document sessions.

Browser/Codespaces reports local-folder pinning as not applicable and routes users to the session library.

### Continue working

Current document sessions appear as Continue working cards with:

- document name/type;
- saved/unsaved/saving state;
- session activation;
- independent existing document-session state preserved by the shell.

Home does not create a second session model.

### Update notice

Home exposes the local package version and explicitly states that the updater module is not operational. It does not contact a network server or falsely report that the build is current.

### Student Hub / classroom state

The current student/noncommercial build shows a local-only/not-connected state when no classroom account provider is available. Local document work is never blocked by sign-in.

There is no subscription, premium, billing or upsell UI.

### System status

Home uses only cheap cached/runtime facts:

- desktop vs browser runtime;
- open document-tab count;
- current document-library count;
- local-first readiness.

It does not start Ollama, OCR, CAD, DICOM, Java/Python workers or other heavy providers.

## MALENJO-owned state and recovery

`src/suite/home/model.ts` defines versioned `HomeStateV1` and pure state transitions. Persistent state is sanitized, bounded and deduplicated before use.

`src/suite/home/storage.ts` catches malformed JSON, storage denial/quota failures and unavailable storage. Storage failure produces an explicit Home notice instead of a blank shell.

No Home state includes document content, OCR text, passwords, tokens or provider secrets.

## Accessibility and visual baseline

All primary actions are native buttons. Tabs expose tab roles/selected state, the dynamic content is an ARIA live tab panel, notices use `role=status`, controls have visible focus treatment, and reduced-motion preferences disable launcher motion.

Committed baseline: `docs/visual-baselines/HOME-START-CENTER.md`.

Executable semantic baseline: `src/suite/home/HomeWorkspace.test.tsx`.

## Tests

`src/suite/home/model.test.ts` covers:

- eight-action requirement;
- exact pinned OSS source commit/license baseline;
- corrupted-state sanitation;
- pin deduplication;
- recent/starred ordering and multi-token search;
- missing-star pruning;
- persistent-state round trip;
- storage failure recovery.

`src/suite/home/HomeWorkspace.test.tsx` server-renders the major Home state and verifies launcher count, tab semantics, continue-work state, honest updater/account states and absence of WPS/premium/ad content.

## CI gate

Implementation head `06aa772f1fed86b9532a62f888079d920c158d8d` passed CI #211 (`37453190343`): frontend typecheck/tests/build, Windows Rust check/tests and Codespaces/Linux validation/check/tests. The registry promotion and final documentation commits require a fresh final-head CI before merge; post-merge `main` CI is also required.

## Completion boundary

Promoting Home to `complete` means the **Home/start-center module** satisfies its own source feature tree. It does not make Files, Office, PDF, Scanner, OCR, AI, Automation, Account, Settings, Student Hub or Updater complete.

Provider-specific work remains owned by those destination modules.
