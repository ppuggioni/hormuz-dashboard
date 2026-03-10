import fs from 'node:fs/promises';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ALERT_START_PAYLOAD = process.env.TELEGRAM_ALERT_START_PAYLOAD || 'hormuz_alerts';
const TELEGRAM_ALLOWED_CHATS = (process.env.TELEGRAM_ALLOWED_CHATS || '').split(',').map(s => s.trim()).filter(Boolean);

function must(v, name) { if (!v) throw new Error(`${name} missing`); return v; }

async function supa(path, init = {}) {
  const r = await fetch(`${must(SUPABASE_URL,'SUPABASE_URL')}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: must(SUPABASE_SERVICE_ROLE_KEY,'SUPABASE_SERVICE_ROLE_KEY'),
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  if (r.status === 204) return null;
  const txt = await r.text();
  if (!txt) return null;
  return JSON.parse(txt);
}

async function tg(method, payload = {}) {
  const r = await fetch(`https://api.telegram.org/bot${must(TELEGRAM_BOT_TOKEN,'TELEGRAM_BOT_TOKEN')}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`Telegram ${method} failed: ${JSON.stringify(j)}`);
  return j.result;
}

function eventKey(e) {
  return `${e.shipId}|${e.direction}|${e.t}`;
}

function formatDirection(d) {
  return d === 'east_to_west' ? 'east→west' : d === 'west_to_east' ? 'west→east' : d;
}

async function syncSubscribersFromTelegram() {
  // Read/update offset from local file to avoid duplicate update processing.
  const offsetFile = new URL('../.telegram_updates_offset', import.meta.url);
  let offset = 0;
  try { offset = Number((await fs.readFile(offsetFile, 'utf8')).trim()) || 0; } catch {}

  const updates = await tg('getUpdates', { timeout: 1, offset: offset + 1, allowed_updates: ['message'] });
  let maxUpdateId = offset;

  for (const u of updates) {
    maxUpdateId = Math.max(maxUpdateId, u.update_id || 0);
    const msg = u.message;
    if (!msg?.chat?.id) continue;
    const text = String(msg.text || '').trim();
    const chatId = String(msg.chat.id);

    if (TELEGRAM_ALLOWED_CHATS.length && !TELEGRAM_ALLOWED_CHATS.includes(chatId)) continue;

    if (text.startsWith('/start')) {
      // Optional payload gate: /start hormuz_alerts
      const parts = text.split(/\s+/);
      const payload = parts[1] || '';
      if (payload && payload !== TELEGRAM_ALERT_START_PAYLOAD) continue;

      await supa('marinetraffic_telegram_subscribers?on_conflict=chat_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{
          chat_id: Number(chatId),
          username: msg.from?.username || null,
          first_name: msg.from?.first_name || null,
          is_active: true,
          last_seen_at: new Date().toISOString(),
        }]),
      });

      await tg('sendMessage', {
        chat_id: Number(chatId),
        text: 'Subscribed to tanker crossing alerts. Send /stop to unsubscribe.',
      });
    }

    if (text.startsWith('/stop')) {
      await supa(`marinetraffic_telegram_subscribers?chat_id=eq.${chatId}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: false, last_seen_at: new Date().toISOString() }),
      });
      await tg('sendMessage', {
        chat_id: Number(chatId),
        text: 'Unsubscribed from tanker crossing alerts.',
      });
    }
  }

  await fs.writeFile(offsetFile, String(maxUpdateId));
}

async function dispatchAlerts() {
  const core = JSON.parse(await fs.readFile(new URL('../public/data/processed_core.json', import.meta.url), 'utf8'));
  const events = (core?.data?.crossingEvents || [])
    .filter((e) => e.vesselType === 'tanker')
    .sort((a, b) => +new Date(a.t) - +new Date(b.t));

  if (!events.length) {
    console.log('[tg-alerts] no tanker crossing events');
    return;
  }

  const subs = await supa('marinetraffic_telegram_subscribers?is_active=eq.true&select=id,chat_id');
  if (!subs?.length) {
    console.log('[tg-alerts] no active subscribers');
    return;
  }

  let sentMsgs = 0;
  let sentRows = 0;

  for (const sub of subs) {
    const keys = events.map(eventKey);
    const keyFilter = `(${keys.map((k) => `"${k.replaceAll('"','')}"`).join(',')})`;
    const existing = await supa(`marinetraffic_telegram_events_sent?subscriber_id=eq.${sub.id}&event_key=in.${encodeURIComponent(keyFilter)}&select=event_key`);
    const done = new Set((existing || []).map((x) => x.event_key));
    const fresh = events.filter((e) => !done.has(eventKey(e)));
    if (!fresh.length) continue;

    const lines = fresh.slice(-20).map((e) => `• ${e.shipName} (${e.shipId}) | ${formatDirection(e.direction)} | ${new Date(e.t).toUTCString()}`);
    const txt = `Tanker crossing alert: ${fresh.length} new event(s)\n\n${lines.join('\n')}`;

    await tg('sendMessage', { chat_id: sub.chat_id, text: txt });
    sentMsgs += 1;

    const rows = fresh.map((e) => ({ subscriber_id: sub.id, event_key: eventKey(e) }));
    await supa('marinetraffic_telegram_events_sent?on_conflict=subscriber_id,event_key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    });
    sentRows += rows.length;

    await supa(`marinetraffic_telegram_subscribers?id=eq.${sub.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ last_sent_at: new Date().toISOString() }),
    });
  }

  console.log(`[tg-alerts] sent_msgs=${sentMsgs} sent_rows=${sentRows}`);
}

async function run() {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log('[tg-alerts] skip: TELEGRAM_BOT_TOKEN not set');
    return;
  }
  await syncSubscribersFromTelegram();
  await dispatchAlerts();
}

run().catch((e) => {
  console.error('[tg-alerts] error', e?.message || e);
  process.exit(1);
});
