# Home start-center visual regression baseline

This is the committed visual-structure baseline for the MALENJO Home module.

## Open-source design basis

MALENJO Home adapts the MIT-licensed dashboard composition from:

- repository: `satnaing/shadcn-admin`
- pinned commit: `e16c87f213a5ba5e45964e9b67c792105ec74d26`
- reviewed upstream patterns: persistent sidebar/header, search command surface, main content frame, tabs, cards and responsive grid.

The user-provided WPS Office screenshot is used only as a composition benchmark for **office-style launcher tiles + recent/starred work + a secondary information rail**. No WPS branding, promotional art, proprietary icons, exact spacing, ad cards or pixel-for-pixel trade dress is stored or copied.

## Baseline structure

Desktop major state:

```text
Existing MALENJO sidebar + global header/search
└── Home main
    ├── compact Home/local-first heading
    ├── Start launcher
    │   ├── Open
    │   ├── Document
    │   ├── Spreadsheet
    │   ├── Presentation
    │   ├── PDF
    │   ├── Scan
    │   ├── OCR
    │   └── Malenjo AI
    ├── secondary actions: Files / Recent / Starred / Pinned locations / New workflow
    ├── Continue working (only when document sessions exist)
    └── two-column dashboard
        ├── primary work list
        │   ├── Recent
        │   ├── Starred
        │   └── Locations
        └── information rail
            ├── System
            ├── Updates
            └── Student Hub
```

## Stable regression invariants

- exactly eight high-frequency launcher actions;
- three primary work tabs: Recent, Starred, Locations;
- local-first system card always visible;
- Update card must explicitly say when updater is not operational;
- Student Hub card must preserve offline/local work when no account provider is connected;
- no WPS, Premium, SALE or advertisement text/assets;
- visible focus treatment for buttons/inputs;
- reduced-motion override;
- desktop dashboard uses a primary work column plus 300px information rail;
- at <=1120px the information rail moves under the work list;
- at <=1380px launcher tiles reflow from eight to four columns.

`src/suite/home/HomeWorkspace.test.tsx` is the executable semantic regression baseline. `src/suite/home/model.test.ts` pins the layout-source commit and structural constants.
