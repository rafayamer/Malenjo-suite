#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-runtime}"
STATE_DIR="${MALENJO_AI_STATE_DIR:-$HOME/.malenjo-ai}"
LOG_FILE="$STATE_DIR/ollama.log"
PID_FILE="$STATE_DIR/ollama.pid"
MANIFEST="${MALENJO_AI_MODEL_MANIFEST:-third_party/models/MODEL_LICENSES.json}"
PROFILE_ID="${MALENJO_AI_MODEL_PROFILE:-}"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This helper is intended for Linux GitHub Codespaces."
  exit 2
fi

if [[ ! -f "$MANIFEST" ]]; then
  echo "AI model manifest not found: $MANIFEST"
  exit 2
fi

PROFILE_TSV="$(python3 - "$MANIFEST" "$PROFILE_ID" <<'PY'
import json,sys
path,requested=sys.argv[1],sys.argv[2]
with open(path,'r',encoding='utf-8') as f:
    data=json.load(f)
profile_id=requested or data.get('defaultProfileId','')
profiles={p.get('id'):p for p in data.get('models') or []}
p=profiles.get(profile_id)
if not p:
    raise SystemExit(f"Unknown MALENJO AI model profile: {profile_id}")
fields=[
    p.get('id',''),p.get('provider',''),p.get('tag',''),p.get('displayName',''),
    str(p.get('approximateDownloadBytes','')),p.get('expectedDigestPrefix',''),
    p.get('license',''),p.get('resourceClass',''),p.get('reviewState',''),
    'true' if p.get('installable') else 'false'
]
print('\t'.join(fields))
PY
)"
IFS=$'\t' read -r PROFILE_ID PROVIDER MODEL DISPLAY_NAME APPROX_BYTES EXPECTED_DIGEST_PREFIX LICENSE RESOURCE_CLASS REVIEW_STATE INSTALLABLE <<<"$PROFILE_TSV"

if [[ "$PROVIDER" != "ollama" ]]; then
  echo "The Codespaces bootstrap currently supports installable Ollama profiles only."
  exit 2
fi
if [[ "$REVIEW_STATE" != "reviewed" || "$INSTALLABLE" != "true" ]]; then
  echo "Profile '$PROFILE_ID' is not approved for automatic installation."
  exit 2
fi

mkdir -p "$STATE_DIR"

echo "== MALENJO Codespaces local-AI bootstrap =="
echo "Mode: $MODE"
echo "Profile: $PROFILE_ID ($DISPLAY_NAME)"
echo "License: $LICENSE"
echo "Resource class: $RESOURCE_CLASS"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required."
  exit 2
fi

if ! command -v zstd >/dev/null 2>&1; then
  echo "zstd is required by the current Ollama Linux installer."
  if command -v apt-get >/dev/null 2>&1; then
    echo "Installing zstd with apt..."
    sudo apt-get update
    sudo apt-get install -y --no-install-recommends zstd
  else
    echo "Automatic zstd installation is only implemented for Debian/Ubuntu Codespaces."
    echo "Install zstd with your system package manager, then rerun this command."
    exit 2
  fi
fi

if ! command -v zstd >/dev/null 2>&1; then
  echo "zstd installation did not succeed."
  exit 2
fi

if ! command -v ollama >/dev/null 2>&1; then
  echo "Ollama is not installed."
  echo "Installing from the current official Linux installer: https://ollama.com/install.sh"
  curl -fsSL https://ollama.com/install.sh | sh
fi

echo "Ollama: $(ollama --version 2>&1 | head -n 1)"

if curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "Ollama server is already reachable on 127.0.0.1:11434."
else
  echo "Starting Ollama on loopback only..."
  nohup env \
    OLLAMA_HOST=127.0.0.1:11434 \
    OLLAMA_NUM_PARALLEL=1 \
    ollama serve >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"

  for attempt in {1..30}; do
    if curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  if ! curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    echo "Ollama did not become ready. Log:"
    tail -n 80 "$LOG_FILE" || true
    exit 3
  fi
fi

if [[ "$MODE" == "runtime" ]]; then
  echo
  echo "Runtime is ready. No model was downloaded."
  echo "To install the reviewed default model explicitly:"
  echo "  npm run ai:codespace:setup:model"
  echo "To select another reviewed profile:"
  echo "  MALENJO_AI_MODEL_PROFILE=<profile-id> npm run ai:codespace:setup:model"
  exit 0
fi

if [[ "$MODE" != "model" ]]; then
  echo "Unknown mode '$MODE'. Use 'runtime' or 'model'."
  exit 2
fi

echo
echo "Reviewed development model:"
echo "  profile: $PROFILE_ID"
echo "  tag: $MODEL"
echo "  expected Ollama digest prefix: $EXPECTED_DIGEST_PREFIX"
echo "  recorded license: $LICENSE"
echo "  approximate download bytes: $APPROX_BYTES"
echo "  provenance: $MANIFEST"
echo
echo "Pulling the explicitly selected development model..."
ollama pull "$MODEL"

MODEL_LINE="$(ollama list | awk -v model="$MODEL" 'NR>1 && $1==model {print; exit}')"
if [[ -z "$MODEL_LINE" ]]; then
  echo "The model was not reported by 'ollama list' after pull."
  exit 4
fi

MODEL_ID="$(awk '{print $2}' <<<"$MODEL_LINE")"
if [[ "$MODEL_ID" != "$EXPECTED_DIGEST_PREFIX"* ]]; then
  echo "Model digest mismatch."
  echo "Expected prefix: $EXPECTED_DIGEST_PREFIX"
  echo "Reported ID:     $MODEL_ID"
  echo "Refusing to mark the reviewed development profile ready."
  exit 5
fi

echo
echo "Running a local smoke test..."
SMOKE_PAYLOAD="$(printf '{"model":"%s","stream":false,"messages":[{"role":"user","content":"Reply with exactly: MALENJO_AI_READY"}],"options":{"temperature":0,"num_ctx":1024}}' "$MODEL")"
SMOKE_FILE="$STATE_DIR/smoke-response.json"
HTTP_CODE="$(curl -sS --max-time 180 -o "$SMOKE_FILE" -w '%{http_code}' http://127.0.0.1:11434/api/chat -H 'Content-Type: application/json' -d "$SMOKE_PAYLOAD" || true)"
SMOKE="$(cat "$SMOKE_FILE" 2>/dev/null || true)"

if [[ ! "$HTTP_CODE" =~ ^2 ]]; then
  echo "Local model smoke test failed with HTTP $HTTP_CODE."
  if [[ -n "$SMOKE" ]]; then
    echo "Ollama response:"
    echo "$SMOKE"
  fi
  echo
  echo "System memory:"
  free -h || true
  echo
  echo "Recent Ollama server log:"
  tail -n 120 "$LOG_FILE" || true
  echo
  echo "The model download itself succeeded; this failure occurred while Ollama tried to load/run it."
  echo "To try the reviewed newer MIT fallback profile:"
  echo "  MALENJO_AI_MODEL_PROFILE=phi4-mini-q4-mit npm run ai:codespace:setup:model"
  exit 6
fi

if ! grep -q "MALENJO_AI_READY" <<<"$SMOKE"; then
  echo "The model responded, but the smoke-test marker was not found."
  echo "$SMOKE"
  exit 6
fi

echo "Local model smoke test passed."
echo
echo "Start MALENJO:"
echo "  npm run dev:codespace"
echo "Then open Malenjo AI and select/refresh runtime status."
