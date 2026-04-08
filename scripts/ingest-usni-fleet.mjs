import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_USNI_FLEET_SINCE,
  DEFAULT_USNI_NEWS_SEARCH_TERMS,
  buildUsniMapPaths,
  downloadBinary,
  fetchFleetTrackerPosts,
  normalizeUsniPost,
  searchUsniNewsPosts,
} from './usni-fleet-source.mjs';
import {
  loadUsniFleetHistory,
  loadUsniFleetLatestRun,
} from './usni-fleet-runtime.mjs';

const ROOT = process.cwd();
const HISTORY_PATH = path.join(ROOT, 'data', 'usni-fleet-history.json');
const LATEST_RUN_PATH = path.join(ROOT, 'data', 'usni-fleet-latest-run.json');
const MAPS_ROOT = path.join(ROOT, 'public', 'data', 'usni_fleet_maps');
const runAt = new Date().toISOString();

const after = process.env.HORMUZ_USNI_FLEET_SINCE || DEFAULT_USNI_FLEET_SINCE;
const trackerPerPage = Number.parseInt(process.env.HORMUZ_USNI_FLEET_TRACKER_PER_PAGE || '20', 10);
const trackerMaxPages = Number.parseInt(process.env.HORMUZ_USNI_FLEET_TRACKER_MAX_PAGES || '4', 10);
const newsPerPage = Number.parseInt(process.env.HORMUZ_USNI_FLEET_NEWS_PER_PAGE || '10', 10);
const newsMaxPagesPerTerm = Number.parseInt(process.env.HORMUZ_USNI_FLEET_NEWS_MAX_PAGES || '1', 10);
const newsSearchTerms = (process.env.HORMUZ_USNI_FLEET_NEWS_TERMS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const effectiveNewsSearchTerms = newsSearchTerms.length ? newsSearchTerms : DEFAULT_USNI_NEWS_SEARCH_TERMS;

const history = await loadUsniFleetHistory(HISTORY_PATH);
const previousLatestRun = await loadUsniFleetLatestRun(LATEST_RUN_PATH);
const existingById = new Map((history.items || []).map((item) => [item.id, item]));

const trackerPosts = await fetchFleetTrackerPosts({ after, perPage: trackerPerPage, maxPages: trackerMaxPages });
const newsSearchResults = await searchUsniNewsPosts({
  after,
  searchTerms: effectiveNewsSearchTerms,
  perPage: newsPerPage,
  maxPagesPerTerm: newsMaxPagesPerTerm,
});

const newItemIds = [];
let downloadedMaps = 0;
let trackerItemCount = 0;
let newsItemCount = 0;

function upsertItem(item) {
  const existing = existingById.get(item.id);
  const sourceKinds = [...new Set([
    ...(existing?.sourceKinds || (existing?.sourceKind ? [existing.sourceKind] : [])),
    ...(item.sourceKinds || (item.sourceKind ? [item.sourceKind] : [])),
  ])];
  const searchTerms = [...new Set([
    ...(existing?.searchTerms || (existing?.searchTerm ? [existing.searchTerm] : [])),
    ...(item.searchTerms || (item.searchTerm ? [item.searchTerm] : [])),
  ].filter(Boolean))];
  const merged = {
    ...existing,
    ...item,
    sourceKinds,
    sourceKind: sourceKinds.includes('fleet_tracker') ? 'fleet_tracker' : (item.sourceKind || existing?.sourceKind || 'news'),
    searchTerms,
    searchTerm: searchTerms[0] || null,
    firstSeenAt: existing?.firstSeenAt || runAt,
    lastSeenAt: runAt,
  };
  if (!existing) newItemIds.push(item.id);
  existingById.set(item.id, merged);
}

for (const post of trackerPosts) {
  const normalized = normalizeUsniPost(post, { sourceKind: 'fleet_tracker' });
  if (!normalized.publishedAt) continue;
  if (normalized.mapImageSourceUrl) {
    const mapPaths = buildUsniMapPaths({
      slug: normalized.slug,
      sourceUrl: normalized.mapImageSourceUrl,
    });
    try {
      await fs.access(mapPaths.localPath);
    } catch {
      await downloadBinary({
        sourceUrl: normalized.mapImageSourceUrl,
        localPath: mapPaths.localPath,
        accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      });
      downloadedMaps += 1;
    }
    normalized.mapImagePath = path.posix.join(mapPaths.relativeDir, mapPaths.filename);
    normalized.mapImageLocalUrl = mapPaths.localUrl;
    normalized.mapImageObjectPath = mapPaths.objectPath;
    normalized.mapImageRemoteUrl = mapPaths.remoteUrl;
  } else {
    normalized.mapImagePath = null;
    normalized.mapImageLocalUrl = null;
    normalized.mapImageObjectPath = null;
    normalized.mapImageRemoteUrl = null;
  }
  trackerItemCount += 1;
  upsertItem(normalized);
}

for (const { post, searchTerm } of newsSearchResults) {
  const normalized = normalizeUsniPost(post, { sourceKind: 'news', searchTerm });
  if (!normalized.publishedAt) continue;
  newsItemCount += 1;
  upsertItem(normalized);
}

const mergedItems = [...existingById.values()]
  .sort((a, b) => +new Date(b.publishedAt || 0) - +new Date(a.publishedAt || 0));

const latestRun = {
  version: 1,
  runAt,
  sourceUrl: 'https://news.usni.org/category/fleet-tracker',
  sourceApiUrl: 'https://news.usni.org/wp-json/wp/v2',
  newItemIds,
  downloadedMaps,
  itemCount: mergedItems.length,
  trackerItemCount: mergedItems.filter((item) => item.sourceKind === 'fleet_tracker').length,
  newsItemCount: mergedItems.filter((item) => item.sourceKind === 'news').length,
  latestPublishedAt: mergedItems[0]?.publishedAt || previousLatestRun.latestPublishedAt || null,
  after,
  searchTerms: effectiveNewsSearchTerms,
};

await fs.mkdir(path.dirname(HISTORY_PATH), { recursive: true });
await fs.mkdir(MAPS_ROOT, { recursive: true });
await fs.writeFile(HISTORY_PATH, JSON.stringify({ version: 1, items: mergedItems }, null, 2) + '\n');
await fs.writeFile(LATEST_RUN_PATH, JSON.stringify(latestRun, null, 2) + '\n');

console.log(JSON.stringify({
  ok: true,
  runAt,
  trackerFetched: trackerPosts.length,
  newsFetched: newsSearchResults.length,
  totalHistoryItems: mergedItems.length,
  newItems: newItemIds.length,
  downloadedMaps,
}, null, 2));
