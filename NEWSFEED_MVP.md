# Hormuz Newsfeed MVP

This repository now contains the MVP plumbing for a newsfeed add-on that appears at the end of the dashboard.

## Current design

- `config/news-watchlist.json`
  - tracked source list for the future dedicated news agent
  - includes the dedicated browser profile name: `hormuz-news`
- `data/news-history.json`
  - persistent collected item history used for dedupe and feed ordering
- `data/news-latest-run.json`
  - latest run metadata, including `lastUpdateSummary`, `last24hSummary`, and IDs of newly added items
- `data/news-inbox.json`
  - staging area for the next collection run before ingest
- `scripts/ingest-news.mjs`
  - merges unseen items from inbox into history and updates latest-run metadata
- `scripts/build-news.mjs`
  - transforms watchlist + history + latest-run metadata into website-ready JSON
- `public/data/news_feed.json`
  - built artifact consumed by the frontend

## Manual workflow today

1. Browse sources using the `hormuz-news` browser profile.
2. Add newly collected items for this run into `data/news-inbox.json`.
   - Use exact post URLs for X.
   - Use real publication date when known.
   - If only a calendar date is known, store it at `06:00:00Z`.
3. Run:

```bash
npm run ingest:news
npm run build:news
```

4. If desired, rebuild the full app/data:

```bash
npm run build:data
npm run build
```

## Future dedicated 6-hour agent

The future isolated news agent should:

1. Read `config/news-watchlist.json`
2. Browse with the `hormuz-news` browser profile
3. Write newly collected items and both summaries into `data/news-inbox.json`
4. Run `npm run ingest:news`
5. Run `npm run build:news`
6. Publish the resulting `public/data/news_feed.json` artifact alongside the rest of the dashboard data pipeline

## Notes

- MVP is intentionally file-based to avoid introducing DB migrations before the UX is proven.
- The frontend is defensive and renders gracefully even if the news artifact is missing.
- Headline-only or partially paywalled sources are still useful in this workflow if they add narrative context.
