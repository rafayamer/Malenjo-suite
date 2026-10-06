# PDF pass 2 — external-provider legal/capability matrix

Tracking issue: #143  
Base: `73268853cee830c444e682799d663f444bb59998`  
Stirling open-core pin: `25220cbdbde2d526cebf173b94357884e180b8c1`  
PDF module state: **partial**.

This is a source/redistribution decision record, not a claim that every row is already packaged. MALENJO exposes only capabilities whose selected implementation is present and reviewed.

| Upstream dependency observed by pinned Stirling core | Reviewed target/version | License / redistribution decision | MALENJO decision | Affected operation family |
|---|---|---|---|---|
| qpdf | 12.4.2 | Apache-2.0; exact static deps: libjpeg-turbo 3.2.0#1, OpenSSL 3.6.4#1, zlib 1.3.2#2; MSVC runtime file audit still required for release | **integration-approved / release-gated**, checksum-pinned Windows x64 pack | Repair, Compress PDF |
| Ghostscript | 10.08.0 | AGPL-3.0 or commercial license | **do not bundle for business-compatible pack**; use Stirling Java/PDFBox alternatives where real, otherwise MALENJO replacement required | Repair, Compress, Crop, Replace/Invert, Scanner Effect, vector conversion |
| LibreOffice | 26.8.0 source line; release pack not yet approved | MPL-2.0 / LGPLv3+ project licensing plus large transitive pack | **not yet bundle-approved**; keep conversion endpoints unavailable until exact Windows pack/transitives are audited | Office↔PDF/HTML/XML/RTF/PDF-A |
| Tesseract OCR | 5.5.3; official Windows x64 installer SHA-256 `bee9e3434bd94fd65387d9be28cd467a41f61b1275383b55b0f59a1331270ae4`; tessdata_fast `87416418657359cb625c412a48b6e1d6d41c29bd` | Tesseract + pinned eng/osd data are Apache-2.0; official installer build pulls a moving MSYS2 dependency set, so exact extracted DLL source/version/license mapping is still required | **integration-approved / release-gated**; deterministic offline Windows pack, isolated PATH + TESSDATA_PREFIX | OCR PDF, Auto Rotate |
| OCRmyPDF | 17.12.1 | MPL-2.0; runtime stack commonly depends on Ghostscript | **do not use as the business redistribution path while Ghostscript is required**; prefer MALENJO OCR orchestration + Tesseract/PDF libraries | OCR PDF |
| Poppler `pdftohtml` | no MALENJO bundle selected | GPL family; copyleft redistribution boundary unsuitable for the default business-compatible pack | **do not bundle**; replacement required | PDF→HTML/Markdown |
| unoconv | no MALENJO bundle selected | GPL family and legacy LibreOffice bridge | **do not bundle**; use reviewed direct conversion provider instead | File→PDF |
| WeasyPrint | 70.0 | BSD-3-Clause application; native/transitive pack still requires exact review | **candidate only, not yet bundle-approved** | HTML/URL/Markdown/EML→PDF |
| calibre | 9.15 | GPLv3 | **do not bundle in default business-compatible pack**; replacement required | PDF→EPUB |
| Python/OpenCV | Python 3.13 + OpenCV 4.5+ Apache-2.0 licensing family; exact OpenCV binary pack not yet selected | Python PSF-compatible; OpenCV Apache-2.0; transitive wheel review required | **candidate only, not yet bundle-approved** | Extract Image Scans |
| rar | no MALENJO bundle selected | proprietary RAR tool licensing | **do not bundle**; implement CBR with a redistributable archive path or mark unavailable | PDF→CBR |
| Stirling form-detection model | none in open core | pinned core explicitly disables it because the enabling manager is proprietary | **never copy restricted Stirling model/manager**; MALENJO-owned form detector/model pack required | Auto form detection |

## Upstream fallback corrections

Review of the pinned open-core source shows that dependency-group absence does not imply every listed endpoint is dead:

- Repair tries Ghostscript, then qpdf, then PDFBox when neither external tool is available.
- Compress has qpdf/Ghostscript paths plus a Java/PDFBox implementation.
- Crop has Ghostscript and Java alternatives.
- Markdown→PDF has WeasyPrint and Java alternatives.

The MALENJO capability resolver therefore reports the implementation actually satisfying the operation instead of treating a missing optional executable as equivalent to a missing feature.

## Pass-2A implemented boundary

This branch introduces the first integration-approved binary component pack, qpdf 12.4.2, and a MALENJO-owned capability resolver contract. Its open-source obligations are recorded, while final distributable release approval remains gated on the exact runtime/SBOM and Microsoft redistributable file check. It does **not** close #143 and does **not** promote PDF above `partial`. Remaining provider rows require implementation, Windows smoke coverage, exact transitive notices/SBOM, and replacement work where the selected upstream license is unsuitable.


## Pass-2B OCR boundary

MALENJO's reviewed Tesseract integration pins two independent upstream artifacts:

- Tesseract 5.5.3 official Windows x64 installer `tesseract-ocr-w64-setup-5.5.3.20260724.exe`, SHA-256 `bee9e3434bd94fd65387d9be28cd467a41f61b1275383b55b0f59a1331270ae4`.
- `tessdata_fast@87416418657359cb625c412a48b6e1d6d41c29bd`, with `eng.traineddata` Git blob `bbef4675053b5b468cdb477053e28b1c698ba08e` and `osd.traineddata` Git blob `527457ca8f8fe1fda7c2f88bce3c0e4be12be9d0`.

The upstream NSIS installer normally downloads language data from the moving `tessdata_fast/main` branch. MALENJO does not execute that installer and does not permit that runtime download. The pack builder extracts the reviewed installer without installing it, fetches model files from the exact commit, verifies their Git blob identities, and supplies them through a local `TESSDATA_PREFIX`.

Tesseract core/model licensing is compatible with the intended business boundary, but the official Windows build workflow installs an unpinned MSYS2 package set. Therefore this pass may establish functional Windows integration and operation smoke coverage, but final business redistribution approval remains gated on mapping every extracted runtime DLL to an exact upstream package/version/license and retaining its required notices.

This pass does **not** close #143 and does **not** promote PDF above `partial`.
