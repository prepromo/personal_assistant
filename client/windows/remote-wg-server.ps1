# Удалённое включение/выключение службы WireGuard на VPS по SSH (серверная сторона).
# Пример: .\remote-wg-server.ps1 -HostName user@1.2.3.4 -Action status
param(
    [Parameter(Mandatory = $true)]
    [string]$HostName,
    [Parameter(Mandatory = $true)]
    [ValidateSet('start', 'stop', 'restart', 'status')]
    [string]$Action
)

$cmd = "sudo wg-vpn-ctl $Action"
ssh $HostName $cmd
