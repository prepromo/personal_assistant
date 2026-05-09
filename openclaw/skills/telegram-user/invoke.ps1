<#
 Вызывается агентом через exec (см. SKILL.md).
 Нужны TELEGRAM_USER_AGENT_TOKEN и опционально TELEGRAM_USER_BASE_URL (по умолчанию http://127.0.0.1:4050).
 В Windows PowerShell 5 блок param() должен быть первым исполняемым блоком в скрипте.
#>
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("resolve", "account-for-app", "dialogs-list", "messages-list", "dialogs-send", "tasks-list", "tasks-create", "reminders-list", "reminders-create", "policy-patch")]
    [string]$Action,
    [string]$TelegramUserId,
    [string]$AppUserId,
    [string]$Title,
    [string]$Body,
    [string]$Text,
    [string]$FireAt,
    [string]$ReminderText,
    [string]$AccountId,
    [string]$DialogId,
    [int]$Limit = 0,
    [ValidateSet("manual", "suggest", "auto", "")]
    [string]$ReplyMode = ""
)

$ErrorActionPreference = "Stop"

$base = if ($env:TELEGRAM_USER_BASE_URL) { $env:TELEGRAM_USER_BASE_URL.TrimEnd("/") } else { "http://127.0.0.1:4050" }
$token = $env:TELEGRAM_USER_AGENT_TOKEN
if (-not $token) {
    Write-Error "Задайте TELEGRAM_USER_AGENT_TOKEN (как AGENT_API_TOKEN в telegram-user/.env)"
}
$H = @{ Authorization = "Bearer $token" }

function Out-Json($obj) {
    $obj | ConvertTo-Json -Depth 10 -Compress
}

switch ($Action) {
    "resolve" {
        if (-not $TelegramUserId) { throw "Нужен -TelegramUserId" }
        $r = Invoke-RestMethod -Uri "$base/v1/telegram-bindings/$TelegramUserId" -Headers $H -Method Get
        Out-Json $r
    }
    "account-for-app" {
        if (-not $AppUserId) { throw "Нужен -AppUserId" }
        $r = Invoke-RestMethod -Uri "$base/v1/app-users/$AppUserId/tg-account" -Headers $H -Method Get
        Out-Json $r
    }
    "dialogs-list" {
        if (-not $AccountId) { throw "Нужен -AccountId (uuid TgAccount из resolve или account-for-app)" }
        $lim = if ($Limit -gt 0) { [Math]::Min($Limit, 100) } else { 50 }
        $r = Invoke-RestMethod -Uri "$base/v1/accounts/$AccountId/dialogs?limit=$lim" -Headers $H -Method Get
        Out-Json $r
    }
    "messages-list" {
        if (-not $DialogId) { throw "Нужен -DialogId (uuid из dialogs-list items[].id)" }
        $lim = if ($Limit -gt 0) { [Math]::Min($Limit, 200) } else { 50 }
        $r = Invoke-RestMethod -Uri "$base/v1/dialogs/$DialogId/messages?limit=$lim" -Headers $H -Method Get
        Out-Json $r
    }
    "dialogs-send" {
        if (-not $DialogId) { throw "Нужен -DialogId (uuid из dialogs-list)" }
        $t = if ($Text) { $Text.Trim() } else { "" }
        if (-not $t -or $t.Length -gt 4096) { throw "Нужен -Text (1..4096 символов)" }
        $payload = @{ text = $t }
        $json = $payload | ConvertTo-Json -Compress
        $h2 = $H.Clone()
        $h2["Content-Type"] = "application/json"
        $r = Invoke-RestMethod -Uri "$base/v1/dialogs/$DialogId/send" -Headers $h2 -Method Post -Body $json
        Out-Json $r
    }
    "tasks-list" {
        if (-not $AppUserId) { throw "Нужен -AppUserId" }
        $r = Invoke-RestMethod -Uri "$base/v1/app-users/$AppUserId/tasks" -Headers $H -Method Get
        Out-Json $r
    }
    "tasks-create" {
        if (-not $AppUserId) { throw "Нужен -AppUserId" }
        if (-not $Title) { throw "Нужен -Title" }
        $payload = @{ title = $Title }
        if ($Body) { $payload.body = $Body }
        $json = $payload | ConvertTo-Json -Compress
        $h2 = $H.Clone()
        $h2["Content-Type"] = "application/json"
        $r = Invoke-RestMethod -Uri "$base/v1/app-users/$AppUserId/tasks" -Headers $h2 -Method Post -Body $json
        Out-Json $r
    }
    "reminders-list" {
        if (-not $AppUserId) { throw "Нужен -AppUserId" }
        $r = Invoke-RestMethod -Uri "$base/v1/app-users/$AppUserId/reminders" -Headers $H -Method Get
        Out-Json $r
    }
    "reminders-create" {
        if (-not $AppUserId) { throw "Нужен -AppUserId" }
        if (-not $Title) { throw "Нужен -Title" }
        if (-not $ReminderText) { throw "Нужен -ReminderText" }
        if (-not $FireAt) { throw "Нужен -FireAt (ISO8601, напр. 2026-04-02T15:00:00.000Z)" }
        $payload = @{
            title            = $Title
            text             = $ReminderText
            fireAt           = $FireAt
            notifyTelegram   = $true
            notifyWeb        = $true
        }
        $json = $payload | ConvertTo-Json -Compress
        $h2 = $H.Clone()
        $h2["Content-Type"] = "application/json"
        $r = Invoke-RestMethod -Uri "$base/v1/app-users/$AppUserId/reminders" -Headers $h2 -Method Post -Body $json
        Out-Json $r
    }
    "policy-patch" {
        if (-not $AccountId) { throw "Нужен -AccountId (uuid TgAccount)" }
        if (-not $ReplyMode) { throw "Нужен -ReplyMode: manual | suggest | auto" }
        $payload = @{ replyMode = $ReplyMode }
        $json = $payload | ConvertTo-Json -Compress
        $h2 = $H.Clone()
        $h2["Content-Type"] = "application/json"
        $r = Invoke-RestMethod -Uri "$base/v1/accounts/$AccountId/policy" -Headers $h2 -Method Patch -Body $json
        Out-Json $r
    }
}
