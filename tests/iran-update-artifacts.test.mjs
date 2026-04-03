import test from 'node:test';
import assert from 'node:assert/strict';

import { buildIranUpdateArtifacts } from '../scripts/iran-update-artifacts.mjs';

test('buildIranUpdateArtifacts merges extraction records into update and figure payloads', () => {
  const history = {
    version: 1,
    items: [
      {
        id: 'isw-iran-update:sample',
        slug: 'sample',
        title: 'Iran Update Special Report, April 2, 2026',
        url: 'https://example.com/report',
        canonicalUrl: 'https://example.com/report',
        publishedAt: '2026-04-02T18:30:00Z',
        firstSeenAt: '2026-04-03T00:00:00Z',
        lastSeenAt: '2026-04-03T00:00:00Z',
        sourceId: 'isw-iran-update',
        sourceName: 'Institute for the Study of War',
        sourceType: 'research',
        tags: ['iran-update'],
        keyTakeaways: ['Takeaway A'],
        figures: [
          {
            figureId: 'isw-iran-update:sample#figure-01',
            ordinal: 1,
            sourceUrl: 'https://example.com/figure.webp',
            imagePath: 'iran_update_figures/sample/figure-01.webp',
            localUrl: '/data/iran_update_figures/sample/figure-01.webp',
            objectPath: 'hormuz/iran_update_figures/sample/figure-01.webp',
            remoteUrl: 'https://remote/figure.webp',
            alt: 'Histogram',
            caption: 'A chart',
          },
        ],
      },
    ],
  };
  const latestRun = {
    version: 1,
    runAt: '2026-04-03T00:00:00Z',
    sourceUrl: 'https://understandingwar.org/research/?_product_line_filter=iran-update',
    newItems: ['isw-iran-update:sample'],
    newFigureIds: ['isw-iran-update:sample#figure-01'],
    latestPublishedAt: '2026-04-02T18:30:00Z',
  };
  const extractionRecords = new Map([
    ['isw-iran-update:sample#figure-01', {
      status: 'completed',
      updatedAt: '2026-04-03T01:00:00Z',
      result: {
        kind: 'histogram',
        title: 'Missile launches',
        xAxisLabel: 'Date',
        yAxisLabel: 'Count',
        units: 'launches',
        notes: 'Estimated from image',
        confidence: 0.81,
        points: [
          { label: 'Apr 1', value: 10, seriesName: null, notes: null },
          { label: 'Apr 2', value: 14, seriesName: null, notes: null },
        ],
      },
    }],
  ]);

  const { updatesPayload, figuresPayload } = buildIranUpdateArtifacts({ history, latestRun, extractionRecords });

  assert.equal(updatesPayload.metadata.itemCount, 1);
  assert.equal(updatesPayload.metadata.histogramFigureCount, 1);
  assert.equal(updatesPayload.items[0].histogramFigureCount, 1);
  assert.equal(figuresPayload.figures[0].kind, 'histogram');
  assert.equal(figuresPayload.figures[0].points.length, 2);
  assert.equal(figuresPayload.histogramFigures.length, 1);
});
