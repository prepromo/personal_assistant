# One entrypoint for local stack (Windows / PowerShell).
# Run from repo root:
#   .\StartCode.ps1
#
# Non-interactive:
#   .\StartCode.ps1 -Mode FullDesktop
#   .\StartCode.ps1 -Mode FullHere
#   .\StartCode.ps1 -Mode Deps
#   .\StartCode.ps1 -Mode Api
#   .\StartCode.ps1 -Mode Worker
#
# Interactive (menu):
#   .\StartCode.ps1

param(
    [ValidateSet("FullDesktop", "FullHere", "Deps", "Api", "Worker", "Menu")]
    [string]$Mode = "Menu"
)

$ErrorActionPreference = "Stop"
$repo = $PSScriptRoot
Set-Location $repo

$tgStack = Join-Path $repo "scripts\start-tg-stack.ps1"
$tuLocalStack = Join-Path $repo "telegram-user\scripts\start-local-stack.ps1"
$tuDev = Join-Path $repo "telegram-user\scripts\start-dev.ps1"
$tuWorker = Join-Path $repo "telegram-user\scripts\start-worker.ps1"

function Assert-Exists([string]$path, [string]$label) {
    if (-not (Test-Path $path)) { throw "Missing ${label}: ${path}" }
}

Assert-Exists $tgStack "stack script"
Assert-Exists $tuLocalStack "telegram-user local stack"
Assert-Exists $tuDev "telegram-user dev"
Assert-Exists $tuWorker "telegram-user worker"

function Invoke-StartMode([string]$m) {
    switch ($m) {
        "FullDesktop" { & $tgStack -DesktopWindows; return }
        "FullHere"    { & $tgStack; return }
        "Deps"        { & $tuLocalStack; return }
        "Api"         { & $tuDev; return }
        "Worker"      { & $tuWorker -NewWindow; return }
        default       { throw "Unknown mode: $m" }
    }
}

if ($Mode -ne "Menu") {
    Invoke-StartMode $Mode
    return
}

Write-Host ""
Write-Host "=== StartCode (local) ===" -ForegroundColor Cyan
Write-Host "1) FULL: Postgres + LLM + API+bot + worker (Desktop windows)" -ForegroundColor White
Write-Host "2) FULL: same, but in this terminal (concurrently)" -ForegroundColor White
Write-Host "3) ONLY: Postgres + LLM (no API, no worker)" -ForegroundColor White
Write-Host "4) ONLY: API + product bot (npm run dev)" -ForegroundColor White
Write-Host "5) ONLY: worker (MTProto connector)" -ForegroundColor White
Write-Host ""

$choice = Read-Host "Select 1-5"
switch ($choice) {
    "1" { Invoke-StartMode "FullDesktop"; break }
    "2" { Invoke-StartMode "FullHere"; break }
    "3" { Invoke-StartMode "Deps"; break }
    "4" { Invoke-StartMode "Api"; break }
    "5" { Invoke-StartMode "Worker"; break }
    default { Write-Host "Unknown option: $choice" -ForegroundColor Yellow; exit 1 }
}

