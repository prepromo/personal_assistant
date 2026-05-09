# Копирует skill telegram-user в %USERPROFILE%\.openclaw\skills\telegram-user
$ErrorActionPreference = "Stop"
$repoSkills = Join-Path (Split-Path $PSScriptRoot -Parent) "skills\telegram-user"
$destRoot = Join-Path $env:USERPROFILE ".openclaw\skills\telegram-user"
if (-not (Test-Path $repoSkills)) { throw "Not found: $repoSkills" }
New-Item -ItemType Directory -Force -Path $destRoot | Out-Null
Copy-Item -Path (Join-Path $repoSkills "*") -Destination $destRoot -Force
Write-Host "OK: skill copied to $destRoot" -ForegroundColor Green
Write-Host "Set TELEGRAM_USER_AGENT_TOKEN in openclaw/.env, run apply-env-to-openclaw.ps1 if needed, restart gateway." -ForegroundColor Cyan
