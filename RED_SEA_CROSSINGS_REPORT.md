# Red Sea Crossings Report

## What changed

Implemented a new Red Sea crossings analysis flow across the existing processed-data pipeline and webapp.

### Backend / analysis
- Added shared Red Sea rectangle definitions and zone helper logic in `src/lib/redSeaCrossingZones.mjs`.
- Added Red Sea crossing inference in `scripts/build-data.mjs` using only source observations from:
  - `suez`
  - `red_sea`
  - `yemen_channel`
- Implemented four crossing types:
  - `south_outbound`
  - `south_inbound`
  - `north_outbound`
  - `north_inbound`
- Added 30-day lookback logic.
- Added 72-hour per-ship per-crossing-type dedupe.
- Updated prior-zone selection to use the most recent eligible earlier hit.
- Added continuous UTC daily series output, including zero-count days.
- Added bounded route-window extraction for display routes.

### Frontend
- Added shared Red Sea overlays import to `PlaybackMap` through `src/lib/redSeaCrossingZones.mjs`.
- Added dedicated route visualization component:
  - `src/components/RedSeaCrossingMap.tsx`
- Wired Red Sea crossing data into `src/app/page.tsx`.
- Added a new `Red Sea crossings` section before the News section with:
  - filter chips for crossing type
  - one combined daily chart
  - crossing event table
  - selectable route map

## Output fields / artifacts added

### `processed_core.json`
Added:
- `redSeaCrossingTypes`
- `redSeaCrossingsByDay`
- `redSeaCrossingEvents`

Metadata additions include:
- `redSeaCrossingShipCount`
- `redSeaCrossingEventCount`
- `redSeaCrossingRouteCount`
- `redSeaCrossingLookbackDays`
- `redSeaCrossingDedupeHours`
- `redSeaCrossingSourceRegions`

### `processed_paths.json`
Added:
- `redSeaCrossingRoutes`

## Event fields

Each crossing event includes:
- `eventId`
- `shipId`
- `shipName`
- `vesselType`
- `flag`
- `crossingType`
- `t`
- `crossingTime`
- `day`
- `anchorZone`
- `anchorTime`
- `anchorLat`
- `anchorLon`
- `anchorSourceRegion`
- `priorZone`
- `priorTime`
- `priorLat`
- `priorLon`
- `priorSourceRegion`
- `lookbackHours`
- `deltaDh`
- `sourceRegionsSeen`
- `inferenceWindowDays`
- `routePointCount`

## Route fields

Each route includes:
- `eventId`
- `shipId`
- `shipName`
- `vesselType`
- `flag`
- `crossingType`
- `t`
- `crossingTime`
- `day`
- `anchorZone`
- `anchorTime`
- `anchorLat`
- `anchorLon`
- `priorZone`
- `priorTime`
- `priorLat`
- `priorLon`
- `routeWindowHours`
- `routeWindowStartTime`
- `routeWindowEndTime`
- `points`

## Assumptions / simplifications

- Analysis is driven only by the four Red Sea rectangles.
- Source observations are restricted to `suez`, `red_sea`, and `yemen_channel`.
- Route windows are intentionally bounded for display performance rather than storing full 30-day raw paths.
- Daily chart aggregation is by UTC day of crossing anchor time.
- UI uses a combined chart rather than separate per-type charts.

## TODOs / tuning notes

- Consider exposing route-window and dedupe parameters as config if this analysis becomes operationally important.
- Consider adding table filters for vessel type and free-text ship search.
- Consider adding explicit empty-state messaging if no Red Sea events are present in the current dataset.
