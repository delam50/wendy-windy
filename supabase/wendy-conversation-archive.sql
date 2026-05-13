-- Wendy short-term QA conversation archive.
-- Run in Supabase SQL editor. This archive is for response QA and conversion
-- review only; it is not a medical record system.

create extension if not exists pgcrypto;

create table if not exists public.wendy_conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  session_id text,
  page_title text,
  page_url text,
  inferred_topic text,
  detected_intent text,
  preferred_location text,
  suggested_provider text,
  lead_submitted boolean not null default false,
  resource_count integer not null default 0,
  booking_clicked boolean not null default false,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.wendy_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  conversation_id uuid references public.wendy_conversations(id) on delete cascade,
  session_id text,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text,
  redacted boolean not null default false,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists wendy_conversations_session_id_idx
  on public.wendy_conversations (session_id);

create index if not exists wendy_conversations_updated_at_idx
  on public.wendy_conversations (updated_at desc);

create index if not exists wendy_conversations_topic_idx
  on public.wendy_conversations (inferred_topic);

create index if not exists wendy_messages_conversation_id_idx
  on public.wendy_messages (conversation_id);

create index if not exists wendy_messages_created_at_idx
  on public.wendy_messages (created_at desc);

create or replace function public.set_wendy_conversation_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_wendy_conversation_updated_at
  on public.wendy_conversations;

create trigger set_wendy_conversation_updated_at
before update on public.wendy_conversations
for each row
execute function public.set_wendy_conversation_updated_at();

-- Manual 30-day retention cleanup:
-- delete from public.wendy_conversations
-- where created_at < now() - interval '30 days';
