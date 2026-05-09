# Stops processes listening on OpenClaw gateway ports so only ONE gateway can run.
# Run before: openclaw gateway run
$ports = 18789, 18791
foreach ($p in $ports) {
    Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object {
            $procId = $_.OwningProcess
            Write-Host "Stopping PID $procId (port $p)"
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
}
Start-Sleep -Seconds 2
Write-Host "Done. Now run: openclaw gateway run --force"
