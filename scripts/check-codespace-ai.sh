#!/usr/bin/env bash
set -euo pipefail

echo "== MALENJO Codespaces AI diagnostic =="

ready=0
runtime_seen=0

if curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags >/tmp/malenjo-ollama-tags.json 2>/dev/null; then
  runtime_seen=1
  OLLAMA_MODELS="$(python3 - <<'PY'
import json
with open('/tmp/malenjo-ollama-tags.json','r',encoding='utf-8') as f:
    data=json.load(f)
print(len(data.get('models') or []))
PY
)"
  echo "Ollama: reachable at 127.0.0.1:11434"
  echo "Ollama models reported: $OLLAMA_MODELS"
  if [[ "$OLLAMA_MODELS" -gt 0 ]]; then
    ready=1
    python3 - <<'PY'
import json
with open('/tmp/malenjo-ollama-tags.json','r',encoding='utf-8') as f:
    data=json.load(f)
for item in data.get('models') or []:
    print(f"  - {item.get('name') or item.get('model') or 'unnamed'}")
PY
  else
    echo "  Runtime is up, but no model is installed."
    echo "  Install the reviewed dev model with: npm run ai:codespace:setup:model"
  fi
else
  echo "Ollama: not reachable at 127.0.0.1:11434"
  if command -v ollama >/dev/null 2>&1; then
    echo "  The ollama binary exists."
    echo "  Start the reviewed runtime profile with: npm run ai:codespace:setup"
  else
    echo "  The ollama binary is not installed."
    echo "  Install/start it explicitly with: npm run ai:codespace:setup"
  fi
fi

if curl -fsS --max-time 2 http://127.0.0.1:8080/v1/models >/tmp/malenjo-llama-models.json 2>/dev/null; then
  runtime_seen=1
  LLAMA_MODELS="$(python3 - <<'PY'
import json
with open('/tmp/malenjo-llama-models.json','r',encoding='utf-8') as f:
    data=json.load(f)
print(len(data.get('data') or []))
PY
)"
  echo "llama.cpp server: reachable at 127.0.0.1:8080"
  echo "llama.cpp models reported: $LLAMA_MODELS"
  if [[ "$LLAMA_MODELS" -gt 0 ]]; then
    ready=1
  fi
else
  echo "llama.cpp server: not reachable at 127.0.0.1:8080"
fi

echo
if [[ "$ready" -eq 1 ]]; then
  echo "AI-ready: at least one local runtime and model are available."
  echo "Start MALENJO with: npm run dev:codespace"
  echo "Then open Malenjo AI and press Runtime status."
  exit 0
fi

if [[ "$runtime_seen" -eq 1 ]]; then
  echo "Runtime-only state: a local server is reachable, but no usable model is reported."
  exit 3
fi

echo "No local model runtime is reachable."
echo "MALENJO retrieval/indexing still works, but generative answers require a local runtime plus model."
exit 2
