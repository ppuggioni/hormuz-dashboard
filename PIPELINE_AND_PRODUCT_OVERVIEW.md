# Hormuz Dashboard — Pipeline, Data Flow, News Layer, and Jobs Overview

_Last updated: 2026-03-15 (Europe/London)_

## 1) Executive summary

This system has two parallel intelligence layers that feed the Hormuz dashboard:

1. **AIS / vessel-movement layer**
   - recurring regional MarineTraffic capture
   - CSV sync to Supabase
   - processed multi-region artifacts for the dashboard
   - crossing, linkage, candidate-dark-crossing, and alert logic

2. **News / narrative layer**
   - a dedicated `hormuz-news` agent using `codex54`
   - wakes every 6 hours in an isolated run
   - browses X, Lloyd's List, Kpler, and limited fresh research
   - uses judgment to add only genuinely new, high-signal items
   - publishes `news_feed.json` to Supabase Storage

The Vercel app reads **live data from Supabase** wherever possible, with local fallback artifacts for development or recovery.

---

## 2) Active collection scope

## AIS regions (capture every ~15 minutes, staggered)

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

## News sources (initial watchlist)

Tracked by `config/news-watchlist.json` using the logged-in browser profile `hormuz-news`:

- `https://x.com/TankerTrackers`
- `https://x.com/MarineTraffic`
- `https://x.com/Kpler`
- `https://www.lloydslist.com/search#?regulars=Daily%20Briefing`
- `https://www.lloydslist.com/search#?topic=Strait%20of%20Hormuz%20crisis`
- `https://www.kpler.com/resources/blog`
- `https://www.google.com/search?q=hormuz+shadow+fleet`

## Removed from active AIS tracking
- Yemen broad region (duplicate/overlap)
- Sri Lanka broad region (duplicate/overlap)
- Arabian Sea and North Arabian (explicitly removed from scheduling and product tracking)

---

## 3) Jobs and scheduler topology

There are **two different scheduling systems** in play:

1. **launchd jobs on the Mac** for AIS collection/sync/processing
2. **OpenClaw cron isolated agent job** for the narrative/news layer

## 3a) launchd jobs — AIS capture / sync / publish

### Capture jobs
- `com.ppbot.hormuz15m` — `StartInterval=900`
- `com.ppbot.suez15m` — `StartInterval=901`
- `com.ppbot.malacca15m` — `StartInterval=907`
- `com.ppbot.capegoodhope15m` — `StartInterval=913`
- `com.ppbot.yemenchannel15m` — `StartInterval=941`
- `com.ppbot.southsrilanka15m` — `StartInterval=947`
- `com.ppbot.mumbai15m` — `StartInterval=953`

### Supabase regional CSV sync jobs
- `com.ppbot.hormuz.supabase.sync` — `300s`
- `com.ppbot.suez.supabase.sync` — `301s`
- `com.ppbot.malacca.supabase.sync` — `307s`
- `com.ppbot.capegoodhope.supabase.sync` — `313s`
- `com.ppbot.yemenchannel.supabase.sync` — `337s`
- `com.ppbot.southsrilanka.supabase.sync` — `341s`
- `com.ppbot.mumbai.supabase.sync` — `347s`

### Processed dashboard publish job
- `com.ppbot.hormuz.dashboard.refresh` — `295s`

### Hardening choices
- Per-region lock files prevent overlapping capture runs
- Start intervals are intentionally de-synced
- Random jitter added:
  - capture startup jitter: `15–120s`
  - sync startup jitter: `5–40s`

## 3b) OpenClaw cron job — agentic news workflow

### Dedicated configured agent
- **Agent ID:** `hormuz-news`
- **Name:** `Hormuz News`
- **Workspace:** `/Users/pp-bot/.openclaw/workspace_2/hormuz-dashboard`
- **Model:** `openai-codex/gpt-5.4` (`codex54`)

### Scheduled job
- **Job name:** `Hormuz news agent (6h)`
- **Frequency:** every 6 hours
- **Style:** isolated agent run, not a dumb fixed scraper

### Actual routing pattern
The scheduled wake is orchestrated by the main agent, which is explicitly allowed to spawn the dedicated `hormuz-news` agent as a worker. The `hormuz-news` agent performs the browsing, dedupe, summary writing, artifact rebuild, and Supabase upload.

This matters because the news workflow is intentionally **agentic**:
- it uses judgment
- it can keep multiple useful items per source
- it can skip noisy items even when newer
- it distinguishes no-change runs from genuinely new intelligence

---

## 4) AIS data flow (end to end)

## Step 1 — capture local CSVs

Per-region shell wrappers like:
- `hormuz_capture_via_cli.sh`
- `suez_capture_via_cli.sh`
- `mumbai_capture_via_cli.sh`

all delegate to:
- `region_capture_via_cli.sh`

This step:
- opens MarineTraffic with the region-specific browser profile
- scrapes the configured tile area
- writes local CSV snapshots:
  - `<region>_YYYY_MM_DD_HH_MM_SS.csv`
- writes trigger status JSON/log files

## Step 2 — regional CSV sync to Supabase Storage

Per-region sync wrappers upload the local CSVs to Supabase Storage and maintain a regional `index.json` catalog.

Examples:
- `hormuz_supabase_sync.sh`
- `mumbai_supabase_sync.sh`

These publish source-region raw data under:
- bucket: `x-scrapes-public`
- prefix: `<region>/...`

## Step 3 — processed artifact build

Script:
- `scripts/build-data.mjs`

This reads the regional indexes and raw CSVs, then produces processed dashboard artifacts in:
- `public/data/`

## Step 4 — processed artifact publish to Supabase

Script:
- `refresh_and_upload_processed.sh`

This uploads the processed artifacts to:
- `x-scrapes-public/multi_region/*`

It also dispatches alerts after processing.

## Step 5 — dashboard runtime consumption

The Next.js app prefers remote processed artifacts and falls back locally when needed.

Primary runtime pattern:
- read processed split artifacts from Supabase-hosted URLs
- fall back to local `/data/*.json` when remote is unavailable

---

## 5) Processed AIS artifact strategy

## Legacy compatibility
- `processed.json` — monolithic fallback artifact

## Current split artifacts
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

## Why split
- smaller default payloads
- better perceived performance
- lazy loading of heavy windows/components
- more scalable long-term than the monolith

---

## 6) AIS analytics logic

## Crossing logic

There are now **two ways** a crossing can be confirmed:

1. **Direct Hormuz side-change observation**
   - vessel appears on one side of the Hormuz boundary and later on the other side

2. **Zone-inferred crossing**
   - if a vessel is seen in `hormuz_west` and then later in any eastern monitored region, that confirms `west_to_east`
   - if it is seen in any eastern monitored region and then later in `hormuz_west`, that confirms `east_to_west`

This logic exists because direct two-sided observation can be missed when AIS goes dark or the ship is only intermittently visible in the corridor.

## “Once crossed, always crossed”
- crossing events and crossing paths are merged cumulatively across runs using previous processed outputs
- historical confirmed crossings are preserved even if the ship disappears from short recent windows

## Vessel filtering policy
- default build-time allowlist: `tanker,cargo`
- controlled by env `ALLOWED_VESSEL_TYPES`

## Dark crossing candidate logic
- separate from confirmed crossings
- high-conviction threshold currently requires the last known position to be within **90 km** of the strait center, alongside approach/scoring logic

## Known blind spots
- AIS silence/spoofing/GNSS interference
- persistent ghost operations that never reappear
- ambiguity when vessels reappear only outside the monitored corridor

---

## 7) News pipeline data flow

The news system is intentionally **not** a rigid scripted scraper. The scheduler only wakes the workflow; the agent performs judgment-based collection.

## Step 1 — source/watchlist read

File:
- `config/news-watchlist.json`

Contains:
- tracked source list
- priorities/tags
- the dedicated browser profile name: `hormuz-news`

## Step 2 — persistent history read

Files:
- `data/news-history.json`
- `data/news-latest-run.json`

These provide continuity across runs.

### `news-history.json`
Stores persistent collected items, including:
- canonical URL
- source metadata
- publication timestamp
- first seen / last seen timestamps
- summary/tags/figure note

### `news-latest-run.json`
Stores the current run state:
- `lastUpdateSummary`
- `last24hSummary`
- IDs of items that were new in the latest run
- run timestamp

## Step 3 — run staging

File:
- `data/news-inbox.json`

This is the staging area for the **current run only**.

The agent writes into it:
- `runAt`
- `lastUpdateSummary`
- `last24hSummary`
- `items[]` containing only genuinely new items for this run

## Step 4 — incremental ingest

Script:
- `scripts/ingest-news.mjs`

This:
- dedupes against `news-history.json` by canonical URL
- merges unseen items into history
- updates `news-latest-run.json`
- preserves previous latest-run state if the inbox is empty

### Important behavior
Empty inbox is a **no-op**:
- no duplicates are added
- previous “new in last run” markers are preserved
- no accidental wipe of the last-run state

## Step 5 — frontend news artifact build

Script:
- `scripts/build-news.mjs`

Output:
- `public/data/news_feed.json`

This artifact contains:
- metadata
- `lastUpdateSummary`
- `last24hSummary`
- tracked sources
- feed items ordered by `publishedAt`
- per-item `isNew` markers for the latest run

## Step 6 — publish live news artifact to Supabase

Script:
- `upload_news_to_supabase.sh`

Publishes to:
- bucket: `x-scrapes-public`
- path: `hormuz/news_feed.json`

Full public URL:
- `https://hzxiwdylvefcsuaafnhj.supabase.co/storage/v1/object/public/x-scrapes-public/hormuz/news_feed.json`

## Step 7 — dashboard runtime consumption

The app now prefers the live remote news artifact from Supabase and falls back locally only if needed.

Primary pattern:
- remote: `x-scrapes-public/hormuz/news_feed.json`
- fallback: local `/data/news_feed.json`

---

## 8) News workflow rules and editorial policy

The news agent follows these rules:

- use exact X post URLs, never profile-only links
- allow multiple useful items per source when justified
- use actual publication timestamp when known
- if only date is known, default to **06:00:00Z**
- write in factual analyst style
- avoid meta wording like “first pass”, “watchlist ready”, etc.
- focus on:
  - tanker/gas carrier counts
  - direction of flows
  - nationality / flag / operator colour
  - shadow fleet share
  - AIS-off / spoofing / GNSS interference
  - Jask / Kharg / alternate load points
  - sanctions / insurance / escort implications
- only add genuinely new items not already in history
- skip noisy items even if recent

This is why the workflow is agent-based rather than pure scraping.

---

## 9) Frontend / product behavior

## AIS side
Implemented product behavior includes:
- crossing trajectories colored per ship
- marker shape distinctions by vessel class
- thin gray dashed strait boundaries
- cumulative confirmed crossing logic
- linkage/transit analytics
- candidate dark-crossing scoring and confidence bands
- freshness diagnostics for all active regions

## News side
The news section is appended near the end of the page and includes:
- **Last update summary**
- **Last 24h summary**
- tracked source panel
- feed cards ordered by publication time
- exact source links
- figure/operational note callouts when useful
- green “New in last run” badge for newly added items

---

## 10) Alerts system

## Email path
- built and integrated, but operationally optional

## Telegram path (active)
Frontend allows subscription via Telegram.

Backend:
- `scripts/dispatch-telegram-alerts.mjs`
- dedupe key: `shipId|direction|timestamp`
- sends batched alerts per subscriber
- stores send ledger in Supabase

Relevant schema:
- `marinetraffic_telegram_subscribers`
- `marinetraffic_telegram_events_sent`
- SQL: `sql/marinetraffic_telegram_alerts.sql`

---

## 11) Current file map

## AIS processing / publish
- `scripts/build-data.mjs`
- `refresh_and_upload_processed.sh`
- per-region capture scripts in repo root/workspace_2
- per-region Supabase sync scripts in repo root/workspace_2

## News pipeline
- `config/news-watchlist.json`
- `data/news-history.json`
- `data/news-latest-run.json`
- `data/news-inbox.json`
- `scripts/ingest-news.mjs`
- `scripts/build-news.mjs`
- `upload_news_to_supabase.sh`
- `NEWSFEED_MVP.md`
- `LIVE_RUN_REPORT.md`

## UI
- `src/app/page.tsx`
- `src/components/PlaybackMap.tsx`
- `src/components/CrossingPathsMap.tsx`
- `src/components/CandidatePathsMap.tsx`
- `src/components/PortAreaPathsMap.tsx`

## Alerts
- `scripts/dispatch-telegram-alerts.mjs`
- `sql/marinetraffic_telegram_alerts.sql`

---

## 12) Recommended mental model

Think of the system as three layers:

### Layer A — Raw movement collection
MarineTraffic regional capture -> local CSVs -> regional Supabase indexes

### Layer B — Processed operational intelligence
CSV catalogs -> processed multi-region artifacts -> dashboard crossings/linkages/candidates/alerts

### Layer C — Narrative intelligence
Dedicated `hormuz-news` agent -> source browsing -> deduped feed -> Supabase `news_feed.json`

The dashboard then combines:
- **observed movement intelligence**
- **narrative / source intelligence**

without mixing code deployments with changing data.

---

## 13) Why this architecture is now the right one

- AIS data and news data are both treated as live data products
- changing content is separated from code
- Vercel serves the app, while Supabase serves the live artifacts
- the news layer uses agentic judgment instead of low-signal scrape spam
- the system preserves continuity through file-backed history and latest-run metadata
- the “no genuinely new items” case is handled safely and explicitly

This is now a coherent, production-style architecture rather than a prototype glued together with manual commits.
