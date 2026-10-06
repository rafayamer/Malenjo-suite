# PDF local providers — pass 2C open-core effects correction

## Scope

This pass corrects two dependency-gating false negatives in the pinned Stirling open core at commit `25220cbdbde2d526cebf173b94357884e180b8c1`.

It does not add Ghostscript and does not make Ghostscript-only vector or CMYK functionality operational.

## Scanner Effect

Upstream source:
- `app/core/src/main/java/stirling/software/SPDF/controller/api/misc/ScannerEffectController.java`
- `app/core/src/main/java/stirling/software/SPDF/model/api/misc/ScannerEffectRequest.java`

The controller renders PDF pages with PDFBox and performs image processing in Java. It does not execute Ghostscript.

The pinned `EndpointConfiguration` nevertheless places `scanner-effect` in the Ghostscript tool group without registering Java as an alternative. When Ghostscript is disabled, endpoint gating therefore hides a Java implementation that is already present in the reviewed open core.

MALENJO applies the checked-in patch `third_party/stirling-pdf/patches/0001-malenjo-java-effect-alternatives.patch` during provider-pack construction to register Java as an alternative for this endpoint.

## Replace / Invert Colors

Upstream source:
- `app/core/src/main/java/stirling/software/SPDF/controller/api/misc/ReplaceAndInvertColorController.java`
- `app/core/src/main/java/stirling/software/SPDF/Factories/ReplaceAndInvertColorFactory.java`
- `app/common/src/main/java/stirling/software/common/util/misc/CustomColorReplaceStrategy.java`
- `app/common/src/main/java/stirling/software/common/util/misc/InvertFullColorStrategy.java`
- `app/common/src/main/java/stirling/software/common/util/misc/ColorSpaceConversionStrategy.java`

Three request modes are implemented with Java/PDFBox:
- `HIGH_CONTRAST_COLOR`;
- `CUSTOM_COLOR`;
- `FULL_INVERSION`.

Only `COLOR_SPACE_CONVERSION` shells out to `gs` for CMYK conversion.

The pinned endpoint configuration groups the entire endpoint under Ghostscript and does not register Java as an alternative. MALENJO corrects the endpoint gating but filters `COLOR_SPACE_CONVERSION` from the runtime operation contract. The UI therefore exposes only modes that the selected open-core provider can execute.

## Reproducibility and provenance

Both Stirling build scripts:
1. check out the exact reviewed upstream commit;
2. verify restricted source directories are not materialized;
3. apply the checked-in patch only after `git apply --check` succeeds;
4. record the patch path and SHA-256 in `provider-packs/stirling-core/manifest.json`.

This keeps the generated JAR attributable to the pinned upstream source plus one explicit MALENJO patch.

## Windows execution gate

The Windows provider job must run with Ghostscript absent from the reviewed child PATH and prove:
- `/api/v1/misc/scanner-effect` is present and executes;
- `/api/v1/misc/replace-invert-pdf` is present and executes using `FULL_INVERSION`;
- both outputs are valid PDF files;
- Ghostscript-only vector endpoints remain unavailable;
- existing qpdf and Tesseract operation smoke stays green.

PDF remains partial after this pass. CMYK conversion and vector conversion still require reviewed replacements.
