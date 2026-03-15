# MVP Newsfeed Report

## What was implemented

A first-pass newsfeed MVP was added directly into the Hormuz dashboard repo.

### Added
- `config/news-watchlist.json`
  - initial tracked sources
  - includes the dedicated browser profile name: `hormuz-news`
- `data/news-seed-items.json`
  - file-backed curated seed storage for MVP items and executive summary
- `scripts/build-news.mjs`
  - generates website-ready `public/data/news_feed.json`
- `NEWSFEED_MVP.md`
  - explains the manual workflow now and the future dedicated six-hour agent handoff
- `public/data/news_feed.json`
  - generated artifact consumed by the frontend
- newsfeed section in `src/app/page.tsx`
  - executive summary card
  - tracked source list
  - item feed with tags and optional figure note

### Changed
- `package.json`
  - added `build:news`
  - made `dev` and `build` run `build:news`

## MVP design choices

- kept storage file-based for now
- no DB migration required
- frontend remains stable before first live ingest
- future six-hour isolated agent can simply:
  1. browse with `hormuz-news`
  2. update backing store
  3. run `npm run build:news`

## Assumptions

- A manual first live browsing pass will happen before full automation.
- Paywalled/headline-only sources are still worth retaining in the watchlist.
- For MVP, `news_feed.json` is allowed to be generated from curated seed/manual data rather than live scraped content.

## Build status

- `npm run build:news` succeeded.
- Full `npm run build` was not completed yet in this pass; recommended next step is to run it after reviewing the UI.

## Files changed

- `config/news-watchlist.json`
- `data/news-seed-items.json`
- `scripts/build-news.mjs`
- `NEWSFEED_MVP.md`
- `MVP_NEWSFEED_REPORT.md`
- `package.json`
- `src/app/page.tsx`
- `public/data/news_feed.json`
