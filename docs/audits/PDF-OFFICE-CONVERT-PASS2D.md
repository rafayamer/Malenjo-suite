# PDF local providers — pass 2D embedded Office conversion

## Scope

This pass activates and proves the open, in-process Office conversion library
already embedded in the pinned Stirling core. It does not bundle LibreOffice,
Unoconvert or Microsoft Office.

Pinned Stirling source:
`25220cbdbde2d526cebf173b94357884e180b8c1`.

Pinned Office converter:
- repository: `Stirling-Tools/Stirling-Office-Convert`;
- release: `v0.2.2`;
- source commit: `673aab8d6ac784524cd1d90141c95e74b9fd26ae`;
- license: MIT;
- runtime: Java 25, Apache PDFBox / Apache POI family.

## Deterministic runtime selection

The pinned Stirling application exposes `system.stirlingOfficeConversion`
and registers Java endpoint alternatives when it is enabled. MALENJO starts
its loopback-only sidecar with
`--system.stirlingOfficeConversion=true`, so capability truth does not depend
on a mutable admin setting.

The generic provider UI removes the per-request
`useStirlingOfficeConvert` toggle for operations assigned to this provider.
Users therefore cannot accidentally select the missing LibreOffice fallback.

## Reviewed operation boundary

MALENJO assigns these pinned routes to
`stirling-office-convert` 0.2.2:

- File → PDF for input extensions recognized by Office Convert 0.2.2;
- PDF → Word (`doc`, `docx`, `odt`);
- PDF → Presentation (`ppt`, `pptx`, `odp`);
- PDF → Text/RTF;
- PDF → XLSX, whose controller selects the same in-process converter when the
  global feature is enabled.

The File → PDF picker is constrained to the reviewed extension allowlist from
the 0.2.2 `OfficeToPdf.Format` implementation.

These routes remain separate and unavailable without their own reviewed
provider:
- PDF → XML;
- PDF → HTML;
- PDF → PDF/A.

## Source-to-binary provenance

The pinned Stirling Gradle build resolves these exact embedded modules:
- `stirling-office-convert:0.2.2`;
- `stirling-office-convert-legacy:0.2.2`;
- `stirling-office-convert-topdf:0.2.2`.

The MALENJO provider builder verifies all three nested JAR names inside the
generated Spring Boot JAR and records each nested JAR SHA-256 in
`provider-packs/stirling-core/manifest.json` together with the Office source
commit and MIT license.

## License gate and shipped notices

The provider build reproduces the pinned Stirling license policy:

`checkLicense generateLicenseReport --no-parallel`

The pinned upstream override file contains two Apache-2.0 entries that are not
resolved in MALENJO's core-only graph: `immutables-exceptions:1.9` and
`algebra:1.5`. Gradle removes both as unused. MALENJO records that reviewed
normalization in `0002-malenjo-core-license-overrides.patch` before running
the license task. After that explicit baseline is applied, **any further**
mutation of `app/license-overrides.json` fails the build.

The generated exact dependency-license report is packaged as
`malenjo-notices/stirling-dependency-licenses.json` beside retained Stirling
and Office Convert license notices.

See `third_party/stirling-office-convert/` for the source license,
provenance, and direct dependency record.

## Windows execution gate

Clean Windows CI runs the sidecar with no LibreOffice or Microsoft Office in
the reviewed provider PATH and must prove:
- TXT → PDF;
- PDF → DOCX with `word/document.xml` present;
- PDF → PPTX with `ppt/presentation.xml` present;
- PDF → RTF with a real RTF header;
- existing qpdf, Java effects, OCR and OSD smoke stays green;
- PDF → XML remains non-success because that pinned route is still
  LibreOffice-only;
- PDF → vector remains non-success because it is still Ghostscript-only.

PDF remains partial after this pass.


## Runtime capability provenance

MALENJO does not infer Office Convert availability from OpenAPI presence or the
`system.stirlingOfficeConversion` flag alone. The native Tauri boundary
verifies the selected generated/bundled Stirling pack before reporting the
`stirling-office-convert` component as available:

- the adjacent MALENJO manifest names the exact pinned Stirling commit;
- the selected `stirling-pdf.jar` SHA-256 matches the manifest;
- embedded Office Convert is exactly `0.2.2` from source commit
  `673aab8d6ac784524cd1d90141c95e74b9fd26ae` under MIT;
- all three expected embedded Office Convert JAR entries have recorded
  SHA-256 values;
- the generated dependency-license report and retained Office Convert license
  notice are present.

The verification result is cached using JAR/manifest/notice metadata so normal
component-status refreshes do not repeatedly hash the large provider JAR.

An explicit `MALENJO_STIRLING_JAR` override is reported as `configured` and
is **not eligible** for embedded Office Convert approval. This prevents an
arbitrary local JAR from inheriting MALENJO's reviewed-provider claim.

## Provider UI input truth

File → PDF expects an Office/text input, not the currently open PDF. MALENJO
therefore uses the operation's reviewed `accept` contract to decide whether
the active PDF can populate a file field. Office-input fields require an
explicit compatible local file; PDF-input conversion fields may still use the
active working PDF.

## XLSX execution proof

Pass 2D includes a deterministic ruled-table PDF fixture. Windows CI validates
the fixture with qpdf, invokes PDF → XLSX through the loopback provider, and
requires a real OOXML workbook containing both `xl/workbook.xml` and
`xl/worksheets/sheet1.xml`. A 204/no-table response is not accepted as
feature evidence.
