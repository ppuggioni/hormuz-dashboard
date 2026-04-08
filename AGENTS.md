# AGENTS.md

Repo-local operating notes for the Hormuz dashboard.

## Production architecture

This dashboard is backed by a local capture/sync/build pipeline and a Vercel frontend.

The intended production runtime path is:
- source CSV capture
- source CSV sync to Supabase Storage
- windowed processed artifact refresh from local workspace CSVs by default, with remote-index fallback if local files are unavailable
- promotion of the merged current artifact set into `public/data/`
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

The AIS collectors also now have dedicated per-region Chrome keepalive services on the same fixed CDP ports the capture wrappers use:
- `com.ppbot.hormuz.browser` on `19012`
- `com.ppbot.suez.browser` on `19013`
- `com.ppbot.malacca.browser` on `19014`
- `com.ppbot.capegoodhope.browser` on `19015`
- `com.ppbot.yemenchannel.browser` on `19016`
- `com.ppbot.southsrilanka.browser` on `19017`
- `com.ppbot.mumbai.browser` on `19018`
- `com.ppbot.redsea.browser` on `19019`

Operational intent:
- capture jobs keep using the same wrapper scripts and same ports
- browser lifecycle is owned by launchd per region
- `region_watchdog_autoheal.sh` remains the fallback recovery path and now prefers restarting the dedicated browser jobs when present

## Processed artifacts

Preferred artifacts:
- `processed_core.json`
- `processed_paths.json`
- `processed_candidates.json`
- `processed_playback_latest.json`
- `processed_shipmeta_latest.json`
- `processed_external_latest.json`
- `processed_playback_{24h,48h}.json`
- `processed_external_{24h,48h}.json`
- `processed_shipmeta_{24h,48h}.json`

Legacy compatibility artifact:
- `processed.json`

`processed.json` still exists because the frontend retains a legacy fallback path, but it is not the preferred deployment shape.

## Windowed rebuild validation

There is now a validation-only windowed rebuild wrapper around `scripts/build-data.mjs`.

Current behavior:
- `windowed:baseline` builds a frozen archive/current artifact set from a fixed source snapshot
- `windowed:refresh` rebuilds a `14d` context window and rewrites only the newest `4d` slice in the prior full artifacts
- `windowed:rerun-all` sweeps history with `14d` context windows and `7d` commit slices into a separate assembled output

Operational locations:
- runtime manifests and staged sources: `data/windowed-pipeline/`
- validation outputs: `public/data-windowed/`

Important:
- production publishes from `refresh_and_upload_processed.sh` using `windowed:refresh`
- `public/data-windowed/current` is the staged merged output and `public/data/` remains the promoted local publish directory
- `scripts/build-data.mjs` is now the manual fallback path rather than the default production refresh
- `windowed:refresh` can fall back to the existing `public/data` artifact tree as its historical archive when `public/data-windowed/current` has not been seeded
- `windowed:baseline` is intentionally guarded on large archives because `scripts/build-data.mjs` still replays the full source corpus in memory; use `windowed:rerun-all` for safer full-history validation sweeps

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
- Red Sea transponder review now prefers fixed choke-point gate logic over learned event thresholds: Bab el-Mandeb for south crossings and the Suez entrance for north crossings
- when a valid gate-bracketing point pair exists, Red Sea `transponderStatus` is driven by gate gap distance/time; legacy `transponderGapHours`, `transponderBridgeKm`, and `transponderOvershootKm` remain as fallback diagnostics
- processed artifact publish cache headers are `5 minutes` for smaller live files and `30 minutes` for heavier window files

## Git rules

Do not commit regenerated processed data artifacts.

Reasons:
- they are generated
- they are uploaded to Supabase separately
- some exceed GitHub's file-size limit

Ignored patterns live in `.gitignore`.

News pipeline note:
- `scripts/ingest-news.mjs`, `scripts/build-news.mjs`, and `scripts/dispatch-telegram-news.mjs` auto-bootstrap missing `data/news-history.json`, `data/news-latest-run.json`, and `data/news-inbox.json` so a fresh clone can run without pre-seeded news state files
- generated news artifacts under `public/data/` and local news runtime JSON state under `data/` are runtime files and should not be committed
- the ISW Iran Update pipeline now also uses local runtime state plus generated artifacts:
  - ingest: `scripts/ingest-iran-updates.mjs`
  - build: `scripts/build-iran-updates.mjs`
  - figure extraction: `scripts/extract-iran-update-figures.mjs`
  - upload: `upload_iran_updates_to_supabase.sh`
  - runtime state: `data/iran-update-history.json`, `data/iran-update-latest-run.json`, `data/iran-update-publish-state.json`, `data/iran-update-figure-extractions/*`
  - generated artifacts: `public/data/iran_updates.json`, `public/data/iran_update_figures.json`, `public/data/iran_update_figures/*`
  - the uploader is designed to be safe for hourly polling: it checks the latest report ID and exits as a no-op if that report was already published
- the USNI Fleet Tracker pipeline also uses local runtime state plus generated artifacts:
  - ingest: `scripts/ingest-usni-fleet.mjs`
  - map OCR extraction: `scripts/extract-usni-fleet-maps.mjs`
  - build: `scripts/build-usni-fleet.mjs`
  - upload: `upload_usni_fleet_to_supabase.sh`
  - source helpers: `scripts/usni-fleet-source.mjs`
  - artifact builder: `scripts/usni-fleet-artifacts.mjs`
  - OCR helper: `scripts/usni-fleet-map-ocr.swift`
  - runtime state: `data/usni-fleet-history.json`, `data/usni-fleet-latest-run.json`, `data/usni-fleet-map-extractions.json`
  - generated artifacts: `public/data/usni_fleet_tracker.json`, `public/data/usni_fleet_maps/*`
  - remote publish paths: `x-scrapes-public/hormuz/usni_fleet_tracker.json`, `x-scrapes-public/hormuz/usni_fleet_maps/*`
  - the builder now carries tracker heading context across nested `Carrier Strike Group` / `ARG` sections and uses OCR from the saved weekly map images to recover vessel placements and explicit stops like `Split, Croatia` or `Diego Garcia`
  - ingest prefers the USNI WordPress API over raw HTML page fetches because the site’s normal pages can sit behind anti-bot checks
  - the first-pass artifact stores rough region coordinates and movement rows toward or away from an Arabian Sea reference point; map-image vision extraction can be layered on later
  - the uploader now uses a lock directory so recurring runs cannot overlap with manual publishes
  - the launchd job for recurring publish is `com.ppbot.hormuz.usnifleet.publish`, scheduled every `6 hours`

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
2. `launchd` job `com.ppbot.hormuz.iranupdates.publish` is loaded and exiting cleanly
3. `launchd` job `com.ppbot.hormuz.usnifleet.publish` is loaded and exiting cleanly
4. region capture/sync jobs for the region in question are loaded and running cleanly (for Red Sea: `com.ppbot.redsea15m` and `com.ppbot.redsea.supabase.sync`)
5. `refresh_and_upload_processed.sh` logs show recent successful uploads
6. `upload_iran_updates_to_supabase.sh` logs show recent successful polls or no-op checks
7. `upload_usni_fleet_to_supabase.sh` logs show recent successful polls/uploads
8. frontend still loads split artifacts first
9. Supabase Storage contains fresh `multi_region/*` files

## Documentation hygiene

If the pipeline changes, update:
- `README.md`
- this `AGENTS.md`
- `PIPELINE_AND_PRODUCT_OVERVIEW.md` if it is being used as the deeper operator reference
