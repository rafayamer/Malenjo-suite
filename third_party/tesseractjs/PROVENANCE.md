# Tesseract.js provenance

- Package: `tesseract.js`
- Version: `7.0.0`
- Upstream: https://github.com/naptha/tesseract.js
- License: Apache-2.0
- MALENJO use: portable developer/browser OCR fallback when the local PaddleOCR pack is unavailable
- Runtime: Web Worker / WebAssembly
- Network: language data may be downloaded on first portable-fallback use unless already cached/provided locally

The production offline desktop path is the optional supervised PaddleOCR pack. Tesseract.js is not started at application launch.
