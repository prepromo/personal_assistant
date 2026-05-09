# Останавливает процессы, слушающие указанный TCP-порт (Windows).
param([Parameter(Mandatory = $true)][int]$Port)
$ErrorActionPreference = "Stop"
$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $conns) {
    Write-Host "No listener on port $Port"
    exit 0
}
$ids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $ids) {
    try {
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($p) {
            Write-Host "Stopping PID $procId ($($p.ProcessName))"
            Stop-Process -Id $procId -Force
        }
    } catch {
        Write-Host "Could not stop $procId : $($_.Exception.Message)"
    }
}
