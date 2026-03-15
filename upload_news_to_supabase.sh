#!/usr/bin/env zsh
set -euo pipefail

ROOT="/Users/pp-bot/.openclaw/workspace_2/hormuz-dashboard"
WORKROOT="/Users/pp-bot/.openclaw/workspace_2"
LOG="$WORKROOT/hormuz_news_remote.log"
OUT_FILE="$ROOT/public/data/news_feed.json"
BUCKET="x-scrapes-public"
OBJECT_PATH="hormuz/news_feed.json"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if [[ -f "$WORKROOT/.env" ]]; then
  set -a
  source "$WORKROOT/.env"
  set +a
fi

: "${SUPABASE_URL:?SUPABASE_URL missing}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY missing}"

API_BASE="${SUPABASE_URL%/}/storage/v1"
CACHE_CONTROL="public, max-age=3600, s-maxage=3600, stale-while-revalidate=300"

{
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] news upload start"
  cd "$ROOT"
  npm run -s build:news

  if [[ ! -f "$OUT_FILE" ]]; then
    echo "news_feed.json missing after build"
    exit 1
  fi

  curl -fsS -X POST "${API_BASE}/object/${BUCKET}/${OBJECT_PATH}" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -H "Cache-Control: ${CACHE_CONTROL}" \
    -H "x-upsert: true" \
    --data-binary "@${OUT_FILE}" >/tmp/hormuz_news_upload.json

  raw_bytes=$(wc -c < "$OUT_FILE")
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] uploaded ${OBJECT_PATH} raw=${raw_bytes}"
} >> "$LOG" 2>&1
