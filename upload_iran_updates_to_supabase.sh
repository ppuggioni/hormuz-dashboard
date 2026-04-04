#!/usr/bin/env zsh
set -euo pipefail

ROOT="/Users/pp-bot/.openclaw/workspace_2/hormuz-dashboard"
WORKROOT="/Users/pp-bot/.openclaw/workspace_2"
LOG="$WORKROOT/hormuz_iran_updates_remote.log"
UPDATES_FILE="$ROOT/public/data/iran_updates.json"
FIGURES_FILE="$ROOT/public/data/iran_update_figures.json"
FIGURE_DIR="$ROOT/public/data/iran_update_figures"
PUBLISH_STATE_PATH="$ROOT/data/iran-update-publish-state.json"
BUCKET="x-scrapes-public"
UPDATES_OBJECT_PATH="hormuz/iran_updates.json"
FIGURES_OBJECT_PATH="hormuz/iran_update_figures.json"
RUN_EXTRACTION="${HORMUZ_IRAN_UPDATE_RUN_EXTRACTION:-1}"
EXTRACT_RECENT_DAYS="${HORMUZ_IRAN_UPDATE_RECENT_DAYS:-1}"
UPLOAD_RECENT_DAYS="${HORMUZ_IRAN_UPDATE_UPLOAD_RECENT_DAYS:-1}"

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
    --data-binary "@${file_path}" >/tmp/hormuz_iran_updates_upload.json
}

write_publish_state() {
  local publish_check_json="$1"
  PUBLISH_CHECK_JSON="$publish_check_json" node -e "const fs = require('fs'); const parsed = JSON.parse(process.env.PUBLISH_CHECK_JSON); fs.writeFileSync(parsed.publishStatePath, JSON.stringify(parsed.nextState, null, 2) + '\n', 'utf8');"
}

{
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] iran-updates upload start"
  cd "$ROOT"
  npm run -s ingest:iran-updates

  publish_check="$(node scripts/should-publish-iran-updates.mjs)"
  echo "$publish_check"
  should_publish="$(printf '%s' "$publish_check" | node -e "let data='';process.stdin.on('data',d=>data+=d);process.stdin.on('end',()=>{const parsed=JSON.parse(data);process.stdout.write(parsed.shouldPublish ? '1' : '0');});")"

  if [[ "$should_publish" != "1" ]]; then
    write_publish_state "$publish_check"
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] iran-updates no-op; latest report already published"
    exit 0
  fi

  if [[ "$RUN_EXTRACTION" == "1" ]]; then
    HORMUZ_IRAN_UPDATE_RECENT_DAYS="$EXTRACT_RECENT_DAYS" npm run -s extract:iran-update-figures
  fi
  npm run -s build:iran-updates

  [[ -f "$UPDATES_FILE" ]] || { echo "iran_updates.json missing after build"; exit 1; }
  [[ -f "$FIGURES_FILE" ]] || { echo "iran_update_figures.json missing after build"; exit 1; }

  upload_file "$UPDATES_FILE" "$UPDATES_OBJECT_PATH" "application/json" "$CACHE_CONTROL_JSON"
  upload_file "$FIGURES_FILE" "$FIGURES_OBJECT_PATH" "application/json" "$CACHE_CONTROL_JSON"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] uploaded ${UPDATES_OBJECT_PATH} raw=$(wc -c < "$UPDATES_FILE")"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] uploaded ${FIGURES_OBJECT_PATH} raw=$(wc -c < "$FIGURES_FILE")"

  if [[ -d "$FIGURE_DIR" ]]; then
    while IFS=$'\t' read -r rel_path object_path; do
      [[ -n "$rel_path" ]] || continue
      rel_path="${rel_path#iran_update_figures/}"
      file_path="$FIGURE_DIR/$rel_path"
      content_type="$(mime_type_for "$file_path")"
      upload_file "$file_path" "$object_path" "$content_type" "$CACHE_CONTROL_IMG"
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] uploaded ${object_path} raw=$(wc -c < "$file_path")"
    done < <(
      HORMUZ_IRAN_UPDATE_UPLOAD_RECENT_DAYS="$UPLOAD_RECENT_DAYS" node - <<'NODE'
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync('public/data/iran_updates.json', 'utf8'));
const recentDays = Number.parseInt(process.env.HORMUZ_IRAN_UPDATE_UPLOAD_RECENT_DAYS || '1', 10);
const items = Array.isArray(payload.items) ? payload.items : [];
const latestPublishedAt = items.map((item) => item.publishedAt).filter(Boolean).sort((a, b) => +new Date(b) - +new Date(a))[0] || null;
let threshold = null;
if (latestPublishedAt && Number.isFinite(recentDays) && recentDays > 0) {
  const latest = new Date(latestPublishedAt);
  threshold = Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth(), latest.getUTCDate()) - ((recentDays - 1) * 24 * 60 * 60 * 1000);
}
for (const item of items) {
  if (threshold != null && !(item.publishedAt && +new Date(item.publishedAt) >= threshold)) continue;
  for (const figure of item.figures || []) {
    if (!figure.imagePath || !figure.objectPath) continue;
    console.log(`${figure.imagePath}\t${figure.objectPath}`);
  }
}
NODE
    )
  fi

  write_publish_state "$publish_check"
} >> "$LOG" 2>&1
