#!/usr/bin/env zsh
set -euo pipefail

ROOT="/Users/pp-bot/.openclaw/workspace_2/hormuz-dashboard"
WORKROOT="/Users/pp-bot/.openclaw/workspace_2"
LOG="$WORKROOT/hormuz_processed_remote.log"
OUT_DIR="$ROOT/public/data"
WINDOWED_OUTPUT_ROOT="${HORMUZ_WINDOWED_OUTPUT_ROOT:-$ROOT/public/data-windowed}"
WINDOWED_CURRENT_DIR="$WINDOWED_OUTPUT_ROOT/current"
BUCKET="x-scrapes-public"
OBJECTS=(
  "processed_core.json"
  "processed_meta.json"
  "processed_paths.json"
  "processed_paths_tanker_7d.json"
  "processed_paths_cargo_7d.json"
  "processed_paths_tanker_all.json"
  "processed_paths_cargo_all.json"
  "processed_red_sea_routes.json"
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
LOCKDIR="$WORKROOT/.locks/hormuz_processed_refresh.lock"
PIDFILE="$LOCKDIR/pid"
mkdir -p "$WORKROOT/.locks"

if ! mkdir "$LOCKDIR" 2>/dev/null; then
  if [[ -f "$PIDFILE" ]]; then
    existing_pid="$(cat "$PIDFILE" 2>/dev/null || true)"
    if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] another refresh_and_upload_processed.sh run is already active; skipping" >> "$LOG"
      exit 0
    fi
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] stale refresh lock detected for pid=${existing_pid:-unknown}; clearing" >> "$LOG"
  else
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] stale refresh lock detected without pid; clearing" >> "$LOG"
  fi
  rm -rf "$LOCKDIR"
  mkdir "$LOCKDIR"
fi
printf '%s\n' "$$" > "$PIDFILE"
cleanup_lock() {
  rm -rf "$LOCKDIR" >/dev/null 2>&1 || true
}
trap cleanup_lock EXIT INT TERM HUP

if [[ -f "$WORKROOT/.env" ]]; then
  set -a
  source "$WORKROOT/.env"
  set +a
fi

export HORMUZ_SOURCE_MODE="${HORMUZ_SOURCE_MODE:-local}"
export HORMUZ_SOURCE_ROOT="${HORMUZ_SOURCE_ROOT:-$WORKROOT}"
export HORMUZ_SOURCE_MIN_AGE_SECONDS="${HORMUZ_SOURCE_MIN_AGE_SECONDS:-120}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=16384}"

: "${SUPABASE_URL:?SUPABASE_URL missing}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY missing}"

API_BASE="${SUPABASE_URL%/}/storage/v1"
LATEST_CACHE_CONTROL="public, max-age=300, s-maxage=300, stale-while-revalidate=60"
HEAVY_CACHE_CONTROL="public, max-age=1800, s-maxage=1800, stale-while-revalidate=300"

cache_control_for_object() {
  case "$1" in
    processed_paths.json|processed_paths_tanker_all.json|processed_paths_cargo_all.json|processed_red_sea_routes.json|processed_playback_24h.json|processed_playback_48h.json|processed_external_24h.json|processed_external_48h.json|processed_shipmeta_24h.json|processed_shipmeta_48h.json)
      echo "$HEAVY_CACHE_CONTROL"
      ;;
    *)
      echo "$LATEST_CACHE_CONTROL"
      ;;
  esac
}

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
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] refresh start"
  cd "$ROOT"
  export HORMUZ_WINDOWED_PREVIOUS_DIR="${HORMUZ_WINDOWED_PREVIOUS_DIR:-$OUT_DIR}"
  npm run -s windowed:refresh
  promote_windowed_current_to_live

  if [[ ! -f "$OUT_DIR/processed_core.json" ]]; then
    echo "processed_core.json missing after build"
    exit 1
  fi

  total_raw=0
  total_gzip=0
  for obj in "${OBJECTS[@]}"; do
    local_path="$OUT_DIR/$obj"
    if [[ ! -f "$local_path" ]]; then
      echo "missing artifact: $obj"
      exit 1
    fi

    gz_out="/tmp/hormuz_${obj}.gz"
    gzip -c "$local_path" > "$gz_out"

    cache_control="$(cache_control_for_object "$obj")"

    curl -fsS -X POST "${API_BASE}/object/${BUCKET}/multi_region/${obj}" \
      -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
      -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
      -H "Content-Type: application/octet-stream" \
      -H "Content-Encoding: gzip" \
      -H "Cache-Control: ${cache_control}" \
      -H "x-upsert: true" \
      --data-binary "@${gz_out}" >/tmp/hormuz_processed_upload_${obj}.json

    raw_bytes=$(wc -c < "$local_path")
    gzip_bytes=$(wc -c < "$gz_out")
    total_raw=$((total_raw + raw_bytes))
    total_gzip=$((total_gzip + gzip_bytes))
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] uploaded ${obj} raw=${raw_bytes} gzip=${gzip_bytes} cache=${cache_control}"
  done

  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] upload done files=${#OBJECTS[@]} raw_total=${total_raw} gzip_total=${total_gzip} bytes"

  if [[ -n "${RESEND_API_KEY:-}" && -n "${ALERTS_FROM_EMAIL:-}" ]]; then
    if node "$ROOT/scripts/dispatch-alerts.mjs"; then
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] email alerts dispatch done"
    else
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] email alerts dispatch failed (non-fatal)"
    fi
  else
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] email alerts dispatch skipped (email env missing)"
  fi

  if [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]]; then
    if node "$ROOT/scripts/dispatch-telegram-alerts.mjs"; then
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] telegram alerts dispatch done"
    else
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] telegram alerts dispatch failed (non-fatal)"
    fi
  else
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] telegram alerts dispatch skipped (TELEGRAM_BOT_TOKEN missing)"
  fi
} >> "$LOG" 2>&1
