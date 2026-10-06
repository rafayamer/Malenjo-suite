$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Version = '5.5.3'
$Installer = 'tesseract-ocr-w64-setup-5.5.3.20260724.exe'
$InstallerSha256 = 'bee9e3434bd94fd65387d9be28cd467a41f61b1275383b55b0f59a1331270ae4'
$InstallerUrl = "https://github.com/tesseract-ocr/tesseract/releases/download/$Version/$Installer"
$TessdataCommit = '87416418657359cb625c412a48b6e1d6d41c29bd'
$EngBlob = 'bbef4675053b5b468cdb477053e28b1c698ba08e'
$OsdBlob = '527457ca8f8fe1fda7c2f88bce3c0e4be12be9d0'

$Root = Split-Path -Parent $PSScriptRoot
$BuildDir = Join-Path $Root '.build/tesseract'
$InstallerPath = Join-Path $BuildDir $Installer
$ExtractDir = Join-Path $BuildDir 'extract'
$PackDir = Join-Path $Root 'provider-packs/tesseract'
$RuntimeDir = Join-Path $PackDir 'runtime'
$TessdataDir = Join-Path $PackDir 'tessdata'
$NoticeDir = Join-Path $PackDir 'notices'

function Get-GitBlobSha([string]$Path) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  $headerText = "blob $($bytes.Length)" + [char]0
  $prefix = [Text.Encoding]::UTF8.GetBytes($headerText)
  $hash = [Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA1)
  try {
    $hash.AppendData($prefix)
    $hash.AppendData($bytes)
    return ([Convert]::ToHexString($hash.GetHashAndReset())).ToLowerInvariant()
  } finally {
    $hash.Dispose()
  }
}

Remove-Item $BuildDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $RuntimeDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $TessdataDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $NoticeDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $PackDir 'manifest.json') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $PackDir 'runtime-inventory.json') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $PackDir 'sbom.cdx.json') -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $BuildDir,$ExtractDir,$RuntimeDir,$TessdataDir,$NoticeDir | Out-Null

Invoke-WebRequest -Uri $InstallerUrl -OutFile $InstallerPath -UseBasicParsing
$actualInstallerHash = (Get-FileHash -Algorithm SHA256 $InstallerPath).Hash.ToLowerInvariant()
if ($actualInstallerHash -ne $InstallerSha256) {
  throw "Tesseract installer checksum mismatch. Expected $InstallerSha256, got $actualInstallerHash."
}

$sevenZip = Get-Command 7z.exe -ErrorAction SilentlyContinue
if (!$sevenZip) { $sevenZip = Get-Command 7z -ErrorAction SilentlyContinue }
if (!$sevenZip) { throw '7-Zip is required to extract the reviewed Tesseract installer without executing it.' }
& $sevenZip.Source x -y "-o$ExtractDir" $InstallerPath | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Unable to extract reviewed Tesseract installer.' }

$tesseract = Get-ChildItem $ExtractDir -Recurse -File -Filter 'tesseract.exe' | Select-Object -First 1
if (!$tesseract) { throw 'Extracted installer did not contain tesseract.exe.' }
Copy-Item (Join-Path $tesseract.Directory.FullName '*') $RuntimeDir -Recurse -Force

$pdfFont = Get-ChildItem $ExtractDir -Recurse -File -Filter 'pdf.ttf' | Select-Object -First 1
if (!$pdfFont) { throw 'Extracted Tesseract installer did not contain pdf.ttf required for PDF output.' }
Copy-Item $pdfFont.FullName (Join-Path $TessdataDir 'pdf.ttf') -Force
foreach($supportDirName in @('configs','tessconfigs')){
  $supportDir = Join-Path $pdfFont.Directory.FullName $supportDirName
  if (!(Test-Path $supportDir)) { throw "Extracted Tesseract installer is missing tessdata/$supportDirName." }
  Copy-Item $supportDir (Join-Path $TessdataDir $supportDirName) -Recurse -Force
}
if (!(Test-Path (Join-Path $TessdataDir 'configs/pdf'))) {
  throw 'Tesseract PDF output config was not staged into the offline tessdata pack.'
}

$bundledTesseract = Get-ChildItem $RuntimeDir -Recurse -File -Filter 'tesseract.exe' | Select-Object -First 1
if (!$bundledTesseract) { throw 'Tesseract runtime executable was not produced.' }
$versionOutput = (& $bundledTesseract.FullName --version 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch 'tesseract v?5\.5\.3') {
  throw "Unexpected Tesseract runtime version: $versionOutput"
}

$models = @(
  @{ name='eng.traineddata'; blob=$EngBlob },
  @{ name='osd.traineddata'; blob=$OsdBlob }
)
foreach($model in $models){
  $url = "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/$TessdataCommit/$($model.name)"
  $destination = Join-Path $TessdataDir $model.name
  Invoke-WebRequest -Uri $url -OutFile $destination -UseBasicParsing
  $actualBlob = Get-GitBlobSha $destination
  if ($actualBlob -ne $model.blob) {
    throw "Tessdata blob mismatch for $($model.name). Expected $($model.blob), got $actualBlob."
  }
}

Copy-Item (Join-Path $Root 'third_party/tesseract/LICENSE.txt') (Join-Path $NoticeDir 'tesseract-LICENSE.txt') -Force
Copy-Item (Join-Path $Root 'third_party/tesseract/TESSDATA_LICENSE.txt') (Join-Path $NoticeDir 'tessdata-fast-LICENSE.txt') -Force
Copy-Item (Join-Path $Root 'third_party/tesseract/PROVENANCE.md') (Join-Path $NoticeDir 'PROVENANCE.md') -Force

$inventory = Get-ChildItem $RuntimeDir,$TessdataDir -Recurse -File | ForEach-Object {
  [ordered]@{
    path = [IO.Path]::GetRelativePath($PackDir,$_.FullName).Replace('\','/')
    size = $_.Length
    sha256 = (Get-FileHash -Algorithm SHA256 $_.FullName).Hash.ToLowerInvariant()
  }
}
$inventory | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $PackDir 'runtime-inventory.json') -Encoding UTF8

$relativeExe = [IO.Path]::GetRelativePath($PackDir,$bundledTesseract.FullName).Replace('\','/')
$manifest = [ordered]@{
  schemaVersion = 1
  providerId = 'tesseract'
  componentPack = 'tesseract-windows-x64'
  version = $Version
  upstream = 'https://github.com/tesseract-ocr/tesseract'
  sourceAsset = $Installer
  sourceSha256 = $InstallerSha256
  executable = $relativeExe
  tessdataCommit = $TessdataCommit
  models = @(
    @{name='eng';file='tessdata/eng.traineddata';gitBlob=$EngBlob},
    @{name='osd';file='tessdata/osd.traineddata';gitBlob=$OsdBlob}
  )
  license = 'Apache-2.0'
  redistribution = 'integration-approved-release-gated'
  architecture = 'windows-x86_64'
  operations = @('ocr-pdf','auto-rotate-pdf')
  reviewedAt = '2026-10-06'
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $PackDir 'manifest.json') -Encoding UTF8

$sbom = [ordered]@{
  bomFormat='CycloneDX'
  specVersion='1.5'
  version=1
  metadata=@{component=@{type='application';name='MALENJO Tesseract OCR provider pack';version=$Version}}
  components=@(
    @{type='application';name='tesseract';version=$Version;licenses=@(@{license=@{id='Apache-2.0'}});purl="pkg:github/tesseract-ocr/tesseract@$Version"},
    @{type='data';name='tessdata_fast-eng';version=$TessdataCommit;licenses=@(@{license=@{id='Apache-2.0'}})},
    @{type='data';name='tessdata_fast-osd';version=$TessdataCommit;licenses=@(@{license=@{id='Apache-2.0'}})}
  )
}
$sbom | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $PackDir 'sbom.cdx.json') -Encoding UTF8

Write-Host "Built Tesseract OCR provider pack $Version at $PackDir"
