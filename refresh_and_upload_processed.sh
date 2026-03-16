#!/usr/bin/env zsh
set -euo pipefail

ROOT="/Users/pp-bot/.openclaw/workspace_2/hormuz-dashboard"
WORKROOT="/Users/pp-bot/.openclaw/workspace_2"
LOG="$WORKROOT/hormuz_processed_remote.log"
OUT_DIR="$ROOT/public/data"
BUCKET="x-scrapes-public"
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

if [[ -f "$WORKROOT/.env" ]]; then
  set -a
  source "$WORKROOT/.env"
  set +a
fi

export HORMUZ_SOURCE_MODE="${HORMUZ_SOURCE_MODE:-local}"
export HORMUZ_SOURCE_ROOT="${HORMUZ_SOURCE_ROOT:-$WORKROOT}"
export HORMUZ_SOURCE_MIN_AGE_SECONDS="${HORMUZ_SOURCE_MIN_AGE_SECONDS:-120}"

: "${SUPABASE_URL:?SUPABASE_URL missing}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY missing}"

API_BASE="${SUPABASE_URL%/}/storage/v1"
LATEST_CACHE_CONTROL="public, max-age=60, s-maxage=60, stale-while-revalidate=30"
HEAVY_CACHE_CONTROL="public, max-age=300, s-maxage=300, stale-while-revalidate=60"

cache_control_for_object() {
  case "$1" in
    processed_playback_24h.json|processed_playback_48h.json|processed_external_24h.json|processed_external_48h.json|processed_shipmeta_24h.json|processed_shipmeta_48h.json)
      echo "$HEAVY_CACHE_CONTROL"
      ;;
    *)
      echo "$LATEST_CACHE_CONTROL"
      ;;
  esac
}

{
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] refresh start"
  cd "$ROOT"
  npm run -s build:data

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
      -H "Content-Type: application/json" \
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
