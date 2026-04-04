import fs from 'node:fs/promises';
import path from 'node:path';
import { extractIranUpdateReportDate } from './iran-update-source.mjs';

export async function loadIranUpdateExtractionRecords(rootDir) {
  const records = new Map();
  async function walk(dir) {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (!entry.name.endsWith('.json')) continue;
      const payload = JSON.parse(await fs.readFile(entryPath, 'utf8'));
      if (payload?.figureId) records.set(payload.figureId, payload);
    }
  }
  await walk(rootDir);
  return records;
}

function countKinds(figures, kind) {
  return figures.filter((figure) => figure.kind === kind).length;
}

export function buildIranUpdateArtifacts({ history, latestRun, extractionRecords }) {
  const generatedAt = new Date().toISOString();
  const items = [...(history.items || [])]
    .sort((a, b) => +new Date(b.publishedAt || 0) - +new Date(a.publishedAt || 0))
    .map((item) => {
      const reportDate = item.reportDate || extractIranUpdateReportDate(item);
      const figures = (item.figures || []).map((figure) => {
        const extraction = extractionRecords.get(figure.figureId);
        const result = extraction?.result || null;
        const points = Array.isArray(result?.points) ? result.points : [];
        return {
          figureId: figure.figureId,
          articleId: item.id,
          articleTitle: item.title,
          articleUrl: item.url,
          articlePublishedAt: item.publishedAt,
          articleReportDate: reportDate,
          ordinal: figure.ordinal,
          sourceUrl: figure.sourceUrl,
          imagePath: figure.imagePath,
          localUrl: figure.localUrl,
          objectPath: figure.objectPath,
          remoteUrl: figure.remoteUrl,
          alt: figure.alt || null,
          caption: figure.caption || null,
          kind: result?.kind || 'unknown',
          extractionStatus: extraction?.status || 'pending',
          extractedAt: extraction?.updatedAt || null,
          confidence: typeof result?.confidence === 'number' ? result.confidence : null,
          title: result?.title || null,
          xAxisLabel: result?.xAxisLabel || null,
          yAxisLabel: result?.yAxisLabel || null,
          units: result?.units || null,
          notes: result?.notes || null,
          points,
        };
      });
      return {
        id: item.id,
        slug: item.slug,
        title: item.title,
        url: item.url,
        canonicalUrl: item.canonicalUrl || item.url,
        publishedAt: item.publishedAt,
        reportDate,
        firstSeenAt: item.firstSeenAt || latestRun.runAt,
        lastSeenAt: item.lastSeenAt || latestRun.runAt,
        sourceId: item.sourceId,
        sourceName: item.sourceName,
        sourceType: item.sourceType,
        tags: item.tags || [],
        keyTakeaways: item.keyTakeaways || [],
        figureCount: figures.length,
        histogramFigureCount: countKinds(figures, 'histogram'),
        mapFigureCount: countKinds(figures, 'map'),
        figures,
      };
    });

  const flattenedFigures = items.flatMap((item) => item.figures);
  const histogramFigures = flattenedFigures.filter((figure) => figure.kind === 'histogram' && figure.points.length > 0);

  const metadata = {
    generatedAt,
    profile: 'iran-update-ingest',
    sourceUrl: latestRun.sourceUrl,
    itemCount: items.length,
    figureCount: flattenedFigures.length,
    histogramFigureCount: histogramFigures.length,
    extractedFigureCount: flattenedFigures.filter((figure) => figure.extractionStatus === 'completed').length,
    lastRunAt: latestRun.runAt,
    newItemCount: Array.isArray(latestRun.newItems) ? latestRun.newItems.length : 0,
    newFigureCount: Array.isArray(latestRun.newFigureIds) ? latestRun.newFigureIds.length : 0,
    latestPublishedAt: latestRun.latestPublishedAt || items[0]?.publishedAt || null,
  };

  return {
    updatesPayload: {
      metadata,
      latestItem: items[0] || null,
      items,
    },
    figuresPayload: {
      metadata,
      figures: flattenedFigures,
      histogramFigures,
    },
  };
}
