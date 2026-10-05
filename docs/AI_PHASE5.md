# Phase 5 — Malenjo AI Local RAG

## Scope

Phase 5 adds private document question-answering without making the Internet or any cloud AI service mandatory.

The feature is intentionally split into two independent layers:

1. MALENJO local document extraction, chunking, indexing, retrieval and citation.
2. An optional loopback model runtime (Ollama or an OpenAI-compatible llama.cpp server).

MALENJO does not launch, install, pull, or download a model at application startup.

## Data flow

```text
Local PDF / DOCX / XLSX / PPTX / text
        |
        v
MALENJO local extraction
        |
        v
bounded chunk/index
        |
        v
local lexical retrieval
        |
        +--> exact source name + locator citations
        |
        v
prompt boundary
  sources marked UNTRUSTED DATA
        |
        v
127.0.0.1 model runtime
  Ollama /api/chat
  or llama.cpp /v1/chat/completions
        |
        v
answer + retrieved source passages
```

## Source extraction

Supported Phase 5 source formats:

- TXT / Markdown / CSV / JSON / LOG
- text-bearing PDF
- DOCX paragraphs
- XLSX worksheet rows
- PPTX slide text

Scanned PDFs with no text must pass through the Phase 4 OCR pipeline first.

Each source keeps a locator such as page, paragraph, worksheet row or slide number. Citations point back to those locators.

## Memory and resource bounds

Standard mode:

- maximum indexed characters: 2.5 million
- maximum chunks: 400
- approximate chunk target: 1,800 characters
- retrieval passages per question: 6
- generation context request: 4,096
- generation output request: 640

Lite Mode:

- maximum indexed characters: 800,000
- maximum chunks: 160
- approximate chunk target: 1,200 characters
- retrieval passages per question: 3
- generation context request: 2,048
- generation output request: 256
- Ollama `keep_alive: 0` so the model may unload after the request

Each imported source file is limited to 25 MB in this phase. PDF extraction is limited to 200 pages in Standard mode and 60 pages in Lite Mode.

## Retrieval

Phase 5 uses deterministic local lexical TF/IDF-style retrieval.

This deliberately keeps the initial index:

- fully local;
- dependency-light;
- deterministic;
- usable without loading an embedding model;
- available before an AI runtime is installed.

A future embedding provider can be added behind the same retrieval interface.

## Prompt-injection boundary

Retrieved source passages are treated as untrusted data.

The system message explicitly tells the model not to follow:

- instructions embedded in documents;
- role-change requests;
- tool requests;
- policy text;
- requests to reveal secrets.

The local source prompt is wrapped in tagged source blocks with stable citation IDs such as `S1`.

Automated tests include a document containing an "ignore previous instructions" payload.

This reduces risk but does not make prompt injection impossible; source-aware AI output must still be treated as generated content.

## Runtime boundary

### Ollama

Default loopback:

```text
http://127.0.0.1:11434
```

Used endpoints:

- `GET /api/version`
- `GET /api/tags`
- `POST /api/chat`

MALENJO does not call the model pull endpoint.

### llama.cpp

Default loopback:

```text
http://127.0.0.1:8080
```

Used OpenAI-compatible endpoints:

- `GET /v1/models`
- `POST /v1/chat/completions`

## Network policy

Phase 5 rejects non-loopback runtime URLs. The runtime may be absent and MALENJO still performs extraction/indexing/retrieval locally.

No runtime is contacted merely because MALENJO starts. Runtime discovery occurs only when the user opens the AI workspace and explicitly clicks **Check runtime**.

## Cancellation

Generation requests use `AbortController`. The user can cancel an in-flight fetch. Closing the request connection asks the local runtime to abandon the response; runtime-specific compute cancellation behavior remains subject to the provider.

## Model installation and licensing

MALENJO does not bundle model weights in the core application.

Users install models separately. Every model can have its own license and acceptable-use terms; Ollama's runtime license does not automatically grant rights to any model served through it.

## Acceptance checklist

- [x] Ollama adapter.
- [x] llama.cpp OpenAI-compatible adapter.
- [x] Model discovery separated from model installation/download.
- [x] Local document extraction.
- [x] Bounded chunk/index construction.
- [x] Local retrieval.
- [x] Source-name/locator citations.
- [x] Explicit runtime/model/resource status.
- [x] Lite Mode.
- [x] Request cancellation.
- [x] Prompt-injection boundary tests.
- [x] No runtime/model startup at MALENJO launch.
- [ ] Automated CI verification.
- [ ] Manual Windows Ollama/llama.cpp runtime matrix.
- [ ] Representative model-quality evaluation.
