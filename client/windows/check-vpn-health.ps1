#Requires -Version 5.1
<#
.SYNOPSIS
  Проверка: туннель WireGuard, TCP к 1.1.1.1:443, внешний IP (и страна через ipinfo.io).
.EXAMPLE
  .\check-vpn-health.ps1
  .\check-vpn-health.ps1 -InterfaceAlias notebook
#>
[CmdletBinding()]
param(
    [string] $InterfaceAlias = "",
    [switch] $SkipIpInfo
)

$ErrorActionPreference = "Continue"

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

Write-Step "WireGuard (если есть wg.exe)"
$wg = "${env:ProgramFiles}\WireGuard\wg.exe"
if (Test-Path $wg) {
    try {
        if ($InterfaceAlias) {
            & $wg show $InterfaceAlias 2>&1
        } else {
            & $wg show 2>&1
        }
    } catch {
        Write-Warning "Запустите PowerShell от администратора или укажите -InterfaceAlias."
    }
} else {
    Write-Host "wg.exe не найден — пропуск."
}

Write-Step "Адаптеры (WireGuard / Wintun)"
Get-NetAdapter | Where-Object { $_.InterfaceDescription -match 'WireGuard|Wintun' -or $_.Name -match 'wg|tun' } |
    Format-Table Name, Status, InterfaceDescription -AutoSize

$alias = $InterfaceAlias
if (-not $alias) {
    $cand = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and ($_.InterfaceDescription -match 'WireGuard|Wintun') } | Select-Object -First 1
    if ($cand) { $alias = $cand.Name; Write-Host "Используется интерфейс: $alias" }
}

Write-Step "TCP 1.1.1.1:443"
$t = Test-NetConnection -ComputerName 1.1.1.1 -Port 443 -WarningAction SilentlyContinue
[PSCustomObject]@{
    TcpSucceeded = $t.TcpTestSucceeded
    InterfaceAlias = $t.InterfaceAlias
    SourceAddress = $t.SourceAddress
} | Format-List

Write-Step "HTTPS внешний IP (api.ipify.org)"
try {
    $ip = (Invoke-RestMethod -Uri "https://api.ipify.org?format=json" -TimeoutSec 15).ip
    Write-Host "Ваш IPv4 как видит интернет: $ip"
} catch {
    Write-Warning "Не удалось получить IP: $_"
}

if (-not $SkipIpInfo) {
    Write-Step "Страна (ipinfo.io, по IP)"
    try {
        $info = Invoke-RestMethod -Uri "https://ipinfo.io/json" -TimeoutSec 15
        [PSCustomObject]@{
            ip = $info.ip
            country = $info.country
            city = $info.city
            org = $info.org
        } | Format-List
    } catch {
        Write-Warning "ipinfo недоступен: $_"
    }
}

Write-Step "Готово"
if (-not $t.TcpTestSucceeded) {
    exit 1
}
exit 0
