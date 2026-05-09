# Получает access_token GigaChat (≈30 мин) и печатает команды для установки переменных.
# Требуются GIGACHAT_CLIENT_ID, GIGACHAT_CLIENT_SECRET, GIGACHAT_SCOPE в .env рядом с openclaw/
# Запуск из каталога openclaw:  .\scripts\refresh-gigachat-token.ps1

$ErrorActionPreference = "Stop"
$openclawDir = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $openclawDir ".env"
if (-not (Test-Path $envFile)) { $envFile = Join-Path $openclawDir "secrets.env" }
if (-not (Test-Path $envFile)) {
    Write-Error "Не найден .env или secrets.env в папке openclaw. Скопируйте .env.example -> .env и заполните."
}

Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $pair = $_ -split '=', 2
    if ($pair.Count -eq 2) {
        $k = $pair[0].Trim()
        $v = $pair[1].Trim().Trim('"')
        [Environment]::SetEnvironmentVariable($k, $v, "Process")
    }
}

$cid = $env:GIGACHAT_CLIENT_ID
$sec = $env:GIGACHAT_CLIENT_SECRET
$scope = if ($env:GIGACHAT_SCOPE) { $env:GIGACHAT_SCOPE } else { "GIGACHAT_API_PERS" }

if (-not $cid -or -not $sec) {
    Write-Error "Задайте GIGACHAT_CLIENT_ID и GIGACHAT_CLIENT_SECRET в $envFile"
}

$basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${cid}:${sec}"))
$rqUid = [guid]::NewGuid().ToString()

$uri = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
$headers = @{
    "Content-Type" = "application/x-www-form-urlencoded"
    "Accept" = "application/json"
    "RqUID" = $rqUid
    "Authorization" = "Basic $basic"
}
$body = "scope=$scope"

try {
    $resp = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body -TimeoutSec 30
} catch {
    Write-Error "OAuth ошибка: $_"
}

$token = $resp.access_token
if (-not $token) {
    Write-Error "В ответе нет access_token: $($resp | ConvertTo-Json -Depth 5)"
}

Write-Host "`nТокен получен (действует ограниченное время, у GigaChat обычно до ~30 мин).`n" -ForegroundColor Green
Write-Host 'Для текущей сессии PowerShell выполните:'
Write-Host "`$env:OPENAI_API_KEY='$token'"
Write-Host "`$env:OPENAI_BASE_URL='https://gigachat.devices.sberbank.ru/api/v1'"
Write-Host "`nЗатем из каталога openclaw (или с указанием пути к конфигу):"
Write-Host "  npx openclaw@latest gateway run"
Write-Host "`nМодель в OpenClaw укажите как совместимую с OpenAI и именем GigaChat (см. README).`n"
