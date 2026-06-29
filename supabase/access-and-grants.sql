-- ============================================================================
--  UMOF Learning Portal — Access control + grant tracking
--  Run once (Supabase → SQL Editor → New query → paste → Run). Safe to re-run.
--
--  This REPLACES the signup trigger from auth-bootstrap.sql with fuller rules:
--    • First account ever, or any email in admin_emails  -> ADMIN
--    • Email in allowed_students                          -> STUDENT
--    • Anyone else                                        -> signup is blocked
--  Plus: adds grant ($300 fee) tracking columns to leads and students.
-- ============================================================================

-- ── Admin allowlist (emails that become admins on signup) ───────────────────
create table if not exists public.admin_emails (
  email text primary key
);
alter table public.admin_emails enable row level security;
drop policy if exists "admin_emails manage" on public.admin_emails;
create policy "admin_emails manage" on public.admin_emails for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

insert into public.admin_emails (email) values ('info@umof.org')
on conflict (email) do nothing;

-- ── Approved-student allowlist (emails from the enrollment / Jotform) ────────
create table if not exists public.allowed_students (
  email      text primary key,
  added_at   timestamptz default now(),
  note       text
);
alter table public.allowed_students enable row level security;
drop policy if exists "allowed_students manage" on public.allowed_students;
create policy "allowed_students manage" on public.allowed_students for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ── Grant tracking columns ($300 initial fee) ───────────────────────────────
alter table public.leads    add column if not exists grant_awarded boolean default false;
alter table public.leads    add column if not exists grant_amount  numeric(10,2) default 0;
alter table public.profiles add column if not exists grant_awarded boolean default false;
alter table public.profiles add column if not exists grant_amount  numeric(10,2) default 0;

-- ── Signup gate: who is allowed in, and as what role ────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_count int;
begin
  select count(*) into admin_count from public.profiles where role = 'admin';

  if admin_count = 0
     or exists (select 1 from public.admin_emails where lower(email) = lower(new.email)) then
    insert into public.profiles (id, name, email, role)
    values (new.id, coalesce(new.raw_user_meta_data->>'name',''), new.email, 'admin')
    on conflict (id) do nothing;

  elsif exists (select 1 from public.allowed_students where lower(email) = lower(new.email)) then
    insert into public.profiles (id, name, email, role)
    values (new.id, coalesce(new.raw_user_meta_data->>'name',''), new.email, 'student')
    on conflict (id) do nothing;

  else
    -- Not pre-approved: block the signup (the portal shows a friendly message).
    raise exception 'UMOF_NOT_APPROVED' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- ── How to approve students (until the Jotform automation is built) ─────────
--   insert into public.allowed_students (email, note) values
--     ('student1@example.com', 'Summer 2026 cohort'),
--     ('student2@example.com', 'Summer 2026 cohort');
--   -- remove access:  delete from public.allowed_students where email = '...';
