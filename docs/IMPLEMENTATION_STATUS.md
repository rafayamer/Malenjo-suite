# Implementation status

This repository is the **Phase 0 / Phase 1 executable foundation**, not a claim that all 300+ pages of the developer guide are already implemented.

| Area | Status | Next gate |
|---|---|---|
| Unified shell/theme | Implemented scaffold | visual regression against supplied references |
| Module registry/navigation | Implemented scaffold | command palette + document routing |
| Rust native boundary | Implemented scaffold | filesystem/secret-store/update commands |
| Local service manager | Contract scaffold | supervised subprocess lifecycle + health checks |
| PDF | Adapter boundary | legally cleared Stirling/PDF.js/PDFBox proof of concept |
| Office | Adapter boundary | Tiptap/Univer + OOXML fidelity proof of concept |
| Scanner/OCR | Adapter boundary | camera + OpenCV + PaddleOCR proof of concept |
| Local AI | Adapter boundary | Ollama/llama.cpp local RAG proof of concept |
| Sign/Invoice/Metadata | Adapter boundary | module-by-module implementation and tests |
| DMS/Automation/Admin | Planned scaffold | data model and policy service implementation |
| CAD/DICOM | Adapter boundary | optional-pack proof of concept |
| Packaging | Configured developer targets | signing, SBOM, installer QA, update manifests |

Do not mark a module complete until its acceptance criteria and traceability entries in the master guide pass.
