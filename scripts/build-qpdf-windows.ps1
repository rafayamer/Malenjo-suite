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
$BinDir = Join-Path $PackDir 'bin'

Remove-Item $BuildDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $PackDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $BuildDir, $ExtractDir, $BinDir | Out-Null

Invoke-WebRequest -Uri $ReleaseUrl -OutFile $Archive -UseBasicParsing
$ActualSha256 = (Get-FileHash -Algorithm SHA256 -Path $Archive).Hash.ToLowerInvariant()
if ($ActualSha256 -ne $ExpectedSha256) {
  throw "qpdf archive checksum mismatch. Expected $ExpectedSha256, got $ActualSha256."
}

Expand-Archive -Path $Archive -DestinationPath $ExtractDir -Force
$Qpdf = Get-ChildItem -Path $ExtractDir -Recurse -File -Filter 'qpdf.exe' | Select-Object -First 1
if (!$Qpdf) { throw 'qpdf.exe was not found in the reviewed archive.' }

Copy-Item -Path (Join-Path $Qpdf.Directory.FullName '*') -Destination $BinDir -Recurse -Force
$BundledQpdf = Join-Path $BinDir 'qpdf.exe'
if (!(Test-Path $BundledQpdf)) { throw 'Bundled qpdf.exe was not produced.' }

$VersionOutput = (& $BundledQpdf --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $VersionOutput -notmatch [regex]::Escape($Version)) {
  throw "Unexpected qpdf runtime version: $VersionOutput"
}

$Manifest = [ordered]@{
  providerId = 'qpdf'
  componentPack = 'qpdf-windows-x64'
  version = $Version
  upstream = 'https://github.com/qpdf/qpdf'
  release = "v$Version"
  asset = $Asset
  sha256 = $ExpectedSha256
  license = 'Apache-2.0'
  redistribution = 'approved-with-notices'
  architecture = 'windows-x86_64'
  operations = @('repair', 'compress-pdf')
  reviewedAt = '2026-10-06'
}
$Manifest | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $PackDir 'manifest.json') -Encoding UTF8
Write-Host "Built qpdf provider pack $Version at $PackDir"
