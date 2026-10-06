param(
  [Parameter(Mandatory=$true)]
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$encoding = [System.Text.Encoding]::ASCII
$textLines = @(
  'MALENJO OCR PROVIDER SMOKE TEST',
  'The quick brown fox jumps over the lazy dog while local providers stay offline.',
  'Windows Tesseract reads this page without contacting a public service.',
  'Provider contracts report implementation version model data and legal status.',
  'Source truth requires immutable language assets and exact runtime inventory.',
  'Local document processing remains inside the MALENJO desktop boundary.',
  'Orientation detection uses the reviewed osd trained data file.',
  'Searchable PDF output remains structurally valid after OCR processing.',
  'This sentence provides stable English text for orientation analysis.',
  'This sentence provides stable English text for orientation analysis.',
  'This sentence provides stable English text for orientation analysis.',
  'This sentence provides stable English text for orientation analysis.'
)

$stream = "BT`n/F1 14 Tf`n72 730 Td`n"
foreach ($line in $textLines) {
  $escaped = $line.Replace('\','\\').Replace('(','\(').Replace(')','\)')
  $stream += "($escaped) Tj`n0 -28 Td`n"
}
$stream += "ET`n"
$streamLength = $encoding.GetByteCount($stream)

$body = "%PDF-1.4`n"
$objects = @(
  "1 0 obj`n<< /Type /Catalog /Pages 2 0 R >>`nendobj`n",
  "2 0 obj`n<< /Type /Pages /Kids [3 0 R] /Count 1 >>`nendobj`n",
  "3 0 obj`n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`nendobj`n",
  "4 0 obj`n<< /Length $streamLength >>`nstream`n$stream`nendstream`nendobj`n",
  "5 0 obj`n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`nendobj`n"
)
$offsets = @()
foreach ($object in $objects) {
  $offsets += $encoding.GetByteCount($body)
  $body += $object
}

$xrefOffset = $encoding.GetByteCount($body)
$body += "xref`n0 6`n0000000000 65535 f `n"
foreach ($offset in $offsets) {
  $body += ("{0:D10} 00000 n `n" -f $offset)
}
$body += "trailer`n<< /Size 6 /Root 1 0 R >>`nstartxref`n$xrefOffset`n%%EOF`n"

$directory = Split-Path -Parent $OutputPath
if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
[System.IO.File]::WriteAllBytes($OutputPath, $encoding.GetBytes($body))
Write-Host "Wrote valid OCR text PDF smoke fixture: $OutputPath"
