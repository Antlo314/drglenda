-- ============================================================================
--  UMOF Learning Portal — Fix: student work not showing / grades not sticking
--  Run once in Supabase → SQL Editor → New query → paste → Run.
--  Safe to re-run.
--
--  What this does
--  --------------
--  1) Lets admins INSERT submissions (needed if a grade is saved when no row
--     existed yet — e.g. re-grade edge cases).
--  2) Publishes `submissions` + `profiles` to Realtime so the admin portal
--     refreshes the grading queue when a student turns in work (no hard reload).
--  3) Optional diagnostic queries at the bottom (commented) to verify data.
-- ============================================================================

-- ── 1) Admin may insert submission rows (update policy already exists) ──────
drop policy if exists "submissions admin insert" on public.submissions;
create policy "submissions admin insert" on public.submissions
  for insert
  with check (public.current_user_role() = 'admin');

-- ── 2) Realtime: submissions + profiles (leads already in addons.sql) ───────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'submissions'
  ) then
    alter publication supabase_realtime add table public.submissions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;

-- ── 3) Ensure grade documentation columns exist (older projects) ────────────
alter table public.submissions add column if not exists grade_derivation text;
alter table public.submissions add column if not exists question_scores jsonb;
alter table public.submissions add column if not exists scoring_method text;
alter table public.submissions add column if not exists graded_by text;

-- ── 4) DIAGNOSE (uncomment to inspect live data) ────────────────────────────
-- Who has submitted work still awaiting a grade?
-- select p.name, p.email, p.role, s.quiz_id, s.status, s.type, s.submitted_at
-- from public.submissions s
-- join public.profiles p on p.id = s.profile_id
-- where s.status = 'submitted'
-- order by s.submitted_at nulls last;

-- All submissions in the last 30 days:
-- select p.name, p.email, s.quiz_id, s.status, s.score, s.submitted_at, s.graded_at
-- from public.submissions s
-- join public.profiles p on p.id = s.profile_id
-- where s.submitted_at > now() - interval '30 days'
-- order by s.submitted_at desc;
