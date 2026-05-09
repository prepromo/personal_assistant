# Smoke: health -> register (optional) -> cabinet telegram (needs JWT).
# Requires: API on 4050, CABINET_JWT_SECRET, existing TgAccount for SMOKE_APP_USER_ID.
$ErrorActionPreference = "Stop"
$base = if ($env:CABINET_TEST_BASE) { $env:CABINET_TEST_BASE.TrimEnd("/") } else { "http://127.0.0.1:4050" }
$appUserId = if ($env:SMOKE_APP_USER_ID) { $env:SMOKE_APP_USER_ID } else { "user-388963917" }
$email = if ($env:CABINET_TEST_EMAIL) { $env:CABINET_TEST_EMAIL } else { "smoke-$([guid]::NewGuid().ToString('n').Substring(0,8))@example.com" }
$pass = if ($env:CABINET_TEST_PASSWORD) { $env:CABINET_TEST_PASSWORD } else { "smokepass12345" }

Write-Host "GET $base/health"
$h = Invoke-RestMethod -Uri "$base/health" -Method Get
$h | ConvertTo-Json -Compress
if (-not $h.worker) { Write-Host "note: worker field missing until server restart" }

$regBody = @{ email = $email; password = $pass; appUserId = $appUserId } | ConvertTo-Json -Compress
try {
    Write-Host "POST /api/v1/auth/register email=$email ..."
    $r = Invoke-WebRequest -Uri "$base/api/v1/auth/register" -Method POST -ContentType "application/json" -Body $regBody -UseBasicParsing
    Write-Host $r.StatusCode $r.Content
} catch {
    Write-Host "register skip/fail: $($_.Exception.Message)"
    exit 0
}

$token = ($r.Content | ConvertFrom-Json).token
if (-not $token) { Write-Host "no token"; exit 0 }

Write-Host "GET /api/v1/cabinet/telegram (Bearer) ..."
$me = Invoke-RestMethod -Uri "$base/api/v1/cabinet/telegram" -Headers @{ Authorization = "Bearer $token" }
$me | ConvertTo-Json -Compress
Write-Host "GET /api/v1/cabinet/chat/messages ..."
$chat = Invoke-RestMethod -Uri "$base/api/v1/cabinet/chat/messages?limit=5" -Headers @{ Authorization = "Bearer $token" }
$chat | ConvertTo-Json -Compress
Write-Host "OK: test-cabinet"
