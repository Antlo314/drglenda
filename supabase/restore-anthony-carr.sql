-- ============================================================================
--  UMOF Learning Portal — Restore Anthony Carr (iamwhoiambook@gmail.com)
--  Run in Supabase → SQL Editor → New query → paste → Run.
--
--  Why this is needed
--  ------------------
--  This email was the bootstrap first-account ADMIN (name may still be
--  "Dr. Glenda S. Williams"). While role = 'admin':
--    • Login lands on the instructor dashboard (no student "My Tests" UI)
--    • Admin Students / CRM / Graded lists only include role = 'student'
--      so his scores disappear from those views even if submissions still exist
--
--  If handover-admin-to-info.sql was ever run, auth.users + profile +
--  submissions for this email were DELETED (cascade). This script will
--  re-profile the account only if it exists again; it cannot invent scores
--  that were hard-deleted. Section A diagnoses that.
--
--  Safe to re-run.
-- ============================================================================

-- ── A) DIAGNOSE (read-only) ─────────────────────────────────────────────────
-- 1) Does the auth login still exist?
select id, email, created_at, last_sign_in_at, email_confirmed_at
from auth.users
where lower(email) = 'iamwhoiambook@gmail.com';

-- 2) Current profile row (if any)
select id, name, email, role, title, cohort, plan, enrolled, phone
from public.profiles
where lower(email) = 'iamwhoiambook@gmail.com';

-- 3) Any remaining submissions / grades for this user
--    (Uses only base columns — grade_derivation / question_scores / etc. may not
--    exist until grade-derivation.sql has been run on this project.)
select s.id, s.quiz_id, s.type, s.status, s.score, s.total,
       s.feedback, s.submitted_at, s.graded_at, s.answers
from public.submissions s
join public.profiles p on p.id = s.profile_id
where lower(p.email) = 'iamwhoiambook@gmail.com'
order by s.submitted_at nulls last, s.quiz_id;

-- 4) Session completions
select c.session_id, c.completed_at
from public.session_completions c
join public.profiles p on p.id = c.profile_id
where lower(p.email) = 'iamwhoiambook@gmail.com'
order by c.completed_at;

-- ── B) RESTORE PROFILE AS STUDENT "Anthony Carr" ────────────────────────────
-- Only runs if the user still exists in auth.users / profiles.
-- Does NOT delete anything. Does NOT overwrite scores.

-- Ensure he is on the approved-student allowlist (so signup works if needed)
insert into public.allowed_students (email, note)
values ('iamwhoiambook@gmail.com', 'Anthony Carr — Summer 2026 cohort (restored)')
on conflict (email) do update
  set note = excluded.note;

-- Never auto-promote this email to admin on (re)signup
delete from public.admin_emails
where lower(email) = 'iamwhoiambook@gmail.com';

-- Demote + restore student identity fields
update public.profiles
set
  role     = 'student',
  name     = 'Anthony Carr',
  title    = '',                          -- instructor title was from admin bootstrap
  cohort   = coalesce(nullif(trim(cohort), ''), 'Summer 2026'),
  plan     = coalesce(nullif(trim(plan), ''), 'Full Program'),
  enrolled = coalesce(enrolled, current_date)
where lower(email) = 'iamwhoiambook@gmail.com';

-- If the profile row is missing but auth.users still has the login
-- (e.g. orphan after a partial delete), recreate the profile as student.
insert into public.profiles (id, name, email, role, cohort, plan, enrolled)
select u.id, 'Anthony Carr', u.email, 'student',
       'Summer 2026', 'Full Program', current_date
from auth.users u
where lower(u.email) = 'iamwhoiambook@gmail.com'
  and not exists (
    select 1 from public.profiles p where p.id = u.id
  );

-- ── C) CONFIRM ──────────────────────────────────────────────────────────────
select p.email, p.name, p.role, p.cohort, p.plan, p.enrolled,
       (select count(*) from public.submissions s where s.profile_id = p.id) as submission_count,
       (select count(*) from public.submissions s
         where s.profile_id = p.id and s.status = 'graded') as graded_count
from public.profiles p
where lower(p.email) = 'iamwhoiambook@gmail.com';

-- List scores again after restore (same data as section A.3 — should still be there
-- if handover was never run / account was never re-created from scratch)
select s.quiz_id, q.title, s.status, s.score, s.graded_at, s.submitted_at
from public.submissions s
join public.profiles p on p.id = s.profile_id
left join public.quizzes q on q.id = s.quiz_id
where lower(p.email) = 'iamwhoiambook@gmail.com'
order by s.submitted_at nulls last;
