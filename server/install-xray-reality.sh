#!/usr/bin/env bash
# Опционально: VLESS + REALITY (Xray) для обхода DPI, если WireGuard блокируют.
# Запуск на Ubuntu: sudo bash install-xray-reality.sh
# После установки импортируйте выданную ссылку в v2rayNG / Hiddify / Nekobox.
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Запустите от root: sudo $0" >&2; exit 1; }

XRAY_PORT="${XRAY_PORT:-8443}"
# Маскировка под чужой TLS (SNI/dest) — при желании смените на свой «белый» домен
REALITY_DEST="${REALITY_DEST:-www.microsoft.com:443}"
REALITY_SNI="${REALITY_SNI:-www.microsoft.com}"

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  XARCH="64" ;;
  aarch64) XARCH="arm64-v8a" ;;
  *) echo "Неподдерживаемая архитектура: $ARCH" >&2; exit 1 ;;
esac

echo "=== Установка зависимостей ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y curl unzip ca-certificates

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "=== Скачивание Xray ==="
TAG="$(curl -sL https://api.github.com/repos/XTLS/Xray-core/releases/latest | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
[[ -n "$TAG" ]] || TAG="v25.1.30"
ZIP="Xray-linux-${XARCH}.zip"
URL="https://github.com/XTLS/Xray-core/releases/download/${TAG}/${ZIP}"
curl -fsSL "$URL" -o "$TMP/xray.zip"
unzip -q "$TMP/xray.zip" -d "$TMP"
install -m 755 "$TMP/xray" /usr/local/bin/xray

UUID="$(cat /proc/sys/kernel/random/uuid)"
SHORT_ID="$(openssl rand -hex 4)"

KEYS="$(/usr/local/bin/xray x25519)"
PRIV="$(echo "$KEYS" | grep -i 'PrivateKey' | awk '{print $2}')"
PUB="$(echo "$KEYS" | grep -i '^PublicKey' | awk '{print $2}' | head -1)"
[[ -n "$PRIV" && -n "$PUB" ]] || { echo "x25519 failed — проверьте вывод: xray x25519" >&2; exit 1; }

PUB_IP="$(curl -4 -s --max-time 5 ifconfig.me 2>/dev/null || true)"
read -r -p "Публичный IP или домен для клиентов [${PUB_IP:-}]: " IN_HOST
HOST="${IN_HOST:-$PUB_IP}"
[[ -n "$HOST" ]] || { echo "Нужен адрес сервера" >&2; exit 1; }

install -d /usr/local/etc/xray
cat >/usr/local/etc/xray/config.json <<EOF
{
  "log": { "loglevel": "warning" },
  "inbounds": [
    {
      "listen": "0.0.0.0",
      "port": ${XRAY_PORT},
      "protocol": "vless",
      "settings": {
        "clients": [ { "id": "${UUID}", "flow": "xtls-rprx-vision" } ],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "tcp",
        "security": "reality",
        "realitySettings": {
          "show": false,
          "dest": "${REALITY_DEST}",
          "xver": 0,
          "serverNames": [ "${REALITY_SNI}" ],
          "privateKey": "${PRIV}",
          "shortIds": [ "${SHORT_ID}" ]
        }
      },
      "sniffing": {
        "enabled": true,
        "destOverride": ["http", "tls", "quic"]
      }
    }
  ],
  "outbounds": [
    { "protocol": "freedom", "tag": "direct" }
  ]
}
EOF

cat >/etc/systemd/system/xray.service <<'UNIT'
[Unit]
Description=Xray Service
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/xray run -config /usr/local/etc/xray/config.json
Restart=on-failure
RestartSec=3
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable xray
systemctl restart xray

# Ссылка для клиентов (v2rayNG / Hiddify и др.)
VLESS_LINK="vless://${UUID}@${HOST}:${XRAY_PORT}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=${REALITY_SNI}&fp=chrome&pbk=${PUB}&sid=${SHORT_ID}&type=tcp&headerType=none#reality-${HOST}"

cat >/root/xray-reality-client.txt <<EOF
=== Xray VLESS REALITY ===
Сервер: ${HOST}:${XRAY_PORT}
UUID: ${UUID}
Public key (pbk): ${PUB}
Short ID: ${SHORT_ID}
SNI: ${REALITY_SNI}

Импорт одной строкой (скопируйте целиком):
${VLESS_LINK}
EOF

echo ""
echo "=== Готово. Служба: systemctl status xray ==="
echo "Конфиг: /usr/local/etc/xray/config.json"
echo "Строка для импорта сохранена: /root/xray-reality-client.txt"
echo ""
cat /root/xray-reality-client.txt
echo ""
echo "Откройте порт в firewall: ufw allow ${XRAY_PORT}/tcp"
echo ""
