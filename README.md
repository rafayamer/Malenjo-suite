# MALENJO Suite

MALENJO Suite is a **local-first Windows document workspace** being built from the supplied MALENJO master specification and step-by-step developer guide. This repository starts with the unified Tauri + React shell, native Rust boundary, feature/module registry, security defaults, documentation corpus, CI gates and adapter-first integration structure.

> **Current build profile:** personal / classroom / noncommercial student use. All MALENJO feature flags are available to the build. Paid billing, regional pricing and commercial trial counters are intentionally not implemented in this profile. This does not waive third-party license terms.

## What is implemented now

- Unified MALENJO desktop shell and dark navy / electric-blue visual system.
- Full module navigation for Files, DMS, PDF, Office, Scanner, OCR, local AI, Sign, Invoice, Metadata, Automation, Security, CAD, DICOM, Administration, Backup, Settings, Account and Help.
- Real PDF workspace with PDF.js 6.4.299, thumbnails, page navigation, zoom/fit, rotation, print/export paths, and local performance telemetry.
- DOCX, XLSX and PPTX workspaces with explicit OOXML fidelity warnings and exact-copy export for untouched documents.
- Scanner/OCR workspace with image processing, perspective correction, optional PaddleOCR, portable OCR fallback, searchable PDF export and cancellation.
- Private local RAG with citation-bearing retrieval and native loopback Ollama/llama.cpp adapters; no automatic model download or AI startup.
- Security Center and Metadata Studio with metadata sanitization, destructive PDF CDR/redaction, watermarking, AES-GCM secure export, audit history, and optional ClamAV.
- Local PDF signature validation/signed-copy workflow through the native pyHanko boundary with ephemeral zeroized passphrase handling.
- Local DMS with immutable SHA-256 versions, retention preview/apply, legal hold and native permission enforcement.
- Automation Studio with saved local workflow contracts plus an optional fixed-loopback Temporal handoff.
- Verified offline Backup / DR with per-file SHA-256 manifests, tamper detection, recovery-copy restore safety, and optional Kopia integration.
- Administration policy shared across DMS, automation and backup with owner/admin/editor/viewer permission contracts and archive-based audit retention.
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


## GitHub Codespaces

After Phase 1 is merged, create new Codespaces from the default `main` branch. The repository contains a `.devcontainer/` configuration that installs Node.js 22, npm 11, Rust stable and the Linux libraries needed for Tauri development.

Inside the Codespace:

```bash
npm run typecheck
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

For browser-shell development:

```bash
npm run dev -- --host 0.0.0.0
```

See `docs/CODESPACES.md` for the Windows-specific limitations of Codespaces.
