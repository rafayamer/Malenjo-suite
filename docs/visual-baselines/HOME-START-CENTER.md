# Home start-center visual/structural regression baseline

## Open-source basis

The executable structural source is the Apache-2.0 licensed CasualOffice desktop launcher:

- repo: `CasualOffice/desktop`
- pin: `39fe70960462a9f16ea4f1e9aaa8b963d5da6ef1`
- source components: ActionCard, RecentCard, SearchInput, SegmentedFilter, ContextMenu
- launcher composition: `packages/casual-office-ui/demo/App.tsx`
- Home/recent CSS: `apps/shell/src/styles.css`

The previous shadcn-admin attribution was inaccurate and is removed by correction #139.

## Desktop structure

```text
Existing MALENJO Windows shell
├── persistent suite sidebar
├── global search / Open / Commands header
└── Home launcher (CasualOffice-derived)
    ├── greeting / local-first status
    ├── action-card grid
    │   ├── Open
    │   ├── Document
    │   ├── Spreadsheet
    │   ├── Presentation
    │   ├── PDF
    │   ├── Scan
    │   ├── OCR
    │   └── Malenjo AI
    ├── lightweight launcher shortcuts
    ├── Continue working (MALENJO extension)
    ├── Your files
    │   ├── search recent
    │   ├── segmented file-type filter
    │   ├── Pinned
    │   ├── Today
    │   ├── Yesterday
    │   ├── Earlier this week
    │   └── Earlier
    │       └── recent cards + overflow context menu
    ├── Pinned locations (MALENJO extension)
    ├── System / Updates / Student Hub status strip
    └── keyboard shortcut footer
```

## Stable invariants

- exactly eight primary actions;
- action cards use the source-adapted `OfficeActionCard`;
- file results use `OfficeRecentCard`;
- search uses `OfficeSearchInput`;
- type filtering uses `OfficeSegmentedFilter`;
- file overflow uses `OfficeContextMenu`;
- pinned documents are structurally separate from normal recents;
- recents use Office-style time groups;
- unavailable local files remain visible but disabled;
- updater state must remain honest until Updater itself is operational;
- Student Hub cannot block local work;
- native folder pins are Windows/Tauri-only and do not background-crawl folders;
- no WPS branding, ads, sales/premium cards or proprietary assets;
- visible focus and reduced-motion handling remain mandatory.

The user-supplied WPS screenshot is a benchmark for office-start-center purpose, not a code/asset source.
