import fs from 'node:fs/promises';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ALERTS_FROM_EMAIL = process.env.ALERTS_FROM_EMAIL;
const ALERTS_PUBLIC_BASE_URL = process.env.ALERTS_PUBLIC_BASE_URL || '';

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
  return r.json();
}

async function sendEmail(to, subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${must(RESEND_API_KEY,'RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: must(ALERTS_FROM_EMAIL,'ALERTS_FROM_EMAIL'), to: [to], subject, html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  return r.json();
}

function eventKey(e) {
  return `${e.shipId}|${e.direction}|${e.t}`;
}

async function run() {
  if (!RESEND_API_KEY || !ALERTS_FROM_EMAIL) {
    console.log('[alerts] skip: RESEND_API_KEY or ALERTS_FROM_EMAIL not set');
    return;
  }

  const core = JSON.parse(await fs.readFile(new URL('../public/data/processed_core.json', import.meta.url), 'utf8'));
  const events = (core?.data?.crossingEvents || [])
    .filter((e) => e.vesselType === 'tanker')
    .sort((a, b) => +new Date(a.t) - +new Date(b.t));

  if (!events.length) {
    console.log('[alerts] no tanker crossing events');
    return;
  }

  const subscribers = await supa('marinetraffic_alert_subscribers?status=eq.active&select=id,email,unsubscribe_token');
  if (!subscribers?.length) {
    console.log('[alerts] no active subscribers');
    return;
  }

  let sentEmails = 0;
  let sentRows = 0;

  for (const sub of subscribers) {
    const keys = events.map(eventKey);
    const keyFilter = `(${keys.map((k) => `"${k.replaceAll('"','')}"`).join(',')})`;
    const existing = await supa(`marinetraffic_alert_events_sent?subscriber_id=eq.${sub.id}&event_key=in.${encodeURIComponent(keyFilter)}&select=event_key`);
    const done = new Set((existing || []).map((x) => x.event_key));
    const fresh = events.filter((e) => !done.has(eventKey(e)));
    if (!fresh.length) continue;

    const lines = fresh.slice(-20).map((e) => `<li><strong>${e.shipName}</strong> (${e.shipId}) — ${e.direction.replace('_','→')} — ${new Date(e.t).toUTCString()}</li>`).join('');
    const unsub = `${ALERTS_PUBLIC_BASE_URL}/api/alerts/unsubscribe?token=${sub.unsubscribe_token}`;
    const html = `<p>${fresh.length} new tanker crossing event(s).</p><ul>${lines}</ul><p>Dashboard: <a href="${ALERTS_PUBLIC_BASE_URL}">${ALERTS_PUBLIC_BASE_URL}</a></p><p>Unsubscribe: <a href="${unsub}">${unsub}</a></p>`;

    const resp = await sendEmail(sub.email, `Tanker crossing alert: ${fresh.length} new event(s)`, html);
    sentEmails += 1;

    const rows = fresh.map((e) => ({ subscriber_id: sub.id, event_key: eventKey(e), email_provider_id: resp?.id || null }));
    await supa('marinetraffic_alert_events_sent?on_conflict=subscriber_id,event_key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    });
    sentRows += rows.length;

    await supa(`marinetraffic_alert_subscribers?id=eq.${sub.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ last_sent_at: new Date().toISOString() }),
    });
  }

  console.log(`[alerts] sent_emails=${sentEmails} sent_rows=${sentRows}`);
}

run().catch((e) => {
  console.error('[alerts] error', e?.message || e);
  process.exit(1);
});
