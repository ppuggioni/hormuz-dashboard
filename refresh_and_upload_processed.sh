#!/usr/bin/env zsh
set -euo pipefail

ROOT="/Users/pp-bot/.openclaw/workspace_2/hormuz-dashboard"
WORKROOT="/Users/pp-bot/.openclaw/workspace_2"
LOG="$WORKROOT/hormuz_processed_remote.log"
OUT="$ROOT/public/data/processed.json"
BUCKET="x-scrapes-public"
OBJECT="hormuz/processed.json"

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

  if [[ ! -f "$OUT" ]]; then
    echo "processed.json missing after build"
    exit 1
  fi

  GZ_OUT="/tmp/hormuz_processed.json.gz"
  gzip -c "$OUT" > "$GZ_OUT"

  curl -fsS -X POST "${API_BASE}/object/${BUCKET}/${OBJECT}" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -H "x-upsert: true" \
    --data-binary "@${GZ_OUT}" >/tmp/hormuz_processed_upload.json

  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] upload done raw=$(wc -c < "$OUT") gzip=$(wc -c < "$GZ_OUT") bytes"
} >> "$LOG" 2>&1
