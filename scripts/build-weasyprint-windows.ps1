$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Version = '70.0'
$ReleaseCommit = '4d3b7b6449e3494f59c7c2f36b512d129225679c'
$Asset = 'weasyprint-windows-onedir.zip'
$ExpectedSha256 = 'ab1151f210b4e6bb7aa7a79e91a67e8ddb760094c107bfda55241b6aaefe7d53'
$ReleaseUrl = "https://github.com/Kozea/WeasyPrint/releases/download/v$Version/$Asset"

$Root = Split-Path -Parent $PSScriptRoot
$BuildDir = Join-Path $Root '.build/weasyprint'
$Archive = Join-Path $BuildDir $Asset
$ExtractDir = Join-Path $BuildDir 'extract'
$PackDir = Join-Path $Root 'provider-packs/weasyprint'
$RuntimeDir = Join-Path $PackDir 'runtime'
$RuntimeBin = Join-Path $RuntimeDir 'bin'
$LicenseDir = Join-Path $RuntimeDir 'malenjo-notices'

Remove-Item $BuildDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $RuntimeDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $PackDir 'manifest.json') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $PackDir 'inventory.json') -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $BuildDir, $ExtractDir, $RuntimeBin, $LicenseDir | Out-Null

Invoke-WebRequest -Uri $ReleaseUrl -OutFile $Archive -UseBasicParsing
$ActualSha256 = (Get-FileHash -Algorithm SHA256 -Path $Archive).Hash.ToLowerInvariant()
if ($ActualSha256 -ne $ExpectedSha256) {
  throw "WeasyPrint archive checksum mismatch. Expected $ExpectedSha256, got $ActualSha256."
}

Expand-Archive -Path $Archive -DestinationPath $ExtractDir -Force
$Executable = Get-ChildItem -Path $ExtractDir -Recurse -File -Filter 'weasyprint.exe' | Select-Object -First 1
if (!$Executable) { throw 'weasyprint.exe was not found in the reviewed onedir archive.' }

Copy-Item -Path (Join-Path $Executable.Directory.FullName '*') -Destination $RuntimeBin -Recurse -Force
$BundledExecutable = Join-Path $RuntimeBin 'weasyprint.exe'
if (!(Test-Path $BundledExecutable)) { throw 'Bundled weasyprint.exe was not produced.' }

$Info = (& $BundledExecutable --info 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $Info -notmatch 'WeasyPrint\s+version\s+70\.0|WeasyPrint\s+70\.0|Version:\s*70\.0') {
  throw "Unexpected WeasyPrint runtime identity: $Info"
}

Copy-Item (Join-Path $Root 'third_party/weasyprint/LICENSE.txt') (Join-Path $LicenseDir 'weasyprint-LICENSE.txt') -Force
Copy-Item (Join-Path $Root 'third_party/weasyprint/PROVENANCE.md') (Join-Path $LicenseDir 'PROVENANCE.md') -Force

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

$NativeFiles = @(
  Get-ChildItem -Path $RuntimeDir -Recurse -File |
    Where-Object { $_.Extension -match '(?i)^\.(dll|pyd|exe)$' } |
    Sort-Object FullName |
    ForEach-Object {
      $versionInfo = $_.VersionInfo
      [ordered]@{
        path = [IO.Path]::GetRelativePath($RuntimeDir, $_.FullName).Replace('\','/')
        size = $_.Length
        sha256 = (Get-FileHash -Algorithm SHA256 -Path $_.FullName).Hash.ToLowerInvariant()
        fileVersion = $versionInfo.FileVersion
        productVersion = $versionInfo.ProductVersion
        productName = $versionInfo.ProductName
        companyName = $versionInfo.CompanyName
      }
    }
)

$PythonPackages = @(
  Get-ChildItem -Path $RuntimeBin -Recurse -File -Filter 'METADATA' |
    Where-Object { $_.Directory.Name -match '(?i)\.dist-info$' } |
    Sort-Object FullName |
    ForEach-Object {
      $lines = Get-Content $_.FullName
      $nameLine = $lines | Where-Object { $_ -match '^Name:\s+' } | Select-Object -First 1
      $versionLine = $lines | Where-Object { $_ -match '^Version:\s+' } | Select-Object -First 1
      $licenseExpressionLine = $lines | Where-Object { $_ -match '^License-Expression:\s+' } | Select-Object -First 1
      $licenseLine = $lines | Where-Object { $_ -match '^License:\s+' } | Select-Object -First 1
      $name = if ($null -eq $nameLine) { '' } else { ($nameLine -replace '^Name:\s+','').Trim() }
      $version = if ($null -eq $versionLine) { '' } else { ($versionLine -replace '^Version:\s+','').Trim() }
      $licenseExpression = if ($null -eq $licenseExpressionLine) { '' } else { ($licenseExpressionLine -replace '^License-Expression:\s+','').Trim() }
      $license = if ($null -eq $licenseLine) { '' } else { ($licenseLine -replace '^License:\s+','').Trim() }
      $licenseClassifiers = @(
        $lines |
          Where-Object { $_ -match '^Classifier:\s+License\s+::\s+' } |
          ForEach-Object { ($_ -replace '^Classifier:\s+','').Trim() }
      )
      [ordered]@{
        name = $name
        version = $version
        licenseExpression = $licenseExpression
        license = $license
        licenseClassifiers = $licenseClassifiers
        metadataPath = [IO.Path]::GetRelativePath($RuntimeDir, $_.FullName).Replace('\','/')
        metadataSha256 = (Get-FileHash -Algorithm SHA256 -Path $_.FullName).Hash.ToLowerInvariant()
      }
    }
)

$Inventory = [ordered]@{
  schemaVersion = 1
  providerId = 'weasyprint'
  version = $Version
  releaseCommit = $ReleaseCommit
  sourceAsset = $Asset
  sourceSha256 = $ExpectedSha256
  executable = 'runtime/bin/weasyprint.exe'
  runtimeFiles = $RuntimeFiles
  nativeFiles = $NativeFiles
  pythonPackages = $PythonPackages
}
$Inventory | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $PackDir 'inventory.json') -Encoding UTF8

$Manifest = [ordered]@{
  schemaVersion = 1
  providerId = 'weasyprint'
  componentPack = 'weasyprint-windows-x64'
  version = $Version
  upstream = 'https://github.com/Kozea/WeasyPrint'
  release = "v$Version"
  releaseCommit = $ReleaseCommit
  asset = $Asset
  sha256 = $ExpectedSha256
  executable = 'runtime/bin/weasyprint.exe'
  license = 'BSD-3-Clause'
  architecture = 'windows-x86_64'
  redistribution = 'inventory-only-not-approved'
  capabilityEnabled = $false
  operations = @('html-to-pdf', 'url-to-pdf', 'eml-to-pdf')
  releaseGate = 'Map every bundled Python/native runtime file and every non-system DLL to an exact package/version/license, retain required notices/source obligations, then add native runtime verification before enabling capability.'
  runtimeFileCount = $RuntimeFiles.Count
  nativeFileCount = $NativeFiles.Count
  pythonPackageCount = $PythonPackages.Count
  reviewedAt = '2026-10-07'
}
$Manifest | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $PackDir 'manifest.json') -Encoding UTF8

Write-Host 'WEASYPRINT_INVENTORY_BEGIN'
foreach ($file in $NativeFiles) {
  Write-Host ("WEASY_NATIVE|{0}|{1}|{2}|{3}|{4}|{5}|{6}" -f $file.path,$file.size,$file.sha256,$file.fileVersion,$file.productVersion,$file.productName,$file.companyName)
}
Write-Host 'WEASYPRINT_INVENTORY_END'

Write-Host 'WEASYPRINT_PYTHON_PACKAGES_BEGIN'
foreach ($package in $PythonPackages) {
  Write-Host ("WEASY_PYTHON|{0}|{1}|{2}|{3}" -f $package.name,$package.version,$package.licenseExpression,$package.license)
}
Write-Host 'WEASYPRINT_PYTHON_PACKAGES_END'

Write-Host "Inventoried WeasyPrint $Version runtime: $($RuntimeFiles.Count) total files, $($NativeFiles.Count) native/executable files, $($PythonPackages.Count) Python package metadata entries. Capability remains disabled."
