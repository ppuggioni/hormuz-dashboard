import fs from 'node:fs/promises';
import path from 'node:path';
import { loadNewsHistory, loadNewsLatestRun } from './news-runtime.mjs';

const ENV_PATH = path.resolve(process.cwd(), '../.env');
try {
  const rawEnv = await fs.readFile(ENV_PATH, 'utf8');
  for (const line of rawEnv.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
} catch {}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ALERT_START_PAYLOAD = process.env.TELEGRAM_ALERT_START_PAYLOAD || 'hormuz_alerts';
const TELEGRAM_ALLOWED_CHATS = (process.env.TELEGRAM_ALLOWED_CHATS || '').split(',').map(s => s.trim()).filter(Boolean);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ALERTS_PUBLIC_BASE_URL = process.env.ALERTS_PUBLIC_BASE_URL || 'https://hormuz-dashboard-six.vercel.app/';

function must(v, name) {
  if (!v) throw new Error(`${name} missing`);
  return v;
}

async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${must(TELEGRAM_BOT_TOKEN,'TELEGRAM_BOT_TOKEN')}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`Telegram ${method} failed: ${JSON.stringify(j)}`);
  return j.result;
}

async function supa(path, init = {}) {
  const r = await fetch(`${must(SUPABASE_URL,'SUPABASE_URL')}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: must(SUPABASE_SERVICE_ROLE_KEY,'SUPABASE_SERVICE_ROLE_KEY'),
      Authorization: `Bearer ${must(SUPABASE_SERVICE_ROLE_KEY,'SUPABASE_SERVICE_ROLE_KEY')}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`Supabase ${path} failed: ${r.status} ${await r.text()}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

async function syncSubscribersFromTelegram() {
  const offsetFile = new URL('../.telegram_updates_offset', import.meta.url);
  let offset = 0;
  try {
    offset = Number(await fs.readFile(offsetFile, 'utf8')) || 0;
  } catch {}

  const updates = await tg('getUpdates', { offset: offset + 1, timeout: 0, allowed_updates: ['message'] });
  let maxId = offset;
  for (const u of updates || []) {
    maxId = Math.max(maxId, u.update_id || 0);
    const msg = u.message;
    if (!msg?.chat?.id) continue;
    const chatId = String(msg.chat.id);
    if (TELEGRAM_ALLOWED_CHATS.length && !TELEGRAM_ALLOWED_CHATS.includes(chatId)) continue;
    const txt = String(msg.text || '').trim();
    if (txt === '/start' || txt.startsWith('/start ')) {
      const payload = txt.split(' ')[1] || '';
      if (payload && payload !== TELEGRAM_ALERT_START_PAYLOAD) continue;
      await supa('marinetraffic_telegram_subscribers?on_conflict=chat_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{ chat_id: chatId, is_active: true }]),
      });
      await tg('sendMessage', {
        chat_id: chatId,
        text: 'Subscribed to Hormuz dashboard Telegram updates. You will receive crossing alerts and news updates.',
        disable_web_page_preview: true,
      });
    }
    if (txt === '/stop') {
      await supa(`marinetraffic_telegram_subscribers?chat_id=eq.${chatId}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: false }),
      });
      await tg('sendMessage', {
        chat_id: chatId,
        text: 'Unsubscribed from Hormuz dashboard Telegram updates.',
        disable_web_page_preview: true,
      });
    }
  }
  await fs.writeFile(offsetFile, String(maxId), 'utf8');
}

async function run() {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log('[tg-news] skip: TELEGRAM_BOT_TOKEN not set');
    return;
  }

  await syncSubscribersFromTelegram();

  const latest = await loadNewsLatestRun(new URL('../data/news-latest-run.json', import.meta.url));
  const history = await loadNewsHistory(new URL('../data/news-history.json', import.meta.url));
  const newIds = latest.newItems || [];
  if (!newIds.length) {
    console.log('[tg-news] no new items in latest run');
    return;
  }

  const items = (history.items || []).filter((x) => newIds.includes(x.id));
  if (!items.length) {
    console.log('[tg-news] latest run had ids but no matching history items');
    return;
  }

  const subs = await supa('marinetraffic_telegram_subscribers?is_active=eq.true&select=id,chat_id');
  if (!subs?.length) {
    console.log('[tg-news] no active subscribers');
    return;
  }

  const eventKeyBase = `news:${latest.runAt}`;
  let sentMsgs = 0;
  let sentRows = 0;

  for (const sub of subs) {
    const eventKey = `${eventKeyBase}`;
    const existing = await supa(`marinetraffic_telegram_events_sent?subscriber_id=eq.${sub.id}&event_key=eq.${encodeURIComponent(eventKey)}&select=event_key`);
    if (existing?.length) continue;

    const lines = items.slice(0, 5).map((item, idx) => {
      const title = item.title || item.sourceName || 'Untitled';
      return `${idx + 1}. ${title}\n${item.canonicalUrl}`;
    });

    const txt = [
      'Hormuz news update',
      latest.lastUpdateSummary?.headline || '',
      latest.lastUpdateSummary?.body || '',
      '',
      `New items: ${items.length}`,
      ...lines,
      '',
      `Dashboard: ${ALERTS_PUBLIC_BASE_URL}#newsfeed`,
    ].filter(Boolean).join('\n');

    await tg('sendMessage', { chat_id: sub.chat_id, text: txt, disable_web_page_preview: true });
    sentMsgs += 1;

    await supa('marinetraffic_telegram_events_sent?on_conflict=subscriber_id,event_key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ subscriber_id: sub.id, event_key: eventKey }]),
    });
    sentRows += 1;

    await supa(`marinetraffic_telegram_subscribers?id=eq.${sub.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ last_sent_at: new Date().toISOString() }),
    });
  }

  console.log(`[tg-news] sent_msgs=${sentMsgs} sent_rows=${sentRows}`);
}

run().catch((e) => {
  console.error('[tg-news] error', e?.message || e);
  process.exit(1);
});
