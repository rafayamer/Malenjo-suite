# CasualOffice launcher UI provenance

- Upstream repository: https://github.com/CasualOffice/desktop
- Pinned source commit: `39fe70960462a9f16ea4f1e9aaa8b963d5da6ef1`
- Shell/UI license: Apache License 2.0
- Upstream product: local-only Tauri desktop office suite
- Reviewed: 2026-10-06
- Integration mode: source-level UI component and launcher-structure adaptation into MALENJO; no CasualOffice editor runtime is bundled.

## Source files directly adapted

- `packages/casual-office-ui/src/components/ActionCard.tsx`
- `packages/casual-office-ui/src/components/RecentCard.tsx`
- `packages/casual-office-ui/src/components/SearchInput.tsx`
- `packages/casual-office-ui/src/components/SegmentedFilter.tsx`
- `packages/casual-office-ui/src/components/ContextMenu.tsx`
- `packages/casual-office-ui/demo/App.tsx` — reconstructed launcher composition
- `apps/shell/src/styles.css` — Home action-card and Office-Backstage recent-file layout
- `docs/UX-AUDIT.md` — launcher behavior and Office/LibreOffice start-center comparison

## MALENJO changes

MALENJO keeps its own persistent suite sidebar, global document tabs, Tauri/Rust file library, product branding, module routing and dark visual tokens. The CasualOffice launcher structure is expanded from document/spreadsheet/open to MALENJO's eight canonical Home actions and broader PDF/Office/image file types.

The user-provided WPS Office screenshot remains a composition benchmark only. WPS branding, proprietary icons, promotional artwork, advertisements, exact spacing and trade dress are not copied.

The prior `satnaing/shadcn-admin` Home attribution was incorrect for the implemented structure and is removed by correction issue #139.
