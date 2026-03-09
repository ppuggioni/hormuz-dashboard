-- MarineTraffic tanker crossing alerts schema
-- Run in Supabase SQL editor.

create table if not exists public.marinetraffic_alert_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  status text not null default 'pending' check (status in ('pending','active','unsubscribed','bounced')),
  confirm_token text,
  unsubscribe_token text not null,
  filters jsonb not null default '{"vesselTypes":["tanker"]}'::jsonb,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  last_sent_at timestamptz
);

create index if not exists marinetraffic_alert_subscribers_status_idx
  on public.marinetraffic_alert_subscribers(status);

create table if not exists public.marinetraffic_alert_events_sent (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.marinetraffic_alert_subscribers(id) on delete cascade,
  event_key text not null,
  sent_at timestamptz not null default now(),
  email_provider_id text,
  unique (subscriber_id, event_key)
);

create index if not exists marinetraffic_alert_events_sent_event_key_idx
  on public.marinetraffic_alert_events_sent(event_key);
