import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractIranUpdateLinks,
  extractKeyTakeaways,
  parseIranUpdateArticleHtml,
} from '../scripts/iran-update-source.mjs';

test('extractIranUpdateLinks returns unique Iran Update article URLs', () => {
  const html = `
    <a href="https://understandingwar.org/research/middle-east/iran-update-special-report-april-2-2026/">A</a>
    <a href="https://understandingwar.org/research/middle-east/iran-update-special-report-april-2-2026/">B</a>
    <a href="https://understandingwar.org/research/middle-east/another-report/">C</a>
    <a href="https://understandingwar.org/research/middle-east/iran-update-special-report-april-1-2026/">D</a>
  `;
  assert.deepEqual(extractIranUpdateLinks(html), [
    'https://understandingwar.org/research/middle-east/iran-update-special-report-april-2-2026/',
    'https://understandingwar.org/research/middle-east/iran-update-special-report-april-1-2026/',
  ]);
});

test('extractKeyTakeaways parses ordered list content cleanly', () => {
  const html = `
    <h2>Key Takeaways</h2>
    <ol>
      <li>The first takeaway.</li>
      <li>The <strong>second</strong> takeaway.</li>
    </ol>
  `;
  assert.deepEqual(extractKeyTakeaways(html), [
    'The first takeaway.',
    'The second takeaway.',
  ]);
});

test('parseIranUpdateArticleHtml extracts article metadata, takeaways, and figures', () => {
  const html = `
    <html>
      <head>
        <title>Iran Update, April 2, 2026 | ISW</title>
        <meta property="og:title" content="Iran Update Special Report, April 2, 2026" />
        <meta property="article:published_time" content="2026-04-02T18:30:00Z" />
        <link rel="canonical" href="https://understandingwar.org/research/middle-east/iran-update-special-report-april-2-2026/" />
      </head>
      <body>
        <article>
          <h2>Key Takeaways</h2>
          <ol>
            <li>Combined force struck new categories of targets.</li>
            <li>Trump said strategic objectives are nearing completion.</li>
          </ol>
          <figure>
            <img src="https://understandingwar.org/wp-content/uploads/2026/04/Figure-One.webp" alt="Map Thumbnail" />
            <figcaption>Figure one caption.</figcaption>
          </figure>
          <figure>
            <img src="https://understandingwar.org/wp-content/uploads/2026/04/Figure-Two.webp" alt="Histogram Thumbnail" />
          </figure>
        </article>
      </body>
    </html>
  `;

  const parsed = parseIranUpdateArticleHtml(html, 'https://understandingwar.org/research/middle-east/iran-update-special-report-april-2-2026/');
  assert.equal(parsed.id, 'isw-iran-update:iran-update-special-report-april-2-2026');
  assert.equal(parsed.title, 'Iran Update Special Report, April 2, 2026');
  assert.equal(parsed.publishedAt, '2026-04-02T18:30:00Z');
  assert.deepEqual(parsed.keyTakeaways, [
    'Combined force struck new categories of targets.',
    'Trump said strategic objectives are nearing completion.',
  ]);
  assert.equal(parsed.figures.length, 2);
  assert.equal(parsed.figures[0].caption, 'Figure one caption.');
});
