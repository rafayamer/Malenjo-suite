# Ollama local adapter

Phase 5 implements a local-only Ollama adapter.

- Endpoint is hard-coded to `http://127.0.0.1:11434`.
- Model discovery uses `GET /api/tags`.
- Chat uses `POST /api/chat` with `stream:false`.
- MALENJO does not start Ollama at application startup.
- MALENJO does not pull/download models from the chat workspace.
- Model IDs containing cloud-routing suffixes such as `:cloud` are rejected.
- Lite Mode requests `keep_alive: 0s` and a smaller context.
- Requests are cancellable from the MALENJO UI.

Ollama/model installation remains a separate optional runtime/model-pack workflow.
