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

Current source regions include:
- `hormuz`
- `suez`
- `malacca`
- `cape_good_hope`
- `yemen_channel`
- `south_sri_lanka`
- `mumbai`
- `red_sea`

Region-specific browser sessions can use dedicated OpenClaw-managed profiles; the Red Sea collector uses profile `red-sea`.

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

## Red Sea inferred crossings

The Red Sea analysis pipeline writes:
- `redSeaCrossingsByDay`
- `redSeaCrossingEvents`
- `redSeaCrossingRoutes`

Operational notes:
- raw inputs are restricted to `suez`, `red_sea`, and `yemen_channel`
- outputs are restricted to `tanker` and `cargo` vessels
- inference is based on the 4 Red Sea rectangles, not region names alone
- prior-zone selection uses the most recent eligible earlier hit within a 30-day lookback
- same-timestamp zone hits do not satisfy the prior condition
- crossing time is the first qualifying anchor hit after a fresh prior-side sighting
- a `72h` cooldown per `shipId + crossingType` acts as a secondary dedupe guardrail
- the daily series is continuous by UTC day, including zero-count days between event days
- saved route points use a bounded display window rather than the full 30-day history
- confirmed Hormuz crossings and Red Sea crossing events carry per-event transponder review metadata: `transponderGapHours`, `transponderBridgeKm`, `transponderOvershootKm`, and `transponderStatus`
- processed artifact publish cache headers are `5 minutes` for smaller live files and `30 minutes` for heavier window files

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
2. region capture/sync jobs for the region in question are loaded and running cleanly (for Red Sea: `com.ppbot.redsea15m` and `com.ppbot.redsea.supabase.sync`)
3. `refresh_and_upload_processed.sh` logs show recent successful uploads
4. frontend still loads split artifacts first
5. Supabase Storage contains fresh `multi_region/*` files

## Documentation hygiene

If the pipeline changes, update:
- `README.md`
- this `AGENTS.md`
- `PIPELINE_AND_PRODUCT_OVERVIEW.md` if it is being used as the deeper operator reference
