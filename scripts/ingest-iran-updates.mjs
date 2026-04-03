import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildFigurePaths,
  downloadFigureImage,
  fetchText,
  IRAN_UPDATE_LIST_URL,
  parseIranUpdateArticleHtml,
  extractIranUpdateLinks,
} from './iran-update-source.mjs';
import {
  loadIranUpdateHistory,
  loadIranUpdateLatestRun,
} from './iran-update-runtime.mjs';

const ROOT = process.cwd();
const HISTORY_PATH = path.join(ROOT, 'data', 'iran-update-history.json');
const LATEST_RUN_PATH = path.join(ROOT, 'data', 'iran-update-latest-run.json');
const FIGURES_ROOT = path.join(ROOT, 'public', 'data', 'iran_update_figures');
const LIMIT = Number.parseInt(process.env.HORMUZ_IRAN_UPDATE_LIMIT || '30', 10);
const runAt = new Date().toISOString();

const history = await loadIranUpdateHistory(HISTORY_PATH);
const previousLatestRun = await loadIranUpdateLatestRun(LATEST_RUN_PATH);

const listingHtml = await fetchText(IRAN_UPDATE_LIST_URL);
const articleUrls = extractIranUpdateLinks(listingHtml).slice(0, Number.isFinite(LIMIT) ? LIMIT : 30);

const existingByCanonicalUrl = new Map((history.items || []).map((item) => [item.canonicalUrl || item.url, item]));
const newItems = [];
const newFigureIds = [];
let downloadedFigures = 0;

for (const articleUrl of articleUrls) {
  const html = await fetchText(articleUrl);
  const parsed = parseIranUpdateArticleHtml(html, articleUrl);
  const existing = existingByCanonicalUrl.get(parsed.canonicalUrl);
  const existingFigureIds = new Set((existing?.figures || []).map((figure) => figure.figureId));
  const figures = [];

  for (const [index, figure] of parsed.figures.entries()) {
    const ordinal = index + 1;
    const figurePaths = buildFigurePaths({
      slug: parsed.slug,
      ordinal,
      sourceUrl: figure.sourceUrl,
    });
    try {
      await fs.access(figurePaths.localPath);
    } catch {
      await downloadFigureImage({
        sourceUrl: figure.sourceUrl,
        localPath: figurePaths.localPath,
      });
      downloadedFigures += 1;
    }

    const figureId = `${parsed.id}#figure-${String(ordinal).padStart(2, '0')}`;
    if (!existingFigureIds.has(figureId)) newFigureIds.push(figureId);

    figures.push({
      figureId,
      ordinal,
      sourceUrl: figure.sourceUrl,
      alt: figure.alt || null,
      caption: figure.caption || null,
      imagePath: path.posix.join(figurePaths.relativeDir, figurePaths.filename),
      localUrl: figurePaths.localUrl,
      objectPath: figurePaths.objectPath,
      remoteUrl: figurePaths.remoteUrl,
    });
  }

  const normalized = {
    ...parsed,
    firstSeenAt: existing?.firstSeenAt || runAt,
    lastSeenAt: runAt,
    figures,
  };
  if (!existing) newItems.push(normalized.id);
  existingByCanonicalUrl.set(parsed.canonicalUrl, { ...existing, ...normalized });
}

const mergedItems = [...existingByCanonicalUrl.values()].sort((a, b) => +new Date(b.publishedAt || 0) - +new Date(a.publishedAt || 0));

const latestRun = {
  version: 1,
  runAt,
  sourceUrl: IRAN_UPDATE_LIST_URL,
  newItems,
  newFigureIds,
  itemCount: mergedItems.length,
  figureCount: mergedItems.reduce((sum, item) => sum + (item.figures?.length || 0), 0),
  latestPublishedAt: mergedItems[0]?.publishedAt || previousLatestRun.latestPublishedAt || null,
  downloadedFigures,
};

await fs.mkdir(path.dirname(HISTORY_PATH), { recursive: true });
await fs.mkdir(FIGURES_ROOT, { recursive: true });
await fs.writeFile(HISTORY_PATH, JSON.stringify({ version: 1, items: mergedItems }, null, 2) + '\n');
await fs.writeFile(LATEST_RUN_PATH, JSON.stringify(latestRun, null, 2) + '\n');

console.log(JSON.stringify({
  ok: true,
  runAt,
  articleCount: articleUrls.length,
  totalHistoryItems: mergedItems.length,
  newItems: newItems.length,
  newFigureIds: newFigureIds.length,
  downloadedFigures,
}, null, 2));
