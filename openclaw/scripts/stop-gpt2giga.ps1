# Stops process listening on gpt2giga port (default 8090).
param([int]$Port = 8090)
$ErrorActionPreference = "SilentlyContinue"
Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
        Write-Host "Stopping PID $($_.OwningProcess) (port $Port)"
        Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    }
Start-Sleep -Seconds 1
