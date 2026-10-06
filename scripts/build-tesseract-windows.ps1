$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Version = '5.5.3'
$ReleaseCommit = 'db0ec62f81b0737fbbe184d8fea40af5738f8eef'
$Asset = 'tesseract-ocr-w64-setup-5.5.3.20260724.exe'
$ExpectedInstallerSha256 = 'bee9e3434bd94fd65387d9be28cd467a41f61b1275383b55b0f59a1331270ae4'
$ReleaseUrl = "https://github.com/tesseract-ocr/tesseract/releases/download/$Version/$Asset"

$TessdataCommit = '65727574dfcd264acbb0c3e07860e4e9e9b22185'
$EngBlob = 'bbef4675053b5b468cdb477053e28b1c698ba08e'
$OsdBlob = '527457ca8f8fe1fda7c2f88bce3c0e4be12be9d0'
$EngSize = 4113088
$OsdSize = 10562727

$Root = Split-Path -Parent $PSScriptRoot
$BuildDir = Join-Path $Root '.build/tesseract'
$Installer = Join-Path $BuildDir $Asset
$ExtractDir = Join-Path $BuildDir 'extract'
$PackDir = Join-Path $Root 'provider-packs/tesseract'
$RuntimeDir = Join-Path $PackDir 'runtime'
$RuntimeBin = Join-Path $RuntimeDir 'bin'
$TessdataDir = Join-Path $RuntimeDir 'tessdata'
$LicenseDir = Join-Path $RuntimeDir 'malenjo-notices'

function Get-GitBlobSha1([string]$Path) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  $header = [Text.Encoding]::ASCII.GetBytes("blob $($bytes.Length)")
  $stream = [IO.MemoryStream]::new()
  try {
    $stream.Write($header, 0, $header.Length)
    $stream.WriteByte(0)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Position = 0
    $sha = [Security.Cryptography.SHA1]::Create()
    try {
      $hash = $sha.ComputeHash($stream)
      return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
    } finally {
      $sha.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Resolve-SevenZip {
  foreach ($name in @('7z.exe', '7z')) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
  }
  foreach ($candidate in @(
    'C:\Program Files\7-Zip\7z.exe',
    'C:\Program Files (x86)\7-Zip\7z.exe'
  )) {
    if (Test-Path $candidate) { return $candidate }
  }
  throw '7-Zip is required to extract the reviewed Tesseract NSIS installer without executing it.'
}

Remove-Item $BuildDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $RuntimeDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $PackDir 'manifest.json') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $PackDir 'sbom.cdx.json') -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $BuildDir, $ExtractDir, $RuntimeBin, $TessdataDir, $LicenseDir | Out-Null

Invoke-WebRequest -Uri $ReleaseUrl -OutFile $Installer -UseBasicParsing
$ActualInstallerSha256 = (Get-FileHash -Algorithm SHA256 -Path $Installer).Hash.ToLowerInvariant()
if ($ActualInstallerSha256 -ne $ExpectedInstallerSha256) {
  throw "Tesseract installer checksum mismatch. Expected $ExpectedInstallerSha256, got $ActualInstallerSha256."
}

$SevenZip = Resolve-SevenZip
& $SevenZip x $Installer "-o$ExtractDir" -y | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "7-Zip failed to extract the reviewed Tesseract installer (exit $LASTEXITCODE)."
}

$Tesseract = Get-ChildItem -Path $ExtractDir -Recurse -File -Filter 'tesseract.exe' | Select-Object -First 1
if (!$Tesseract) { throw 'tesseract.exe was not found in the reviewed installer payload.' }

Copy-Item -Path (Join-Path $Tesseract.Directory.FullName '*') -Destination $RuntimeBin -Recurse -Force

$EmbeddedTessdata = Join-Path $RuntimeBin 'tessdata'
if (Test-Path $EmbeddedTessdata) {
  Copy-Item -Path (Join-Path $EmbeddedTessdata '*') -Destination $TessdataDir -Recurse -Force
  Remove-Item $EmbeddedTessdata -Recurse -Force
}

$EngPath = Join-Path $TessdataDir 'eng.traineddata'
$OsdPath = Join-Path $TessdataDir 'osd.traineddata'
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/$TessdataCommit/eng.traineddata" -OutFile $EngPath -UseBasicParsing
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/$TessdataCommit/osd.traineddata" -OutFile $OsdPath -UseBasicParsing

if ((Get-Item $EngPath).Length -ne $EngSize -or (Get-GitBlobSha1 $EngPath) -ne $EngBlob) {
  throw 'Pinned eng.traineddata failed its immutable Git blob verification.'
}
if ((Get-Item $OsdPath).Length -ne $OsdSize -or (Get-GitBlobSha1 $OsdPath) -ne $OsdBlob) {
  throw 'Pinned osd.traineddata failed its immutable Git blob verification.'
}

$BundledTesseract = Join-Path $RuntimeBin 'tesseract.exe'
if (!(Test-Path $BundledTesseract)) {
  $candidate = Get-ChildItem -Path $RuntimeBin -Recurse -File -Filter 'tesseract.exe' | Select-Object -First 1
  if ($candidate) { $BundledTesseract = $candidate.FullName }
}
if (!(Test-Path $BundledTesseract)) { throw 'Bundled tesseract.exe was not produced.' }

$env:TESSDATA_PREFIX = $TessdataDir
$VersionOutput = (& $BundledTesseract --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $VersionOutput -notmatch 'tesseract\s+v?5\.5\.3(?:\.\d+)?') {
  throw "Unexpected Tesseract runtime version: $VersionOutput"
}
$Languages = (& $BundledTesseract --list-langs 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0 -or $Languages -notmatch '(?m)^eng\s*$' -or $Languages -notmatch '(?m)^osd\s*$') {
  throw "Pinned Tesseract language/model pack failed validation: $Languages"
}

Copy-Item (Join-Path $Root 'third_party/tesseract/LICENSE.txt') (Join-Path $LicenseDir 'tesseract-LICENSE.txt') -Force
Copy-Item (Join-Path $Root 'third_party/tesseract/tessdata-LICENSE.txt') (Join-Path $LicenseDir 'tessdata-LICENSE.txt') -Force
Copy-Item (Join-Path $Root 'third_party/tesseract/DEPENDENCIES.md') (Join-Path $LicenseDir 'DEPENDENCIES.md') -Force

$RuntimeFiles = @(
  Get-ChildItem -Path $RuntimeDir -Recurse -File |
    Sort-Object FullName |
    ForEach-Object {
      [ordered]@{
        path = [IO.Path]::GetRelativePath($RuntimeDir, $_.FullName).Replace('\','/')
        size = $_.Length
        sha256 = (Get-FileHash -Algorithm SHA256 -Path $_.FullName).Hash.ToLowerInvariant()
      }
    }
)

$EngSha256 = (Get-FileHash -Algorithm SHA256 -Path $EngPath).Hash.ToLowerInvariant()
$OsdSha256 = (Get-FileHash -Algorithm SHA256 -Path $OsdPath).Hash.ToLowerInvariant()
$Manifest = [ordered]@{
  schemaVersion = 1
  providerId = 'tesseract'
  componentPack = 'tesseract-windows-x64'
  version = $Version
  upstream = 'https://github.com/tesseract-ocr/tesseract'
  release = $Version
  releaseCommit = $ReleaseCommit
  asset = $Asset
  sha256 = $ExpectedInstallerSha256
  executable = 'runtime/bin/tesseract.exe'
  tessdataDir = 'runtime/tessdata'
  license = 'Apache-2.0'
  redistribution = 'integration-approved-release-gated'
  architecture = 'windows-x86_64'
  operations = @('ocr-pdf', 'auto-rotate-pdf')
  models = @(
    @{ id = 'eng'; sourceCommit = $TessdataCommit; gitBlobSha1 = $EngBlob; sha256 = $EngSha256; license = 'Apache-2.0' },
    @{ id = 'osd'; sourceCommit = $TessdataCommit; gitBlobSha1 = $OsdBlob; sha256 = $OsdSha256; license = 'Apache-2.0' }
  )
  releaseGate = 'Map every inventoried non-system DLL to an exact upstream package/version/license and retain all required notices/source obligations.'
  runtimeFiles = $RuntimeFiles
  reviewedAt = '2026-10-06'
}
$Manifest | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $PackDir 'manifest.json') -Encoding UTF8

$RootRef = "malenjo:tesseract-windows-x64@$Version"
$EngineRef = "pkg:github/tesseract-ocr/tesseract@$Version"
$EngRef = "pkg:github/tesseract-ocr/tessdata_fast@$TessdataCommit?file=eng.traineddata"
$OsdRef = "pkg:github/tesseract-ocr/tessdata_fast@$TessdataCommit?file=osd.traineddata"
$Sbom = [ordered]@{
  bomFormat = 'CycloneDX'
  specVersion = '1.5'
  version = 1
  metadata = [ordered]@{
    component = [ordered]@{
      type = 'application'
      'bom-ref' = $RootRef
      name = 'MALENJO Tesseract Windows provider pack'
      version = $Version
      properties = @(
        @{ name = 'malenjo:sourceAsset'; value = $Asset },
        @{ name = 'malenjo:sourceSha256'; value = $ExpectedInstallerSha256 },
        @{ name = 'malenjo:runtimeFileCount'; value = [string]$RuntimeFiles.Count },
        @{ name = 'malenjo:releaseGate'; value = $Manifest.releaseGate }
      )
    }
  }
  components = @(
    [ordered]@{
      type = 'application'; 'bom-ref' = $EngineRef; name = 'Tesseract OCR'; version = $Version
      licenses = @(@{ license = @{ id = 'Apache-2.0' } })
      hashes = @(@{ alg = 'SHA-256'; content = $ExpectedInstallerSha256 })
    },
    [ordered]@{
      type = 'file'; 'bom-ref' = $EngRef; name = 'eng.traineddata'; version = '4.1.0'
      licenses = @(@{ license = @{ id = 'Apache-2.0' } })
      hashes = @(@{ alg = 'SHA-256'; content = $EngSha256 })
      properties = @(@{ name = 'malenjo:gitBlobSha1'; value = $EngBlob })
    },
    [ordered]@{
      type = 'file'; 'bom-ref' = $OsdRef; name = 'osd.traineddata'; version = '4.1.0'
      licenses = @(@{ license = @{ id = 'Apache-2.0' } })
      hashes = @(@{ alg = 'SHA-256'; content = $OsdSha256 })
      properties = @(@{ name = 'malenjo:gitBlobSha1'; value = $OsdBlob })
    }
  )
  dependencies = @(
    @{ ref = $RootRef; dependsOn = @($EngineRef, $EngRef, $OsdRef) },
    @{ ref = $EngineRef; dependsOn = @() },
    @{ ref = $EngRef; dependsOn = @() },
    @{ ref = $OsdRef; dependsOn = @() }
  )
}
$Sbom | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $PackDir 'sbom.cdx.json') -Encoding UTF8

Write-Host "Built Tesseract provider pack $Version at $PackDir with $($RuntimeFiles.Count) inventoried runtime files."
