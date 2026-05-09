# Installs gpt2giga (Python) for the local OpenAI->GigaChat proxy.
$ErrorActionPreference = "Stop"
$here = Split-Path $PSScriptRoot -Parent
$req = Join-Path $here "requirements-gpt2giga.txt"
if (-not (Get-Command py -ErrorAction SilentlyContinue) -and -not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Error "Python not found. Install Python 3.10+ and ensure 'py' or 'python' is on PATH."
}
$py = if (Get-Command py -ErrorAction SilentlyContinue) { "py" } else { "python" }
& $py -m pip install -r $req
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "OK: gpt2giga installed. Run: .\scripts\start-gpt2giga.ps1" -ForegroundColor Green
