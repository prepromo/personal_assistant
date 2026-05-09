#!/usr/bin/env bash
# Исправление «нет интернета через WireGuard» на Ubuntu: UFW + NAT на актуальном WAN.
# Запуск на VPS: sudo bash fix-wg-internet.sh
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Запустите: sudo $0" >&2; exit 1; }

WG_IF="${WG_IF:-wg0}"
WG_CONF="/etc/wireguard/${WG_IF}.conf"
WAN_FILE="/etc/wireguard/wan_if.txt"

# Актуальный внешний интерфейс — всегда с default route (не кэш из старого wan_if.txt)
WAN="$(ip route show default 2>/dev/null | awk '{print $5}' | head -n1)"
[[ -n "$WAN" ]] || { echo "Не удалось определить WAN (ip route)." >&2; exit 1; }

OLD_WAN=""
[[ -f "$WAN_FILE" ]] && OLD_WAN="$(cat "$WAN_FILE")"
if [[ -n "$OLD_WAN" && "$OLD_WAN" != "$WAN" ]]; then
  echo "Внимание: раньше в wan_if.txt был «${OLD_WAN}», сейчас default route на «${WAN}» — обновляю NAT в ${WG_CONF}."
fi

echo "=== Диагностика ==="
echo "Туннель: ${WG_IF}, WAN: ${WAN}"
echo "ip_forward:"
sysctl net.ipv4.ip_forward net.ipv6.conf.all.forwarding 2>/dev/null || true
echo ""
echo "iptables INPUT (должен быть ACCEPT для ${WG_IF}, иначе не пингуется 10.7.0.1):"
iptables -L INPUT -n -v 2>/dev/null | head -25 || true
echo ""
echo "iptables NAT (ожидается MASQUERADE на ${WAN}):"
iptables -t nat -L POSTROUTING -n -v 2>/dev/null | head -20 || echo "(iptables недоступен)"
echo ""
echo "UFW:"
if command -v ufw >/dev/null 2>&1; then
  ufw status verbose 2>/dev/null || true
else
  echo "ufw не установлен"
fi
echo ""

echo "=== Исправление ==="
cat >/etc/sysctl.d/99-wireguard.conf <<'SYS'
net.ipv4.ip_forward=1
net.ipv6.conf.all.forwarding=1
# иначе ядро иногда отбрасывает ответы по wg0 (симметричная маршрутизация)
net.ipv4.conf.all.rp_filter=0
net.ipv4.conf.default.rp_filter=0
SYS
sysctl -p /etc/sysctl.d/99-wireguard.conf >/dev/null
[[ -f /proc/sys/net/ipv4/conf/${WG_IF}/rp_filter ]] && sysctl -w "net.ipv4.conf.${WG_IF}.rp_filter=0" >/dev/null 2>&1 || true

# Прописать в wg0.conf PostUp/PostDown под текущий WAN (иначе MASQUERADE уходит не в тот интерфейс)
if [[ -f "$WG_CONF" ]]; then
  TMP="$(mktemp)"
  awk -v wan="$WAN" -v wg="$WG_IF" '
    /^\[Interface\]/ { in_iface=1 }
    /^\[/ && $0 !~ /^\[Interface\]/ { in_iface=0 }
    in_iface && /^PostUp = / {
      print "PostUp = iptables -I INPUT -i " wg " -j ACCEPT; iptables -A FORWARD -i " wg " -j ACCEPT; iptables -A FORWARD -o " wg " -j ACCEPT; iptables -t nat -A POSTROUTING -o " wan " -j MASQUERADE"
      next
    }
    in_iface && /^PostDown = / {
      print "PostDown = iptables -t nat -D POSTROUTING -o " wan " -j MASQUERADE; iptables -D FORWARD -o " wg " -j ACCEPT; iptables -D FORWARD -i " wg " -j ACCEPT; iptables -D INPUT -i " wg " -j ACCEPT"
      next
    }
    { print }
  ' "$WG_CONF" > "$TMP" && mv "$TMP" "$WG_CONF"
  chmod 600 "$WG_CONF"
  echo "Обновлены PostUp/PostDown в ${WG_CONF}"
  if ! grep -q '^MTU = ' "$WG_CONF"; then
    sed -i '/^ListenPort = /a MTU = 1280' "$WG_CONF"
    echo "Добавлено MTU = 1280 в ${WG_CONF}"
  fi
fi

if command -v ufw >/dev/null 2>&1; then
  if grep -q '^DEFAULT_FORWARD_POLICY=' /etc/default/ufw; then
    sed -i 's/^DEFAULT_FORWARD_POLICY=.*/DEFAULT_FORWARD_POLICY="ACCEPT"/' /etc/default/ufw
  else
    echo 'DEFAULT_FORWARD_POLICY="ACCEPT"' >> /etc/default/ufw
  fi
  ufw allow OpenSSH >/dev/null 2>&1 || true
  WG_PORT="$(cat /etc/wireguard/port.txt 2>/dev/null || echo '51820')"
  ufw allow "${WG_PORT}/udp" >/dev/null 2>&1 || true
  ufw route allow in on "${WG_IF}" out on "${WAN}" >/dev/null 2>&1 || true
  ufw route allow in on "${WAN}" out on "${WG_IF}" >/dev/null 2>&1 || true
  ufw --force reload >/dev/null 2>&1 || true
  echo "UFW: DEFAULT_FORWARD_POLICY=ACCEPT, route ${WG_IF}<->${WAN}"
fi

echo "$WAN" > "$WAN_FILE"

if systemctl is-enabled "wg-quick@${WG_IF}.service" &>/dev/null; then
  systemctl restart "wg-quick@${WG_IF}.service"
else
  wg-quick down "${WG_IF}" 2>/dev/null || true
  wg-quick up "${WG_IF}"
fi

echo ""
echo "=== После правок ==="
iptables -t nat -L POSTROUTING -n -v 2>/dev/null | head -15 || true
echo ""
wg show "${WG_IF}" 2>/dev/null || wg show
echo ""
echo "На клиенте (VPN вкл): «C:\\Program Files\\WireGuard\\wg.exe» show — должен быть недавний handshake."
echo "Затем: ping 10.7.0.1  и  Test-NetConnection 1.1.1.1 -Port 443"
echo "Если handshake нет — проверьте UDP 51820 до VPS и Endpoint в конфиге."
