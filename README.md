# Hormuz Dashboard

Multi-region maritime dashboard focused on Hormuz crossings, dark-crosser candidate review, and related regional linkage analysis.

## What the deployed app actually uses

The deployed Vercel app is designed to load **split processed JSON artifacts** from Supabase Storage first, not giant Git-tracked data blobs.

Primary runtime artifacts:
- `processed_core.json`
- `processed_paths.json`
- `processed_playback_24h.json`
- `processed_playback_48h.json`
- `processed_playback_72h.json`
- `processed_playback_all.json`
- `processed_external_24h.json`
- `processed_external_48h.json`
- `processed_external_72h.json`
- `processed_external_all.json`
- `processed_shipmeta_24h.json`
- `processed_shipmeta_48h.json`
- `processed_shipmeta_72h.json`
- `processed_shipmeta_all.json`

The frontend loads split files first and only falls back to legacy `processed.json` if needed.

## Production data flow

1. Regional capture jobs write fresh CSV snapshots.
2. Regional sync jobs upload source CSVs to Supabase Storage.
3. `refresh_and_upload_processed.sh` runs `npm run build:data`.
   The build now reads local CSV snapshots from the workspace root by default and only falls back to remote Supabase indexes if local source files are unavailable.
4. Processed artifacts are uploaded to Supabase Storage under:
   - `x-scrapes-public/multi_region/*`
5. Vercel fetches those artifacts at runtime.

Current source regions in the live pipeline include:
- `hormuz`
- `suez`
- `malacca`
- `cape_good_hope`
- `yemen_channel`
- `south_sri_lanka`
- `mumbai`
- `red_sea`

## Red Sea inferred crossings

The processed-data build also derives a Red Sea crossings layer from:
- source regions `suez`, `red_sea`, and `yemen_channel`
- four analysis rectangles: `rs-south-out`, `rs-south-in`, `rs-north-in`, `rs-north-out`

Current behavior:
- Red Sea crossing outputs are restricted to `tanker` and `cargo` vessels
- crossings use the most recent eligible prior zone hit within a 30-day lookback
- the crossing timestamp is the first qualifying anchor hit after a fresh prior-side sighting
- repeated detections are further guarded by a 72-hour cooldown per `shipId + crossingType`
- daily output is continuous by UTC day, including zero-count days between active days
- saved route geometry is bounded for display performance rather than storing full 30-day histories
- confirmed Hormuz crossing events and Red Sea crossing events now carry per-event transponder review fields: `transponderGapHours`, `transponderBridgeKm`, `transponderOvershootKm`, and `transponderStatus`
- outputs are written to `processed_core.json` and `processed_paths.json` as Red Sea-specific fields

Processed artifact caching:
- smaller live artifacts publish with `5 minute` cache headers
- heavier playback/external/shipmeta window artifacts publish with `30 minute` cache headers

## Scheduler / refresh cadence

Production refresh is handled locally via `launchd`, not just GitHub Actions.

Important job:
- `com.ppbot.hormuz.dashboard.refresh`
- `StartInterval = 900` seconds

Region-specific examples now also include the Red Sea additions:
- capture: `com.ppbot.redsea15m`
- sync: `com.ppbot.redsea.supabase.sync`
- browser profile: `red-sea`

That job runs:
- `refresh_and_upload_processed.sh`
- rebuilds the processed artifacts
- uploads them to Supabase Storage
- optionally dispatches alerts

## Legacy monolith status

`processed.json` is still generated and uploaded for backward compatibility.

Important:
- It is large.
- It should not be committed to Git.
- The preferred production path is the split artifact set above.
- Do not assume the monolith is the primary runtime payload.

## Git hygiene

Generated processed artifacts are ignored via `.gitignore`:
- `/public/data/processed*.json`
- `/public/data/processed*.json.gz`

Do not commit regenerated data files to GitHub. Some exceed GitHub's 100 MB object limit.

The news pipeline also maintains runtime JSON state under `data/`. The news scripts now auto-bootstrap missing `data/news-history.json`, `data/news-latest-run.json`, and `data/news-inbox.json` on first run so fresh clones do not fail on missing files.

Generated news artifacts and local news runtime JSON state are also intended to stay out of Git:
- `/public/data/news_feed.json`
- `/public/data/vessel_attacks_latest.json`
- `/public/data/confirmed_crossing_exclusions.json`
- `/data/news-history.json`
- `/data/news-latest-run.json`
- `/data/news-inbox.json`

## Useful scripts

- Build processed data locally:
```bash
npm run build:data
```

Optional source controls:
- `HORMUZ_SOURCE_MODE=local|remote` defaults to `local`
- `HORMUZ_SOURCE_ROOT=/Users/pp-bot/.openclaw/workspace_2` points the build at the local CSV workspace
- `HORMUZ_SOURCE_MIN_AGE_SECONDS=120` skips very fresh files so the build does not read a CSV while capture is still writing it

- Rebuild + upload processed artifacts to Supabase:
```bash
./refresh_and_upload_processed.sh
```

## Incremental pipeline rollout status

Incremental hot-pipeline work is being added in phases. Phase 1 introduces only
scaffolding under `scripts/incremental/` plus the runtime `state/` directory
layout and helper APIs for checkpoints, lock files, JSONL ledgers, and baseline
metadata.

Important:
- the current full rebuild path remains the live path
- `scripts/build-data.mjs` is still authoritative for production artifacts
- the new state helpers are not wired into publication yet

## Environment / runtime assumption

The app uses `NEXT_PUBLIC_HORMUZ_PROCESSED_URL` as the base URL for processed artifacts. The code then derives the split-file root from that base and attempts split-file loading first.

## Local development

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Notes for future maintainers

If you change the processed data model:
- preserve backward compatibility where practical
- prefer adding new fields over renaming/removing existing ones
- keep split artifacts as the main deployment path
- treat `processed.json` as legacy compatibility, not the default design target
