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
4. Processed artifacts are uploaded to Supabase Storage under:
   - `x-scrapes-public/multi_region/*`
5. Vercel fetches those artifacts at runtime.

## Scheduler / refresh cadence

Production refresh is handled locally via `launchd`, not just GitHub Actions.

Important job:
- `com.ppbot.hormuz.dashboard.refresh`
- `StartInterval = 295` seconds

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

- Rebuild + upload processed artifacts to Supabase:
```bash
./refresh_and_upload_processed.sh
```

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
