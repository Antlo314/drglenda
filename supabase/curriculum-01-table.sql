-- STEP 1 of 3: create curriculum table only
-- Supabase SQL Editor -> New query -> paste this entire file -> Run

create table if not exists public.curriculum (
  id text primary key default 'main',
  title text not null default '',
  tagline text not null default '',
  length text not null default '',
  format text not null default '',
  learning_style text not null default '',
  description text not null default '',
  weeks jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.curriculum enable row level security;
