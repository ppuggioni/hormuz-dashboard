#!/usr/bin/env zsh
set -euo pipefail

ROOT="/Users/pp-bot/.openclaw/workspace_2/hormuz-dashboard"
WORKROOT="/Users/pp-bot/.openclaw/workspace_2"
LOG="$WORKROOT/hormuz_processed_remote.log"
OUT_DIR="$ROOT/public/data"
BUCKET="x-scrapes-public"
OBJECTS=(
  "processed.json"
  "processed_core.json"
  "processed_paths.json"
  "processed_playback_24h.json"
  "processed_playback_48h.json"
  "processed_playback_72h.json"
  "processed_playback_all.json"
  "processed_external_24h.json"
  "processed_external_48h.json"
  "processed_external_72h.json"
  "processed_external_all.json"
  "processed_shipmeta_24h.json"
  "processed_shipmeta_48h.json"
  "processed_shipmeta_72h.json"
  "processed_shipmeta_all.json"
)

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if [[ -f "$WORKROOT/.env" ]]; then
  set -a
  source "$WORKROOT/.env"
  set +a
fi

: "${SUPABASE_URL:?SUPABASE_URL missing}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY missing}"

API_BASE="${SUPABASE_URL%/}/storage/v1"

{
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] refresh start"
  cd "$ROOT"
  npm run -s build:data

  if [[ ! -f "$OUT_DIR/processed.json" ]]; then
    echo "processed.json missing after build"
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

    curl -fsS -X POST "${API_BASE}/object/${BUCKET}/multi_region/${obj}" \
      -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
      -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
      -H "Content-Type: application/json" \
      -H "x-upsert: true" \
      --data-binary "@${gz_out}" >/tmp/hormuz_processed_upload_${obj}.json

    raw_bytes=$(wc -c < "$local_path")
    gzip_bytes=$(wc -c < "$gz_out")
    total_raw=$((total_raw + raw_bytes))
    total_gzip=$((total_gzip + gzip_bytes))
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] uploaded ${obj} raw=${raw_bytes} gzip=${gzip_bytes}"
  done

  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] upload done files=${#OBJECTS[@]} raw_total=${total_raw} gzip_total=${total_gzip} bytes"

  if [[ -n "${RESEND_API_KEY:-}" && -n "${ALERTS_FROM_EMAIL:-}" ]]; then
    if node "$ROOT/scripts/dispatch-alerts.mjs"; then
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] alerts dispatch done"
    else
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] alerts dispatch failed (non-fatal)"
    fi
  else
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] alerts dispatch skipped (email env missing)"
  fi
} >> "$LOG" 2>&1
