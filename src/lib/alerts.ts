import crypto from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export type AlertSubscriber = {
  id: string;
  email: string;
  status: "pending" | "active" | "unsubscribed" | "bounced";
  confirm_token: string | null;
  unsubscribe_token: string;
  filters: { vesselTypes?: string[] } | null;
};

function assertEnv() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
}

async function supa(path: string, init: RequestInit = {}) {
  assertEnv();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY!}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase ${res.status}: ${txt}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function upsertPendingSubscriber(email: string) {
  const confirm_token = makeToken();
  const unsubscribe_token = makeToken();
  const row = {
    email,
    status: "pending",
    confirm_token,
    unsubscribe_token,
    filters: { vesselTypes: ["tanker"] },
  };

  const data = await supa(
    `marinetraffic_alert_subscribers?on_conflict=email&select=id,email,status,confirm_token,unsubscribe_token,filters`,
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row),
    },
  );

  return (data?.[0] || null) as AlertSubscriber | null;
}

export async function activateByConfirmToken(token: string) {
  const rows = (await supa(
    `marinetraffic_alert_subscribers?confirm_token=eq.${encodeURIComponent(token)}&select=id,email,status,confirm_token,unsubscribe_token,filters`,
  )) as AlertSubscriber[];
  const sub = rows?.[0];
  if (!sub) return null;

  await supa(`marinetraffic_alert_subscribers?id=eq.${sub.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "active", confirmed_at: new Date().toISOString(), confirm_token: null }),
  });
  return sub;
}

export async function unsubscribeByToken(token: string) {
  const rows = (await supa(
    `marinetraffic_alert_subscribers?unsubscribe_token=eq.${encodeURIComponent(token)}&select=id,email`,
  )) as Array<{ id: string; email: string }>;
  const sub = rows?.[0];
  if (!sub) return null;
  await supa(`marinetraffic_alert_subscribers?id=eq.${sub.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "unsubscribed" }),
  });
  return sub;
}

export async function sendEmail(to: string, subject: string, html: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.ALERTS_FROM_EMAIL;
  if (!key || !from) throw new Error("Missing RESEND_API_KEY or ALERTS_FROM_EMAIL");

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  return r.json();
}

export function publicBaseUrl() {
  return process.env.ALERTS_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "";
}
