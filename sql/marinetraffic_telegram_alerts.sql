-- MarineTraffic Telegram alerts schema
-- Run in Supabase SQL editor.

create table if not exists public.marinetraffic_telegram_subscribers (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null unique,
  username text,
  first_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  last_sent_at timestamptz
);

create index if not exists marinetraffic_telegram_subscribers_active_idx
  on public.marinetraffic_telegram_subscribers(is_active);

create table if not exists public.marinetraffic_telegram_events_sent (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.marinetraffic_telegram_subscribers(id) on delete cascade,
  event_key text not null,
  sent_at timestamptz not null default now(),
  unique (subscriber_id, event_key)
);

create index if not exists marinetraffic_telegram_events_sent_event_key_idx
  on public.marinetraffic_telegram_events_sent(event_key);
