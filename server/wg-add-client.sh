#!/usr/bin/env bash
# Добавить клиента WireGuard (сервер). Использование: wg-add-client <имя>
set -euo pipefail

WG_IF="${WG_IF:-wg0}"
NAME="${1:-}"

[[ -n "$NAME" ]] || { echo "Использование: wg-add-client <имя_клиента>" >&2; exit 1; }
[[ $EUID -eq 0 ]] || { echo "Запустите от root: sudo wg-add-client $NAME" >&2; exit 1; }

CONF="/etc/wireguard/${WG_IF}.conf"
ENDPOINT_FILE="/etc/wireguard/endpoint.txt"
[[ -f "$CONF" ]] || { echo "Сначала установите сервер: install-wireguard.sh" >&2; exit 1; }

SAFE_NAME="$(echo "$NAME" | tr -cd 'a-zA-Z0-9_-')"
[[ -n "$SAFE_NAME" ]] || { echo "Имя должно содержать буквы/цифры/дефис" >&2; exit 1; }

CLIENT_OUT="/etc/wireguard/clients/${SAFE_NAME}.conf"
[[ ! -f "$CLIENT_OUT" ]] || { echo "Клиент уже существует: $CLIENT_OUT" >&2; exit 1; }

NEXT_ID="$(cat /etc/wireguard/next_client_id.txt)"
CLIENT_IP="10.7.0.${NEXT_ID}"
ENDPOINT="$(cat "$ENDPOINT_FILE")"
PORT="$(cat /etc/wireguard/port.txt)"
SERVER_PUB="$(cat /etc/wireguard/server_public.key)"

umask 077
WG_PRIV="$(wg genkey)"
WG_PUB="$(echo "$WG_PRIV" | wg pubkey)"

{
  echo ""
  echo "# Client: ${SAFE_NAME}"
  echo "[Peer]"
  echo "PublicKey = ${WG_PUB}"
  echo "AllowedIPs = ${CLIENT_IP}/32"
} >>"$CONF"

wg syncconf "$WG_IF" <(wg-quick strip "$CONF")

cat >"$CLIENT_OUT" <<EOF
[Interface]
PrivateKey = ${WG_PRIV}
Address = ${CLIENT_IP}/24
DNS = 1.1.1.1, 2606:4700:4700::1111

[Peer]
PublicKey = ${SERVER_PUB}
Endpoint = ${ENDPOINT}:${PORT}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
EOF
chmod 600 "$CLIENT_OUT"

echo "$((NEXT_ID + 1))" >/etc/wireguard/next_client_id.txt

echo ""
echo "=== Клиент '${SAFE_NAME}' добавлен ==="
echo "IP в туннеле: ${CLIENT_IP}"
echo "Файл конфигурации: ${CLIENT_OUT}"
echo ""
echo "--- Содержимое для импорта (скопируйте в файл .conf) ---"
cat "$CLIENT_OUT"
echo "--- конец ---"
echo ""
if command -v qrencode >/dev/null 2>&1; then
  echo "QR для WireGuard (Android/iOS):"
  qrencode -t ANSIUTF8 <"$CLIENT_OUT"
fi
