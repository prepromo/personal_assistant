# Включение/выключение туннеля WireGuard на Windows (одна команда).
# Требуется установленный WireGuard: https://www.wireguard.com/install/
# Скопируйте выданный сервером *.conf в каталог конфигураций (см. $ConfigDir ниже).
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('up', 'down', 'status')]
    [string]$Action,
    [string]$TunnelName = 'wg0'
)

$WgQuick = "${env:ProgramFiles}\WireGuard\wg-quick.exe"
if (-not (Test-Path $WgQuick)) {
    Write-Error "Не найден wg-quick.exe. Установите WireGuard для Windows."
    exit 1
}

# Стандартный каталог: конфиг должен называться <TunnelName>.conf
$ConfigDir = "${env:ProgramFiles}\WireGuard\Data\Configurations"
$Conf = Join-Path $ConfigDir "$TunnelName.conf"
if ($Action -ne 'status' -and -not (Test-Path $Conf)) {
    Write-Error "Нет файла $Conf — импортируйте конфиг из сервера (wg-add-client) или скопируйте вручную."
    exit 1
}

switch ($Action) {
    'up' {
        & $WgQuick up $TunnelName
    }
    'down' {
        & $WgQuick down $TunnelName
    }
    'status' {
        $wg = "${env:ProgramFiles}\WireGuard\wg.exe"
        if (Test-Path $wg) { & $wg show } else { & wg show 2>$null }
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Туннель не активен или не найден wg.exe (откройте приложение WireGuard)."
        }
    }
}
