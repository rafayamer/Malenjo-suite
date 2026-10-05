# Ollama adapter

Phase 5 implements a local-only MALENJO RAG adapter for Ollama.

## Boundary

Default loopback endpoint:

```text
http://127.0.0.1:11434
```

Used API surfaces:

- `GET /api/version`
- `GET /api/tags`
- `POST /api/chat`

The adapter never calls the model-pull API. Model installation/download remains an explicit external action.

## Startup behavior

Ollama is not launched by MALENJO. No AI runtime request is made at application startup. The AI workspace only contacts the configured loopback runtime after the user clicks **Check runtime**.

## Resource policy

Standard mode requests a bounded context/output and keeps the model warm briefly. Lite Mode uses smaller index/context/output limits and sends `keep_alive: 0`.

Generation requests are cancellable with `AbortController`.

## Security

- only loopback runtime URLs are accepted;
- local sources are marked as untrusted data;
- document instructions are never treated as system instructions;
- retrieval citations are created before generation;
- model output remains untrusted generated content.

## Licensing

Ollama itself is MIT licensed. MALENJO does not redistribute the runtime or any model weights in this repository. Each model requires its own license review.

See `docs/AI_PHASE5.md` and `third_party/ollama/PROVENANCE.md`.
