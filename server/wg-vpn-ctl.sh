#!/usr/bin/env bash
# Управление службой WireGuard на сервере: start | stop | restart | status
set -euo pipefail

WG_IF="${WG_IF:-wg0}"
UNIT="wg-quick@${WG_IF}.service"
CMD="${1:-}"

case "$CMD" in
  start)   systemctl start "$UNIT" ;;
  stop)    systemctl stop "$UNIT" ;;
  restart) systemctl restart "$UNIT" ;;
  status)  systemctl status "$UNIT" --no-pager ;;
  enable)  systemctl enable "$UNIT" ;;
  disable) systemctl disable "$UNIT" ;;
  *)
    echo "Использование: wg-vpn-ctl {start|stop|restart|status|enable|disable}"
    echo "Текущий интерфейс: $WG_IF ($UNIT)"
    exit 1
    ;;
esac
