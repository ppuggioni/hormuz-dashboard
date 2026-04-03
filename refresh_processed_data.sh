#!/usr/bin/env zsh
set -euo pipefail

ROOT="/Users/pp-bot/.openclaw/workspace_2/hormuz-dashboard"
LOG="/Users/pp-bot/.openclaw/workspace_2/hormuz_dashboard_refresh.log"
OUT_DIR="$ROOT/public/data"
WINDOWED_OUTPUT_ROOT="${HORMUZ_WINDOWED_OUTPUT_ROOT:-$ROOT/public/data-windowed}"
WINDOWED_CURRENT_DIR="$WINDOWED_OUTPUT_ROOT/current"
OBJECTS=(
  "processed_core.json"
  "processed_paths.json"
  "processed_candidates.json"
  "confirmed_crossing_exclusions.json"
  "processed_playback_latest.json"
  "processed_shipmeta_latest.json"
  "processed_external_latest.json"
  "processed_playback_24h.json"
  "processed_playback_48h.json"
  "processed_external_24h.json"
  "processed_external_48h.json"
  "processed_shipmeta_24h.json"
  "processed_shipmeta_48h.json"
)

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=16384}"

promote_windowed_current_to_live() {
  mkdir -p "$OUT_DIR"
  for obj in "${OBJECTS[@]}"; do
    src_path="$WINDOWED_CURRENT_DIR/$obj"
    if [[ ! -f "$src_path" ]]; then
      echo "missing windowed artifact: $obj"
      return 1
    fi
    tmp_path="$OUT_DIR/${obj}.$$.$RANDOM.tmp"
    cp "$src_path" "$tmp_path"
    mv "$tmp_path" "$OUT_DIR/$obj"
  done
}

{
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] windowed:refresh start"
  cd "$ROOT"
  export HORMUZ_WINDOWED_PREVIOUS_DIR="${HORMUZ_WINDOWED_PREVIOUS_DIR:-$OUT_DIR}"
  npm run -s windowed:refresh
  promote_windowed_current_to_live
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] windowed:refresh done"
} >> "$LOG" 2>&1
