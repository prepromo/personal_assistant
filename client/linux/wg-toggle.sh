#!/usr/bin/env bash
# WireGuard на Linux: wg-toggle.sh up|down|status [имя_туннеля]
set -euo pipefail
ACTION="${1:-}"
T="${2:-wg0}"
[[ -n "$ACTION" ]] || { echo "Использование: $0 up|down|status [wg0]"; exit 1; }
case "$ACTION" in
  up|down) sudo wg-quick "$ACTION" "$T" ;;
  status) sudo wg show "$T" 2>/dev/null || echo "Туннель $T не поднят" ;;
  *) echo "up|down|status"; exit 1 ;;
esac
