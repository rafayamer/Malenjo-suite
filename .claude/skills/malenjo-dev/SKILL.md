---
name: malenjo-dev
description: Rules and workflow for developing MALENJO (Rafius Tech LLC document suite). Use for any code, dependency, documentation or pull-request work in this repository, especially when the developer is a beginner. Enforces license gates, adapter boundaries, feature flags, tests and the PR checklist.
---

# MALENJO development rules

MALENJO is a local-first Windows desktop document suite (educational / noncommercial build profile: personal use and class fellows; no billing, plans or paywalls). The repo already contains the Phase 0-7 foundation. Work **from this repo**, not from a fresh Stirling fork.

**Active branch: `integration/option-b-codespaces-validation`.** It is far ahead of `main`. Branch from it and open every PR against it. **Never merge anything into `main`**; only the owner does that, at final release.

Before starting, read `docs/NEW_CHAT_HANDOFF.md`, `docs/IMPLEMENTATION_STATUS.md` and the ten-phase roadmap (GitHub issue #238). Phases are only `RELEASE-READY` or `NOT RELEASE-READY`; a merged PR or green CI is evidence, not acceptance. Never claim a module or phase is finished unless its acceptance criteria and `docs/TRACEABILITY.md` entries pass and the owner has accepted it.

## The rules

1. **One small task at a time.** Never "build the scanner". Split into the smallest piece that can be tested alone. If a request contains more than one feature, say so and propose a split before coding.
2. **Licenses are a build gate.** Noncommercial use does not make code redistributable. Never copy Stirling-PDF's proprietary or source-available directories (`app/proprietary`, `app/saas`, `engine`, and the proprietary / desktop / saas / cloud / portal frontend layers). Only legally cleared components may be integrated. If unsure, stop and ask the owner.
3. **No GPL or AGPL dependencies.** Before adding any library, font, model, codec or binary: read its LICENSE, pin the exact version, record provenance under `third_party/`, and update `docs/THIRD_PARTY_NOTICES.md`. Models, fonts and binaries have their own licenses.
4. **Adapters, not coupling.** UI code asks for a MALENJO capability, never an upstream engine. Flow: capability -> MALENJO interface -> adapter -> engine. Engines live behind `integrations/<engine>/` or a native service in `src-tauri/src/suite/`.
5. **Keep startup fast.** The React/Tauri shell must be interactive before Java, Python, LibreOffice, OCR, AI, CAD or DICOM start. Engines load lazily per capability. Do not add anything heavy to shell startup.
6. **Offline first.** Local features must work with no internet. Network use needs explicit user consent and a stated reason.
7. **Untrusted input.** Treat every PDF, Office file, image, archive, DICOM or CAD file as hostile. Validate signatures and size limits, test path traversal and malformed files, and keep parsers out of privileged UI hot paths.
8. **Secrets.** Never commit passwords, tokens, keys or OAuth secrets. Use the `SecretStore` abstraction (Windows DPAPI / Credential Manager). Local helper services bind to loopback only and require auth for sensitive APIs.
9. **Do not edit locked UI/theme foundations casually.** The dark-navy / electric-blue theme and shell layout are locked in the master README. Change them only when a task explicitly says so.
10. **Do not mark anything complete without evidence.** Honest status beats green checkmarks.

## Where code lives

| Layer | Path |
|---|---|
| React/TypeScript UI | `src/suite/` (modules: `ai`, `commands`, `core`, `enterprise`, `files`, `help`, `home`, `modules`, `office`, `pdf`, `scanner`, `security`, `shell`) |
| Rust / Tauri native | `src-tauri/src/suite/` (`library`, `pdf`, `office`, `ocr`, `ai`, `security`, `enterprise`, `local_services`, ...) |
| Engine adapters | `integrations/` |
| Optional provider packs | `provider-packs/` |
| Cleared third-party material | `third_party/` |
| Tests and fixtures | `testing/suite/`, plus `*.test.ts` and Rust unit tests beside the code |
| Docs and traceability | `docs/` |

## Task routine

1. `git switch integration/option-b-codespaces-validation && git pull --ff-only`, then `git switch -c fix/<phase>-<tiny-task>-<yyyymmdd>` (or `feat/...`, `docs/...`). Never commit to `main` or directly to the integration branch.
2. Read the relevant docs and the existing code for that module first. Match its patterns.
3. Make the smallest change. Put new capability code behind its feature flag where the module has one.
4. Add tests: a normal case plus a bad-input case. Use `testing/suite/fixtures/` for documents.
5. Run the checks (below). Fix everything red before committing.
6. Run the app and try the feature by hand, including trying to break it. Say plainly what you could not test (for example Windows-only behavior).
7. Commit with a clear message, push the branch, open a pull request using `.github/PULL_REQUEST_TEMPLATE.md`. Fill every section honestly: traceability IDs, tests run, license/provenance, performance impact.

## Checks to run

```bash
npm run typecheck
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

`npm run verify:codespace` runs these in order on Linux / Codespaces.

For any PDF workspace change, also run the real-browser gates (they need `npm install --no-save playwright` and `npx playwright install chromium`):

```bash
node scripts/pdf-ui-browser-smoke.mjs
node scripts/pdf-phase2-browser-acceptance.mjs
```

The second one saves every edit through the real Save button and reopens the output independently; add a check there for any new PDF editing behaviour. Windows-specific behavior (installed desktop app, printing, camera, installers, Office interop) still needs a manual Windows check; record the result in the PR.

## Definition of done

- Checks above pass, with new tests.
- Existing features still work; no startup or idle-memory regression.
- License and provenance recorded for anything new.
- Works offline where it should.
- Keyboard-usable and readable (accessibility).
- `docs/IMPLEMENTATION_STATUS.md` and `docs/TRACEABILITY.md` updated truthfully if status changed.
- PR checklist complete and reviewed by a human.

## Working with a beginner

Explain what you changed and why in plain words. Prefer small, reviewable pull requests. Never paste large code the developer cannot explain; offer to walk through it. When a task is too big or risky for the current stage, say so and propose the smallest safe first step. When something fails, show the first real error, not the last.

## Out of scope until the owner says otherwise

CAD, DICOM, forensic watermarking, post-quantum crypto, paid plans or billing of any kind, and anything that needs proprietary Stirling directories.
