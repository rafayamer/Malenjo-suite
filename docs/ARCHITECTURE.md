# MALENJO Architecture

## Locked platform layers

1. **Tauri + Rust** — Windows shell, native security, service lifecycle, filesystem, update boundary.
2. **React + TypeScript** — one branded shell and all visible workspaces.
3. **Java/Spring adapter layer** — PDF/Office/domain services where required.
4. **Python workers** — OCR/AI/extraction tasks isolated from the UI process.
5. **External engines behind adapters** — Ollama/llama.cpp, PaddleOCR, Temporal, Kopia, identity services and optional CAD/DICOM engines.

## Startup policy

The React/Tauri shell must become interactive before Java, Python, LibreOffice, AI models, OCR, CAD, DICOM or enterprise services are started. Engines are lazy-loaded by capability.

## Trust boundaries

Untrusted documents never gain direct access to credentials or privileged native APIs. Complex parsers/converters should run with least privilege and process isolation where practical. Local service listeners bind to `127.0.0.1` unless an explicit administrator policy says otherwise.

## Adapter contract

Every engine integration follows: capability -> MALENJO interface -> proof-of-concept adapter -> Windows/offline tests -> license/security review -> unified UI -> permanent dependency.
