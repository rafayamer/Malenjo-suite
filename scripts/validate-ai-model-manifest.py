#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path

MANIFEST = Path(sys.argv[1] if len(sys.argv) > 1 else "third_party/models/MODEL_LICENSES.json")
ALLOWED_PROVIDERS = {"ollama", "llama-cpp"}
ALLOWED_RESOURCE_CLASSES = {"ultralite", "lite", "standard"}
ALLOWED_REVIEW_STATES = {"reviewed", "candidate"}
DIGEST = re.compile(r"^[0-9a-f]{12,64}$", re.I)

def fail(message: str) -> None:
    raise SystemExit(f"AI model manifest invalid: {message}")

data = json.loads(MANIFEST.read_text(encoding="utf-8"))
if data.get("schemaVersion") != 2:
    fail("schemaVersion must be 2")

models = data.get("models")
if not isinstance(models, list) or len(models) != 1:
    fail("models must contain exactly one reviewed MALENJO model")

ids = set()
tags = set()
for model in models:
    profile_id = model.get("id")
    tag = model.get("tag")
    if not isinstance(profile_id, str) or not profile_id or profile_id in ids:
        fail("profile IDs must be unique non-empty strings")
    if not isinstance(tag, str) or not tag or tag in tags:
        fail("model tags must be unique non-empty strings")
    if model.get("provider") not in ALLOWED_PROVIDERS:
        fail(f"{profile_id}: unsupported provider")
    if model.get("resourceClass") not in ALLOWED_RESOURCE_CLASSES:
        fail(f"{profile_id}: unsupported resourceClass")
    if model.get("reviewState") not in ALLOWED_REVIEW_STATES:
        fail(f"{profile_id}: unsupported reviewState")
    if not isinstance(model.get("approximateDownloadBytes"), int) or model["approximateDownloadBytes"] <= 0:
        fail(f"{profile_id}: invalid approximateDownloadBytes")
    digest = model.get("expectedDigestPrefix")
    if not isinstance(digest, str) or not DIGEST.fullmatch(digest):
        fail(f"{profile_id}: invalid expectedDigestPrefix")
    if not isinstance(model.get("license"), str) or not model["license"].strip():
        fail(f"{profile_id}: license is required")
    if model.get("installable") and model.get("reviewState") != "reviewed":
        fail(f"{profile_id}: installable profiles must be reviewed")
    ids.add(profile_id)
    tags.add(tag)

default_id = data.get("defaultProfileId")
default = next((model for model in models if model.get("id") == default_id), None)
if default is None:
    fail("defaultProfileId does not resolve to a model")
if not default.get("installable") or default.get("reviewState") != "reviewed":
    fail("default profile must be reviewed and installable")
if default.get("license") != "MIT":
    fail("default profile must be MIT-licensed")
if default.get("provider") != "ollama":
    fail("default profile must use the Ollama local provider")
if default.get("upstreamModel") != "microsoft/Phi-4-mini-instruct":
    fail("default profile must be the reviewed Phi-4 Mini upstream")
if not default.get("upstreamRevision"):
    fail("default profile requires a pinned upstream revision")
if default.get("fineTunable") is not True:
    fail("default profile must remain fine-tunable")

print(f"AI model manifest OK: {len(models)} profiles; default={default_id}; license={default['license']}")
