# Calls openclaw agent with "Привет" until success or max attempts (requires running gateway + LLM keys).
$ErrorActionPreference = "Stop"
$openclawDir = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $openclawDir ".env"
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $pair = $_ -split '=', 2
    if ($pair.Count -eq 2) {
        $k = $pair[0].Trim()
        $v = $pair[1].Trim().Trim('"')
        if ($k -and $v) { Set-Item -Path "env:$k" -Value $v }
    }
}
$cid = $env:GIGACHAT_CLIENT_ID
$sec = $env:GIGACHAT_CLIENT_SECRET
$scope = if ($env:GIGACHAT_SCOPE) { $env:GIGACHAT_SCOPE } else { "GIGACHAT_API_PERS" }
if ($cid -and $sec) {
    $basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${cid}:${sec}"))
    $rqUid = [guid]::NewGuid().ToString()
    $resp = Invoke-RestMethod -Uri "https://ngw.devices.sberbank.ru:9443/api/v2/oauth" -Method Post -Headers @{
        "Content-Type" = "application/x-www-form-urlencoded"
        "Accept"       = "application/json"
        "RqUID"        = $rqUid
        "Authorization" = "Basic $basic"
    } -Body "scope=$scope" -TimeoutSec 30
    if ($resp.access_token) {
        $env:OPENAI_API_KEY = $resp.access_token
        $env:OPENAI_BASE_URL = "https://gigachat.devices.sberbank.ru/api/v1"
    }
}
$env:NODE_OPTIONS = "--use-system-ca"
$sessionsPath = Join-Path $env:USERPROFILE ".openclaw\agents\main\sessions\sessions.json"
$sj = Get-Content $sessionsPath -Raw | ConvertFrom-Json
$sid = $sj.'agent:main:main'.sessionId
if (-not $sid) { throw "No sessionId in sessions.json" }
$max = 8
for ($i = 1; $i -le $max; $i++) {
    Write-Host "Attempt $i / $max ..."
    try {
        $out = openclaw agent --session-id $sid -m "Привет" --json 2>&1
        $txt = $out | Out-String
        if ($LASTEXITCODE -eq 0 -and $txt -notmatch 'error|Error|failed') {
            Write-Host $txt
            exit 0
        }
        Write-Host $txt
    } catch {
        Write-Host $_
    }
    Start-Sleep -Seconds 2
}
exit 1
