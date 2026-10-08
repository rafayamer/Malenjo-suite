# Review-gated portable Java runtime for MALENJO's offline Stirling core.
# Pin the official Temurin Windows x64 ZIP; do not rely on a user's JAVA_HOME.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Version = '25.0.4.1+1'
$Asset = 'OpenJDK25U-jdk_x64_windows_hotspot_25.0.4.1_1.zip'
$ExpectedSha256 = '00c847d804f4a78e9f04f2683faf14fed898535b177b7fc704486cb0284e9283'
$ReleaseUrl = "https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.4.1%2B1/$Asset"
$Root = Split-Path -Parent $PSScriptRoot
$WorkDir = Join-Path $Root '.build/temurin'
$ExtractDir = Join-Path $WorkDir 'extracted'
$Archive = Join-Path $WorkDir $Asset
$Runtime = Join-Path $Root 'runtime/java'

Remove-Item $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
# Preserve the tracked resource directory marker in developer checkouts.
if (Test-Path $Runtime) {
  Get-ChildItem $Runtime -Force |
    Where-Object { $_.Name -ne 'README.md' } |
    Remove-Item -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $WorkDir, $ExtractDir, $Runtime | Out-Null

Invoke-WebRequest -Uri $ReleaseUrl -OutFile $Archive -UseBasicParsing
$ActualSha256 = (Get-FileHash -Path $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ActualSha256 -ne $ExpectedSha256) {
  throw "Temurin JDK archive SHA-256 mismatch; refusing to bundle unreviewed Java binaries."
}

Expand-Archive -Path $Archive -DestinationPath $ExtractDir -Force
$Candidates = @(Get-ChildItem -Path $ExtractDir -Recurse -File -Filter 'java.exe')
if ($Candidates.Count -ne 1) { throw 'Unexpected Temurin archive structure: expected exactly one java.exe.' }
$JdkRoot = $Candidates[0].Directory.Parent.FullName
$ReleaseFile = Join-Path $JdkRoot 'release'
$LegalDir = Join-Path $JdkRoot 'legal'
if (!(Test-Path $ReleaseFile) -or !(Test-Path $LegalDir)) {
  throw 'Temurin source metadata or legal notices are missing from the official archive.'
}
$ReleaseText = [IO.File]::ReadAllText($ReleaseFile)
if ($ReleaseText -notmatch '(?m)^JAVA_VERSION="25\.0\.4\.1"' -or
    $ReleaseText -notmatch '(?m)^IMPLEMENTOR="Eclipse Adoptium"') {
  throw 'The Temurin runtime release metadata does not match the reviewed version/vendor.'
}
if (!(Test-Path (Join-Path $LegalDir 'java.base/LICENSE'))) {
  throw 'OpenJDK GPL/ClassPath legal notice missing; refusing distribution.'
}

# Copy the complete reviewed portable distribution. We intentionally keep
# all modules and vendor-supplied /legal notices until feature coverage proves
# a smaller jlink image is safe for every Stirling route.
Copy-Item -Path (Join-Path $JdkRoot '*') -Destination $Runtime -Recurse -Force

$BundledJava = Join-Path $Runtime 'bin/java.exe'
if (!(Test-Path $BundledJava)) { throw 'Offline Java runtime was not bundled.' }
$VersionText = (& $BundledJava -version 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0 -or $VersionText -notmatch '25\.0\.4\.1' -or
    $VersionText -notmatch 'Temurin') {
  throw "The portable Temurin runtime failed its Java 25 smoke test: $VersionText"
}

$Manifest = [ordered]@{
  schemaVersion = 1
  component = 'temurin-windows-x64'
  version = $Version
  vendor = 'Eclipse Adoptium'
  upstream = 'adoptium/temurin25-binaries'
  asset = $Asset
  upstreamUrl = $ReleaseUrl
  archiveSha256 = $ExpectedSha256
  runtimeExecutable = 'bin/java.exe'
  executableSha256 = (Get-FileHash -Path $BundledJava -Algorithm SHA256).Hash.ToLowerInvariant()
  license = 'GPL-2.0-with-Classpath-exception'
  redistributable = 'release-gated-retain-vendor-legal-notices'
  legalDirectory = 'legal'
  createdAtUtc = [DateTime]::UtcNow.ToString('o')
}
[IO.File]::WriteAllText(
  (Join-Path $Runtime 'malenjo-runtime-manifest.json'),
  ($Manifest | ConvertTo-Json -Depth 5),
  (New-Object System.Text.UTF8Encoding($false))
)
Write-Host "Built verified MALENJO offline Java runtime at $Runtime"
Write-Host "Official Temurin $Version archive SHA-256: $ExpectedSha256"
