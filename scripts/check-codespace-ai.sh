#!/usr/bin/env bash
set -euo pipefail

echo "== MALENJO Codespaces AI diagnostic =="

MANIFEST="${MALENJO_AI_MODEL_MANIFEST:-third_party/models/MODEL_LICENSES.json}"
if [[ ! -f "$MANIFEST" ]]; then
  echo "AI model manifest not found: $MANIFEST"
  exit 2
fi

PROFILE_TSV="$(python3 - "$MANIFEST" <<'PY'
import json,sys
with open(sys.argv[1],'r',encoding='utf-8') as f:
    data=json.load(f)
models=data.get('models') or []
if len(models) != 1:
    raise SystemExit("MALENJO AI manifest must contain exactly one reviewed model")
profile_id=data.get('defaultProfileId','')
profile=models[0]
if profile.get('id') != profile_id:
    raise SystemExit("The sole MALENJO AI model must be the default profile")
print("\t".join([
    profile_id,
    profile.get('tag',''),
    profile.get('license',''),
    profile.get('resourceClass',''),
    profile.get('expectedDigestPrefix',''),
]))
PY
)"
IFS=$'\t' read -r DEFAULT_PROFILE_ID DEFAULT_MODEL_TAG DEFAULT_MODEL_LICENSE DEFAULT_RESOURCE_CLASS EXPECTED_DIGEST_PREFIX <<<"$PROFILE_TSV"

echo "Reviewed model: $DEFAULT_PROFILE_ID"
echo "  tag: $DEFAULT_MODEL_TAG"
echo "  license: $DEFAULT_MODEL_LICENSE"
echo "  resource class: $DEFAULT_RESOURCE_CLASS"
echo "  expected digest prefix: $EXPECTED_DIGEST_PREFIX"
echo

if ! curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags >/tmp/malenjo-ollama-tags.json 2>/dev/null; then
  echo "Ollama: not reachable at 127.0.0.1:11434"
  if command -v ollama >/dev/null 2>&1; then
    echo "  The ollama binary exists."
    echo "  Start the reviewed runtime with: npm run ai:codespace:setup"
  else
    echo "  Ollama is not installed."
    echo "  Install/start it explicitly with: npm run ai:codespace:setup"
  fi
  exit 2
fi

echo "Ollama: reachable at 127.0.0.1:11434"

MODEL_TSV="$(python3 - "$DEFAULT_MODEL_TAG" "$EXPECTED_DIGEST_PREFIX" <<'PY'
import json,sys
expected_tag,expected_digest=sys.argv[1],sys.argv[2]
with open('/tmp/malenjo-ollama-tags.json','r',encoding='utf-8') as f:
    data=json.load(f)
models=data.get('models') or []
for item in models:
    name=item.get('name') or item.get('model') or ''
    if name == expected_tag:
        digest=item.get('digest') or item.get('id') or ''
        size=item.get('size') or 0
        print(f"found\t{digest}\t{size}")
        break
else:
    print("missing\t\t0")
PY
)"
IFS=$'\t' read -r MODEL_STATE MODEL_DIGEST MODEL_SIZE <<<"$MODEL_TSV"

if [[ "$MODEL_STATE" != "found" ]]; then
  echo "Reviewed MALENJO model is not installed."
  echo "Install it with: npm run ai:codespace:setup:model"
  echo
  echo "Other Ollama models, if any, are intentionally ignored by MALENJO."
  exit 3
fi

if [[ -z "$MODEL_DIGEST" || "$MODEL_DIGEST" != "$EXPECTED_DIGEST_PREFIX"* ]]; then
  echo "Reviewed model tag is installed but its digest does not match the reviewed identity."
  echo "Expected prefix: $EXPECTED_DIGEST_PREFIX"
  echo "Reported digest: $MODEL_DIGEST"
  exit 4
fi

echo "Reviewed Phi-4 model: installed"
echo "  reported digest: ${MODEL_DIGEST:-not reported}"
echo "  reported size bytes: $MODEL_SIZE"
echo
echo "AI-ready: the approved local runtime and model are available."
echo "Start MALENJO with: npm run dev:codespace"
echo "Then open Malenjo AI and press Runtime status."
