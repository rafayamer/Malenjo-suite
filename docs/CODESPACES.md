# MALENJO GitHub Codespaces

Create the Codespace from the repository default branch, `main`.

The dev container installs Node.js 22, npm 11, Rust stable, and the Linux libraries required to compile the Tauri shell. It then installs JavaScript dependencies and fetches Rust dependencies.

## Recommended verification

Run the complete verification as one command:

```bash
npm run verify:codespace
```

That script runs these checks in order:

```bash
npm run typecheck
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Using the single verification command avoids accidental terminal concatenation when pasting several commands at once.

## Run the browser shell

```bash
npm run dev:codespace
```

Port 1420 is forwarded automatically.

## Malenjo AI in Codespaces

Codespaces is a remote Linux VM. Your laptop browser cannot directly reach a model server bound to `127.0.0.1` inside that VM.

MALENJO development mode therefore exposes only four constrained same-origin bridge operations through Vite:

- Ollama model discovery → local `GET /api/tags`
- Ollama chat → local `POST /api/chat`
- llama.cpp model discovery → local `GET /v1/models`
- llama.cpp chat → local `POST /v1/chat/completions`

The bridge does **not** expose generic Ollama/llama.cpp paths and does not expose model-pull endpoints.

Check the VM before starting MALENJO:

```bash
npm run ai:codespace:check
```

For Ollama, the expected development sequence is explicit and user-controlled:

```bash
# Terminal A — only after Ollama is installed in the Codespace
ollama serve

# Terminal B — model installation remains a separate explicit action
ollama pull <model-you-have-reviewed>

# Confirm the runtime/model is visible
npm run ai:codespace:check

# Start MALENJO
npm run dev:codespace
```

Then open **Malenjo AI → Runtime status**. The UI should report the model(s) returned by the runtime and can send local RAG prompts through the Codespace bridge.

If no runtime/model is running, MALENJO can still extract documents, build the local retrieval index and show matching citations, but it cannot honestly provide generative model answers.

Model weights remain separately licensed. Do not pull or redistribute a model without reviewing that model's license and redistribution terms.

## Desktop path

The Windows/Tauri build does **not** use the Vite development bridge. It continues to route AI calls through the Rust native boundary with fixed loopback endpoints, disabled redirects and cloud-routed model-name rejection.

## Desktop limitation of Codespaces

A Codespace is Linux. It is suitable for React/TypeScript work, Rust core logic, tests, documentation, adapters, and much of Tauri development. Windows-specific WebView2 behavior, NSIS/MSI packaging, Authenticode signing, and final Windows desktop validation remain the responsibility of the Windows GitHub Actions runner and Windows test machines.

The CI workflow includes a dedicated `codespace-linux` job so Linux/Tauri regressions are caught before they reach `main`.
