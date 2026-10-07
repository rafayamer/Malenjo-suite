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
Assert-Command "jar"

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

  $patchRelativePaths = @(
    "third_party/stirling-pdf/patches/0001-malenjo-java-effect-alternatives.patch",
    "third_party/stirling-pdf/patches/0002-malenjo-core-license-overrides.patch"
  )
  $patchRecords = @()
  foreach ($patchRelativePath in $patchRelativePaths) {
    $patchPath = Join-Path $repoRoot $patchRelativePath
    if (!(Test-Path $patchPath)) { throw "Reviewed Stirling patch is missing: $patchPath" }
    & git apply --check $patchPath
    if ($LASTEXITCODE -ne 0) { throw "Reviewed Stirling patch no longer applies cleanly to ${Pin}: $patchRelativePath" }
    & git apply $patchPath
    if ($LASTEXITCODE -ne 0) { throw "Unable to apply reviewed Stirling patch: $patchRelativePath" }
    $patchRecords += [ordered]@{
      path = $patchRelativePath
      sha256 = (Get-FileHash -Algorithm SHA256 $patchPath).Hash.ToLowerInvariant()
    }
  }

  $licenseOverridesPath = Join-Path $src "app/license-overrides.json"
  $licenseOverridesBaselineHash = (Get-FileHash -Algorithm SHA256 $licenseOverridesPath).Hash.ToLowerInvariant()

  # settings.gradle always declares :proprietary even in core flavor. Provide an
  # empty MALENJO-owned stub project so Gradle can configure the graph without
  # checking out Stirling's restricted app/proprietary source.
  New-Item -ItemType Directory -Force -Path "app/proprietary" | Out-Null
  Set-Content -NoNewline -Path "app/proprietary/build.gradle" -Value "// MALENJO core-build stub. No Stirling proprietary source is present."

  $env:STIRLING_FLAVOR = "core"
  $env:DISABLE_ADDITIONAL_FEATURES = "true"
  $env:ENABLE_SAAS = "false"

  Write-Host "Checking pinned Stirling runtime dependency licenses..."
  .\gradlew.bat checkLicense generateLicenseReport --no-parallel --no-daemon
  if ($LASTEXITCODE -ne 0) { throw "Pinned Stirling dependency license gate failed." }
  $licenseReport = Join-Path $src "build/reports/dependency-license/index.json"
  if (!(Test-Path $licenseReport)) { throw "Stirling dependency license report was not generated." }
  $licenseReportPinPath = Join-Path $repoRoot "third_party/stirling-office-convert/DEPENDENCY_LICENSE_REPORT.sha256"
  if (!(Test-Path $licenseReportPinPath)) { throw "Reviewed Stirling dependency-license report pin is missing." }
  $licenseReportPinLine = (Get-Content $licenseReportPinPath | Where-Object { $_ -match '^[0-9a-f]{64}\s+stirling-dependency-licenses\.json$' } | Select-Object -First 1)
  if (-not $licenseReportPinLine) { throw "Reviewed Stirling dependency-license report pin is malformed." }
  $expectedLicenseReportHash = ($licenseReportPinLine -split '\s+')[0]
  $actualLicenseReportHash = (Get-FileHash -Algorithm SHA256 $licenseReport).Hash.ToLowerInvariant()
  if ($actualLicenseReportHash -ne $expectedLicenseReportHash) {
    throw "Generated Stirling dependency-license report differs from the reviewed SHA-256 baseline."
  }
  $licenseOverridesAfterHash = (Get-FileHash -Algorithm SHA256 $licenseOverridesPath).Hash.ToLowerInvariant()
  if ($licenseOverridesAfterHash -ne $licenseOverridesBaselineHash) {
    throw "Stirling dependency license resolution changed the reviewed core-only app/license-overrides.json baseline; review the new metadata before packaging."
  }

  Write-Host "Building backend-only Stirling core JAR..."
  .\gradlew.bat :stirling-pdf:bootJar -PbuildWithFrontend=false --no-daemon

  $jar = Get-ChildItem "app/core/build/libs/*.jar" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $jar) { throw "Stirling core build produced no JAR." }

  $destination = Join-Path $out "stirling-pdf.jar"
  Copy-Item $jar.FullName $destination -Force

  $hash = (Get-FileHash -Algorithm SHA256 $destination).Hash.ToLowerInvariant()

  $officeVersion = "0.2.2"
  $officeCommit = "673aab8d6ac784524cd1d90141c95e74b9fd26ae"
  $officeNames = @(
    "stirling-office-convert-$officeVersion.jar",
    "stirling-office-convert-legacy-$officeVersion.jar",
    "stirling-office-convert-topdf-$officeVersion.jar"
  )
  $jarTool = (Get-Command jar).Source
  $jarEntries = @(& $jarTool tf $destination)
  $embeddedRoot = Join-Path $work "embedded-office"
  New-Item -ItemType Directory -Force -Path $embeddedRoot | Out-Null
  $officeHashes = [ordered]@{}
  Push-Location $embeddedRoot
  try {
    foreach ($officeName in $officeNames) {
      $entry = "BOOT-INF/lib/$officeName"
      if ($jarEntries -notcontains $entry) { throw "Stirling core JAR is missing embedded $entry." }
      & $jarTool xf $destination $entry
      if ($LASTEXITCODE -ne 0) { throw "Unable to extract embedded Office Convert component $officeName." }
      $embeddedPath = Join-Path $embeddedRoot $entry
      $officeHashes[$officeName] = (Get-FileHash -Algorithm SHA256 $embeddedPath).Hash.ToLowerInvariant()
    }
  } finally {
    Pop-Location
  }

  $artifactPinsPath = Join-Path $repoRoot "third_party/stirling-office-convert/ARTIFACTS.sha256"
  if (!(Test-Path $artifactPinsPath)) { throw "Reviewed Office artifact hash pins are missing." }
  $artifactPins = @{}
  foreach ($line in Get-Content $artifactPinsPath) {
    if ($line -match '^([0-9a-f]{64})\s+(.+)$') {
      $artifactPins[$Matches[2].Trim()] = $Matches[1]
    }
  }
  foreach ($officeName in $officeNames) {
    $expectedHash = $artifactPins[$officeName]
    if (-not $expectedHash) { throw "No reviewed SHA-256 pin exists for $officeName." }
    if ($officeHashes[$officeName] -ne $expectedHash) {
      throw "Embedded Office artifact $officeName does not match its reviewed published SHA-256 pin."
    }
  }

  $noticeDir = Join-Path $out "malenjo-notices"
  New-Item -ItemType Directory -Force -Path $noticeDir | Out-Null
  Copy-Item (Join-Path $repoRoot "third_party/stirling-pdf/LICENSE") (Join-Path $noticeDir "stirling-pdf-LICENSE.txt") -Force
  Copy-Item (Join-Path $repoRoot "third_party/stirling-office-convert/LICENSE.txt") (Join-Path $noticeDir "stirling-office-convert-LICENSE.txt") -Force
  Copy-Item (Join-Path $repoRoot "third_party/stirling-office-convert/DEPENDENCIES.md") (Join-Path $noticeDir "stirling-office-convert-DEPENDENCIES.md") -Force
  Copy-Item $licenseReport (Join-Path $noticeDir "stirling-dependency-licenses.json") -Force

  $licenseArtifacts = [ordered]@{}
  foreach ($licenseRelativePath in @(
    "malenjo-notices/stirling-office-convert-LICENSE.txt",
    "malenjo-notices/stirling-office-convert-DEPENDENCIES.md",
    "malenjo-notices/stirling-dependency-licenses.json"
  )) {
    $licenseArtifacts[$licenseRelativePath] = (Get-FileHash -Algorithm SHA256 (Join-Path $out $licenseRelativePath)).Hash.ToLowerInvariant()
  }

  $manifest = [ordered]@{
    schemaVersion = 1
    provider = "stirling-open-core"
    upstream = "Stirling-Tools/Stirling-PDF"
    upstreamCommit = $Pin
    flavor = "core"
    restrictedSourceMaterialized = $false
    jar = "stirling-pdf.jar"
    sha256 = $hash
    patches = $patchRecords
    embeddedOfficeConvert = [ordered]@{
      version = $officeVersion
      upstream = "Stirling-Tools/Stirling-Office-Convert"
      sourceCommit = $officeCommit
      license = "MIT"
      verification = "pinned-published-sha256"
      jars = $officeHashes
    }
    dependencyLicenseReport = "malenjo-notices/stirling-dependency-licenses.json"
    licenseArtifacts = $licenseArtifacts
    builtAt = [DateTime]::UtcNow.ToString("o")
  } | ConvertTo-Json -Depth 6
  $manifestPath = Join-Path $out "manifest.json"
  [System.IO.File]::WriteAllText($manifestPath, $manifest, (New-Object System.Text.UTF8Encoding($false)))
  $dependencyLicenseHash = (Get-FileHash -Algorithm SHA256 (Join-Path $out "malenjo-notices/stirling-dependency-licenses.json")).Hash.ToLowerInvariant()
  if ($dependencyLicenseHash -ne $expectedLicenseReportHash) {
    throw "Packaged Stirling dependency-license report differs from the reviewed SHA-256 baseline."
  }
  Write-Host "Dependency-license report SHA-256: $dependencyLicenseHash"

  Write-Host "Built MALENJO Stirling core pack: $destination"
  Write-Host "SHA-256: $hash"
} finally {
  Pop-Location
}
