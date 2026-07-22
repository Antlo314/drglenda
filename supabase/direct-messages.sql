-- ============================================================================
--  UMOF Learning Portal — Direct messages (classmate 1:1 chat)
--  Run AFTER schema.sql + profiles-public-hub.sql.
--  Safe to re-run (idempotent).
--
--  Security:
--    • Authenticated users can READ only messages they sent or received.
--    • Authenticated users can INSERT only as themselves (sender_id = auth.uid()).
--    • Recipients can mark messages read (update read_at on rows they received).
--    • Admins can delete any message (moderation).
-- ============================================================================

create table if not exists public.direct_messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 4000),
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  constraint direct_messages_not_self check (sender_id <> recipient_id)
);

alter table public.direct_messages enable row level security;

create index if not exists idx_dm_pair_created
  on public.direct_messages (sender_id, recipient_id, created_at);
create index if not exists idx_dm_recipient_unread
  on public.direct_messages (recipient_id, created_at)
  where read_at is null;

-- Sender is always the signed-in user (prevents spoofing).
create or replace function public.dm_set_sender()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.sender_id := auth.uid();
  return new;
end; $$;

drop trigger if exists on_dm_insert on public.direct_messages;
create trigger on_dm_insert
  before insert on public.direct_messages
  for each row execute function public.dm_set_sender();

drop policy if exists "dm read own" on public.direct_messages;
drop policy if exists "dm insert own" on public.direct_messages;
drop policy if exists "dm update read own" on public.direct_messages;
drop policy if exists "dm delete own or admin" on public.direct_messages;

create policy "dm read own" on public.direct_messages for select
  using (auth.uid() is not null and (sender_id = auth.uid() or recipient_id = auth.uid()));

create policy "dm insert own" on public.direct_messages for insert
  with check (auth.uid() is not null and sender_id = auth.uid());

-- Recipient (or admin) may set read_at only — app only updates that column.
create policy "dm update read own" on public.direct_messages for update
  using (
    auth.uid() is not null
    and (recipient_id = auth.uid() or public.current_user_role() = 'admin')
  )
  with check (
    auth.uid() is not null
    and (recipient_id = auth.uid() or public.current_user_role() = 'admin')
  );

create policy "dm delete own or admin" on public.direct_messages for delete
  using (
    auth.uid() is not null
    and (sender_id = auth.uid() or public.current_user_role() = 'admin')
  );

-- Live updates for open conversations.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'direct_messages'
  ) then
    alter publication supabase_realtime add table public.direct_messages;
  end if;
end $$;
