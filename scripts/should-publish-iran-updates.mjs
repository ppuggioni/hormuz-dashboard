import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createEmptyIranUpdatePublishState,
  loadIranUpdateHistory,
  loadIranUpdatePublishState,
} from './iran-update-runtime.mjs';
import { extractIranUpdateReportDate } from './iran-update-source.mjs';

const ROOT = process.cwd();
const HISTORY_PATH = path.join(ROOT, 'data', 'iran-update-history.json');
const PUBLISH_STATE_PATH = path.join(ROOT, 'data', 'iran-update-publish-state.json');
const FORCE = process.env.HORMUZ_IRAN_UPDATE_FORCE_PUBLISH === '1';

const history = await loadIranUpdateHistory(HISTORY_PATH);
const publishState = await loadIranUpdatePublishState(PUBLISH_STATE_PATH);
const latestItem = [...(history.items || [])]
  .sort((a, b) => +new Date(b.publishedAt || 0) - +new Date(a.publishedAt || 0))[0] || null;

const latestReportId = latestItem?.id || null;
const latestReportDate = latestItem ? extractIranUpdateReportDate(latestItem) : null;
const reason = FORCE
  ? 'forced'
  : !latestReportId
    ? 'no-latest-report'
    : publishState.lastPublishedReportId !== latestReportId
      ? 'new-report'
      : 'already-published';
const shouldPublish = FORCE || (Boolean(latestReportId) && publishState.lastPublishedReportId !== latestReportId);

const nextState = shouldPublish
  ? {
      version: 1,
      lastCheckedAt: new Date().toISOString(),
      lastPublishedAt: latestItem?.publishedAt || publishState.lastPublishedAt || null,
      lastPublishedReportId: latestReportId,
      lastPublishedReportDate: latestReportDate,
    }
  : {
      ...createEmptyIranUpdatePublishState(),
      ...publishState,
      lastCheckedAt: new Date().toISOString(),
    };

console.log(JSON.stringify({
  shouldPublish,
  forced: FORCE,
  reason,
  latestReportId,
  latestReportDate,
  lastPublishedReportId: publishState.lastPublishedReportId || null,
  publishStatePath: PUBLISH_STATE_PATH,
  nextState,
}, null, 2));
