#!/usr/bin/env zsh
set -euo pipefail

ROOT="/Users/pp-bot/.openclaw/workspace_2/hormuz-dashboard"
WORKROOT="/Users/pp-bot/.openclaw/workspace_2"
LOG="$WORKROOT/hormuz_spoofing_audit.log"
LOCKDIR="$WORKROOT/.locks/hormuz_spoofing_codex_audit.lock"
PIDFILE="$LOCKDIR/pid"
PROMPT_TEMPLATE="$ROOT/prompts/hormuz-spoofing-audit.md"
RUNS_DIR="$ROOT/data/spoofing-audit/runs"
LOGS_DIR="$ROOT/data/spoofing-audit/logs"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$WORKROOT/.locks" "$RUNS_DIR" "$LOGS_DIR"

resolve_codex_bin() {
  local candidate
  local -a candidates=()
  if [[ -n "${HORMUZ_SPOOFING_AUDIT_CODEX_BIN:-}" ]]; then
    candidates+=("$HORMUZ_SPOOFING_AUDIT_CODEX_BIN")
  fi
  if command -v codex >/dev/null 2>&1; then
    candidates+=("$(command -v codex)")
  fi
  candidates+=("/Applications/ChatGPT.app/Contents/Resources/codex")

  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]] && "$candidate" --version >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

if ! CODEX_BIN="$(resolve_codex_bin)"; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] spoofing audit failed: no working Codex CLI found" >> "$LOG"
  exit 127
fi

if ! mkdir "$LOCKDIR" 2>/dev/null; then
  if [[ -f "$PIDFILE" ]]; then
    existing_pid="$(cat "$PIDFILE" 2>/dev/null || true)"
    if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] spoofing audit already active pid=${existing_pid}; skipping" >> "$LOG"
      exit 0
    fi
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] stale spoofing audit lock pid=${existing_pid:-unknown}; clearing" >> "$LOG"
  else
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] stale spoofing audit lock without pid; clearing" >> "$LOG"
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

DRY_RUN="${HORMUZ_SPOOFING_AUDIT_DRY_RUN:-1}"
AUTO_APPLY="${HORMUZ_SPOOFING_AUDIT_AUTO_APPLY:-0}"
PUBLISH="${HORMUZ_SPOOFING_AUDIT_PUBLISH:-0}"
TELEGRAM="${HORMUZ_SPOOFING_AUDIT_TELEGRAM:-0}"
LOOKBACK_HOURS="${HORMUZ_SPOOFING_AUDIT_LOOKBACK_HOURS:-48}"
WINDOW_START_UTC="${HORMUZ_SPOOFING_AUDIT_WINDOW_START_UTC:-}"
WINDOW_END_UTC="${HORMUZ_SPOOFING_AUDIT_WINDOW_END_UTC:-}"
BACKFILL_ID="${HORMUZ_SPOOFING_AUDIT_BACKFILL_ID:-}"
BACKFILL_CHUNK_INDEX="${HORMUZ_SPOOFING_AUDIT_BACKFILL_CHUNK_INDEX:-}"
BACKFILL_CHUNK_COUNT="${HORMUZ_SPOOFING_AUDIT_BACKFILL_CHUNK_COUNT:-}"
MODEL="${HORMUZ_SPOOFING_AUDIT_MODEL:-gpt-5.6-sol}"
EFFORT="${HORMUZ_SPOOFING_AUDIT_REASONING_EFFORT:-xhigh}"
TIMEOUT_SECONDS="${HORMUZ_SPOOFING_AUDIT_TIMEOUT_SECONDS:-7200}"

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="$RUNS_DIR/$RUN_ID"
PROMPT_FILE="$RUN_DIR/prompt.md"
FINAL_REPORT="$RUN_DIR/codex-final.md"
EVENT_LOG="$RUN_DIR/codex-events.jsonl"
STDERR_LOG="$RUN_DIR/codex-stderr.log"
JSON_REPORT="$RUN_DIR/report.json"
STATUS_FILE="$RUN_DIR/status.json"
LATEST_REPORT="$ROOT/data/spoofing-audit/latest-report.json"
LATEST_FINAL="$ROOT/data/spoofing-audit/latest-codex-final.md"

mkdir -p "$RUN_DIR"

{
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] spoofing audit start run_id=${RUN_ID} dry_run=${DRY_RUN} auto_apply=${AUTO_APPLY} publish=${PUBLISH} telegram=${TELEGRAM} lookback_hours=${LOOKBACK_HOURS} window_start=${WINDOW_START_UTC:-none} window_end=${WINDOW_END_UTC:-none} backfill_id=${BACKFILL_ID:-none} chunk=${BACKFILL_CHUNK_INDEX:-none}/${BACKFILL_CHUNK_COUNT:-none} model=${MODEL} effort=${EFFORT}"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] spoofing audit codex_bin=${CODEX_BIN}"
} >> "$LOG"

{
  cat <<EOF
# Runtime Header

- RUN_ID: ${RUN_ID}
- RUN_DIR: ${RUN_DIR}
- JSON_REPORT_PATH: ${JSON_REPORT}
- FINAL_REPORT_PATH: ${FINAL_REPORT}
- NOW_UTC: $(date -u +%Y-%m-%dT%H:%M:%SZ)
- LOOKBACK_HOURS: ${LOOKBACK_HOURS}
- WINDOW_START_UTC: ${WINDOW_START_UTC}
- WINDOW_END_UTC: ${WINDOW_END_UTC}
- BACKFILL_ID: ${BACKFILL_ID}
- BACKFILL_CHUNK_INDEX: ${BACKFILL_CHUNK_INDEX}
- BACKFILL_CHUNK_COUNT: ${BACKFILL_CHUNK_COUNT}
- DRY_RUN: ${DRY_RUN}
- AUTO_APPLY: ${AUTO_APPLY}
- PUBLISH: ${PUBLISH}
- TELEGRAM: ${TELEGRAM}

EOF
  cat "$PROMPT_TEMPLATE"
} > "$PROMPT_FILE"

codex_args=(
  exec
  --cd "$ROOT"
  --sandbox danger-full-access
  -c "approval_policy=\"never\""
  -c "sandbox_mode=\"danger-full-access\""
  -c "model_reasoning_effort=\"${EFFORT}\""
  -c "plan_mode_reasoning_effort=\"${EFFORT}\""
  -c "notify=[]"
  -o "$FINAL_REPORT"
  --json
)

if [[ -n "$MODEL" ]]; then
  codex_args+=(-m "$MODEL")
fi

set +e
if command -v gtimeout >/dev/null 2>&1; then
  gtimeout "$TIMEOUT_SECONDS" "$CODEX_BIN" "${codex_args[@]}" - < "$PROMPT_FILE" > "$EVENT_LOG" 2> "$STDERR_LOG"
  run_status=$?
elif command -v timeout >/dev/null 2>&1; then
  timeout "$TIMEOUT_SECONDS" "$CODEX_BIN" "${codex_args[@]}" - < "$PROMPT_FILE" > "$EVENT_LOG" 2> "$STDERR_LOG"
  run_status=$?
else
  "$CODEX_BIN" "${codex_args[@]}" - < "$PROMPT_FILE" > "$EVENT_LOG" 2> "$STDERR_LOG"
  run_status=$?
fi
set -e

ended_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > "$STATUS_FILE" <<EOF
{
  "runId": "${RUN_ID}",
  "endedAt": "${ended_at}",
  "status": ${run_status},
  "dryRun": "${DRY_RUN}",
  "autoApply": "${AUTO_APPLY}",
  "publish": "${PUBLISH}",
  "telegram": "${TELEGRAM}",
  "windowStartUtc": "${WINDOW_START_UTC}",
  "windowEndUtc": "${WINDOW_END_UTC}",
  "backfillId": "${BACKFILL_ID}",
  "backfillChunkIndex": "${BACKFILL_CHUNK_INDEX}",
  "backfillChunkCount": "${BACKFILL_CHUNK_COUNT}",
  "jsonReport": "${JSON_REPORT}",
  "finalReport": "${FINAL_REPORT}",
  "eventLog": "${EVENT_LOG}",
  "stderrLog": "${STDERR_LOG}"
}
EOF

if [[ -f "$JSON_REPORT" ]]; then
  cp "$JSON_REPORT" "$LATEST_REPORT"
fi
if [[ -f "$FINAL_REPORT" ]]; then
  cp "$FINAL_REPORT" "$LATEST_FINAL"
fi

send_telegram_summary() {
  if [[ "$TELEGRAM" != "1" ]]; then
    return 0
  fi
  if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] spoofing audit telegram skipped: TELEGRAM_BOT_TOKEN missing" >> "$LOG"
    return 0
  fi
  local chat_ids="${HORMUZ_SPOOFING_AUDIT_TELEGRAM_CHAT_IDS:-${TELEGRAM_ALLOWED_CHATS:-}}"
  node --input-type=module - "$FINAL_REPORT" "$JSON_REPORT" "$RUN_ID" "$DRY_RUN" "$AUTO_APPLY" "$PUBLISH" "$chat_ids" <<'NODE'
const [finalPath, jsonPath, runId, dryRun, autoApply, publish, chatIdsRaw] = process.argv.slice(2);
const fs = await import('node:fs/promises');
const token = process.env.TELEGRAM_BOT_TOKEN;
let chatIds = String(chatIdsRaw || '').split(',').map((x) => x.trim()).filter(Boolean);

async function loadSubscriberChatIds() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  const response = await fetch(`${url}/rest/v1/marinetraffic_telegram_subscribers?is_active=eq.true&select=chat_id`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!response.ok) throw new Error(`Supabase subscriber lookup failed ${response.status}: ${await response.text()}`);
  const rows = await response.json();
  return rows.map((row) => String(row.chat_id || '').trim()).filter(Boolean);
}

let summary = '';
try {
  const report = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  const high = report.highConfidenceCandidates?.length ?? 0;
  const mediumBounce = (report.mediumConfidenceCandidates || []).filter((candidate) => candidate.reason === 'bounce_back').length;
  const applied = report.appliedEventIds?.length ?? 0;
  const errors = report.errors || [];
  const notable = high > 0 || mediumBounce > 0 || applied > 0 || errors.length > 0 || Boolean(report.published);
  if (!notable) {
    console.log(`Hormuz spoofing audit ${runId}: no notable findings; Telegram skipped`);
    process.exit(0);
  }
  const candidates = [
    ...(report.highConfidenceCandidates || []),
    ...(report.mediumConfidenceCandidates || []).filter((candidate) => candidate.reason === 'bounce_back'),
  ].slice(0, 16);
  const candidateLines = candidates.map((candidate) => {
    const vessel = candidate.shipName || candidate.shipId || 'unknown vessel';
    const reason = candidate.reason || candidate.confidence || 'candidate';
    const direction = candidate.direction || '';
    const timestamp = candidate.timestamp || '';
    return `- ${vessel} | ${direction} | ${timestamp} | ${reason}`;
  });
  summary = [
    `Hormuz spoofing audit ${runId}`,
    `dryRun=${dryRun} autoApply=${autoApply} publish=${publish}`,
    `ok=${report.ok} high=${high} mediumBounce=${mediumBounce} applied=${applied} published=${Boolean(report.published)}`,
    report.latestHormuz ? `latestHormuz=${report.latestHormuz}` : '',
    report.artifactGeneratedAt ? `artifactGeneratedAt=${report.artifactGeneratedAt}` : '',
    candidateLines.length ? `\nTop candidates:\n${candidateLines.join('\n')}` : '',
    errors.length ? `errors=${errors.join('; ')}` : '',
  ].filter(Boolean).join('\n');
} catch {
  try {
    summary = await fs.readFile(finalPath, 'utf8');
  } catch {
    summary = `Hormuz spoofing audit ${runId}: no report available`;
  }
}
summary = summary.slice(0, 3500);
if (!chatIds.length) chatIds = await loadSubscriberChatIds();
if (!chatIds.length) {
  console.log(`Hormuz spoofing audit ${runId}: no Telegram chat IDs or active subscribers; Telegram skipped`);
  process.exit(0);
}
for (const chat_id of chatIds) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, text: summary, disable_web_page_preview: true }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Telegram send failed ${response.status}: ${body}`);
}
NODE
}

if [[ "$run_status" -eq 0 ]]; then
  send_telegram_summary || echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] spoofing audit telegram summary failed" >> "$LOG"
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] spoofing audit done run_id=${RUN_ID} status=${run_status} report=${FINAL_REPORT} json=${JSON_REPORT}" >> "$LOG"
exit "$run_status"
