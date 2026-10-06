# Stirling-PDF upstream provenance

- Upstream repository: https://github.com/Stirling-Tools/Stirling-PDF
- Pinned review commit: `25220cbdbde2d526cebf173b94357884e180b8c1`
- Reviewed date: 2026-10-06
- Root license: open-core; MIT for content outside explicitly restricted directories.
- Upstream root copyright: Copyright (c) 2025 Stirling PDF Inc.

## MALENJO integration rule

MALENJO may copy/adapt MIT-licensed source from the open core and must preserve the MIT copyright/license notice for substantial portions.

Primary approved UI/UX source areas include:

- `frontend/editor/src/core/pages/HomePage.tsx`
- `frontend/editor/src/core/pages/HomePage.css`
- `frontend/editor/src/core/components/**`
- `frontend/editor/src/core/styles/**`
- `frontend/editor/src/core/routes/**`
- `app/core/**`
- `app/common/**`

Each copied/adapted implementation should record the exact upstream path and pinned commit in source comments or the relevant audit.

## Restricted upstream areas — do not copy

The Stirling root LICENSE explicitly removes these directories from the MIT grant:

- `app/proprietary/`
- `app/saas/`
- `engine/`
- `frontend/editor/src/proprietary/`
- `frontend/editor/src/desktop/`
- `frontend/editor/src/saas/`
- `frontend/editor/src/cloud/`
- `frontend/editor/src/prototypes/`
- `frontend/editor/src/portal/`
- `frontend/editor/src/portal-saas/`

At the reviewed commit, restricted frontend directories contain a Stirling PDF User License that prohibits copying/distribution outside its licensed scope. MALENJO therefore does not import them.

## Product identity

Stirling is the open-source upstream baseline, not MALENJO's customer-facing brand. The product remains **Malenjo Suite** by **Rafius Tech LLC**. Upstream attribution appears in third-party notices/provenance rather than replacing MALENJO branding.

## Functional strategy

Use Stirling's MIT UI/UX and open PDF workflows as the default starting point, then layer MALENJO-owned capabilities and adapters for Office, Scanner/OCR, local AI, signing, metadata, enterprise DMS, automation, security, backup, CAD, DICOM, administration and other source-required features.

Do not bypass or imitate paid-license checks from restricted Stirling code.
