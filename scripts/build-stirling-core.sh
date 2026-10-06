#!/usr/bin/env bash
set -euo pipefail

PIN="25220cbdbde2d526cebf173b94357884e180b8c1"
UPSTREAM="https://github.com/Stirling-Tools/Stirling-PDF.git"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${1:-$ROOT/.build/stirling-core}"
OUT="${2:-$ROOT/provider-packs/stirling-core}"
SRC="$WORK/source"

command -v git >/dev/null || { echo "git is required" >&2; exit 1; }

rm -rf "$WORK"
mkdir -p "$WORK" "$OUT"

echo "Checking out Stirling open core at $PIN..."
git clone --filter=blob:none --no-checkout "$UPSTREAM" "$SRC"
cd "$SRC"
git config core.autocrlf false
git sparse-checkout init --cone
git sparse-checkout set app/core app/common buildSrc gradle frontend/editor/public/samples
git checkout --detach "$PIN"

for path in   app/proprietary app/saas engine   frontend/editor/src/proprietary frontend/editor/src/desktop   frontend/editor/src/saas frontend/editor/src/cloud   frontend/editor/src/prototypes frontend/editor/src/portal   frontend/editor/src/portal-saas
do
  if [[ -e "$path" ]]; then
    echo "Restricted Stirling path was materialized: $path" >&2
    exit 1
  fi
done

PATCH="$ROOT/third_party/stirling-pdf/patches/0001-malenjo-java-effect-alternatives.patch"
[[ -f "$PATCH" ]] || { echo "Reviewed Stirling endpoint patch is missing: $PATCH" >&2; exit 1; }
git apply --check "$PATCH"
git apply "$PATCH"
patch_hash="$(sha256sum "$PATCH" | awk '{print $1}')"

mkdir -p app/proprietary
printf '%s' '// MALENJO core-build stub. No Stirling proprietary source is present.' > app/proprietary/build.gradle

export STIRLING_FLAVOR=core
export DISABLE_ADDITIONAL_FEATURES=true
export ENABLE_SAAS=false

echo "Building backend-only Stirling core JAR..."
./gradlew :stirling-pdf:bootJar -PbuildWithFrontend=false --no-daemon

jar="$(find app/core/build/libs -maxdepth 1 -type f -name '*.jar' -printf '%T@ %p\n' | sort -nr | head -n1 | cut -d' ' -f2-)"
[[ -n "$jar" ]] || { echo "Stirling core build produced no JAR" >&2; exit 1; }
cp "$jar" "$OUT/stirling-pdf.jar"

hash="$(sha256sum "$OUT/stirling-pdf.jar" | awk '{print $1}')"
cat > "$OUT/manifest.json" <<JSON
{
  "schemaVersion": 1,
  "provider": "stirling-open-core",
  "upstream": "Stirling-Tools/Stirling-PDF",
  "upstreamCommit": "$PIN",
  "flavor": "core",
  "restrictedSourceMaterialized": false,
  "jar": "stirling-pdf.jar",
  "sha256": "$hash",
  "patches": [
    {
      "path": "third_party/stirling-pdf/patches/0001-malenjo-java-effect-alternatives.patch",
      "sha256": "$patch_hash"
    }
  ]
}
JSON

echo "Built MALENJO Stirling core pack: $OUT/stirling-pdf.jar"
echo "SHA-256: $hash"
