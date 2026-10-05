# llama.cpp server adapter

Phase 5 supports a local OpenAI-compatible llama.cpp server as a secondary model runtime.

Default address:

```text
http://127.0.0.1:8080
```

MALENJO uses only:

- `GET /v1/models`
- `POST /v1/chat/completions`

The server and model are not bundled or started by MALENJO. Runtime/model packaging, exact version pinning and redistribution review remain separate optional-pack work.
