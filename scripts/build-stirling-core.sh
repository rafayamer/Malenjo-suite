#!/usr/bin/env bash
set -euo pipefail

PIN="25220cbdbde2d526cebf173b94357884e180b8c1"
UPSTREAM="https://github.com/Stirling-Tools/Stirling-PDF.git"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${1:-$ROOT/.build/stirling-core}"
OUT="${2:-$ROOT/provider-packs/stirling-core}"
SRC="$WORK/source"

command -v git >/dev/null || { echo "git is required" >&2; exit 1; }
command -v jar >/dev/null || { echo "jar is required" >&2; exit 1; }

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

effects_patch="$ROOT/third_party/stirling-pdf/patches/0001-malenjo-java-effect-alternatives.patch"
license_patch="$ROOT/third_party/stirling-pdf/patches/0002-malenjo-core-license-overrides.patch"
for patch in "$effects_patch" "$license_patch"; do
  [[ -f "$patch" ]] || { echo "Reviewed Stirling patch is missing: $patch" >&2; exit 1; }
  git apply --check "$patch"
  git apply "$patch"
done
effects_patch_hash="$(sha256sum "$effects_patch" | awk '{print $1}')"
license_patch_hash="$(sha256sum "$license_patch" | awk '{print $1}')"

mkdir -p app/proprietary
printf '%s' '// MALENJO core-build stub. No Stirling proprietary source is present.' > app/proprietary/build.gradle

export STIRLING_FLAVOR=core
export DISABLE_ADDITIONAL_FEATURES=true
export ENABLE_SAAS=false

echo "Checking pinned Stirling runtime dependency licenses..."
./gradlew checkLicense generateLicenseReport --no-parallel --no-daemon
license_report="$SRC/build/reports/dependency-license/index.json"
[[ -f "$license_report" ]] || { echo "Stirling dependency license report was not generated" >&2; exit 1; }
if [[ -n "$(git status --porcelain -- app/license-overrides.json)" ]]; then
  echo "Stirling dependency license resolution changed app/license-overrides.json; review the new metadata before packaging." >&2
  exit 1
fi

echo "Building backend-only Stirling core JAR..."
./gradlew :stirling-pdf:bootJar -PbuildWithFrontend=false --no-daemon

jar="$(find app/core/build/libs -maxdepth 1 -type f -name '*.jar' -printf '%T@ %p\n' | sort -nr | head -n1 | cut -d' ' -f2-)"
[[ -n "$jar" ]] || { echo "Stirling core build produced no JAR" >&2; exit 1; }
cp "$jar" "$OUT/stirling-pdf.jar"

hash="$(sha256sum "$OUT/stirling-pdf.jar" | awk '{print $1}')"

office_version="0.2.2"
office_commit="673aab8d6ac784524cd1d90141c95e74b9fd26ae"
office_core="stirling-office-convert-$office_version.jar"
office_legacy="stirling-office-convert-legacy-$office_version.jar"
office_topdf="stirling-office-convert-topdf-$office_version.jar"
for office_name in "$office_core" "$office_legacy" "$office_topdf"; do
  jar tf "$OUT/stirling-pdf.jar" | grep -Fxq "BOOT-INF/lib/$office_name" || {
    echo "Stirling core JAR is missing embedded BOOT-INF/lib/$office_name" >&2
    exit 1
  }
done

embedded="$WORK/embedded-office"
rm -rf "$embedded"
mkdir -p "$embedded"
(
  cd "$embedded"
  jar xf "$OUT/stirling-pdf.jar" "BOOT-INF/lib/$office_core" "BOOT-INF/lib/$office_legacy" "BOOT-INF/lib/$office_topdf"
)
office_core_hash="$(sha256sum "$embedded/BOOT-INF/lib/$office_core" | awk '{print $1}')"
office_legacy_hash="$(sha256sum "$embedded/BOOT-INF/lib/$office_legacy" | awk '{print $1}')"
office_topdf_hash="$(sha256sum "$embedded/BOOT-INF/lib/$office_topdf" | awk '{print $1}')"

notice_dir="$OUT/malenjo-notices"
mkdir -p "$notice_dir"
cp "$ROOT/third_party/stirling-pdf/LICENSE" "$notice_dir/stirling-pdf-LICENSE.txt"
cp "$ROOT/third_party/stirling-office-convert/LICENSE.txt" "$notice_dir/stirling-office-convert-LICENSE.txt"
cp "$ROOT/third_party/stirling-office-convert/DEPENDENCIES.md" "$notice_dir/stirling-office-convert-DEPENDENCIES.md"
cp "$license_report" "$notice_dir/stirling-dependency-licenses.json"

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
      "sha256": "$effects_patch_hash"
    },
    {
      "path": "third_party/stirling-pdf/patches/0002-malenjo-core-license-overrides.patch",
      "sha256": "$license_patch_hash"
    }
  ],
  "embeddedOfficeConvert": {
    "version": "$office_version",
    "upstream": "Stirling-Tools/Stirling-Office-Convert",
    "sourceCommit": "$office_commit",
    "license": "MIT",
    "jars": {
      "$office_core": "$office_core_hash",
      "$office_legacy": "$office_legacy_hash",
      "$office_topdf": "$office_topdf_hash"
    }
  },
  "dependencyLicenseReport": "malenjo-notices/stirling-dependency-licenses.json"
}
JSON

echo "Built MALENJO Stirling core pack: $OUT/stirling-pdf.jar"
echo "SHA-256: $hash"
