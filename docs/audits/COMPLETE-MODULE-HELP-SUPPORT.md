# Complete module audit — Help / Support

## Decision

**Module:** Help / Support  
**Registry state after this change:** `complete`  
**Tracking issue:** #132

This is the first MALENJO module promoted to `complete`. The promotion is deliberately limited to the registered Help / Support module; no PDF, Office, AI, Scanner, Security, DMS, Settings, Account, installer or other major capability inherits this status.

## Canonical source basis

Canonical source: `MALENJO_SUITE_FINAL_MASTER_README.md`  
SHA-256: `e24c8f238c01bfd455f2d9994789feaa5b674ac167d191e678452fc3cf5b13aa`

Applicable source requirements:

- §34 lines 2384–2412 — diagnostics and a diagnostic bundle exporter that redacts secrets; passwords, API tokens, private keys, full document contents and sensitive OCR text must not be logged/exported by default.
- §50 lines 3234–3240 — About identifies Malenjo Suite, version/build, Rafius Tech LLC, edition/license and provides third-party notices access.
- §50 lines 3249–3261 — customer-facing MALENJO terminology; third-party/provider names appear only where diagnostics/configuration genuinely require them.
- §50 line 3272 — About/Help is a release-facing customer path and must not expose unintended upstream branding.
- §53 accessibility/visual doctrine — keyboard access, visible focus, screen-reader labels, reduced-motion respect and MALENJO visual identity.
- User build override — student/noncommercial; no paid support, upsell, trial counter or subscription UX.

## Implemented feature tree

### Guides and troubleshooting

`src/suite/help/HelpWorkspace.tsx` and `supportModel.ts` provide a searchable, task-oriented guide library covering:

- getting started/opening files;
- saving and recovery expectations;
- scanner/OCR;
- local AI;
- signing/security;
- Codespaces/browser runtime differences;
- troubleshooting/diagnostic export;
- core keyboard shortcuts.

Search is multi-token and tests verify task discoverability.

### About

The module exposes:

- product: Malenjo Suite;
- intended owner/publisher: Rafius Tech LLC;
- edition: Student / noncommercial;
- application version;
- build identity;
- active runtime (Tauri desktop or Browser/Codespaces);
- direct Third-party notices navigation.

Tauri version is read from the application package; browser development uses the package-equivalent build version.

### Runtime/provider diagnostics

Diagnostics are explicit and non-destructive. They do not open documents or launch heavyweight providers.

The module checks:

- Malenjo system status;
- native local-service manager registration;
- Ollama;
- llama.cpp;
- PaddleOCR native pack;
- ClamAV;
- pyHanko;
- Temporal;
- Kopia.

Browser/Codespaces marks desktop-only adapters as **Not applicable** instead of pretending they are broken or operational.

### Privacy-redacted support bundle

The bundle includes only bounded product/runtime/provider/module-summary metadata.

It excludes by design:

- document names;
- file paths;
- full document contents;
- OCR text;
- passwords/passphrases;
- API/authentication tokens;
- private keys/credentials.

There are two redaction layers:

1. TypeScript recursive redaction before serialization.
2. Rust recursive sensitive-key redaction before native file write.

Desktop/Tauri export uses the system save picker followed by the native `write_support_bundle` command. The native writer enforces JSON, a 1 MiB bound, a `.json` destination and regular-file/non-symlink semantics. Browser/Codespaces uses a local Blob download. Copy-to-clipboard is provided where the runtime exposes clipboard permission.

### Third-party notices

The Help UI includes an offline policy summary and a direct notices/policy link to `docs/THIRD_PARTY_POLICY.md`. Provider names are confined to diagnostics/notices where they are technically useful. This does **not** claim that the wider release SBOM/license program is complete; release-level dependency review remains a separate source requirement.

## Tests

Frontend:

- recursive secret/document/path redaction;
- support bundle privacy flags and serialization;
- multi-token guide search;
- registry asserts Help / Support is `complete`.

Rust:

- sensitive diagnostic keys are redacted;
- privacy booleans are preserved;
- support bundle byte limit is fixed and bounded.

CI must additionally pass frontend typecheck/tests/build, Windows Rust check/tests and Codespaces/Linux Rust validation before merge.

## Completion boundary

The Help / Support module can be complete while global source issue #101 remains open because #101 also requires **every other MALENJO module** to emit the full structured logging schema. Help now provides the complete customer-facing diagnostic consumer/export surface; completing logging instrumentation in unrelated modules is not reclassified as Help work.

Settings and Account remain `foundation`. All other existing module states remain unchanged.
