# PDF completion pass 2C — pinned open-core capability truth

Tracking: #143, #141, canonical #39/#81  
Base main: `ef3fa29846b0d931c2e005ce644c52166492ae53`  
Stirling open-core pin: `25220cbdbde2d526cebf173b94357884e180b8c1`  
PDF registry state: **partial**.

## Purpose

Pass 2A/2B conservatively disabled some operations whose endpoint names appeared in dependency-group diagnostics. Source review of the pinned open-core implementation shows that two of those classifications were too broad.

This pass corrects MALENJO's provider truth. It does not bundle Ghostscript and it does not widen the Stirling legal boundary.

## Scanner Effect

Pinned source:
- `app/core/src/main/java/stirling/software/SPDF/controller/api/misc/ScannerEffectController.java`
- `app/core/src/main/java/stirling/software/SPDF/model/api/misc/ScannerEffectRequest.java`

The operation is implemented with Java/AWT and PDFBox:
- `PDFRenderer` renders bounded pages;
- Java image buffers implement grayscale, rotation, border, brightness/contrast, blur, noise and paper effects;
- PDFBox writes the processed images back into PDF pages;
- render dimensions/pixels and DPI are bounded.

No Ghostscript process is invoked by this controller.

MALENJO therefore resolves Scanner Effect to `stirling-core`, with implementation truth `Java-PDFBox-AWT scanner simulation`.

## Replace / Invert Color

Pinned source:
- `ReplaceAndInvertColorController.java`
- `ReplaceAndInvertColorFactory.java`
- `CustomColorReplaceStrategy.java`
- `InvertFullColorStrategy.java`

The factory has four request modes:

| Mode | Pinned implementation | MALENJO state |
|---|---|---|
| `HIGH_CONTRAST_COLOR` | PDFBox text/background rewrite | available |
| `CUSTOM_COLOR` | PDFBox text/background rewrite | available |
| `FULL_INVERSION` | PDFBox/AWT render, invert and rewrite | available |
| `COLOR_SPACE_CONVERSION` | Ghostscript CMYK conversion | **not exposed** |

The MALENJO-owned operation contract filters the final enum so the Ghostscript-only CMYK mode is not rendered as an available control. The endpoint itself remains operational for the three lawful core modes.

## Ghostscript boundary

Ghostscript remains absent from the reviewed provider PATH and is not bundled. PDF↔PostScript/EPS/PCL/XPS vector conversion remains unavailable because the pinned `PdfVectorExportController` executes `gs` for those paths.

The source audit also confirms that SVG→PDF is a separate Java/Batik/PDFBox path and is not treated as the Ghostscript vector endpoint.

## Windows executable evidence

The Windows provider job keeps PATH restricted to the reviewed qpdf and Tesseract directories, then requires and invokes:

- `/api/v1/misc/replace-invert-pdf` with `FULL_INVERSION`;
- `/api/v1/misc/scanner-effect` with a low-quality grayscale preset.

Both outputs must be valid PDF signatures. Because Ghostscript is absent from the child PATH, this is executable evidence for the core implementation boundary rather than an environment-dependent success.

## Completion boundary

This pass corrects two operation classifications only. It does not close #143, #141, #39 or #81 and does not promote PDF above `partial`. Office conversion, HTML-family conversion, true Ghostscript-only vector replacements, EPUB, scan extraction, CBR, form detection, binary redistribution gates, installed-package smoke and the wider canonical feature tree remain outstanding.
