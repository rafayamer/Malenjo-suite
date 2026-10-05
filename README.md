# MALENJO Suite

MALENJO Suite is a **local-first Windows document workspace** being built from the supplied MALENJO master specification and step-by-step developer guide. This repository starts with the unified Tauri + React shell, native Rust boundary, feature/module registry, security defaults, documentation corpus, CI gates and adapter-first integration structure.

> **Current build profile:** personal / classroom / noncommercial student use. All MALENJO feature flags are available to the build. Paid billing, regional pricing and commercial trial counters are intentionally not implemented in this profile. This does not waive third-party license terms.

## What is implemented now

- Unified MALENJO desktop shell and dark navy / electric-blue visual system.
- Full module navigation for Files, DMS, PDF, Office, Scanner, OCR, local AI, Sign, Invoice, Metadata, Automation, Security, CAD, DICOM, Administration, Backup, Settings, Account and Help.
- Feature registry and adapter status model.
- Tauri/Rust native shell with a `LocalServiceManager` catalog and security boundary.
- Localhost-only service policy; heavyweight services are not launched on UI startup.
- Supplied canonical README, Stirling notes, source notes, logos and UI concepts preserved under `docs/`.
- CI/typecheck/test/build workflow and dependency review policy.

## Run the web shell

```powershell
npm install
npm run dev
```

## Run the Windows desktop shell

Install current Node.js, Rust stable, Microsoft C++ Build Tools and WebView2/Tauri prerequisites, then:

```powershell
npm install
npm run tauri:dev
```

## Build an installer

```powershell
npm install
npm run typecheck
npm test
npm run tauri:build
```

Unsigned developer packages may be produced locally. Production distribution must add code-signing, SBOM, third-party notices, security review, update signing and release acceptance checks from the developer guide.

## Architecture rule

Never merge third-party applications into MALENJO as visible products. Define a MALENJO interface, build a thin adapter, test it on Windows and offline, audit license/security/performance, then integrate behind the unified UI.

See `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_STATUS.md`, and the complete source-of-truth material in `docs/source-of-truth/`.
