# Stops only Node processes running OpenClaw (does not kill other Node apps e.g. IDE tooling).
$ErrorActionPreference = "SilentlyContinue"
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | ForEach-Object {
    $cmd = $_.CommandLine
    if ($cmd -and ($cmd -match 'openclaw')) {
        Write-Host "Stopping PID $($_.ProcessId) (openclaw)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}
Start-Sleep -Seconds 2
