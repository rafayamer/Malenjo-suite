param(
  [string]$WorkRoot = ".build/stirling-core",
  [string]$OutputDir = "provider-packs/stirling-core"
)

$ErrorActionPreference = "Stop"
$Pin = "25220cbdbde2d526cebf173b94357884e180b8c1"
$Upstream = "https://github.com/Stirling-Tools/Stirling-PDF.git"

function Assert-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' is not available."
  }
}

Assert-Command "git"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$work = Join-Path $repoRoot $WorkRoot
$src = Join-Path $work "source"
$out = Join-Path $repoRoot $OutputDir

if (Test-Path $work) { Remove-Item -Recurse -Force $work }
New-Item -ItemType Directory -Force -Path $work | Out-Null
New-Item -ItemType Directory -Force -Path $out | Out-Null

Write-Host "Checking out Stirling open core at $Pin..."
git clone --filter=blob:none --no-checkout $Upstream $src
Push-Location $src
try {
  git config core.autocrlf false
  git sparse-checkout init --cone
  git sparse-checkout set app/core app/common buildSrc gradle frontend/editor/public/samples
  git checkout --detach $Pin

  $forbidden = @(
    "app/proprietary",
    "app/saas",
    "engine",
    "frontend/editor/src/proprietary",
    "frontend/editor/src/desktop",
    "frontend/editor/src/saas",
    "frontend/editor/src/cloud",
    "frontend/editor/src/prototypes",
    "frontend/editor/src/portal",
    "frontend/editor/src/portal-saas"
  )
  foreach ($path in $forbidden) {
    if (Test-Path $path) {
      throw "Restricted Stirling path was materialized by sparse checkout: $path"
    }
  }

  $patchPath = Join-Path $repoRoot "third_party/stirling-pdf/patches/0001-malenjo-java-effect-alternatives.patch"
  if (!(Test-Path $patchPath)) { throw "Reviewed Stirling endpoint patch is missing: $patchPath" }
  & git apply --check $patchPath
  if ($LASTEXITCODE -ne 0) { throw "Reviewed Stirling endpoint patch no longer applies cleanly to $Pin." }
  & git apply $patchPath
  if ($LASTEXITCODE -ne 0) { throw "Unable to apply reviewed Stirling endpoint patch." }
  $patchHash = (Get-FileHash -Algorithm SHA256 $patchPath).Hash.ToLowerInvariant()

  # settings.gradle always declares :proprietary even in core flavor. Provide an
  # empty MALENJO-owned stub project so Gradle can configure the graph without
  # checking out Stirling's restricted app/proprietary source.
  New-Item -ItemType Directory -Force -Path "app/proprietary" | Out-Null
  Set-Content -NoNewline -Path "app/proprietary/build.gradle" -Value "// MALENJO core-build stub. No Stirling proprietary source is present."

  $env:STIRLING_FLAVOR = "core"
  $env:DISABLE_ADDITIONAL_FEATURES = "true"
  $env:ENABLE_SAAS = "false"

  Write-Host "Building backend-only Stirling core JAR..."
  .\gradlew.bat :stirling-pdf:bootJar -PbuildWithFrontend=false --no-daemon

  $jar = Get-ChildItem "app/core/build/libs/*.jar" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $jar) { throw "Stirling core build produced no JAR." }

  $destination = Join-Path $out "stirling-pdf.jar"
  Copy-Item $jar.FullName $destination -Force

  $hash = (Get-FileHash -Algorithm SHA256 $destination).Hash.ToLowerInvariant()
  $manifest = [ordered]@{
    schemaVersion = 1
    provider = "stirling-open-core"
    upstream = "Stirling-Tools/Stirling-PDF"
    upstreamCommit = $Pin
    flavor = "core"
    restrictedSourceMaterialized = $false
    jar = "stirling-pdf.jar"
    sha256 = $hash
    patches = @(
      [ordered]@{
        path = "third_party/stirling-pdf/patches/0001-malenjo-java-effect-alternatives.patch"
        sha256 = $patchHash
      }
    )
    builtAt = [DateTime]::UtcNow.ToString("o")
  } | ConvertTo-Json -Depth 4
  Set-Content -Path (Join-Path $out "manifest.json") -Value $manifest -Encoding UTF8

  Write-Host "Built MALENJO Stirling core pack: $destination"
  Write-Host "SHA-256: $hash"
} finally {
  Pop-Location
}
