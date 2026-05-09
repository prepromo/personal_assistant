#!/usr/bin/env bash
# Удалить клиента WireGuard. Использование: wg-remove-client <имя>
set -euo pipefail

WG_IF="${WG_IF:-wg0}"
NAME="${1:-}"

[[ -n "$NAME" ]] || { echo "Использование: wg-remove-client <имя_клиента>" >&2; exit 1; }
[[ $EUID -eq 0 ]] || { echo "Запустите от root" >&2; exit 1; }

SAFE_NAME="$(echo "$NAME" | tr -cd 'a-zA-Z0-9_-')"
CLIENT_OUT="/etc/wireguard/clients/${SAFE_NAME}.conf"
CONF="/etc/wireguard/${WG_IF}.conf"
[[ -f "$CLIENT_OUT" ]] || { echo "Клиент не найден: $CLIENT_OUT" >&2; exit 1; }
[[ -f "$CONF" ]] || { echo "Нет $CONF" >&2; exit 1; }

PUB="$(grep -A20 "^# Client: ${SAFE_NAME}$" "$CONF" | awk '/^PublicKey = /{print $3; exit}')"
[[ -n "$PUB" ]] || { echo "Не найден PublicKey для клиента в $CONF" >&2; exit 1; }

python3 - "$CONF" "$SAFE_NAME" <<'PY'
import re, sys
path, name = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as f:
    text = f.read()
# Блок: newline + # Client: name + всё до следующего \n# Client: или конца файла
pat = re.compile(
    r"\n# Client: " + re.escape(name) + r"\b[^\n]*\n(?:.*\n)*?(?=\n# Client:|\Z)"
)
new, n = pat.subn("", text, count=1)
if n != 1:
    sys.stderr.write("Не удалось удалить блок клиента из конфига\n")
    sys.exit(1)
with open(path, "w", encoding="utf-8") as f:
    f.write(new.strip() + "\n")
PY

wg syncconf "$WG_IF" <(wg-quick strip "$CONF")
rm -f "$CLIENT_OUT"
echo "Клиент '${SAFE_NAME}' удалён."
