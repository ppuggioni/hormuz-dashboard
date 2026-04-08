import fs from 'node:fs/promises';
import path from 'node:path';

export const USNI_WP_API_ROOT = 'https://news.usni.org/wp-json/wp/v2';
export const USNI_FLEET_TRACKER_CATEGORY_URL = 'https://news.usni.org/category/fleet-tracker';
export const USNI_FLEET_TRACKER_CATEGORY_SLUG = 'fleet-tracker';
export const USNI_SOURCE_ID = 'usni-fleet';
export const USNI_SOURCE_NAME = 'USNI News';
export const USNI_DEFAULT_PUBLIC_BUCKET_ROOT = 'https://hzxiwdylvefcsuaafnhj.supabase.co/storage/v1/object/public/x-scrapes-public';
export const DEFAULT_USNI_FLEET_SINCE = '2026-02-01T00:00:00Z';
export const DEFAULT_USNI_NEWS_SEARCH_TERMS = [
  'Middle East',
  'Arabian Sea',
  'Red Sea',
  'Gulf of Oman',
  'Gulf of Aden',
  'Suez',
  'Strait of Gibraltar',
  'Mediterranean Sea',
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
        return String.fromCodePoint(Number.parseInt(codePoint, 16));
      } catch {
        return '';
      }
    })
    .replace(/&(nbsp|amp|quot|apos);|&#0?39;|&#8217;|&#8216;|&#8220;|&#8221;|&#8211;|&#8212;|&#8230;/g, (entity) => HTML_ENTITY_MAP[entity] || entity);
}

export function stripHtml(value) {
  return decodeHtmlEntities((value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeIsoDate(value) {
  if (!value) return null;
  const maybeIso = /z$/i.test(value) ? value : `${value}Z`;
  const parsed = new Date(maybeIso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function extensionFromUrl(url) {
  const pathname = new URL(url).pathname;
  const ext = path.extname(pathname).toLowerCase();
  return ext || '.bin';
}

function buildApiUrl(endpoint, params = {}) {
  const url = new URL(`${USNI_WP_API_ROOT}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Codex Hormuz dashboard bot)',
      accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`fetch failed ${response.status} for ${url}`);
  }
  return response.json();
}

async function fetchWpCollection(endpoint, params = {}, maxPages = 1) {
  const items = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages && page <= maxPages; page += 1) {
    const url = buildApiUrl(endpoint, { ...params, page });
    const response = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Codex Hormuz dashboard bot)',
        accept: 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`fetch failed ${response.status} for ${url}`);
    }
    const pageItems = await response.json();
    totalPages = Number.parseInt(response.headers.get('x-wp-totalpages') || '1', 10) || 1;
    items.push(...pageItems);
  }
  return items;
}

export async function fetchCategoryBySlug(slug) {
  const categories = await fetchWpCollection('categories', { slug, per_page: 10 }, 1);
  return categories[0] || null;
}

export async function fetchFleetTrackerPosts({ after = DEFAULT_USNI_FLEET_SINCE, perPage = 20, maxPages = 4 } = {}) {
  const category = await fetchCategoryBySlug(USNI_FLEET_TRACKER_CATEGORY_SLUG);
  if (!category?.id) {
    throw new Error(`USNI category not found for slug ${USNI_FLEET_TRACKER_CATEGORY_SLUG}`);
  }
  return fetchWpCollection('posts', {
    categories: category.id,
    after,
    per_page: perPage,
    orderby: 'date',
    order: 'desc',
    _embed: 1,
  }, maxPages);
}

export async function searchUsniNewsPosts({
  searchTerms = DEFAULT_USNI_NEWS_SEARCH_TERMS,
  after = DEFAULT_USNI_FLEET_SINCE,
  perPage = 10,
  maxPagesPerTerm = 1,
} = {}) {
  const results = [];
  for (const searchTerm of searchTerms) {
    const posts = await fetchWpCollection('posts', {
      search: searchTerm,
      after,
      per_page: perPage,
      orderby: 'date',
      order: 'desc',
      _embed: 1,
    }, maxPagesPerTerm);
    for (const post of posts) results.push({ post, searchTerm });
  }
  return results;
}

function extractImageTags(html) {
  return [...String(html || '').matchAll(/<img\b[^>]*src="([^"]+)"[^>]*>/gi)].map((match) => match[1]);
}

function cleanRenderedHtml(html) {
  return String(html || '')
    .replace(/<figure[\s\S]*?<\/figure>/gi, ' ')
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
}

function fragmentToText(html) {
  return decodeHtmlEntities(
    String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim(),
  );
}

export function renderedHtmlToPlainText(html) {
  return fragmentToText(cleanRenderedHtml(html));
}

export function extractSectionBlocks(html) {
  const cleaned = cleanRenderedHtml(html);
  const matches = [...cleaned.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)];
  if (!matches.length) return [];
  const sections = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const next = matches[index + 1];
    const start = match.index + match[0].length;
    const end = next ? next.index : cleaned.length;
    const heading = stripHtml(match[2]);
    const bodyHtml = cleaned.slice(start, end);
    const bodyText = fragmentToText(bodyHtml);
    sections.push({
      heading,
      bodyText,
    });
  }
  return sections.filter((section) => section.heading || section.bodyText);
}

function selectPrimaryMapImage(post, renderedHtml) {
  const images = extractImageTags(renderedHtml).filter((src) => /\/wp-content\/uploads\//i.test(src));
  const featured = post?._embedded?.['wp:featuredmedia']?.[0]?.source_url || null;
  if (images[0]) return images[0];
  if (featured && /\/wp-content\/uploads\//i.test(featured)) return featured;
  return featured;
}

function normalizeCategoryTerms(post) {
  return (post?._embedded?.['wp:term'] || [])
    .flat()
    .filter((term) => term?.taxonomy === 'category')
    .map((term) => ({
      id: term.id,
      slug: term.slug,
      name: stripHtml(term.name),
    }));
}

export function normalizeUsniPost(post, { sourceKind, searchTerm = null } = {}) {
  const title = stripHtml(post?.title?.rendered || '');
  const excerpt = stripHtml(post?.excerpt?.rendered || '');
  const contentHtml = post?.content?.rendered || '';
  const contentText = renderedHtmlToPlainText(contentHtml);
  const sections = extractSectionBlocks(contentHtml);
  const mapImageSourceUrl = sourceKind === 'fleet_tracker' ? selectPrimaryMapImage(post, contentHtml) : null;
  return {
    id: `${USNI_SOURCE_ID}:${post.id}`,
    wpId: post.id,
    slug: post.slug,
    url: post.link,
    canonicalUrl: post.link,
    title,
    excerpt,
    publishedAt: normalizeIsoDate(post.date_gmt || post.date),
    modifiedAt: normalizeIsoDate(post.modified_gmt || post.modified),
    sourceId: USNI_SOURCE_ID,
    sourceName: USNI_SOURCE_NAME,
    sourceType: 'news',
    sourceKind,
    sourceKinds: [sourceKind],
    searchTerm,
    searchTerms: searchTerm ? [searchTerm] : [],
    categories: normalizeCategoryTerms(post),
    contentText,
    sections,
    mapImageSourceUrl,
    mapImageAlt: null,
    firstSeenAt: null,
    lastSeenAt: null,
    tags: ['usni', sourceKind].filter(Boolean),
    _debug: {
      rawTitle: normalizeWhitespace(post?.title?.rendered || ''),
    },
  };
}

export function buildUsniMapPaths({ slug, sourceUrl, publicBucketRoot = USNI_DEFAULT_PUBLIC_BUCKET_ROOT }) {
  const ext = extensionFromUrl(sourceUrl);
  const filename = `map${ext}`;
  const relativeDir = path.posix.join('usni_fleet_maps', slug);
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

export async function downloadBinary({ sourceUrl, localPath, accept = '*/*' }) {
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  const response = await fetch(sourceUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Codex Hormuz dashboard bot)',
      accept,
    },
  });
  if (!response.ok) {
    throw new Error(`asset fetch failed ${response.status} for ${sourceUrl}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(localPath, Buffer.from(arrayBuffer));
}
