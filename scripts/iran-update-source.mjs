import fs from 'node:fs/promises';
import path from 'node:path';

export const IRAN_UPDATE_LIST_URL = 'https://understandingwar.org/research/?_product_line_filter=iran-update';
export const IRAN_UPDATE_SOURCE_ID = 'isw-iran-update';
export const IRAN_UPDATE_SOURCE_NAME = 'Institute for the Study of War';
export const DEFAULT_PUBLIC_BUCKET_ROOT = 'https://hzxiwdylvefcsuaafnhj.supabase.co/storage/v1/object/public/x-scrapes-public';
const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const HTML_ENTITY_MAP = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&quot;': '"',
  '&apos;': "'",
  '&#039;': "'",
  '&#8217;': "'",
  '&#8216;': "'",
  '&#8220;': '"',
  '&#8221;': '"',
  '&#8211;': '-',
  '&#8212;': '-',
  '&#8230;': '...',
};

function decodeHtmlEntities(value) {
  if (!value) return '';
  return value
    .replace(/&#(\d+);/g, (_, codePoint) => {
      try {
        return String.fromCodePoint(Number(codePoint));
      } catch {
        return '';
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, codePoint) => {
      try {
        return String.fromCodePoint(parseInt(codePoint, 16));
      } catch {
        return '';
      }
    })
    .replace(/&(nbsp|amp|quot|apos);|&#0?39;|&#8217;|&#8216;|&#8220;|&#8221;|&#8211;|&#8212;|&#8230;/g, (entity) => HTML_ENTITY_MAP[entity] || entity);
}

export function stripHtml(value) {
  return decodeHtmlEntities((value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function extractMetaContent(html, matcher) {
  const directMatch = html.match(matcher);
  return directMatch ? stripHtml(directMatch[1]) : null;
}

function extractAttribute(tag, attr) {
  const match = tag.match(new RegExp(`${attr}="([^"]+)"`, 'i'));
  return match ? decodeHtmlEntities(match[1]) : null;
}

export function slugFromIranUpdateUrl(url) {
  return url.replace(/\/+$/, '').split('/').pop() || 'iran-update';
}

function toIsoDate(year, monthName, day) {
  const monthIndex = MONTH_NAMES.indexOf(String(monthName || '').toLowerCase());
  if (monthIndex < 0) return null;
  const parsed = new Date(Date.UTC(Number(year), monthIndex, Number(day)));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function extractIranUpdateReportDate({ title, slug, publishedAt }) {
  const normalizedTitle = stripHtml(title || '');
  const titleMatch = normalizedTitle.match(/\b([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\b/);
  if (titleMatch) {
    const [, monthName, day, year] = titleMatch;
    const iso = toIsoDate(year, monthName, day);
    if (iso) return iso;
  }

  const normalizedSlug = String(slug || '').toLowerCase();
  const slugMatch = normalizedSlug.match(/-(january|february|march|april|may|june|july|august|september|october|november|december)-(\d{1,2})-(\d{4})$/);
  if (slugMatch) {
    const [, monthName, day, year] = slugMatch;
    const iso = toIsoDate(year, monthName, day);
    if (iso) return iso;
  }

  if (!publishedAt) return null;
  const parsed = new Date(publishedAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function extractIranUpdateLinks(html) {
  const matches = [...html.matchAll(/href="(https:\/\/understandingwar\.org\/research\/middle-east\/[^"]+)"/g)];
  return [...new Set(matches.map((match) => match[1]).filter((url) => /iran-update/i.test(url)))];
}

export function extractKeyTakeaways(html) {
  const headingIndex = html.search(/<h[1-6][^>]*>\s*Key Takeaways\s*<\/h[1-6]>/i);
  if (headingIndex < 0) return [];
  const section = html.slice(headingIndex, headingIndex + 12000);
  const listMatch = section.match(/<(ol|ul)[^>]*>([\s\S]*?)<\/\1>/i);
  if (!listMatch) return [];
  const items = [...listMatch[2].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((match) => stripHtml(match[1]));
  return items.filter(Boolean);
}

function extractCaptionNearImage(section, src) {
  const srcIndex = section.indexOf(src);
  if (srcIndex < 0) return null;
  const trailing = section.slice(srcIndex, srcIndex + 1000);
  const captionMatch = trailing.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
  return captionMatch ? stripHtml(captionMatch[1]) : null;
}

export function extractFigureImages(html, publishedAt) {
  const contentStart = Math.max(html.indexOf('Key Takeaways'), html.indexOf('<article'));
  let section = contentStart >= 0 ? html.slice(contentStart) : html;
  const stopMarkers = ['<footer', 'Most Popular', 'Related Content', 'site-footer'];
  let endIndex = section.length;
  for (const marker of stopMarkers) {
    const markerIndex = section.indexOf(marker);
    if (markerIndex >= 0) endIndex = Math.min(endIndex, markerIndex);
  }
  section = section.slice(0, endIndex);

  const yearMonth = publishedAt ? publishedAt.slice(0, 7).replace('-', '/') : null;
  const seen = new Set();
  const figures = [];
  for (const match of section.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src = extractAttribute(tag, 'src') || extractAttribute(tag, 'data-src') || extractAttribute(tag, 'data-lazy-src');
    if (!src || !/https:\/\/understandingwar\.org\/wp-content\/uploads\/\d{4}\/\d{2}\//i.test(src)) continue;
    if (!/\.(?:png|jpe?g|webp)(?:\?.*)?$/i.test(src)) continue;
    if (yearMonth && !src.includes(`/${yearMonth}/`)) continue;
    if (/Website-Featured-Image|ISW-Research-Library-Graphic/i.test(src)) continue;
    if (seen.has(src)) continue;
    seen.add(src);
    figures.push({
      sourceUrl: src,
      alt: extractAttribute(tag, 'alt'),
      caption: extractCaptionNearImage(section, src),
    });
  }
  return figures;
}

export function parseIranUpdateArticleHtml(html, url) {
  const canonicalUrl = extractMetaContent(html, /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i) || url;
  const slug = slugFromIranUpdateUrl(canonicalUrl);
  const title = extractMetaContent(html, /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)
    || extractMetaContent(html, /<title>([^<]+)<\/title>/i)
    || slugFromIranUpdateUrl(url);
  const publishedAt = extractMetaContent(html, /<meta[^>]+property="article:published_time"[^>]+content="([^"]+)"/i)
    || extractMetaContent(html, /<time[^>]+datetime="([^"]+)"/i)
    || null;
  const keyTakeaways = extractKeyTakeaways(html);
  const figures = extractFigureImages(html, publishedAt);
  const reportDate = extractIranUpdateReportDate({ title, slug, publishedAt });
  return {
    id: `${IRAN_UPDATE_SOURCE_ID}:${slug}`,
    slug,
    canonicalUrl,
    url: canonicalUrl,
    title,
    publishedAt,
    reportDate,
    keyTakeaways,
    figures,
    sourceId: IRAN_UPDATE_SOURCE_ID,
    sourceName: IRAN_UPDATE_SOURCE_NAME,
    sourceType: 'research',
    tags: ['iran-update', 'isw'],
  };
}

export async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Codex Hormuz dashboard bot)',
      accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!response.ok) {
    throw new Error(`fetch failed ${response.status} for ${url}`);
  }
  return response.text();
}

function extensionFromUrl(url) {
  const pathname = new URL(url).pathname;
  const ext = path.extname(pathname).toLowerCase();
  return ext || '.bin';
}

export function buildFigurePaths({ slug, ordinal, sourceUrl, publicBucketRoot = DEFAULT_PUBLIC_BUCKET_ROOT }) {
  const ext = extensionFromUrl(sourceUrl);
  const filename = `figure-${String(ordinal).padStart(2, '0')}${ext}`;
  const relativeDir = path.posix.join('iran_update_figures', slug);
  const objectPath = path.posix.join('hormuz', relativeDir, filename);
  const localPath = path.join(process.cwd(), 'public', 'data', relativeDir, filename);
  return {
    filename,
    relativeDir,
    objectPath,
    localPath,
    localUrl: `/data/${relativeDir}/${filename}`,
    remoteUrl: `${publicBucketRoot}/${objectPath}`,
  };
}

export async function downloadFigureImage({ sourceUrl, localPath }) {
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  const response = await fetch(sourceUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Codex Hormuz dashboard bot)',
      accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    },
  });
  if (!response.ok) {
    throw new Error(`image fetch failed ${response.status} for ${sourceUrl}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(localPath, Buffer.from(arrayBuffer));
}
