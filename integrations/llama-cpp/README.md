# llama.cpp local server adapter

Phase 5 supports an already-running local `llama-server`.

- Endpoint is hard-coded to `http://127.0.0.1:8080`.
- Model discovery uses the OpenAI-compatible `GET /v1/models` endpoint.
- Chat uses `POST /v1/chat/completions`.
- No llama.cpp process or model is started during MALENJO startup.
- Model weights are not downloaded by the chat workspace.
- Requests are cancellable.

Typical external launch:

```text
llama-server -m model.gguf --port 8080
```

The server/model package remains an optional local AI component.
