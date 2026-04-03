import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadIranUpdateHistory } from './iran-update-runtime.mjs';

const ROOT = process.cwd();
const HISTORY_PATH = path.join(ROOT, 'data', 'iran-update-history.json');
const EXTRACTIONS_DIR = path.join(ROOT, 'data', 'iran-update-figure-extractions');
const SCHEMA_PATH = path.join(ROOT, 'config', 'iran-update-figure-extraction-schema.json');
const MODEL = process.env.HORMUZ_IRAN_UPDATE_CODEX_MODEL || 'gpt-5.4-mini';
const LIMIT = Number.parseInt(process.env.HORMUZ_IRAN_UPDATE_EXTRACT_LIMIT || '0', 10);
const FORCE = process.env.HORMUZ_IRAN_UPDATE_EXTRACT_FORCE === '1';
const ONLY_ARTICLE_ID = process.env.HORMUZ_IRAN_UPDATE_ARTICLE_ID || null;
const ONLY_FIGURE_ID = process.env.HORMUZ_IRAN_UPDATE_FIGURE_ID || null;
const RECENT_DAYS = Number.parseInt(process.env.HORMUZ_IRAN_UPDATE_RECENT_DAYS || '1', 10);

function buildPrompt(figure) {
  return [
    'Analyze this single figure image from an Institute for the Study of War Iran Update report.',
    'Classify it as histogram, map, other, or unknown.',
    'If it is a histogram or bar chart, extract the visible categories and their numeric values as accurately as possible.',
    'If it is not a histogram-like chart, return kind=map or other and leave points empty.',
    'Do not invent categories that are not visible.',
    'Use notes to explain uncertainty, OCR ambiguity, or why the image is not a histogram.',
    `Article title: ${figure.articleTitle}`,
    `Article published at: ${figure.articlePublishedAt || 'unknown'}`,
  ].join('\n');
}

async function runCodexExtraction({ imagePath, prompt, outputPath }) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn('codex', [
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--model',
      MODEL,
      '--output-schema',
      SCHEMA_PATH,
      '--output-last-message',
      outputPath,
      '--image',
      imagePath,
      '-',
    ], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on('data', () => {
      // Suppress verbose progress noise here; we only care about the structured output file.
    });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`codex extraction timed out for ${imagePath}`));
    }, 5 * 60 * 1000);

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.stdin.write(prompt);
    child.stdin.end();

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`codex exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      resolve();
    });
  });
}

const history = await loadIranUpdateHistory(HISTORY_PATH);
const latestPublishedAt = [...(history.items || [])]
  .map((item) => item.publishedAt)
  .filter(Boolean)
  .sort((a, b) => +new Date(b) - +new Date(a))[0] || null;
const latestDayStartMs = latestPublishedAt
  ? Date.UTC(
      new Date(latestPublishedAt).getUTCFullYear(),
      new Date(latestPublishedAt).getUTCMonth(),
      new Date(latestPublishedAt).getUTCDate(),
    )
  : null;
const recentThresholdMs = latestDayStartMs != null && Number.isFinite(RECENT_DAYS) && RECENT_DAYS > 0
  ? (latestDayStartMs - ((RECENT_DAYS - 1) * 24 * 60 * 60 * 1000))
  : null;
let processed = 0;
let skipped = 0;

const figures = [...(history.items || [])]
  .filter((item) => {
    if (ONLY_ARTICLE_ID) return item.id === ONLY_ARTICLE_ID;
    if (recentThresholdMs == null) return true;
    return item.publishedAt && +new Date(item.publishedAt) >= recentThresholdMs;
  })
  .flatMap((item) => (item.figures || []).map((figure) => ({
    ...figure,
    articleId: item.id,
    articleTitle: item.title,
    articlePublishedAt: item.publishedAt,
  })))
  .filter((figure) => !ONLY_FIGURE_ID || figure.figureId === ONLY_FIGURE_ID);

for (const figure of figures) {
  const outputPath = path.join(EXTRACTIONS_DIR, figure.articleId.replace(/[:/]/g, '_'), `${figure.figureId.split('#').pop()}.json`);
  if (!FORCE) {
    try {
      const existing = JSON.parse(await fs.readFile(outputPath, 'utf8'));
      if (existing?.status === 'completed') {
        skipped += 1;
        continue;
      }
    } catch {
      // extract it
    }
  }

  const resolvedImagePath = path.join(ROOT, 'public', figure.localUrl.replace(/^\/+/, ''));

  try {
    await runCodexExtraction({
      imagePath: resolvedImagePath,
      prompt: buildPrompt(figure),
      outputPath,
    });
    const raw = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    const payload = {
      version: 1,
      figureId: figure.figureId,
      articleId: figure.articleId,
      status: 'completed',
      updatedAt: new Date().toISOString(),
      model: MODEL,
      result: raw,
    };
    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + '\n');
    processed += 1;
  } catch (error) {
    const payload = {
      version: 1,
      figureId: figure.figureId,
      articleId: figure.articleId,
      status: 'failed',
      updatedAt: new Date().toISOString(),
      model: MODEL,
      error: error instanceof Error ? error.message : String(error),
    };
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + '\n');
    processed += 1;
  }

  if (LIMIT > 0 && processed >= LIMIT) break;
}

console.log(JSON.stringify({
  ok: true,
  processed,
  skipped,
  totalCandidates: figures.length,
  limit: LIMIT > 0 ? LIMIT : null,
  latestPublishedAt,
  recentDays: recentThresholdMs == null ? null : RECENT_DAYS,
}, null, 2));
