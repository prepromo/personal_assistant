# Запуск gateway OpenClaw с переменными из openclaw/.env.
# По умолчанию: локальный прокси gpt2giga (OpenAI-совместимо -> GigaChat), затем gateway.
# USE_GPT2GIGA_PROXY=false — прямой OAuth GigaChat (короткий токен), без gpt2giga.

$ErrorActionPreference = "Stop"
$openclawDir = Split-Path $PSScriptRoot -Parent
Set-Location $openclawDir

$envFile = Join-Path $openclawDir ".env"
if (-not (Test-Path $envFile)) { $envFile = Join-Path $openclawDir "secrets.env" }
if (-not (Test-Path $envFile)) {
    Write-Error "Создайте openclaw/.env из .env.example и заполните ключи."
}

Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $pair = $_ -split '=', 2
    if ($pair.Count -eq 2) {
        $k = $pair[0].Trim()
        $v = $pair[1].Trim().Trim('"')
        if ($k -and $v) { Set-Item -Path "env:$k" -Value $v }
    }
}

if (-not $env:TELEGRAM_BOT_TOKEN) {
    Write-Warning "TELEGRAM_BOT_TOKEN empty - Telegram channel will not start. Fill .env"
}

$useProxy = $env:USE_GPT2GIGA_PROXY
if ($null -eq $useProxy -or $useProxy -eq '' -or $useProxy -eq '1' -or $useProxy -eq 'true') {
    & (Join-Path $PSScriptRoot "start-gpt2giga.ps1")
    & (Join-Path $PSScriptRoot "sync-openclaw-json-gpt2giga.ps1")
    $port = if ($env:GPT2GIGA_PORT) { $env:GPT2GIGA_PORT } else { '8090' }
    $env:OPENAI_BASE_URL = "http://127.0.0.1:$port/v1"
    $env:OPENAI_API_KEY = if ($env:GPT2GIGA_CLIENT_OPENAI_KEY) { $env:GPT2GIGA_CLIENT_OPENAI_KEY } else { 'sk-openclaw-gpt2giga-local' }
    Write-Host "OpenClaw -> gpt2giga at $env:OPENAI_BASE_URL" -ForegroundColor Green
}
else {
    $cid = $env:GIGACHAT_CLIENT_ID
    $sec = $env:GIGACHAT_CLIENT_SECRET
    $scope = if ($env:GIGACHAT_SCOPE) { $env:GIGACHAT_SCOPE } else { "GIGACHAT_API_PERS" }
    if ($cid -and $sec) {
        $basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${cid}:${sec}"))
        $rqUid = [guid]::NewGuid().ToString()
        $uri = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
        $headers = @{
            "Content-Type" = "application/x-www-form-urlencoded"
            "Accept" = "application/json"
            "RqUID" = $rqUid
            "Authorization" = "Basic $basic"
        }
        $resp = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body "scope=$scope" -TimeoutSec 30
        if ($resp.access_token) {
            $env:OPENAI_API_KEY = $resp.access_token
            $env:OPENAI_BASE_URL = "https://gigachat.devices.sberbank.ru/api/v1"
            Write-Host "GigaChat: токен получен, OPENAI_BASE_URL установлен (direct)." -ForegroundColor Green
        }
    }
    if (-not $env:OPENAI_API_KEY) {
        Write-Error "Нет OPENAI_API_KEY. Заполните GIGACHAT_CLIENT_ID/SECRET в .env или включите gpt2giga (USE_GPT2GIGA_PROXY)."
    }
}

# GigaChat (Sber): Node must use Windows CA store, else TLS fails with SELF_SIGNED_CERT_IN_CHAIN
$env:NODE_OPTIONS = "--use-system-ca"
$env:OPENCLAW_NO_RESPAWN = "1"

$npmOpenclawMjs = Join-Path $env:APPDATA "npm\node_modules\openclaw\openclaw.mjs"
Write-Host "Starting OpenClaw gateway (NODE_OPTIONS=--use-system-ca)..." -ForegroundColor Cyan
if (Test-Path $npmOpenclawMjs) {
    & node $npmOpenclawMjs gateway run --force
} elseif (Get-Command openclaw -ErrorAction SilentlyContinue) {
    openclaw gateway run --force
} else {
    npx --yes openclaw@latest gateway run --force
}
