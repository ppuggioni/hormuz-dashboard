# Hormuz Dashboard — Pipeline, Product, and Alerts Overview

_Last updated: 2026-03-10 (Europe/London)_

## 1) Executive Summary

This system tracks strategic maritime traffic (focused on tankers/cargo) across key chokepoints and routes, processes the data into analytics-friendly artifacts, and serves a Vercel dashboard with Telegram alerting.

Core design goals achieved:
- Reliable recurring collection with de-synced schedules and jitter
- End-to-end ingestion -> processing -> publish pipeline
- Split data artifacts for better performance (instead of one monolith)
- UI optimized for tanker/cargo intelligence and explainability
- Telegram-based alert subscription flow (no email domain dependency)

---

## 2) Active Collection Scope (Current)

## Active regions (capture every ~15 min, staggered)

1. **Hormuz**
   - Center: `(26.2, 56.5)`
   - Zoom: `8`
   - Radius: `2`
   - Browser profile: `marinetraffic-hormuz`

2. **Suez**
   - Center: `(29.78, 32.45)`
   - Zoom: `10`
   - Radius: `1`
   - Browser profile: `marinetraffic-suez`

3. **Malacca**
   - Center: `(1.95, 102.2)`
   - Zoom: `10`
   - Radius: `1`
   - Browser profile: `marinetraffic-malacca`

4. **Cape of Good Hope**
   - Center: `(-34.8, 19.2)`
   - Zoom: `8`
   - Radius: `1`
   - Browser profile: `marinetraffic-cape-good-hope`

5. **Yemen Channel**
   - Center: `(12.0, 45.5)`
   - Zoom: `8`
   - Radius: `1`
   - Browser profile: `marinetraffic-yemen`

6. **South Sri Lanka**
   - Center: `(5.2, 81.0)`
   - Zoom: `9`
   - Radius: `1`
   - Browser profile: `marinetraffic-sri-lanka`

7. **Mumbai**
   - Center: `(18.7, 71.6)`
   - Zoom: `9`
   - Radius: `2`
   - Browser profile: `marinetraffic-mumbai`

## Removed from active tracking
- Yemen broad region (duplicate/overlap)
- Sri Lanka broad region (duplicate/overlap)
- Arabian Sea and North Arabian (explicitly removed from scheduling and product tracking)

---

## 3) Scheduler / Jobs Topology (launchd)

## Capture jobs
- `com.ppbot.hormuz15m` — `StartInterval=900`
- `com.ppbot.suez15m` — `StartInterval=901`
- `com.ppbot.malacca15m` — `StartInterval=907`
- `com.ppbot.capegoodhope15m` — `StartInterval=913`
- `com.ppbot.yemenchannel15m` — `StartInterval=941`
- `com.ppbot.southsrilanka15m` — `StartInterval=947`
- `com.ppbot.mumbai15m` — `StartInterval=953`

## Supabase sync jobs
- `com.ppbot.hormuz.supabase.sync` — `300s`
- `com.ppbot.suez.supabase.sync` — `301s`
- `com.ppbot.malacca.supabase.sync` — `307s`
- `com.ppbot.capegoodhope.supabase.sync` — `313s`
- `com.ppbot.yemenchannel.supabase.sync` — `337s`
- `com.ppbot.southsrilanka.supabase.sync` — `341s`
- `com.ppbot.mumbai.supabase.sync` — `347s`

## Processing + publish job
- `com.ppbot.hormuz.dashboard.refresh` — `295s`

## Anti-pattern hardening
- Per-region lock files prevent overlap in the same region
- Start intervals intentionally de-synced
- Random jitter added:
  - Capture startup jitter: `15–120s`
  - Sync startup jitter: `5–40s`

---

## 4) Data Flow (End-to-End)

1. **Capture** (`*_capture_via_cli.sh` -> `region_capture_via_cli.sh`)
   - Opens MarineTraffic with region-specific profile
   - Scrapes configured tile area
   - Writes local CSV snapshots (`<region>_YYYY_MM_DD_HH_MM_SS.csv`)
   - Writes trigger status JSON/logs

2. **Sync** (`*_supabase_sync.sh` / JS)
   - Uploads new regional CSVs to Supabase Storage
   - Updates region `index.json` (source catalog used by processor)

3. **Build + publish** (`refresh_and_upload_processed.sh`)
   - Runs `npm run build:data` (script: `scripts/build-data.mjs`)
   - Produces processed artifacts in `public/data`
   - Uploads all artifacts to `x-scrapes-public/multi_region/*`
   - Triggers alert dispatch scripts (email optional, Telegram active)

4. **Dashboard runtime (Vercel)**
   - Loads split files first (v2)
   - Falls back to legacy `processed.json` if needed

---

## 5) Data Model Evolution and Current Artifact Strategy

## Legacy (kept for compatibility)
- `processed.json` (monolithic)

## Split artifacts (current production strategy)
- `processed_core.json` (lightweight metadata + summary + crossing/linkage tables)
- `processed_paths.json` (crossing trajectory paths)
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

## Why split
- Smaller default payload
- Window-based lazy loading for heavy components
- Better long-term scalability and user-perceived performance

---

## 6) Crossing Logic, Cumulative History, and Accuracy Choices

## Crossing detection
- Crossing events are generated from side changes vs Hormuz boundary logic.

## “Once crossed, always crossed” behavior
- Crossing events and crossing paths are merged cumulatively across runs using previous processed outputs.
- This preserves historical crossings even if a vessel no longer appears in the short recent ingestion horizon.

## Vessel filtering policy
- Build-time default allowlist is `tanker,cargo` only
- Controlled via env: `ALLOWED_VESSEL_TYPES`
  - `ALLOWED_VESSEL_TYPES=all` re-enables all classes

## Known robustness assumptions
- AIS can be delayed/spoofed/silent in conflict zones.
- Analysis is robust if a vessel reports at least once in corridor/chokepoints.
- True persistent ghost operations remain a blind spot.

---

## 7) UI / Product Changes Implemented

## Visual + analytical changes
- Crossing trajectories colored per ship (deterministic), not just type
- Marker shapes distinguish classes (cargo vs tanker style distinction)
- Strait boundary lines changed to thin light-gray dashed lines
- Barcharts use precomputed crossing events (all data)
- Tables default to newest-first and support clickable sorting by headers
- Transit delta relabeled and reformatted as `Dd:HHh:MMm`

## Diagnostics
- Pipeline freshness diagnostics expanded to all tracked active regions
- Region file counts rendered dynamically
- Removed irrelevant diagnostics entries for removed regions

## Header/cards/FAQ
- Removed top “Files” card
- Expanded FAQ:
  - dark AIS behavior and re-detection logic
  - refresh cadence (~15–30 min end-to-end)
  - data source and limitations

---

## 8) Alerts System (Current State)

## Email path
- Built and integrated, but operationally optional due to sender/domain constraints.

## Telegram path (active)
- Website button: **Sign up for alerts (Telegram)**
- Opens bot with start payload: `https://t.me/<bot>?start=hormuz_alerts`
- UX popup explains exact subscription steps

## Telegram backend behavior
- Script: `scripts/dispatch-telegram-alerts.mjs`
- Polls bot updates (`/start` subscribe, `/stop` unsubscribe)
- Reads new tanker crossing events
- Dedupe key: `shipId|direction|timestamp`
- Sends batched Telegram message per subscriber
- Writes send ledger to Supabase tables

## Telegram Supabase schema
- `marinetraffic_telegram_subscribers`
- `marinetraffic_telegram_events_sent`
- SQL file: `sql/marinetraffic_telegram_alerts.sql`

---

## 9) Why this architecture now

- It minimizes operational risk (incremental changes, compatibility fallback)
- It keeps existing collection machinery while improving UX and performance
- It supports near-real-time operational awareness with low manual overhead
- It is presentation-ready: clear narrative from data capture -> intelligence layer -> alerting

---

## 10) Practical talking points for slides

- **Problem:** One monolithic payload and overlapping region jobs reduced clarity and scalability.
- **Approach:** Decompose pipeline + de-duplicate region strategy + event-driven alerting.
- **Outcome:** Faster dashboard loads, clearer regional coverage, cumulative crossing intelligence, live Telegram alerts.
- **Operational posture:** Staggered/jittered jobs, profile isolation, cumulative historical integrity, explicit handling of AIS limitations.

---

## 11) Key files (implementation map)

- Processing:
  - `scripts/build-data.mjs`
  - `refresh_and_upload_processed.sh`
- UI:
  - `src/app/page.tsx`
  - `src/components/PlaybackMap.tsx`
  - `src/components/CrossingPathsMap.tsx`
- Telegram alerts:
  - `scripts/dispatch-telegram-alerts.mjs`
  - `sql/marinetraffic_telegram_alerts.sql`

---

If this document is used as prompt input for slide generation, a good structure is:
1) Context & objective
2) System architecture
3) Region coverage & scheduling
4) Data model split strategy
5) UI/UX improvements
6) Alerting model (Telegram)
7) Reliability, constraints, and roadmap
