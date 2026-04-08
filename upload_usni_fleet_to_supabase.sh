#!/usr/bin/env zsh
set -euo pipefail

ROOT="/Users/pp-bot/.openclaw/workspace_2/hormuz-dashboard"
WORKROOT="/Users/pp-bot/.openclaw/workspace_2"
LOG="$WORKROOT/hormuz_usni_fleet_remote.log"
FLEET_FILE="$ROOT/public/data/usni_fleet_tracker.json"
MAP_DIR="$ROOT/public/data/usni_fleet_maps"
BUCKET="x-scrapes-public"
FLEET_OBJECT_PATH="hormuz/usni_fleet_tracker.json"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if [[ -f "$WORKROOT/.env" ]]; then
  set -a
  source "$WORKROOT/.env"
  set +a
fi

: "${SUPABASE_URL:?SUPABASE_URL missing}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY missing}"

API_BASE="${SUPABASE_URL%/}/storage/v1"
CACHE_CONTROL_JSON="public, max-age=900, s-maxage=900, stale-while-revalidate=120"
CACHE_CONTROL_IMG="public, max-age=3600, s-maxage=3600, stale-while-revalidate=600"

mime_type_for() {
  case "$1" in
    *.json) echo "application/json" ;;
    *.png) echo "image/png" ;;
    *.jpg|*.jpeg) echo "image/jpeg" ;;
    *.webp) echo "image/webp" ;;
    *) echo "application/octet-stream" ;;
  esac
}

upload_file() {
  local file_path="$1"
  local object_path="$2"
  local content_type="$3"
  local cache_control="$4"

  curl -fsS -X POST "${API_BASE}/object/${BUCKET}/${object_path}" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: ${content_type}" \
    -H "Cache-Control: ${cache_control}" \
    -H "x-upsert: true" \
    --data-binary "@${file_path}" >/tmp/hormuz_usni_fleet_upload.json
}

{
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] usni-fleet upload start"
  cd "$ROOT"
  npm run -s ingest:usni-fleet
  npm run -s extract:usni-fleet-maps
  npm run -s build:usni-fleet

  [[ -f "$FLEET_FILE" ]] || { echo "usni_fleet_tracker.json missing after build"; exit 1; }

  upload_file "$FLEET_FILE" "$FLEET_OBJECT_PATH" "application/json" "$CACHE_CONTROL_JSON"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] uploaded ${FLEET_OBJECT_PATH} raw=$(wc -c < "$FLEET_FILE")"

  if [[ -d "$MAP_DIR" ]]; then
    while IFS= read -r file_path; do
      [[ -n "$file_path" ]] || continue
      rel_path="${file_path#$ROOT/public/data/}"
      object_path="hormuz/${rel_path}"
      content_type="$(mime_type_for "$file_path")"
      upload_file "$file_path" "$object_path" "$content_type" "$CACHE_CONTROL_IMG"
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] uploaded ${object_path} raw=$(wc -c < "$file_path")"
    done < <(find "$MAP_DIR" -type f | sort)
  fi
} >> "$LOG" 2>&1
