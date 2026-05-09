# Writes TELEGRAM_API_ID and TELEGRAM_API_HASH into connector/.env (keeps other lines).
param(
    [Parameter(Mandatory = $true)][string]$ApiId,
    [Parameter(Mandatory = $true)][string]$ApiHash
)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$path = Join-Path $root "connector\.env"
if (-not (Test-Path $path)) { throw "Missing $path" }

$lines = Get-Content $path
$out = New-Object System.Collections.ArrayList
foreach ($line in $lines) {
    if ($line -match '^\s*TELEGRAM_API_ID=') {
        [void]$out.Add("TELEGRAM_API_ID=$ApiId")
    }
    elseif ($line -match '^\s*TELEGRAM_API_HASH=') {
        [void]$out.Add("TELEGRAM_API_HASH=$ApiHash")
    }
    else {
        [void]$out.Add($line)
    }
}
$out | Set-Content -Path $path -Encoding utf8
Write-Host "Updated $path" -ForegroundColor Green
