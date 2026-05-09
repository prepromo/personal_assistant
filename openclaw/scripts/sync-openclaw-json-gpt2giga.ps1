# Sets custom GigaChat provider baseUrl in ~/.openclaw/openclaw.json to the local gpt2giga proxy.
param(
    [int]$Port = 8090
)
$ErrorActionPreference = "Stop"
$path = Join-Path $env:USERPROFILE ".openclaw\openclaw.json"
if (-not (Test-Path $path)) { throw "Missing $path" }
$baseUrl = "http://127.0.0.1:$Port/v1"
$content = [System.IO.File]::ReadAllText($path)
$direct = '"baseUrl": "https://gigachat.devices.sberbank.ru/api/v1"'
$proxy = "`"baseUrl`": `"$baseUrl`""
if ($content.Contains($direct)) {
    $content = $content.Replace($direct, $proxy)
}
else {
    $content = $content -replace '"baseUrl"\s*:\s*"http://127\.0\.0\.1:\d+/v1"', $proxy
}
if ($content -notmatch [regex]::Escape($baseUrl)) {
    throw "Failed to set baseUrl in openclaw.json (unexpected format)."
}
[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))
Write-Host "OK: $path baseUrl -> $baseUrl" -ForegroundColor Green
