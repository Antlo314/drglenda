-- ============================================================================
--  UMOF Learning Portal — ADD-ONS
--  Run this AFTER schema.sql + seed.sql (Supabase → SQL Editor → New query).
--  Enables: (1) public website lead capture, (2) realtime CRM, (3) video storage.
--  Safe to re-run.
-- ============================================================================

-- ── 1. Public website form → CRM leads ──────────────────────────────────────
-- Lets anonymous website visitors INSERT a lead (and nothing else). They cannot
-- read, edit, or delete — only admins can (existing "leads admin all" policy).
drop policy if exists "leads anon insert" on public.leads;
create policy "leads anon insert" on public.leads
  for insert to anon with check (true);
-- Also allow logged-in visitors (authenticated role) to submit, just in case:
drop policy if exists "leads authed insert" on public.leads;
create policy "leads authed insert" on public.leads
  for insert to authenticated with check (true);

-- ── 2. Realtime CRM ─────────────────────────────────────────────────────────
-- Broadcast row changes on `leads` so the admin CRM updates live (new website
-- signups appear instantly; edits sync across multiple admins).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leads'
  ) then
    alter publication supabase_realtime add table public.leads;
  end if;
end $$;

-- ── 3. Video / notes storage ────────────────────────────────────────────────
-- A PRIVATE bucket for class recordings. Files are served via short-lived signed
-- URLs, so only logged-in users can watch — links can't be shared publicly.
insert into storage.buckets (id, name, public)
values ('session-media', 'session-media', false)
on conflict (id) do nothing;

-- Admins can upload / replace / delete media:
drop policy if exists "session-media admin write" on storage.objects;
create policy "session-media admin write" on storage.objects
  for all
  using (bucket_id = 'session-media' and public.current_user_role() = 'admin')
  with check (bucket_id = 'session-media' and public.current_user_role() = 'admin');

-- Any logged-in user can read (needed to mint signed URLs for playback):
drop policy if exists "session-media read authed" on storage.objects;
create policy "session-media read authed" on storage.objects
  for select
  using (bucket_id = 'session-media' and auth.uid() is not null);
