param(
  [Parameter(Mandatory=$true)]
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$encoding = [System.Text.Encoding]::ASCII
$stream = @"
0.8 w
50 150 m 250 150 l S
50 100 m 250 100 l S
50 50 m 250 50 l S
50 50 m 50 150 l S
150 50 m 150 150 l S
250 50 m 250 150 l S
BT /F1 12 Tf 65 125 Td (Name) Tj ET
BT /F1 12 Tf 165 125 Td (Score) Tj ET
BT /F1 12 Tf 65 75 Td (MALENJO) Tj ET
BT /F1 12 Tf 165 75 Td (100) Tj ET
"@
$streamBytes = $encoding.GetBytes($stream)
$body = "%PDF-1.4`n"
$objects = @(
  "1 0 obj`n<< /Type /Catalog /Pages 2 0 R >>`nendobj`n",
  "2 0 obj`n<< /Type /Pages /Kids [3 0 R] /Count 1 >>`nendobj`n",
  "3 0 obj`n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`nendobj`n",
  "4 0 obj`n<< /Length $($streamBytes.Length) >>`nstream`n$stream`nendstream`nendobj`n",
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
Write-Host "Wrote ruled-table PDF smoke fixture: $OutputPath"