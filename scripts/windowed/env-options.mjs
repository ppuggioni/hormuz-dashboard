import path from 'node:path';

function parseRoots(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => path.resolve(part));
}

function maybeSetOption(options, key, value) {
  if (value === undefined || value === null || value === '') return options;
  options[key] = value;
  return options;
}

export function getBaselineOptionsFromEnv() {
  const options = {};
  const sourceRoots = parseRoots(process.env.HORMUZ_WINDOWED_BASE_SOURCE_ROOTS || '');
  if (sourceRoots.length) options.sourceRoots = sourceRoots;
  return options;
}

export function getRefreshOptionsFromEnv() {
  const options = {};
  const sourceRoots = parseRoots(process.env.HORMUZ_WINDOWED_SOURCE_ROOTS || '');
  if (sourceRoots.length) options.sourceRoots = sourceRoots;
  maybeSetOption(options, 'endUtc', process.env.HORMUZ_WINDOWED_END_UTC || null);
  maybeSetOption(options, 'previousDir', process.env.HORMUZ_WINDOWED_PREVIOUS_DIR || null);
  return options;
}

export function getRerunAllOptionsFromEnv() {
  const options = {};
  const sourceRoots = parseRoots(process.env.HORMUZ_WINDOWED_SOURCE_ROOTS || '');
  if (sourceRoots.length) options.sourceRoots = sourceRoots;
  maybeSetOption(options, 'startUtc', process.env.HORMUZ_WINDOWED_START_UTC || null);
  maybeSetOption(options, 'endUtc', process.env.HORMUZ_WINDOWED_END_UTC || null);
  return options;
}
