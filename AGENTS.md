# AGENTS.md

Repo-local operating notes for the Hormuz dashboard.

## Production architecture

This dashboard is backed by a local capture/sync/build pipeline and a Vercel frontend.

The intended production runtime path is:
- source CSV capture
- source CSV sync to Supabase Storage
- processed artifact build from local workspace CSVs by default, with remote-index fallback if local files are unavailable
- processed artifact upload to `x-scrapes-public/multi_region/*`
- Vercel runtime fetch of split artifacts

## Processed artifacts

Preferred artifacts:
- `processed_core.json`
- `processed_paths.json`
- `processed_playback_{24h,48h,72h,all}.json`
- `processed_external_{24h,48h,72h,all}.json`
- `processed_shipmeta_{24h,48h,72h,all}.json`

Legacy compatibility artifact:
- `processed.json`

`processed.json` still exists because the frontend retains a legacy fallback path, but it is not the preferred deployment shape.

## Git rules

Do not commit regenerated processed data artifacts.

Reasons:
- they are generated
- they are uploaded to Supabase separately
- some exceed GitHub's file-size limit

Ignored patterns live in `.gitignore`.

## Data model guidance

When extending vessel metadata, prefer backward-compatible additions.

Examples already carried in the model:
- `flag`
- `destination`
- `rawShipType`
- `rawGtShipType`
- freshness/speed/course metadata

Avoid deleting or renaming stable fields unless the frontend and pipeline are updated together.

## Operational check points

If someone asks whether production is healthy, verify:
1. `launchd` job `com.ppbot.hormuz.dashboard.refresh` is loaded and exiting cleanly
2. `refresh_and_upload_processed.sh` logs show recent successful uploads
3. frontend still loads split artifacts first
4. Supabase Storage contains fresh `multi_region/*` files

## Documentation hygiene

If the pipeline changes, update:
- `README.md`
- this `AGENTS.md`
- `PIPELINE_AND_PRODUCT_OVERVIEW.md` if it is being used as the deeper operator reference
