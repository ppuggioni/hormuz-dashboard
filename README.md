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

## Scheduler / refresh cadence

Production refresh is handled locally via `launchd`, not just GitHub Actions.

Important job:
- `com.ppbot.hormuz.dashboard.refresh`
- `StartInterval = 900` seconds

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
