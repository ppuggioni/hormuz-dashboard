#!/usr/bin/env zsh
set -euo pipefail

ROOT="/Users/pp-bot/.openclaw/workspace_2/hormuz-dashboard"
LOG="/Users/pp-bot/.openclaw/workspace_2/hormuz_dashboard_refresh.log"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

{
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] build:data start"
  cd "$ROOT"
  npm run -s build:data
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] build:data done"
} >> "$LOG" 2>&1
