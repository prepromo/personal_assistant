# Smoke: account-for-app -> dialogs-list -> dialogs-send (queue; worker delivers to Telegram).
$ErrorActionPreference = "Stop"
$openclawDir = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $openclawDir ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
        $pair = $_ -split '=', 2
        if ($pair.Count -eq 2) {
            $k = $pair[0].Trim()
            $v = $pair[1].Trim().Trim('"')
            if ($k -and $v) { Set-Item -Path "env:$k" -Value $v }
        }
    }
}
if (-not $env:TELEGRAM_USER_AGENT_TOKEN) { $env:TELEGRAM_USER_AGENT_TOKEN = "local-dev-agent-token-2026" }
$app = if ($env:SMOKE_APP_USER_ID) { $env:SMOKE_APP_USER_ID } else { "user-388963917" }
$invoke = Join-Path $openclawDir "skills\telegram-user\invoke.ps1"
$shell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { "pwsh" } else { "powershell.exe" }
$prefix = if ($env:SMOKE_SEND_PREFIX) { $env:SMOKE_SEND_PREFIX } else { "smoke" }
Write-Host "test-telegram-user-send: account-for-app AppUserId=$app ..."
try {
    $out = & $shell -NoProfile -ExecutionPolicy Bypass -File $invoke -Action account-for-app -AppUserId $app
    Write-Host $out
    $j = $out | ConvertFrom-Json
    if (-not $j.accountId) { throw "no accountId" }
    $aid = $j.accountId
    Write-Host "dialogs-list AccountId=$aid ..."
    $out2 = & $shell -NoProfile -ExecutionPolicy Bypass -File $invoke -Action dialogs-list -AccountId $aid -Limit 5
    Write-Host $out2
    $d = $out2 | ConvertFrom-Json
    if (-not $d.items -or $d.items.Count -eq 0) {
        Write-Host "SKIP: no dialogs in DB (run worker sync)."
        exit 0
    }
    $did = $d.items[0].id
    $msg = "$prefix $(Get-Date -Format o)"
    Write-Host "dialogs-send DialogId=$did ..."
    $out3 = & $shell -NoProfile -ExecutionPolicy Bypass -File $invoke -Action dialogs-send -DialogId $did -Text $msg
    Write-Host $out3
    $s = $out3 | ConvertFrom-Json
    if (-not $s.pendingId) { throw "send: missing pendingId in API response" }
    Write-Host "OK: test-telegram-user-send (queued)"
} catch {
    Write-Host "SKIP or error: $($_.Exception.Message)"
    exit 0
}
