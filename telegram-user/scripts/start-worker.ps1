# Запуск connector/worker.py: Pyrogram (личный аккаунт) → ingest + очередь TgPendingSend.
# Предусловия: npm run dev на 4050, выполненный login.py, CONNECTOR_SECRET совпадает с telegram-user/.env.
#
# Текущее окно (блокирует до Ctrl+C):
#   .\scripts\start-worker.ps1
#
# Отдельное окно PowerShell:
#   .\scripts\start-worker.ps1 -NewWindow

param([switch]$NewWindow)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$conn = Join-Path $root "connector"
$py = Join-Path $conn ".venv\Scripts\python.exe"

if (-not (Test-Path $py)) {
    Write-Host "Нет .venv в connector. Выполните:" -ForegroundColor Yellow
    Write-Host "  cd `"$conn`"" -ForegroundColor Gray
    Write-Host "  py -3 -m venv .venv" -ForegroundColor Gray
    Write-Host "  .\.venv\Scripts\pip install -r requirements.txt" -ForegroundColor Gray
    exit 1
}

$escapedConn = $conn -replace "'", "''"
$escapedPy = $py -replace "'", "''"
$line = "Set-Location '$escapedConn'; & '$escapedPy' worker.py"

if ($NewWindow) {
    Start-Process powershell -ArgumentList @("-NoExit", "-NoProfile", "-Command", $line)
    Write-Host "Открыто новое окно с worker.py" -ForegroundColor Green
    exit 0
}

Set-Location $conn
& $py worker.py
