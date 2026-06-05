# Hormuz Spoofing Audit

You are running as a headless Codex spoofing-audit worker for the Hormuz dashboard.

## Objective

Audit recent Hormuz crossing events for likely spoofing/source-artifact false crossings, focusing on the rolling lookback window provided in the runtime header.

Use flexible judgment, but be conservative: only high-confidence spoofing/artifact cases should be added to the manual exclusion config when apply mode is enabled.

## Runtime Controls

The wrapper prepends runtime values. Respect them strictly:

- `DRY_RUN=1`: do not edit `config/confirmed-crossing-exclusions.json`, do not run `refresh_and_upload_processed.sh`, do not upload to Supabase, do not commit, do not push.
- `AUTO_APPLY=1`: you may append high-confidence exclusions only to `config/confirmed-crossing-exclusions.json`.
- `PUBLISH=1`: after successful AUTO_APPLY edits and validation, run `./refresh_and_upload_processed.sh`.
- `TELEGRAM=1`: leave Telegram dispatch to the wrapper unless explicitly instructed otherwise.

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

Check the latest generated artifact first. Anchor the rolling lookback to `metadata.latestByRegion.hormuz` when available; otherwise use artifact `generatedAt`.

Large artifact handling:

- Do not use `rg`, `grep`, `cat`, or `sed` in ways that print whole minified JSON artifacts.
- Prefer short Node scripts that parse JSON and print compact summaries, bounded tables, and candidate lists.
- Keep command output concise enough for unattended logs.

## Spoofing Patterns To Look For

High-confidence cases include:

- Spatial burst: many crossing events landing in a very tight coordinate cluster, especially `>= 5` events within `1-3 km`, same direction, short time span, high bridge distance, and mostly/all `transponderStatus=off`.
- Raw source confirmation: raw CSV rows show many distinct named vessels in the same small bbox at the same scrape timestamps.
- Impossible jumps: prior side point and crossing anchor imply hundreds of km over minutes or a small number of hours.
- Bounce-back from known spoofing: a vessel already manually excluded for a fake crossing then creates an opposite-direction crossing from the fake anchor back to the real side.
- Placeholder leakage: `[SAT-AIS]`, encoded/invalid ship IDs, or other non-vessel placeholders becoming crossing events.
- Same-hotspot continuation: a newly appearing event lands in a hotspot already identified as spoofing within the lookback window.

Do not auto-exclude isolated transponder-off events merely because they are dark. Real dark transits exist. You need a strong artifact pattern.

## Required Procedure

1. Load and summarize the latest artifact metadata.
2. Collect crossing events in the lookback window.
3. Identify event-point clusters by joining events to the nearest path point at the event timestamp.
4. Cross-check suspicious clusters against raw Hormuz CSV rows.
5. Check bounce-back events from existing manual exclusions.
6. Decide high-confidence, medium-confidence, and rejected candidates.
7. If `DRY_RUN=0` and `AUTO_APPLY=1`, append high-confidence event IDs to `config/confirmed-crossing-exclusions.json` without duplicates.
8. Validate JSON after any edit.
9. If `DRY_RUN=0`, `AUTO_APPLY=1`, and `PUBLISH=1`, run `./refresh_and_upload_processed.sh` and verify the remote/local artifact if practical.
10. Write a machine-readable report to the JSON report path supplied in the runtime header.
11. Write a concise human summary in your final response.

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
  "highConfidenceCandidates": [
    {
      "eventId": "shipId|timestamp|direction",
      "shipName": "Example",
      "vesselType": "tanker",
      "direction": "east_to_west",
      "timestamp": "2026-06-05T00:00:00Z",
      "reason": "spatial_burst|bounce_back|placeholder|same_hotspot_continuation",
      "confidence": "high",
      "evidence": {
        "clusterCenter": {"lat": 0, "lon": 0},
        "clusterEventCount": 0,
        "rawRowsInCluster": 0,
        "bridgeKm": 0,
        "gapHours": 0,
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
