#!/usr/bin/env bash
# Полная переустановка WireGuard: сервер + два клиента (ноутбук 10.7.0.2, телефон 10.7.0.3).
# Ubuntu 20.04+. Запуск на VPS: sudo bash setup-wireguard-two-clients.sh
# Переменные: ENDPOINT=1.2.3.4 WG_PORT=51820 (опционально)
set -euo pipefail

WG_IF="${WG_IF:-wg0}"
WG_PORT="${WG_PORT:-51820}"
SERVER_TUN_IP="${SERVER_TUN_IP:-10.7.0.1}"
IP_NOTEBOOK="${IP_NOTEBOOK:-10.7.0.2}"
IP_PHONE="${IP_PHONE:-10.7.0.3}"

die() { echo "Ошибка: $*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "Запустите от root: sudo $0"

if [[ -f /etc/os-release ]]; then
  # shellcheck source=/dev/null
  . /etc/os-release
  [[ "${ID:-}" == "ubuntu" ]] || die "Ожидается Ubuntu (найдено: ${ID:-unknown})"
fi

DEFAULT_IF="$(ip route show default 2>/dev/null | awk '{print $5}' | head -n1)"
[[ -n "$DEFAULT_IF" ]] || die "Не удалось определить внешний интерфейс (ip route)"

AUTO_IP="$(curl -4 -s --max-time 5 ifconfig.me 2>/dev/null || true)"
if [[ -z "${ENDPOINT:-}" ]]; then
  read -r -p "Публичный IP или домен для клиентов (Endpoint) [${AUTO_IP:-}]: " IN_EP
  ENDPOINT="${IN_EP:-$AUTO_IP}"
fi
[[ -n "$ENDPOINT" ]] || die "Нужен Endpoint (IP или домен)"

echo "=== Остановка старого ${WG_IF} (если был) ==="
systemctl stop "wg-quick@${WG_IF}.service" 2>/dev/null || true
wg-quick down "${WG_IF}" 2>/dev/null || true

BK="/root/wireguard-backup-$(date +%Y%m%d%H%M%S)"
mkdir -p "$BK"
cp -a /etc/wireguard/. "$BK/" 2>/dev/null || true
echo "Резервная копия: $BK"

echo "=== Пакеты ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y wireguard wireguard-tools qrencode iptables curl

echo "=== IP forwarding ==="
cat >/etc/sysctl.d/99-wireguard.conf <<'SYS'
net.ipv4.ip_forward=1
net.ipv6.conf.all.forwarding=1
SYS
sysctl -p /etc/sysctl.d/99-wireguard.conf >/dev/null
grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.conf 2>/dev/null || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf

umask 077
mkdir -p /etc/wireguard/clients

echo "=== Ключи сервера ==="
wg genkey | tee /etc/wireguard/server_private.key | wg pubkey >/etc/wireguard/server_public.key
chmod 600 /etc/wireguard/server_private.key
SERVER_PRIV="$(cat /etc/wireguard/server_private.key)"
SERVER_PUB="$(cat /etc/wireguard/server_public.key)"

echo "=== Ключи ноутбук ==="
wg genkey | tee /etc/wireguard/notebook_private.key | wg pubkey >/etc/wireguard/notebook_public.key
NOTEBOOK_PRIV="$(cat /etc/wireguard/notebook_private.key)"
NOTEBOOK_PUB="$(cat /etc/wireguard/notebook_public.key)"

echo "=== Ключи телефон ==="
wg genkey | tee /etc/wireguard/phone_private.key | wg pubkey >/etc/wireguard/phone_public.key
PHONE_PRIV="$(cat /etc/wireguard/phone_private.key)"
PHONE_PUB="$(cat /etc/wireguard/phone_public.key)"

POST_UP="iptables -I INPUT -i ${WG_IF} -j ACCEPT; iptables -A FORWARD -i ${WG_IF} -j ACCEPT; iptables -A FORWARD -o ${WG_IF} -j ACCEPT; iptables -t nat -A POSTROUTING -o ${DEFAULT_IF} -j MASQUERADE"
POST_DOWN="iptables -t nat -D POSTROUTING -o ${DEFAULT_IF} -j MASQUERADE; iptables -D FORWARD -o ${WG_IF} -j ACCEPT; iptables -D FORWARD -i ${WG_IF} -j ACCEPT; iptables -D INPUT -i ${WG_IF} -j ACCEPT"

cat >/etc/wireguard/${WG_IF}.conf <<EOF
# setup-wireguard-two-clients.sh — $(date -Iseconds)
[Interface]
Address = ${SERVER_TUN_IP}/24
ListenPort = ${WG_PORT}
MTU = 1280
PrivateKey = ${SERVER_PRIV}
PostUp = ${POST_UP}
PostDown = ${POST_DOWN}

[Peer]
# notebook
PublicKey = ${NOTEBOOK_PUB}
AllowedIPs = ${IP_NOTEBOOK}/32

[Peer]
# phone
PublicKey = ${PHONE_PUB}
AllowedIPs = ${IP_PHONE}/32
EOF
chmod 600 "/etc/wireguard/${WG_IF}.conf"

# Клиенты: MTU 1280, только IPv4 в туннеле (::/0 убран — часто ломает Windows/IPv6 без v6 на сервере)
cat >/etc/wireguard/clients/notebook.conf <<EOF
[Interface]
PrivateKey = ${NOTEBOOK_PRIV}
Address = ${IP_NOTEBOOK}/32
MTU = 1280
DNS = 1.1.1.1

[Peer]
PublicKey = ${SERVER_PUB}
Endpoint = ${ENDPOINT}:${WG_PORT}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
EOF

cat >/etc/wireguard/clients/phone.conf <<EOF
[Interface]
PrivateKey = ${PHONE_PUB}
Address = ${IP_PHONE}/32
MTU = 1280
DNS = 1.1.1.1

[Peer]
PublicKey = ${SERVER_PUB}
Endpoint = ${ENDPOINT}:${WG_PORT}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
EOF
chmod 600 /etc/wireguard/clients/notebook.conf /etc/wireguard/clients/phone.conf

echo "${ENDPOINT}" >/etc/wireguard/endpoint.txt
echo "${WG_PORT}" >/etc/wireguard/port.txt
echo "${DEFAULT_IF}" >/etc/wireguard/wan_if.txt

echo "=== UFW (если установлен) ==="
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow "${WG_PORT}/udp" >/dev/null 2>&1 || true
  if grep -q '^DEFAULT_FORWARD_POLICY=' /etc/default/ufw; then
    sed -i 's/^DEFAULT_FORWARD_POLICY=.*/DEFAULT_FORWARD_POLICY="ACCEPT"/' /etc/default/ufw
  else
    echo 'DEFAULT_FORWARD_POLICY="ACCEPT"' >> /etc/default/ufw
  fi
  ufw route allow in on "${WG_IF}" out on "${DEFAULT_IF}" >/dev/null 2>&1 || true
  ufw route allow in on "${DEFAULT_IF}" out on "${WG_IF}" >/dev/null 2>&1 || true
  ufw --force reload >/dev/null 2>&1 || true
  echo "UFW: порт ${WG_PORT}/udp, forward для ${WG_IF}<->${DEFAULT_IF}"
fi

systemctl enable "wg-quick@${WG_IF}.service"
systemctl restart "wg-quick@${WG_IF}.service"

echo ""
echo "=== Готово ==="
echo "Внешний интерфейс: ${DEFAULT_IF}"
echo "Endpoint клиентов: ${ENDPOINT}:${WG_PORT}"
echo "Сервер в туннеле: ${SERVER_TUN_IP}"
echo "Ноутбук: ${IP_NOTEBOOK} -> /etc/wireguard/clients/notebook.conf"
echo "Телефон: ${IP_PHONE} -> /etc/wireguard/clients/phone.conf"
echo ""
wg show
echo ""
echo "=== Скопируйте на ПК (из PowerShell) ==="
echo "scp root@${ENDPOINT}:/etc/wireguard/clients/notebook.conf %USERPROFILE%\\Downloads\\"
echo ""
echo "=== Телефон: QR ==="
qrencode -t ANSIUTF8 </etc/wireguard/clients/phone.conf 2>/dev/null || true
echo ""
echo "Файлы: /etc/wireguard/clients/notebook.conf и phone.conf"
echo "Публичный ключ сервера (для проверки): ${SERVER_PUB}"
echo ""
