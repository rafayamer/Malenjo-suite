param(
  [string]$OutputDir = "provider-packs/qpdf"
)

$ErrorActionPreference = "Stop"
$Version = "12.4.2"
$Asset = "qpdf-$Version-msvc64.zip"
$Url = "https://github.com/qpdf/qpdf/releases/download/v$Version/$Asset"
$ExpectedSha256 = "db87077e683630c1217e0e8f9a20a9749d952ab676e881c3689187763a5de25d"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$out = Join-Path $repoRoot $OutputDir
$runtime = Join-Path $out "runtime"
$tempRoot = Join-Path $repoRoot ".build/qpdf"
$archive = Join-Path $tempRoot $Asset
$extract = Join-Path $tempRoot "extract"

if (Test-Path $tempRoot) { Remove-Item -Recurse -Force $tempRoot }
if (Test-Path $runtime) { Remove-Item -Recurse -Force $runtime }
New-Item -ItemType Directory -Force -Path $tempRoot, $extract, $runtime | Out-Null

Write-Host "Downloading qpdf $Version from official GitHub release..."
Invoke-WebRequest -Uri $Url -OutFile $archive -UseBasicParsing

$actual = (Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant()
if ($actual -ne $ExpectedSha256) {
  throw "qpdf archive hash mismatch. Expected $ExpectedSha256, got $actual"
}

Expand-Archive -Path $archive -DestinationPath $extract -Force
$qpdf = Get-ChildItem $extract -Recurse -File -Filter "qpdf.exe" | Select-Object -First 1
if (-not $qpdf) { throw "Official qpdf archive did not contain qpdf.exe" }

# Preserve the entire binary distribution root so adjacent DLLs/notices remain available.
$distributionRoot = $qpdf.Directory.Parent.FullName
Copy-Item (Join-Path $distributionRoot "*") $runtime -Recurse -Force

$installed = Get-ChildItem $runtime -Recurse -File -Filter "qpdf.exe" | Select-Object -First 1
if (-not $installed) { throw "qpdf.exe was not installed into the provider pack" }

$versionOutput = & $installed.FullName --version
if ($LASTEXITCODE -ne 0 -or ($versionOutput -join " ") -notmatch "qpdf version 12\.4\.2") {
  throw "Installed qpdf executable failed version verification: $($versionOutput -join ' ')"
}

$manifest = [ordered]@{
  schemaVersion = 1
  provider = "qpdf"
  version = $Version
  upstream = "qpdf/qpdf"
  sourceAsset = $Asset
  sourceSha256 = $ExpectedSha256
  executable = $installed.FullName.Substring($runtime.Length).TrimStart("\","/")
  license = "Apache-2.0"
  installedAt = [DateTime]::UtcNow.ToString("o")
} | ConvertTo-Json -Depth 4
Set-Content -Path (Join-Path $out "manifest.json") -Value $manifest -Encoding UTF8

Write-Host "Installed qpdf provider pack: $($installed.FullName)"
Write-Host ($versionOutput -join " ")
