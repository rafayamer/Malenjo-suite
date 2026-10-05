# Phase 4 — Scanner and OCR Pipeline

## Scope

Phase 4 turns Scanner and OCR into real MALENJO workspaces for local page capture, image cleanup, page assembly, OCR, benchmarking and searchable output.

## Scan pipeline

```text
Camera / image import
       |
       v
resource validation
  - supported image MIME
  - <= 25 MB/page
  - <= 25 megapixels/page
  - <= 50 pages/session
       |
       v
crop -> brightness/contrast/grayscale
       -> manual quadrilateral perspective correction
       -> rotation
       |
       v
page assembly / reorder
       |
       +--> OCR
       +--> text export
       +--> searchable PDF
```

## Perspective correction

The Phase 4 UI exposes four normalized corner points. The browser image pipeline maps that quadrilateral into a rectangular output canvas using bilinear sampling. This is a manual correction path; future OpenCV/Scanic adapters may add automatic document-edge detection.

## OCR engines

### PaddleOCR local pack

The preferred desktop path is a supervised Python/PaddleOCR worker:

- loaded only on demand;
- optional pack;
- 25 MB job limit;
- 120 second timeout;
- actual child-process cancellation;
- cache-directory staging;
- JSON-only result contract.

### Tesseract.js portable fallback

Tesseract.js 7.0.0 provides a Codespaces/browser fallback and session cache. Language data can require first-use download/cache; it is not presented as the final offline desktop pack.

## Cache and cancellation

Processed image content is SHA-256 keyed in the frontend OCR session cache. Cache hits return without rerunning OCR. Active Tesseract workers are terminated on cancellation. Native Paddle jobs receive a cancellation ID and the Rust supervisor kills the child process.

## Searchable output

- Plain text output combines OCR text by assembled page order.
- Searchable PDF embeds each processed scan image using pdf-lib 1.17.1 and places a low-opacity text layer in the page content for search/indexing.
- Phase 4's searchable layer is English/ASCII-oriented; precise word-position overlays and full Unicode font embedding remain later fidelity work.

## Benchmarking

For each recognized page MALENJO records:

- OCR engine;
- confidence;
- latency;
- cache hit/new job.

A ground-truth input computes normalized character accuracy using Levenshtein edit distance.

## Security and resource bounds

- no OCR process on startup;
- image/page limits;
- local worker timeout;
- cancellation;
- staged temporary image deletion;
- no arbitrary script path supplied by UI;
- only the bundled worker script is invoked.

## Third-party provenance

| Component | Version | License | Role |
|---|---:|---|---|
| Tesseract.js | 7.0.0 | Apache-2.0 | portable OCR fallback |
| pdf-lib | 1.17.1 | MIT | searchable PDF assembly |

PaddleOCR itself remains an optional separately installed pack and must carry its exact Python/model license inventory when packaged.

## Acceptance checklist

- [x] image import.
- [x] camera capture.
- [x] crop.
- [x] rotate.
- [x] manual perspective correction.
- [x] image cleanup.
- [x] multi-page assembly/reorder.
- [x] supervised local PaddleOCR adapter.
- [x] portable OCR fallback.
- [x] OCR cache.
- [x] OCR cancellation.
- [x] latency/confidence metrics.
- [x] accuracy benchmark.
- [x] text export.
- [x] searchable PDF export.
- [x] resource bounds.
- [x] malformed/oversized metadata tests.
- [x] optional offline local-worker architecture.
- [ ] CI validation.
- [ ] packaged PaddleOCR/model pack installation test.
- [ ] Windows camera-device matrix.
