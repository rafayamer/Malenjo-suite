#!/usr/bin/env bash
set -euo pipefail

echo "== MALENJO Codespaces AI diagnostic =="

ok=0
if curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags >/tmp/malenjo-ollama-tags.json 2>/dev/null; then
  echo "Ollama: reachable at 127.0.0.1:11434"
  cat /tmp/malenjo-ollama-tags.json
  echo
  ok=1
else
  echo "Ollama: not reachable at 127.0.0.1:11434"
  if command -v ollama >/dev/null 2>&1; then
    echo "  The ollama binary exists. Start it in another terminal with: ollama serve"
  else
    echo "  The ollama binary is not installed in this Codespace."
  fi
fi

if curl -fsS --max-time 2 http://127.0.0.1:8080/v1/models >/tmp/malenjo-llama-models.json 2>/dev/null; then
  echo "llama.cpp server: reachable at 127.0.0.1:8080"
  cat /tmp/malenjo-llama-models.json
  echo
  ok=1
else
  echo "llama.cpp server: not reachable at 127.0.0.1:8080"
fi

echo
if [[ "$ok" -eq 1 ]]; then
  echo "At least one local AI runtime is reachable."
  echo "Start MALENJO with: npm run dev:codespace"
  echo "Then open Malenjo AI and press Runtime status."
else
  echo "No local model runtime is reachable."
  echo "MALENJO retrieval/indexing will still work, but generative answers require a local runtime and an explicitly installed model."
  exit 2
fi
