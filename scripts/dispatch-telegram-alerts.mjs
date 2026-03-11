import fs from 'node:fs/promises';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ALERT_START_PAYLOAD = process.env.TELEGRAM_ALERT_START_PAYLOAD || 'hormuz_alerts';
const TELEGRAM_ALLOWED_CHATS = (process.env.TELEGRAM_ALLOWED_CHATS || '').split(',').map(s => s.trim()).filter(Boolean);
const ALERTS_PUBLIC_BASE_URL = process.env.ALERTS_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '';

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

function candidateKey(c) {
  return `cand|${c.shipId}|${c.lastSeenAt}`;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function formatDirection(d) {
  return d === 'east_to_west' ? 'east→west' : d === 'west_to_east' ? 'west→east' : d;
}

function computeCandidateCrossers(snapshots, eastLon, westLon, crossingShipIds) {
  if (!Array.isArray(snapshots) || !snapshots.length) return [];
  const latestTs = +new Date(snapshots[snapshots.length - 1].t);
  const centerLon = (eastLon + westLon) / 2;
  const centerLat = 26.25;

  const byShip = new Map();
  for (const s of snapshots) {
    for (const p of s.points || []) {
      if (p.vesselType !== 'tanker') continue;
      if (!byShip.has(p.shipId)) byShip.set(p.shipId, { shipName: p.shipName, points: [] });
      byShip.get(p.shipId).points.push({ t: s.t, lat: p.lat, lon: p.lon });
    }
  }

  const out = [];
  for (const [shipId, v] of byShip.entries()) {
    if (crossingShipIds.has(shipId)) continue;
    const pts = v.points.sort((a, b) => +new Date(a.t) - +new Date(b.t));
    if (pts.length < 3) continue;
    const last = pts[pts.length - 1];
    const darkHours = (latestTs - +new Date(last.t)) / 3600000;
    if (darkHours <= 6 || darkHours > 48) continue;

    const tail = pts.slice(-Math.min(6, pts.length));
    if (tail.length < 3) continue;

    let aligned = 0;
    let speedQuality = 0;
    let segCount = 0;
    const segSpeeds = [];

    for (let i = 1; i < tail.length; i++) {
      const a = tail[i - 1];
      const b = tail[i];
      const distPrev = haversineKm(a.lat, a.lon, centerLat, centerLon);
      const distCur = haversineKm(b.lat, b.lon, centerLat, centerLon);
      if (distCur < distPrev) aligned += 1;

      const dtHours = Math.max((+new Date(b.t) - +new Date(a.t)) / 3600000, 1 / 60);
      const speedKnots = (haversineKm(a.lat, a.lon, b.lat, b.lon) / dtHours) / 1.852;
      segSpeeds.push(speedKnots);
      if (speedKnots < 3) speedQuality += 0.2;
      else if (speedKnots <= 23) speedQuality += 1;
      else if (speedKnots <= 30) speedQuality += 0.5;
      else speedQuality += 0.1;
      segCount += 1;
    }

    const alignedPoints = aligned + 1;
    if (alignedPoints < 3) continue;

    const speedScore = segCount ? speedQuality / segCount : 0;
    const approachConfidence = Math.min(1, (alignedPoints / Math.max(3, tail.length)) * speedScore);
    const lastMidDistKm = haversineKm(last.lat, last.lon, centerLat, centerLon);
    const proximityRaw = 1 - Math.min(1, lastMidDistKm / 160);
    const prev = tail[tail.length - 2];
    const lastDist = haversineKm(last.lat, last.lon, centerLat, centerLon);
    const prevDist = haversineKm(prev.lat, prev.lon, centerLat, centerLon);
    const approachDirectionRaw = Math.max(-1, Math.min(1, (prevDist - lastDist) / 8));

    const approachScore = approachConfidence * 55;
    const proximityScore = proximityRaw * 20;
    const directionScore = approachDirectionRaw > 0 ? approachDirectionRaw * 25 : approachDirectionRaw * 20;
    const lastSegmentKnots = segSpeeds.length ? segSpeeds[segSpeeds.length - 1] : 0;
    const prevSegmentKnots = segSpeeds.length > 1 ? segSpeeds[segSpeeds.length - 2] : lastSegmentKnots;

    let readinessScore = 0;
    if (lastSegmentKnots < 2 && approachDirectionRaw <= 0) readinessScore = -12;
    if (lastSegmentKnots >= 4 && lastSegmentKnots > prevSegmentKnots && approachDirectionRaw > 0) readinessScore = 4;

    let onePointPostAnchoringPenalty = 0;
    if (segSpeeds.length >= 2) {
      const anchorLikeCount = segSpeeds.slice(0, -1).filter((x) => x < 2).length;
      const hasOnlyOnePostAnchorSegment = segSpeeds[segSpeeds.length - 1] >= 2 && segSpeeds[segSpeeds.length - 2] < 2;
      if (anchorLikeCount >= 1 && hasOnlyOnePostAnchorSegment) onePointPostAnchoringPenalty = -6;
    }

    const score = approachScore + proximityScore + directionScore + readinessScore + onePointPostAnchoringPenalty;
    if (score <= 50) continue;

    out.push({ shipId, shipName: v.shipName, lastSeenAt: last.t, darkHours, score });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, 20);
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

  let snapshots = [];
  try {
    const playbackAll = JSON.parse(await fs.readFile(new URL('../public/data/processed_playback_all.json', import.meta.url), 'utf8'));
    snapshots = playbackAll?.data?.snapshots || [];
  } catch {
    try {
      const playback24 = JSON.parse(await fs.readFile(new URL('../public/data/processed_playback_24h.json', import.meta.url), 'utf8'));
      snapshots = playback24?.data?.snapshots || [];
    } catch {}
  }

  const crossingShipIds = new Set((core?.data?.crossingPaths || []).map((p) => p.shipId));
  const candidateCrossers = computeCandidateCrossers(
    snapshots,
    core?.metadata?.eastLon ?? 56.4,
    core?.metadata?.westLon ?? 56.15,
    crossingShipIds,
  );

  if (!events.length && !candidateCrossers.length) {
    console.log('[tg-alerts] no tanker crossing events and no candidate dark crossers');
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
    const eventKeys = events.map(eventKey);
    const candidateKeys = candidateCrossers.map(candidateKey);
    const keys = [...eventKeys, ...candidateKeys];

    const done = new Set();
    if (keys.length) {
      const keyFilter = `(${keys.map((k) => `"${k.replaceAll('"','')}"`).join(',')})`;
      const existing = await supa(`marinetraffic_telegram_events_sent?subscriber_id=eq.${sub.id}&event_key=in.${encodeURIComponent(keyFilter)}&select=event_key`);
      for (const x of (existing || [])) done.add(x.event_key);
    }

    const freshEvents = events.filter((e) => !done.has(eventKey(e)));
    const freshCandidates = candidateCrossers.filter((c) => !done.has(candidateKey(c)));
    if (!freshEvents.length && !freshCandidates.length) continue;

    const crossingLines = freshEvents.slice(-15).map((e) => `• ${e.shipName} (${e.shipId}) | ${formatDirection(e.direction)} | ${new Date(e.t).toUTCString()}`);
    const candidateLines = freshCandidates.slice(-10).map((c) => `• ${c.shipName} (${c.shipId}) | score ${c.score.toFixed(1)} | dark ${c.darkHours.toFixed(1)}h | last seen ${new Date(c.lastSeenAt).toUTCString()}\n  ${`https://www.marinetraffic.com/en/ais/details/ships/shipid:${c.shipId}`}`);

    const dashboardUrl = ALERTS_PUBLIC_BASE_URL || '';
    const txt = [
      `Hormuz tanker alert`,
      freshEvents.length ? `\nNew observed crossings: ${freshEvents.length}` : '',
      crossingLines.length ? crossingLines.join('\n') : '',
      freshCandidates.length ? `\nDark-crossing candidates (>50 score, >6h dark, <=48h): ${freshCandidates.length}` : '',
      candidateLines.length ? candidateLines.join('\n') : '',
      dashboardUrl ? `\nDashboard: ${dashboardUrl}` : '',
      dashboardUrl ? `${dashboardUrl}#candidate-dark-crossers` : '',
    ].filter(Boolean).join('\n');

    await tg('sendMessage', { chat_id: sub.chat_id, text: txt, disable_web_page_preview: true });
    sentMsgs += 1;

    const rows = [
      ...freshEvents.map((e) => ({ subscriber_id: sub.id, event_key: eventKey(e) })),
      ...freshCandidates.map((c) => ({ subscriber_id: sub.id, event_key: candidateKey(c) })),
    ];
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
