#!/usr/bin/env bash
set -euo pipefail

echo "== MALENJO Codespace verification =="
npm run typecheck
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib

echo "== MALENJO Codespace verification passed =="
