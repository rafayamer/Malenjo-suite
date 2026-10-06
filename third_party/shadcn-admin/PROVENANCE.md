# shadcn-admin design provenance

- Upstream: https://github.com/satnaing/shadcn-admin
- Pinned review commit: `e16c87f213a5ba5e45964e9b67c792105ec74d26`
- License: MIT
- Copyright notice: Copyright (c) 2024 Sat Naing
- Reviewed: 2026-10-06
- Integration mode: design/layout adaptation only; MALENJO does not vendor the upstream application or its Clerk/auth dependency.
- Upstream files/patterns reviewed:
  - `src/features/dashboard/index.tsx`
  - `src/components/layout/header.tsx`
  - dashboard card/tab/search/sidebar composition described by the upstream README.

## MALENJO adaptation

The Home start center uses the upstream dashboard's open-source information-architecture pattern:

- persistent application sidebar/header remains owned by MALENJO;
- compact main dashboard surface;
- grouped high-frequency actions;
- tabs for related views;
- card-based secondary/status information;
- responsive layout and accessible focus/keyboard behavior.

The WPS Office screenshot supplied by the user is only a composition benchmark for an office-style launcher row, recent/starred work list and right-side information rail. MALENJO does not copy WPS branding, proprietary icons, advertising artwork, exact pixel layout or trade dress.

The implemented React state, file-library integration, local-first behavior, visual tokens and all product content are MALENJO-owned code.
