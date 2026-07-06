-- ============================================================================
--  UMOF Learning Portal — Written tests + admin "Go live" control
--  Run once (Supabase → SQL Editor → New query → paste → Run). Safe to re-run.
--
--  Result: ONE test per week, using the EXACT free-response questions from the
--  curriculum. Adds:
--    • quizzes.published  — a test stays hidden from students until an admin
--      clicks "Go live" on the Sessions panel.
--    • The Week 1 written test (Entrepreneurial Mindset & Business Foundation),
--      instructor-graded. Ships OFFLINE; open it from Admin → Class Sessions.
--    • Removes the old multiple-choice sample quizzes (q1–q4).
-- ============================================================================

-- 1) Add the go-live flag. Existing tests default to OFFLINE (published = false),
--    so nothing shows to students until you set it live from the portal.
alter table public.quizzes
  add column if not exists published boolean not null default false;

-- 2) Remove the sample multiple-choice quizzes (demo content, not real coursework).
--    Cascades to any submissions for those quizzes (none expected before launch).
delete from public.quizzes where id in ('q1','q2','q3','q4');

-- 3) Seed the Week 1 written test (5 free-response questions from the curriculum).
--    Linked to session s1 so it appears on that session's card in the admin panel.
insert into public.quizzes (id, session_id, type, title, max_score, prompt, questions, published)
values (
  'qw1', 's1', 'manual',
  'Week 1 Test — Entrepreneurial Mindset & Business Foundation',
  100, null,
  '[{"id":"qw1-1","prompt":"What is a growth mindset?"},
    {"id":"qw1-2","prompt":"Why is goal setting important in business?"},
    {"id":"qw1-3","prompt":"What is the purpose of a business vision statement?"},
    {"id":"qw1-4","prompt":"Name two characteristics of successful entrepreneurs."},
    {"id":"qw1-5","prompt":"What is entrepreneurial readiness?"}]'::jsonb,
  false
)
on conflict (id) do update set
  session_id = excluded.session_id,
  type       = excluded.type,
  title      = excluded.title,
  max_score  = excluded.max_score,
  prompt     = excluded.prompt,
  questions  = excluded.questions;
  -- `published` left as-is so re-running never hides a test you've set live.

-- 4) (Optional) Open the Week 1 test immediately instead of clicking Go live:
-- update public.quizzes set published = true where id = 'qw1';

-- 5) Confirm.
select id, title, type, published from public.quizzes order by published desc, id;
