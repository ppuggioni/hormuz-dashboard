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
MODEL="${HORMUZ_SPOOFING_AUDIT_MODEL:-gpt-5.5}"
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
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] spoofing audit start run_id=${RUN_ID} dry_run=${DRY_RUN} auto_apply=${AUTO_APPLY} publish=${PUBLISH} telegram=${TELEGRAM} lookback_hours=${LOOKBACK_HOURS} model=${MODEL} effort=${EFFORT}"
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
  gtimeout "$TIMEOUT_SECONDS" codex "${codex_args[@]}" - < "$PROMPT_FILE" > "$EVENT_LOG" 2> "$STDERR_LOG"
  run_status=$?
elif command -v timeout >/dev/null 2>&1; then
  timeout "$TIMEOUT_SECONDS" codex "${codex_args[@]}" - < "$PROMPT_FILE" > "$EVENT_LOG" 2> "$STDERR_LOG"
  run_status=$?
else
  codex "${codex_args[@]}" - < "$PROMPT_FILE" > "$EVENT_LOG" 2> "$STDERR_LOG"
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
  if [[ -z "$chat_ids" ]]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] spoofing audit telegram skipped: no HORMUZ_SPOOFING_AUDIT_TELEGRAM_CHAT_IDS or TELEGRAM_ALLOWED_CHATS" >> "$LOG"
    return 0
  fi

  node --input-type=module - "$FINAL_REPORT" "$JSON_REPORT" "$RUN_ID" "$DRY_RUN" "$AUTO_APPLY" "$PUBLISH" "$chat_ids" <<'NODE'
const [finalPath, jsonPath, runId, dryRun, autoApply, publish, chatIdsRaw] = process.argv.slice(2);
const fs = await import('node:fs/promises');
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatIds = String(chatIdsRaw || '').split(',').map((x) => x.trim()).filter(Boolean);
let summary = '';
try {
  const report = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  const high = report.highConfidenceCandidates?.length ?? 0;
  const applied = report.appliedEventIds?.length ?? 0;
  summary = [
    `Hormuz spoofing audit ${runId}`,
    `dryRun=${dryRun} autoApply=${autoApply} publish=${publish}`,
    `ok=${report.ok} high=${high} applied=${applied} published=${Boolean(report.published)}`,
    report.errors?.length ? `errors=${report.errors.join('; ')}` : '',
  ].filter(Boolean).join('\n');
} catch {
  try {
    summary = await fs.readFile(finalPath, 'utf8');
  } catch {
    summary = `Hormuz spoofing audit ${runId}: no report available`;
  }
}
summary = summary.slice(0, 3500);
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
