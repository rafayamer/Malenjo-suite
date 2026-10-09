# MALENJO PDF — Stirling tool parity evidence register

The machine-readable source of truth is [pdf-stirling-parity-matrix.json](./pdf-stirling-parity-matrix.json). Its 90 operation identifiers were transcribed in order from the October 8, 2026 MALENJO development handoff (§5A–5G), **not** independently re-audited against a newer upstream release. The upstream comparison baseline is `Stirling-Tools/Stirling-PDF@25220cbdbde2d526cebf173b94357884e180b8c1`.

**No operation is credited as complete.** Twenty-four operations with real MALENJO source symbols, workspace paths and unit-test evidence are classified **`partial`**, and the other 66 remain **`null` (not yet source-audited)**. This is not a claim of Windows/provider end-to-end verification. For every tool, verify the real MALENJO code, UI command, actual local Windows execution, source license and notices, positive/negative fixtures and golden tests, memory/size limits, and export/save/reopen outcomes; then set a supported status: `implemented`, `partial`, `unavailable`, or `excluded-by-license`. Exclusions need user approval.

## Source-backed endpoint audit — pinned commit

The pinned upstream file `testing/endpoints.txt` at `Stirling-Tools/Stirling-PDF@25220cbdbde2d526cebf173b94357884e180b8c1` has **62 distinct smoke-test endpoint paths** (upstream file blob `1df2e53e690bcd4ca763f88d4d7fb5257c2d0a64`). A byte-for-byte snapshot lives in [pdf-stirling-pinned-endpoints.txt](./pdf-stirling-pinned-endpoints.txt).

Of the **90 handoff requirements**, **54 have an explicit path in that pinned endpoint-test list** and **36 do not**. There are **8 endpoint-test paths** not mapped to the handoff's tool IDs (six filters, PDF decompression, and ebook-to-PDF). These numbers measure *textual route coverage only*, not tool implementation, licensing approval, or user-facing functionality. For the 36 without a route, inspect upstream frontend/composite flows or alternate OpenAPI paths before calling anything absent.

A separate second pass compared the same 90 handoff items against the pinned upstream **frontend** `frontend/editor/src/core/utils/urlMapping.ts` (105 URL aliases, blob `67328c8ab22e775d544c8910387a37aec962628d`) and its `types/toolId.ts` core registry (61 core tool identifiers, blob `de647e2b6e91c6bb9fb66735fd5db748adf75a88`). A pinned [frontend route mapping snapshot](./pdf-stirling-pinned-frontend-routes.json) is included. Of the 36 items without a tested backend endpoint, **22 match an upstream core frontend route**. A third pass located **8 actual Java controllers** (four form handlers, timestamping, standards verification, scanner effect, and pipeline handling), leaving **6 conversion items found only in upstream endpoint configuration**. Some of the frontend items are navigation/documentation links or composite conversion surfaces, not individual backend operations. These results are source *classification*, not functional test completion.

The local PDF tools panel now cross-references the 90 items with **live** provider OpenAPI operation paths: `provider-not-loaded`, `not-in-live-openapi`, `provider-disabled`, or `provider-reports-available`. The final state means only that the local capability resolver advertises availability, **not that any document was processed, saved, reopened or validated offline**. No tools are assigned the evidence status `implemented` by this operation.



### Controller-only and configuration-only evidence

The Java source was checked against the same pinned commit. In addition to the 54 routes present in `testing/endpoints.txt`, eight other routes are declared by concrete controllers: `/api/v1/form/fields`, `/api/v1/form/fill`, `/api/v1/form/modify-fields`, `/api/v1/form/delete-fields`, `/api/v1/security/timestamp-pdf`, `/api/v1/security/verify-pdf`, `/api/v1/misc/scanner-effect`, and `/api/v1/pipeline/handleData`. These can be matched against a **live** OpenAPI response, but are not counted as already passing functional tests.

The last six conversion operations (`pdf-to-epub`, `pdf-to-vector`, `pdf-to-json`, `pdf-to-rtf`, `json-to-pdf`, `vector-to-pdf`) appear only as groups or alternatives in pinned `app/common/.../EndpointConfiguration.java` within this audit. That is **configuration evidence only**. These operations must remain disabled/unknown unless a reviewed runtime handler is separately confirmed.

**Offline caveats from upstream source:** `TimestampController` contacts a remote RFC 3161 timestamp authority; `VerifyPDFController` uses a veraPDF service whose Windows redistribution has not been verified; and `PipelineController` is conditionally excluded in `STIRLING_PDF_TAURI_MODE`. MALENJO's provider capability gate explicitly prevents all three from being advertised as verified offline operations. These do not meet the user's full-functionality requirement.

**Pinned source classification of all 90:** 54 endpoint-fixture routes + 8 controller-only routes + 22 frontend-only entries + 6 configuration-only entries. **Actual function status is still only 24 partial / 66 unaudited; 0 complete.** Source classification cannot substitute for operation fixture execution.

## Runnable, local-only PDF utilities added to the panel

An open PDF can now be exported without starting the Java Stirling sidecar:

- **PDF information → JSON**: uses MALENJO's new bounded `src/suite/pdf/pdfInfo.ts` reader to report metadata, page count, page dimensions and rotation. Tests in `pdfInfo.test.ts` cover real PDF output, byte preservation, malformed input and oversized metadata. This is **partial** parity with upstream `get-info-on-pdf`: security/signatures, full resources and permission diagnostics are not equivalent.
- **Selectable text → TXT**: reuses `src/suite/pdf/textExport.ts`, the existing PDF.js worker and tested per-page limits. Rejects scanned/image-only PDFs without an OCR layer rather than silently exporting an empty document. This is **partial** parity with upstream `pdf-to-text`.
- **Edit standard PDF metadata**: uses `src/suite/pdf/pdfMetadataEdit.ts` and `pdfMetadataEdit.test.ts`. Prefills the four conventional PDF Info fields (title, author, subject and keywords), bounds metadata length, declines signed documents and invalid inputs, and reopens output to validate the page count and changed fields before applying it via MALENJO's working-copy/Undo route. It intentionally does **not** claim to sanitize XMP/custom metadata or preserve digital signatures. This is **partial** parity with upstream `update-metadata`.
- **Modify or delete AcroForm fields**: existing `src/suite/pdf/formManagement.ts`, its real-file tests, and the existing PDF form inspector now receive explicit evidence links in the 90-tool register. The fields' required/read-only flags can be modified, and selected fields/widgets can be removed with XFA/signature refusal. These are **partial** `modify-fields` and `delete-fields` coverage, not full upstream batch/field-type parity.
- **Remove review/markup annotations**: the existing selected-note deletion in `src/suite/pdf/review.ts` has been supplemented with `src/suite/pdf/pdfAnnotationCleanup.ts` and four real PDF tests. The user can remove all common review/markup subtypes and related popups from the current working PDF through an undoable command. Form widgets, links, other interactive annotations and file attachments are preserved; signature dictionaries are refused. This is **partial** `remove-annotations` coverage—not signed-document rewriting, secure sanitization, or every upstream subtype.

Both use the MALENJO local save implementation and carry the same Windows final-output verification gate as other tools. Neither sends the PDF to an internet service. The buttons remain usable even when the Java provider is stopped.

## Release and license constraints

Root Stirling MIT does **not** apply without exception. Independently verify each source file's terms; do not copy Stirling `engine/`, proprietary, SaaS or restricted editor/desktop subtrees under the MIT assumption. Keep source provenance, copyright notices and dependency audits. Provider binary startup alone does not prove an operation works offline.

This is an evidence register, **not an implementation roadmap or feature-completion claim**. It intentionally retains a separate `windowsOffline` verification field. Mark PDF module registry status `partial` until GitHub #39/#81/#141/#143 and the final manual Windows acceptance are satisfied. Automated checks enforce 90 unique IDs and guard against unjustified `implemented` classifications in `src/suite/pdf/parityMatrix.test.ts`.
