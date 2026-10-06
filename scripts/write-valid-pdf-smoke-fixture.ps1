param(
  [Parameter(Mandatory=$true)]
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$encoding = [System.Text.Encoding]::ASCII
$body = "%PDF-1.4`n"
$objects = @(
  "1 0 obj`n<< /Type /Catalog /Pages 2 0 R >>`nendobj`n",
  "2 0 obj`n<< /Type /Pages /Kids [3 0 R] /Count 1 >>`nendobj`n",
  "3 0 obj`n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>`nendobj`n",
  "4 0 obj`n<< /Length 0 >>`nstream`n`nendstream`nendobj`n"
)
$offsets = @()
foreach ($object in $objects) {
  $offsets += $encoding.GetByteCount($body)
  $body += $object
}

$xrefOffset = $encoding.GetByteCount($body)
$body += "xref`n0 5`n0000000000 65535 f `n"
foreach ($offset in $offsets) {
  $body += ("{0:D10} 00000 n `n" -f $offset)
}
$body += "trailer`n<< /Size 5 /Root 1 0 R >>`nstartxref`n$xrefOffset`n%%EOF`n"

$directory = Split-Path -Parent $OutputPath
if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
[System.IO.File]::WriteAllBytes($OutputPath, $encoding.GetBytes($body))
Write-Host "Wrote valid one-page PDF smoke fixture: $OutputPath"
