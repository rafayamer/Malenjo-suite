$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Version = '12.4.2'
$Asset = "qpdf-$Version-msvc64.zip"
$ExpectedSha256 = 'db87077e683630c1217e0e8f9a20a9749d952ab676e881c3689187763a5de25d'
$ReleaseUrl = "https://github.com/qpdf/qpdf/releases/download/v$Version/$Asset"
$Root = Split-Path -Parent $PSScriptRoot
$BuildDir = Join-Path $Root '.build/qpdf'
$Archive = Join-Path $BuildDir $Asset
$ExtractDir = Join-Path $BuildDir 'extract'
$PackDir = Join-Path $Root 'provider-packs/qpdf'
$RuntimeDir = Join-Path $PackDir 'runtime'
$LicenseDir = Join-Path $RuntimeDir 'malenjo-notices'

Remove-Item $BuildDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $RuntimeDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $PackDir 'manifest.json') -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $BuildDir, $ExtractDir, $RuntimeDir | Out-Null

Invoke-WebRequest -Uri $ReleaseUrl -OutFile $Archive -UseBasicParsing
$ActualSha256 = (Get-FileHash -Algorithm SHA256 -Path $Archive).Hash.ToLowerInvariant()
if ($ActualSha256 -ne $ExpectedSha256) {
  throw "qpdf archive checksum mismatch. Expected $ExpectedSha256, got $ActualSha256."
}

Expand-Archive -Path $Archive -DestinationPath $ExtractDir -Force
$Qpdf = Get-ChildItem -Path $ExtractDir -Recurse -File -Filter 'qpdf.exe' | Select-Object -First 1
if (!$Qpdf) { throw 'qpdf.exe was not found in the reviewed archive.' }

# Preserve the full official distribution root so qpdf's adjacent DLLs/data remain intact.
$DistributionRoot = $Qpdf.Directory.Parent.FullName
Copy-Item -Path (Join-Path $DistributionRoot '*') -Destination $RuntimeDir -Recurse -Force

$BundledQpdf = Get-ChildItem -Path $RuntimeDir -Recurse -File -Filter 'qpdf.exe' | Select-Object -First 1
if (!$BundledQpdf) { throw 'Bundled qpdf.exe was not produced.' }

$VersionOutput = (& $BundledQpdf.FullName --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $VersionOutput -notmatch [regex]::Escape($Version)) {
  throw "Unexpected qpdf runtime version: $VersionOutput"
}

New-Item -ItemType Directory -Force -Path $LicenseDir | Out-Null
Copy-Item (Join-Path $Root 'third_party/qpdf/LICENSE.txt') (Join-Path $LicenseDir 'qpdf-LICENSE.txt') -Force
Copy-Item (Join-Path $Root 'third_party/qpdf/NOTICE.md') (Join-Path $LicenseDir 'qpdf-NOTICE.md') -Force
Copy-Item (Join-Path $Root 'third_party/qpdf/DEPENDENCIES.md') (Join-Path $LicenseDir 'DEPENDENCIES.md') -Force
Copy-Item (Join-Path $Root 'third_party/qpdf/deps/libjpeg-turbo-LICENSE.md') (Join-Path $LicenseDir 'libjpeg-turbo-LICENSE.md') -Force
Copy-Item (Join-Path $Root 'third_party/qpdf/deps/libjpeg-turbo-README.ijg') (Join-Path $LicenseDir 'libjpeg-turbo-README.ijg') -Force
Copy-Item (Join-Path $Root 'third_party/qpdf/deps/openssl-LICENSE.txt') (Join-Path $LicenseDir 'openssl-LICENSE.txt') -Force
Copy-Item (Join-Path $Root 'third_party/qpdf/deps/zlib-LICENSE.txt') (Join-Path $LicenseDir 'zlib-LICENSE.txt') -Force

$RelativeExecutable = [IO.Path]::GetRelativePath($RuntimeDir, $BundledQpdf.FullName).Replace('\','/')
$Manifest = [ordered]@{
  schemaVersion = 1
  providerId = 'qpdf'
  componentPack = 'qpdf-windows-x64'
  version = $Version
  upstream = 'https://github.com/qpdf/qpdf'
  release = "v$Version"
  asset = $Asset
  sha256 = $ExpectedSha256
  executable = "runtime/$RelativeExecutable"
  license = 'Apache-2.0'
  redistribution = 'integration-approved-release-gated'
  embeddedDependencies = @(
    @{ id = 'libjpeg-turbo'; version = '3.2.0#1'; license = 'IJG + BSD-3-Clause' },
    @{ id = 'openssl'; version = '3.6.4#1'; license = 'Apache-2.0' },
    @{ id = 'zlib'; version = '1.3.2#2'; license = 'Zlib' }
  )
  releaseGate = 'Capture exact runtime file inventory/SBOM and verify Microsoft Visual C++ runtime files against applicable redistributable terms.'
  architecture = 'windows-x86_64'
  operations = @('repair', 'compress-pdf')
  reviewedAt = '2026-10-06'
}
$Manifest | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $PackDir 'manifest.json') -Encoding UTF8
Write-Host "Built qpdf provider pack $Version at $PackDir"
