param([string]$Root = (Split-Path $PSScriptRoot -Parent))
$envFile = Join-Path $Root ".env"
if (-not (Test-Path $envFile)) { throw "Missing file: $envFile" }
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $pair = $_ -split '=', 2
    if ($pair.Count -eq 2) {
        $k = $pair[0].Trim()
        $v = $pair[1].Trim().Trim('"')
        if ($k) { Set-Item -Path "env:$k" -Value $v }
    }
}
