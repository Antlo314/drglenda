-- ============================================================================
--  UMOF Learning Portal — CLASS MATERIALS (resell-ready content library)
--  Run AFTER schema.sql + addons.sql (Supabase → SQL Editor → New query → Run).
--  Adds a per-session library of files/links students view & download in the
--  portal. Files live in the existing private 'session-media' bucket (created
--  by addons.sql) and are served via short-lived signed URLs. Safe to re-run.
-- ============================================================================

create table if not exists public.class_materials (
  id         uuid primary key default gen_random_uuid(),
  session_id text not null references public.sessions(id) on delete cascade,
  kind       text not null check (kind in ('pdf','image','video','link')),
  title      text not null,
  -- Either a normal URL (a 'link'), or a 'storage:'-prefixed object path in the
  -- session-media bucket (an uploaded private file, e.g. 'storage:s1/materials/...').
  url        text not null default '',
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);
alter table public.class_materials enable row level security;

-- Any logged-in user can read the library; only admins can add/edit/delete.
drop policy if exists "materials read"        on public.class_materials;
drop policy if exists "materials admin write" on public.class_materials;
create policy "materials read" on public.class_materials for select
  using (auth.uid() is not null);
create policy "materials admin write" on public.class_materials for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create index if not exists idx_materials_session on public.class_materials(session_id);

-- NOTE: file storage reuses the 'session-media' bucket + its policies from
-- addons.sql (admin-write, authenticated-read). No extra bucket needed.
-- Uploaded material files are stored under the 's{id}/materials/' prefix.
