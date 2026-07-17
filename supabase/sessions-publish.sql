-- ============================================================================
--  UMOF Learning Portal — Per-session publish flag
--  Run ONLY this file (Supabase → SQL Editor → New query → paste ALL → Run).
--  Safe to re-run. Do NOT paste seed.sql into the same query.
--
--  Result:
--    • sessions.published  — students only see sessions an admin has published
--    • Existing sessions stay VISIBLE (published = true)
--    • New sessions default to OFFLINE until Publish in the portal
-- ============================================================================

-- 1) Add column if missing (nullable first so existing rows are safe)
alter table public.sessions
  add column if not exists published boolean;

-- 2) Existing rows → published so students are not locked out
update public.sessions
set published = true
where published is null;

-- 3) New rows default offline until an admin publishes
alter table public.sessions
  alter column published set default false;

-- 4) Require a value going forward
alter table public.sessions
  alter column published set not null;

-- 5) Confirm
select id, week, title, published
from public.sessions
order by week, id;
