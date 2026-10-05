# PaddleOCR adapter

Phase 4 provides a supervised optional local PaddleOCR worker.

## Runtime boundary

- PaddleOCR is **not** imported or started during MALENJO startup.
- The Rust adapter checks for Python and the optional `paddleocr` package only when OCR status/job commands are requested.
- A job image is staged in MALENJO cache, processed by `workers/paddleocr/worker.py`, and removed afterward.
- Image payloads are limited to 25 MB.
- Each worker job has a 120-second timeout.
- Cancellation is propagated to Rust and kills the child process.
- Worker stdout must be valid JSON before it is accepted.

## Portable fallback

Codespaces/browser development can use Tesseract.js 7.0.0. Its language assets may require a first-use download/cache. The installed PaddleOCR pack is the intended fully local desktop OCR path.

## Packaging

The Python worker script is bundled as a Tauri resource. Python/Paddle/model packages are intentionally separate optional components to preserve a small core installer.
