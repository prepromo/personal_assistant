#!/usr/bin/env bash
# WireGuard VPN — автоматическая установка на Ubuntu 22.04/24.04
# Запуск: curl -sSL ... | sudo bash   ИЛИ: sudo bash install-wireguard.sh
set -euo pipefail

WG_IF="${WG_IF:-wg0}"
WG_PORT="${WG_PORT:-51820}"
WG_NET="${WG_NET:-10.7.0.0/24}"
WG_SERVER_IP="${WG_SERVER_IP:-10.7.0.1}"

die() { echo "Ошибка: $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Запустите от root: sudo $0"

if [[ -f /etc/os-release ]]; then
  # shellcheck source=/dev/null
  . /etc/os-release
  [[ "${ID:-}" == "ubuntu" ]] || die "Ожидается Ubuntu (найдено: ${ID:-unknown})"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Установка пакетов ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y wireguard wireguard-tools qrencode iptables curl python3

echo "=== Сеть и IP forwarding ==="
DEFAULT_IF="$(ip route show default 2>/dev/null | awk '{print $5}' | head -n1)"
[[ -n "$DEFAULT_IF" ]] || die "Не удалось определить внешний интерфейс (default route)"
echo "Внешний интерфейс: $DEFAULT_IF"

if ! grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.d/99-wireguard.conf 2>/dev/null; then
  cat >/etc/sysctl.d/99-wireguard.conf <<EOF
net.ipv4.ip_forward=1
net.ipv6.conf.all.forwarding=1
EOF
fi
sysctl -p /etc/sysctl.d/99-wireguard.conf >/dev/null

echo "=== Публичный адрес сервера (Endpoint для клиентов) ==="
AUTO_IP="$(curl -4 -s --max-time 5 ifconfig.me 2>/dev/null || true)"
read -r -p "Введите публичный IP или домен сервера [${AUTO_IP:-вручную}]: " IN_EP
ENDPOINT="${IN_EP:-$AUTO_IP}"
[[ -n "$ENDPOINT" ]] || die "Нужен IP или домен для Endpoint"

echo "Endpoint будет: ${ENDPOINT}:${WG_PORT}"

umask 077
install -d -m 700 /etc/wireguard/clients

if [[ ! -f /etc/wireguard/server_private.key ]]; then
  wg genkey | tee /etc/wireguard/server_private.key | wg pubkey >/etc/wireguard/server_public.key
  chmod 600 /etc/wireguard/server_private.key
fi
SERVER_PRIV="$(cat /etc/wireguard/server_private.key)"
SERVER_PUB="$(cat /etc/wireguard/server_public.key)"

# PostUp/PostDown: NAT и форвардинг
POST_UP="iptables -I INPUT -i ${WG_IF} -j ACCEPT; iptables -A FORWARD -i ${WG_IF} -j ACCEPT; iptables -A FORWARD -o ${WG_IF} -j ACCEPT; iptables -t nat -A POSTROUTING -o ${DEFAULT_IF} -j MASQUERADE"
POST_DOWN="iptables -t nat -D POSTROUTING -o ${DEFAULT_IF} -j MASQUERADE; iptables -D FORWARD -o ${WG_IF} -j ACCEPT; iptables -D FORWARD -i ${WG_IF} -j ACCEPT; iptables -D INPUT -i ${WG_IF} -j ACCEPT"

cat >/etc/wireguard/${WG_IF}.conf <<EOF
# Сгенерировано install-wireguard.sh — не редактируйте секции [Peer] вручную (используйте wg-add-client)
[Interface]
Address = ${WG_SERVER_IP}/24
ListenPort = ${WG_PORT}
PrivateKey = ${SERVER_PRIV}
PostUp = ${POST_UP}
PostDown = ${POST_DOWN}
EOF

echo "${ENDPOINT}" >/etc/wireguard/endpoint.txt
echo "${WG_PORT}" >/etc/wireguard/port.txt
echo "${DEFAULT_IF}" >/etc/wireguard/wan_if.txt
echo "2" >/etc/wireguard/next_client_id.txt

install -m 755 "${SCRIPT_DIR}/wg-add-client.sh" /usr/local/bin/wg-add-client
install -m 755 "${SCRIPT_DIR}/wg-remove-client.sh" /usr/local/bin/wg-remove-client
install -m 755 "${SCRIPT_DIR}/wg-vpn-ctl.sh" /usr/local/bin/wg-vpn-ctl

systemctl enable "wg-quick@${WG_IF}.service"
systemctl restart "wg-quick@${WG_IF}.service"

echo ""
echo "=== Готово. WireGuard слушает UDP ${WG_PORT} ==="
echo "Команды:"
echo "  wg-add-client <имя>     — добавить клиента (конфиг + QR)"
echo "  wg-remove-client <имя>  — удалить клиента"
echo "  wg-vpn-ctl start|stop|status|restart"
echo ""
echo "Откройте порт в firewall, если используете ufw:"
echo "  ufw allow ${WG_PORT}/udp && ufw allow OpenSSH && ufw enable"
echo ""
