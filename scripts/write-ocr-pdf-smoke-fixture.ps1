param(
  [Parameter(Mandatory=$true)]
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$encoding = [System.Text.Encoding]::ASCII
$nl = [Environment]::NewLine

$lines = @(
  'MALENJO OCR PROVIDER SMOKE TEST',
  'This page contains enough repeated English text for optical character recognition.',
  'The quick brown fox jumps over the lazy dog while local providers stay offline.',
  'Windows Tesseract must read this page without contacting a public service.',
  'Provider contracts report implementation version model data and legal status.',
  'Source truth requires immutable language assets and exact runtime inventory.',
  'Local document processing remains inside the MALENJO desktop boundary.',
  'Orientation detection uses the reviewed osd trained data file.',
  'Searchable PDF output must remain structurally valid after OCR processing.',
  'This sentence is repeated to provide a stable amount of text for OSD analysis.',
  'This sentence is repeated to provide a stable amount of text for OSD analysis.',
  'This sentence is repeated to provide a stable amount of text for OSD analysis.',
  'This sentence is repeated to provide a stable amount of text for OSD analysis.'
)

$stream = 'BT' + $nl + '/F1 15 Tf' + $nl + '72 730 Td' + $nl
foreach ($line in $lines) {
  $escaped = $line.Replace('\','\\').Replace('(','\(').Replace(')','\)')
  $stream += '(' + $escaped + ') Tj' + $nl + '0 -28 Td' + $nl
}
$stream += 'ET' + $nl
$streamBytes = $encoding.GetBytes($stream)

$objects = @(
  ('1 0 obj' + $nl + '<< /Type /Catalog /Pages 2 0 R >>' + $nl + 'endobj' + $nl),
  ('2 0 obj' + $nl + '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' + $nl + 'endobj' + $nl),
  ('3 0 obj' + $nl + '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>' + $nl + 'endobj' + $nl),
  ('4 0 obj' + $nl + '<< /Length ' + $streamBytes.Length + ' >>' + $nl + 'stream' + $nl + $stream + 'endstream' + $nl + 'endobj' + $nl),
  ('5 0 obj' + $nl + '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' + $nl + 'endobj' + $nl)
)

$body = '%PDF-1.4' + $nl
$offsets = @()
foreach ($object in $objects) {
  $offsets += $encoding.GetByteCount($body)
  $body += $object
}

$xrefOffset = $encoding.GetByteCount($body)
$body += 'xref' + $nl + '0 6' + $nl + '0000000000 65535 f ' + $nl
foreach ($offset in $offsets) {
  $body += ('{0:D10} 00000 n ' -f $offset) + $nl
}
$body += 'trailer' + $nl + '<< /Size 6 /Root 1 0 R >>' + $nl + 'startxref' + $nl + $xrefOffset + $nl + '%%EOF' + $nl

$directory = Split-Path -Parent $OutputPath
if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
[System.IO.File]::WriteAllBytes($OutputPath, $encoding.GetBytes($body))
Write-Host "Wrote OCR text PDF smoke fixture: $OutputPath"
