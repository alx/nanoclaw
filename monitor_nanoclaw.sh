#!/usr/bin/env bash
# monitor_nanoclaw.sh — tail all NanoClaw logs + docker containers in one stream

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"

cleanup() { kill 0; }
trap cleanup EXIT INT TERM

# File logs
tail -f "$LOG_DIR/nanoclaw.log" | sed 's/^/[app] /' &
tail -f "$LOG_DIR/nanoclaw.error.log" | sed 's/^/[err] /' &

# systemd journal (silently skip if not available)
journalctl --user -u nanoclaw -f --no-pager 2>/dev/null | sed 's/^/[svc] /' &

# Docker: poll for nanoclaw containers and follow new ones as they appear
(
  followed=""
  while true; do
    containers=$(docker ps --filter "name=nanoclaw" --format "{{.Names}}" 2>/dev/null)
    for c in $containers; do
      if ! echo "$followed" | grep -qw "$c"; then
        echo "[dkr] following $c"
        docker logs --tail 20 -f "$c" 2>&1 | sed "s/^/[dkr:$c] /" &
        followed="$followed $c"
      fi
    done
    sleep 2
  done
) &

wait
