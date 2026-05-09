# HTTP-вход по телефону (FastAPI, порт 4052 по умолчанию)
$ErrorActionPreference = "Stop"
$conn = Join-Path (Split-Path $PSScriptRoot -Parent) "connector"
Set-Location $conn
if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
    Write-Host "Сначала venv: python -m venv .venv; pip install -r requirements.txt" -ForegroundColor Yellow
    exit 1
}
& .\.venv\Scripts\python.exe auth_server.py
