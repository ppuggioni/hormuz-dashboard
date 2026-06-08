#!/usr/bin/env zsh
set -euo pipefail

ROOT="/Users/pp-bot/.openclaw/workspace_2/hormuz-dashboard"
WORKROOT="/Users/pp-bot/.openclaw/workspace_2"
BACKFILL_ROOT="$ROOT/data/spoofing-audit/backfill"
RUN_ID="${HORMUZ_SPOOFING_BACKFILL_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
RUN_DIR="$BACKFILL_ROOT/$RUN_ID"
PLAN_JSON="$RUN_DIR/plan.json"
PLAN_TSV="$RUN_DIR/chunks.tsv"
RESULTS_JSONL="$RUN_DIR/results.jsonl"
SUMMARY_JSON="$RUN_DIR/summary.json"
LOG="$RUN_DIR/backfill.log"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

CHUNK_DAYS="${HORMUZ_SPOOFING_BACKFILL_CHUNK_DAYS:-14}"
START_UTC="${HORMUZ_SPOOFING_BACKFILL_START_UTC:-}"
END_UTC="${HORMUZ_SPOOFING_BACKFILL_END_UTC:-}"
DRY_RUN="${HORMUZ_SPOOFING_BACKFILL_DRY_RUN:-1}"
AUTO_APPLY="${HORMUZ_SPOOFING_BACKFILL_AUTO_APPLY:-0}"
PUBLISH_EACH="${HORMUZ_SPOOFING_BACKFILL_PUBLISH_EACH:-0}"
FINAL_PUBLISH="${HORMUZ_SPOOFING_BACKFILL_FINAL_PUBLISH:-0}"
TELEGRAM="${HORMUZ_SPOOFING_BACKFILL_TELEGRAM:-0}"
MODEL="${HORMUZ_SPOOFING_BACKFILL_MODEL:-${HORMUZ_SPOOFING_AUDIT_MODEL:-gpt-5.5}}"
EFFORT="${HORMUZ_SPOOFING_BACKFILL_REASONING_EFFORT:-${HORMUZ_SPOOFING_AUDIT_REASONING_EFFORT:-xhigh}}"
TIMEOUT_SECONDS="${HORMUZ_SPOOFING_BACKFILL_TIMEOUT_SECONDS:-7200}"
RESUME_FROM_CHUNK="${HORMUZ_SPOOFING_BACKFILL_RESUME_FROM_CHUNK:-1}"

if ! [[ "$RESUME_FROM_CHUNK" == <-> ]] || [[ "$RESUME_FROM_CHUNK" -lt 1 ]]; then
  echo "Invalid HORMUZ_SPOOFING_BACKFILL_RESUME_FROM_CHUNK: $RESUME_FROM_CHUNK" >&2
  exit 2
fi

CHUNK_HOURS="$(node --input-type=module -e 'const d = Number(process.argv[1]); if (!Number.isFinite(d) || d <= 0) { process.exit(2); } console.log(Math.max(1, Math.ceil(d * 24)));' "$CHUNK_DAYS")"

mkdir -p "$RUN_DIR"
if [[ "$RESUME_FROM_CHUNK" -le 1 ]]; then
  : > "$RESULTS_JSONL"
  : > "$LOG"
else
  touch "$RESULTS_JSONL" "$LOG"
fi

if [[ -f "$WORKROOT/.env" ]]; then
  set -a
  source "$WORKROOT/.env"
  set +a
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] backfill start id=${RUN_ID} chunk_days=${CHUNK_DAYS} chunk_hours=${CHUNK_HOURS} dry_run=${DRY_RUN} auto_apply=${AUTO_APPLY} publish_each=${PUBLISH_EACH} final_publish=${FINAL_PUBLISH} telegram=${TELEGRAM} resume_from_chunk=${RESUME_FROM_CHUNK}" | tee -a "$LOG"

if [[ "$RESUME_FROM_CHUNK" -gt 1 && -s "$PLAN_JSON" && -s "$PLAN_TSV" ]]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] resume using existing plan ${PLAN_JSON}" | tee -a "$LOG"
  node --input-type=module - "$PLAN_JSON" <<'NODE'
import fs from 'node:fs';

const [planPath] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
console.log(JSON.stringify({
  startUtc: plan.startUtc,
  endUtc: plan.endUtc,
  totalEvents: plan.totalEvents,
  chunkCount: plan.chunkCount,
  chunkDays: plan.chunkDays,
}, null, 2));
NODE
else
  node --input-type=module - "$PLAN_JSON" "$PLAN_TSV" "$CHUNK_DAYS" "$START_UTC" "$END_UTC" <<'NODE'
import fs from 'node:fs';

const [planPath, tsvPath, chunkDaysRaw, startRaw, endRaw] = process.argv.slice(2);
const chunkDays = Number.parseFloat(chunkDaysRaw || '14');
if (!Number.isFinite(chunkDays) || chunkDays <= 0) throw new Error(`Invalid chunk days: ${chunkDaysRaw}`);

const core = JSON.parse(fs.readFileSync('public/data/processed_core.json', 'utf8'));
const events = (core.data?.crossingEvents || [])
  .map((event) => ({ ...event, ms: +new Date(event.t) }))
  .filter((event) => Number.isFinite(event.ms))
  .sort((a, b) => a.ms - b.ms);

if (!events.length) throw new Error('No crossing events found in public/data/processed_core.json');

const firstMs = events[0].ms;
const lastMs = events.at(-1).ms;
const startMs = startRaw ? +new Date(startRaw) : firstMs;
const endMs = endRaw ? +new Date(endRaw) : lastMs + 1;
if (!Number.isFinite(startMs)) throw new Error(`Invalid start UTC: ${startRaw}`);
if (!Number.isFinite(endMs)) throw new Error(`Invalid end UTC: ${endRaw}`);
if (endMs <= startMs) throw new Error(`End must be after start: ${startRaw} / ${endRaw}`);

const chunkMs = chunkDays * 24 * 60 * 60 * 1000;
const chunks = [];
for (let cursor = startMs; cursor < endMs; cursor += chunkMs) {
  const chunkStart = cursor;
  const chunkEnd = Math.min(cursor + chunkMs, endMs);
  const chunkEvents = events.filter((event) => event.ms >= chunkStart && event.ms < chunkEnd);
  chunks.push({
    index: chunks.length + 1,
    startUtc: new Date(chunkStart).toISOString(),
    endUtc: new Date(chunkEnd).toISOString(),
    eventCount: chunkEvents.length,
    westToEast: chunkEvents.filter((event) => event.direction === 'west_to_east').length,
    eastToWest: chunkEvents.filter((event) => event.direction === 'east_to_west').length,
    excludedAtPlanTime: chunkEvents.filter((event) => event.manuallyExcluded).length,
  });
}

const plan = {
  generatedAt: new Date().toISOString(),
  chunkDays,
  startUtc: new Date(startMs).toISOString(),
  endUtc: new Date(endMs).toISOString(),
  sourceGeneratedAt: core.metadata?.generatedAt || core.generatedAt || null,
  latestHormuz: core.metadata?.latestByRegion?.hormuz || null,
  totalEvents: events.length,
  chunkCount: chunks.length,
  chunks,
};

fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
fs.writeFileSync(tsvPath, chunks.map((chunk) => [
  chunk.index,
  chunks.length,
  chunk.startUtc,
  chunk.endUtc,
  chunk.eventCount,
].join('\t')).join('\n') + '\n');

console.log(JSON.stringify({
  startUtc: plan.startUtc,
  endUtc: plan.endUtc,
  totalEvents: plan.totalEvents,
  chunkCount: plan.chunkCount,
  chunkDays: plan.chunkDays,
}, null, 2));
NODE
fi

while IFS=$'\t' read -r chunk_index chunk_count chunk_start chunk_end event_count; do
  if [[ -z "$chunk_index" ]]; then
    continue
  fi
  if [[ "$chunk_index" -lt "$RESUME_FROM_CHUNK" ]]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] chunk ${chunk_index}/${chunk_count} skipped by resume_from_chunk=${RESUME_FROM_CHUNK}" | tee -a "$LOG"
    continue
  fi

  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] chunk ${chunk_index}/${chunk_count} start=${chunk_start} end=${chunk_end} events=${event_count}" | tee -a "$LOG"

  set +e
  HORMUZ_SPOOFING_AUDIT_DRY_RUN="$DRY_RUN" \
    HORMUZ_SPOOFING_AUDIT_AUTO_APPLY="$AUTO_APPLY" \
    HORMUZ_SPOOFING_AUDIT_PUBLISH="$PUBLISH_EACH" \
    HORMUZ_SPOOFING_AUDIT_TELEGRAM="$TELEGRAM" \
    HORMUZ_SPOOFING_AUDIT_LOOKBACK_HOURS="$CHUNK_HOURS" \
    HORMUZ_SPOOFING_AUDIT_WINDOW_START_UTC="$chunk_start" \
    HORMUZ_SPOOFING_AUDIT_WINDOW_END_UTC="$chunk_end" \
    HORMUZ_SPOOFING_AUDIT_BACKFILL_ID="$RUN_ID" \
    HORMUZ_SPOOFING_AUDIT_BACKFILL_CHUNK_INDEX="$chunk_index" \
    HORMUZ_SPOOFING_AUDIT_BACKFILL_CHUNK_COUNT="$chunk_count" \
    HORMUZ_SPOOFING_AUDIT_MODEL="$MODEL" \
    HORMUZ_SPOOFING_AUDIT_REASONING_EFFORT="$EFFORT" \
    HORMUZ_SPOOFING_AUDIT_TIMEOUT_SECONDS="$TIMEOUT_SECONDS" \
    "$ROOT/scripts/run-hormuz-spoofing-codex-audit.sh"
  audit_status=$?
  set -e

  latest_run="$(ls -td "$ROOT"/data/spoofing-audit/runs/* 2>/dev/null | head -n 1 || true)"
  node --input-type=module - "$RESULTS_JSONL" "$latest_run" "$chunk_index" "$chunk_count" "$chunk_start" "$chunk_end" "$event_count" "$audit_status" <<'NODE'
import fs from 'node:fs';

const [resultsPath, runDir, chunkIndex, chunkCount, chunkStart, chunkEnd, eventCount, statusRaw] = process.argv.slice(2);
let report = null;
let status = null;
try {
  report = JSON.parse(fs.readFileSync(`${runDir}/report.json`, 'utf8'));
} catch {}
try {
  status = JSON.parse(fs.readFileSync(`${runDir}/status.json`, 'utf8'));
} catch {}

const row = {
  chunkIndex: Number(chunkIndex),
  chunkCount: Number(chunkCount),
  chunkStart,
  chunkEnd,
  eventCount: Number(eventCount),
  wrapperStatus: Number(statusRaw),
  runDir,
  runId: status?.runId || runDir.split('/').at(-1),
  reportOk: report?.ok ?? null,
  reportStatus: status?.status ?? null,
  eventsScanned: report?.eventsScanned ?? null,
  highConfidence: report?.highConfidenceCandidates?.length ?? null,
  mediumConfidence: report?.mediumConfidenceCandidates?.length ?? null,
  mediumBounce: (report?.mediumConfidenceCandidates || []).filter((candidate) => candidate.reason === 'bounce_back').length,
  applied: report?.appliedEventIds?.length ?? null,
  published: report?.published ?? null,
  errors: report?.errors || [],
};

fs.appendFileSync(resultsPath, JSON.stringify(row) + '\n');
console.log(JSON.stringify(row, null, 2));
NODE

  if [[ "$audit_status" -ne 0 ]]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] chunk ${chunk_index}/${chunk_count} failed status=${audit_status}" | tee -a "$LOG"
    exit "$audit_status"
  fi
done < "$PLAN_TSV"

if [[ "$FINAL_PUBLISH" == "1" && "$DRY_RUN" != "1" ]]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] final publish start" | tee -a "$LOG"
  "$ROOT/refresh_and_upload_processed.sh"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] final publish done" | tee -a "$LOG"
fi

node --input-type=module - "$PLAN_JSON" "$RESULTS_JSONL" "$SUMMARY_JSON" <<'NODE'
import fs from 'node:fs';

const [planPath, resultsPath, summaryPath] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const results = fs.readFileSync(resultsPath, 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const summary = {
  generatedAt: new Date().toISOString(),
  plan,
  chunksRun: results.length,
  totals: {
    eventsScanned: results.reduce((sum, row) => sum + (row.eventsScanned || 0), 0),
    highConfidence: results.reduce((sum, row) => sum + (row.highConfidence || 0), 0),
    mediumConfidence: results.reduce((sum, row) => sum + (row.mediumConfidence || 0), 0),
    mediumBounce: results.reduce((sum, row) => sum + (row.mediumBounce || 0), 0),
    applied: results.reduce((sum, row) => sum + (row.applied || 0), 0),
    failedChunks: results.filter((row) => row.wrapperStatus !== 0 || row.reportOk === false || row.errors?.length).length,
  },
  results,
};
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary.totals, null, 2));
NODE

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] backfill done id=${RUN_ID} summary=${SUMMARY_JSON}" | tee -a "$LOG"
