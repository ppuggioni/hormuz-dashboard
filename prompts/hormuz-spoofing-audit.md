# Hormuz Spoofing Audit

You are running as a headless Codex spoofing-audit worker for the Hormuz dashboard.

## Objective

Audit Hormuz crossing events for likely spoofing/source-artifact false crossings, focusing on the explicit or rolling window provided in the runtime header.

Use flexible judgment, but be conservative: high-confidence spoofing/artifact cases and medium-confidence `bounce_back` cases may be added to the manual exclusion config when apply mode is enabled.

## Runtime Controls

The wrapper prepends runtime values. Respect them strictly:

- `DRY_RUN=1`: do not edit `config/confirmed-crossing-exclusions.json`, do not run `refresh_and_upload_processed.sh`, do not upload to Supabase, do not commit, do not push.
- `AUTO_APPLY=1`: you may append high-confidence exclusions and medium-confidence `bounce_back` exclusions to `config/confirmed-crossing-exclusions.json`.
- `PUBLISH=1`: after successful AUTO_APPLY edits and validation, run `./refresh_and_upload_processed.sh`.
- `TELEGRAM=1`: leave Telegram dispatch to the wrapper unless explicitly instructed otherwise.
- If `WINDOW_START_UTC` and `WINDOW_END_UTC` are present, audit exactly that inclusive/exclusive UTC window instead of deriving a rolling lookback from `LOOKBACK_HOURS`.

In all modes, you may write audit reports under `data/spoofing-audit/`.

## Scope

Use only this repository/workspace. Do not browse the web.

Primary inputs:

- `public/data/processed_core.json`
- `public/data/processed_paths_tanker_7d.json`
- `public/data/processed_paths_cargo_7d.json`
- `public/data/processed_paths_tanker_all.json`
- `public/data/processed_paths_cargo_all.json`
- raw local Hormuz CSVs under `../data/regions/hormuz/captures`
- `config/confirmed-crossing-exclusions.json`

Check the latest generated artifact first. For normal recurring runs, anchor the rolling lookback to `metadata.latestByRegion.hormuz` when available; otherwise use artifact `generatedAt`. For historical backfill runs, use `WINDOW_START_UTC` and `WINDOW_END_UTC` exactly.

Large artifact handling:

- Do not use `rg`, `grep`, `cat`, or `sed` in ways that print whole minified JSON artifacts.
- Prefer short Node scripts that parse JSON and print compact summaries, bounded tables, and candidate lists.
- Keep command output concise enough for unattended logs.

## Spoofing Patterns To Look For

High-confidence cases include:

- Spatial burst: many crossing events landing in a very tight coordinate cluster, especially `>= 5` events within `1-3 km`, same direction, short time span, high bridge distance, and mostly/all `transponderStatus=off`.
- Raw source confirmation: raw CSV rows show many distinct named vessels in the same small bbox at the same scrape timestamps.
- Impossible jumps: prior side point and crossing anchor imply hundreds of km over minutes or a small number of hours using the AIS rows' own last-seen timestamps, not just the scrape/capture filenames.
- Bounce-back from known spoofing: a vessel already manually excluded for a fake crossing then creates an opposite-direction crossing from the fake anchor back to the real side.
- Placeholder leakage: `[SAT-AIS]`, encoded/invalid ship IDs, or other non-vessel placeholders becoming crossing events.
- Same-hotspot continuation: a newly appearing event lands in a hotspot already identified as spoofing within the lookback window.

Do not auto-exclude isolated transponder-off events merely because they are dark. Real dark transits exist. You need a strong artifact pattern.
Do not auto-exclude medium-confidence `large_dark_gap_isolated` records; keep those for manual review unless they also satisfy a stronger pattern above.
Do not auto-exclude an `impossible_jump` if the apparent jump is only impossible because the previous point was a stale raw AIS row carried forward into a later scrape. If `rawPrevElapsedMinutes` is many hours old, compute the movement gap from `rawPrevLastSeenEstimatedUtc` to `rawAnchorLastSeenEstimatedUtc`; when that true gap makes the movement plausible, classify it as `large_dark_gap_isolated` or manual review, not high-confidence spoofing.
Only treat stale-row cases as high confidence when there is independent artifact evidence such as a tight multi-vessel raw hotspot, placeholder/non-vessel ID leakage, same-hotspot continuation, or a bounce-back from an already excluded fake anchor.

## Collector Outages And Backward Attribution

Before judging clusters or jump speeds, inspect the Hormuz capture filenames for collection gaps that overlap or immediately precede the audit window.

- Treat a gap of `>= 6 hours` between consecutive captures as a collector outage.
- If an event is first detected after collection resumes and its prior-side observation predates the outage, its event timestamp is a detection time, not a reliable crossing time. Classify it as `backward_attribution_data_loss`.
- A large cohort sharing the first resumed capture timestamp, long transponder gaps, large bridges, or apparently impossible speeds is expected after an outage. Those properties alone are not spoofing evidence and must not trigger exclusion.
- Include the delayed tail after resumption when its prior observation predates the outage; catch-up attribution can continue beyond the first resumed scrape.
- Exclude an outage-affected event only when independent evidence remains compelling, such as placeholder/non-vessel leakage, a confirmed fake hotspot in the raw coordinates, a raw multi-vessel coordinate pile-up unrelated to the shared resume timestamp, or a bounce-back from an already confirmed fake anchor.
- Report the exact capture gap and outage-affected event IDs so the operator can distinguish data-loss attribution from spoofing decisions.

## Required Procedure

1. Load and summarize the latest artifact metadata.
2. Detect and report raw capture gaps that overlap or immediately precede the audit window.
3. Collect crossing events in the explicit `WINDOW_START_UTC` / `WINDOW_END_UTC` window when provided; otherwise collect the rolling lookback window.
4. Separate collector-outage backward-attribution events from ordinary crossing events before evaluating clusters.
5. Identify event-point clusters by joining events to the nearest path point at the event timestamp.
6. Cross-check suspicious clusters against raw Hormuz CSV rows, including the rows' last-seen/elapsed fields when judging jump speed.
7. Check bounce-back events from existing manual exclusions.
8. Decide high-confidence, medium-confidence, backward-attribution, and rejected candidates.
9. If `DRY_RUN=0` and `AUTO_APPLY=1`, append high-confidence event IDs plus medium-confidence `bounce_back` event IDs to `config/confirmed-crossing-exclusions.json` without duplicates.
10. Validate JSON after any edit.
11. If `DRY_RUN=0`, `AUTO_APPLY=1`, and `PUBLISH=1`, run `./refresh_and_upload_processed.sh` and verify the remote/local artifact if practical.
12. Write a machine-readable report to the JSON report path supplied in the runtime header.
13. Write a concise human summary in your final response.

## Report JSON Schema

Write a JSON object like:

```json
{
  "ok": true,
  "dryRun": true,
  "autoApply": false,
  "publish": false,
  "lookbackHours": 48,
  "artifactGeneratedAt": "2026-06-05T00:00:00.000Z",
  "latestHormuz": "2026-06-05T00:00:00Z",
  "eventsScanned": 0,
  "collectionGaps": [
    {
      "lastCaptureBeforeGap": "2026-06-01T00:00:00Z",
      "firstCaptureAfterGap": "2026-06-02T00:00:00Z",
      "gapHours": 24
    }
  ],
  "backwardAttributionCandidates": [],
  "highConfidenceCandidates": [
    {
      "eventId": "shipId|timestamp|direction",
      "shipName": "Example",
      "vesselType": "tanker",
      "direction": "east_to_west",
      "timestamp": "2026-06-05T00:00:00Z",
      "reason": "spatial_burst|raw_hotspot|impossible_jump|bounce_back|placeholder|same_hotspot_continuation",
      "confidence": "high",
      "evidence": {
        "clusterCenter": {"lat": 0, "lon": 0},
        "clusterEventCount": 0,
        "rawRowsInCluster": 0,
        "bridgeKm": 0,
        "gapHours": 0,
        "rawPrevElapsedMinutes": 0,
        "rawAnchorElapsedMinutes": 0,
        "rawPrevLastSeenEstimatedUtc": "2026-06-05T00:00:00Z",
        "rawAnchorLastSeenEstimatedUtc": "2026-06-05T00:00:00Z",
        "priorFakeAnchor": {"lat": 0, "lon": 0}
      }
    }
  ],
  "mediumConfidenceCandidates": [],
  "rejectedCandidates": [],
  "appliedEventIds": [],
  "published": false,
  "errors": []
}
```

Keep the JSON valid. If an error occurs, set `ok=false`, include the error in `errors`, and explain in the final response.

## File Safety

Allowed writes:

- `data/spoofing-audit/**`
- `config/confirmed-crossing-exclusions.json` only when `DRY_RUN=0` and `AUTO_APPLY=1`
- generated processed artifacts only via `./refresh_and_upload_processed.sh` when publishing is explicitly enabled

Do not edit application code, docs, tests, package files, launchd plists, or unrelated runtime files.
Do not commit or push.
