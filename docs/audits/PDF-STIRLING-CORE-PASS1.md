# PDF completion pass 1 — local Stirling open-core provider

## Status

Tracking issue: #141  
Implementation PR: #142  
PDF registry state: **partial**. This pass must not promote the module.

## Upstream boundary

Reviewed upstream: `Stirling-Tools/Stirling-PDF@25220cbdbde2d526cebf173b94357884e180b8c1`.

The repository root license permits the open core under MIT while explicitly assigning separate licenses to restricted/open-core-adjacent directories. MALENJO therefore excludes those paths from the provider-pack build and does not copy them into the application.

The provider-pack scripts use sparse checkout for only the reviewed core/common/build paths, create a MALENJO-owned empty `app/proprietary` Gradle project solely because upstream `settings.gradle` declares that project even in core flavor, and build with:

- `STIRLING_FLAVOR=core`;
- `DISABLE_ADDITIONAL_FEATURES=true`;
- `ENABLE_SAAS=false`;
- backend-only build mode.

Restricted Stirling source is not materialized by the scripts.

## Local Windows architecture

MALENJO remains a Windows/Tauri desktop application. Stirling is not deployed as an external/public server.

The Rust boundary:

- locates the reviewed generated core JAR from a MALENJO provider-pack directory;
- locates configured/bundled/system Java;
- starts the provider only when a PDF provider tool is requested;
- binds Spring Boot to `127.0.0.1:28970`;
- applies a 75-second health timeout;
- keeps provider autostart disabled;
- exposes start/status/stop/OpenAPI/request commands through Tauri IPC;
- disables HTTP redirects;
- allows only `/api/v1/*` operation paths;
- rejects path traversal/absolute URL injection;
- applies 512 MiB aggregate request/response safety bounds;
- limits field names, filenames and scalar field sizes;
- uses a bounded native output writer for non-PDF results.

The normal MALENJO shell and PDF.js renderer do not require this provider to start.

## MALENJO provider contract

The PDF workspace does not consume Stirling implementation types directly.

`src/suite/pdf/backend.ts` defines `PDF_PROVIDER_CONTRACT_VERSION=1` and the MALENJO-owned `PdfToolProvider` contract. `defaultProvider.ts` is the composition root that injects the local core implementation.

The visible tool panel accepts only `PdfToolProvider`.

## Tool coverage

Static source review records 57 open-core Stirling frontend tool surfaces, including merge/split/rotate/crop/compress/convert/OCR/protection/signing/forms/annotations/attachments/text/image/page tools.

Runtime coverage is broader and safer than a hand-maintained endpoint map: after the local provider is healthy, MALENJO reads its local OpenAPI catalog and translates all GET/POST `/api/v1/*` operations into the MALENJO provider schema.

Supported OpenAPI field translation includes:

- query parameters;
- component parameter references;
- multipart request-body references;
- binary files and arrays of files;
- booleans;
- numbers/integers;
- enums/defaults;
- JSON/object fields.

## PDF working-copy behavior

Provider operations returning PDF bytes are fed back through the existing MALENJO PDF `mutate()` path and therefore enter the existing bounded per-tab history instead of silently replacing the source file.

Non-PDF outputs use Save As and the native bounded output writer.

The source document remains untouched until the user explicitly exports/saves through existing MALENJO flows.

## View improvements in this pass

The PDF workspace also gains:

- single-page mode;
- continuous mode;
- two-page/facing mode;
- actual-size shortcut;
- fullscreen;
- presentation mode.

These remain MALENJO-owned UI behavior.

## Tests

Frontend tests cover:

- exact reviewed Stirling pin;
- static 57-tool inventory;
- OpenAPI operation translation;
- component parameter/request-body references;
- PDF-output recognition;
- single/continuous/two-page view behavior.

Rust tests cover:

- strict local `/api/v1/*` path allowlist;
- traversal/absolute-URL rejection;
- fixed provider port;
- input/output bounds;
- generic output extension restrictions.

A Windows CI job additionally builds the reviewed Stirling core pack and smoke-tests health/OpenAPI on localhost.

## Current CI blocker

GitHub Actions runs #236 and #237 created all jobs but every runner terminated in roughly 2–3 seconds before any workflow step/log became available. GitHub exposes one job annotation per job but no downloadable job log/step list through the connected API. A failed-jobs rerun of #237 behaved identically.

This pattern is an Actions runner/account/infrastructure failure rather than evidence of a completed compile/test pass. The frontend provider-call bug found by source review was corrected in commit `abb75b7d9e45f9fb00b498824f50a0f9fb01d7b8`, but **PR #142 must not merge until executable CI resumes and passes**.

## Completion boundary

This pass establishes the local legal/provider integration foundation only.

The PDF module remains partial until the wider canonical feature tree—including advanced content/object editing, bookmarks/attachments/layers depth, annotation lifecycle, forms/signatures/protection depth, fidelity/security/performance corpus and Windows end-to-end validation—is complete.
