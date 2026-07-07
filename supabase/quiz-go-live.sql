-- ============================================================================
--  UMOF Learning Portal — Written tests + admin "Go live" control
--  Run once (Supabase → SQL Editor → New query → paste → Run). Safe to re-run.
--
--  Result: ONE test per week, using the EXACT free-response questions from the
--  curriculum. Adds:
--    • quizzes.published  — a test stays hidden from students until an admin
--      clicks "Go live" on the Sessions panel.
--    • Two Week 1 deliverables, both LIVE at launch, instructor-graded:
--        – "Why Section" (5 reflection questions) — due Fri 2026-07-10
--        – "Week 1 Test" (curriculum questions + portfolio prompts: SMART goal,
--          revenue goal, financial/operational/marketing goals, business +
--          personal vision statements) — due Mon 2026-07-13
--    • Removes the old multiple-choice sample quizzes (q1–q4).
-- ============================================================================

-- 1) Add the go-live flag + optional due date. New tests default to OFFLINE, so
--    nothing shows to students until an admin sets it live from the portal.
alter table public.quizzes
  add column if not exists published boolean not null default false;
alter table public.quizzes
  add column if not exists due_date date;

-- 2) Remove the sample multiple-choice quizzes (demo content, not real coursework).
--    Cascades to any submissions for those quizzes (none expected before launch).
delete from public.quizzes where id in ('q1','q2','q3','q4');

-- 3) Seed both Week 1 deliverables and set them LIVE (published = true) so
--    students can start answering. Both linked to session s1.
insert into public.quizzes (id, session_id, type, title, max_score, prompt, questions, published, due_date)
values
(
  'qwhy1', 's1', 'manual', 'Week 1 — Why Section',
  100, null,
  '[{"id":"qwhy1-1","prompt":"Why do I want a business?"},
    {"id":"qwhy1-2","prompt":"Why? (Dig deeper — what is the deeper reason behind that?)"},
    {"id":"qwhy1-3","prompt":"Why would you want to leave a legacy?"},
    {"id":"qwhy1-4","prompt":"Why do I want financial stability?"},
    {"id":"qwhy1-5","prompt":"Why is creating generational wealth and opportunity important?"}]'::jsonb,
  true, '2026-07-10'
),
(
  'qw1', 's1', 'manual',
  'Week 1 Test — Entrepreneurial Mindset & Business Foundation',
  100, null,
  '[{"id":"qw1-1","prompt":"What is a growth mindset?"},
    {"id":"qw1-2","prompt":"Why is goal setting important in business?"},
    {"id":"qw1-3","prompt":"What is the purpose of a business vision statement?"},
    {"id":"qw1-4","prompt":"Name two characteristics of successful entrepreneurs."},
    {"id":"qw1-5","prompt":"What is entrepreneurial readiness?"},
    {"id":"qw1-6","prompt":"Set a SMART goal for your business — make it Specific, Measurable, Achievable, Relevant, and Time-bound."},
    {"id":"qw1-7","prompt":"Complete and expand on this goal: “I will increase my monthly revenue by ______.” (Tip: a revenue target paired with a customer-retention strategy is a cheat code that shows lenders you can sustain growth.)"},
    {"id":"qw1-8","prompt":"What are your financial goals?"},
    {"id":"qw1-9","prompt":"What are your operational goals?"},
    {"id":"qw1-10","prompt":"What are your marketing goals?"},
    {"id":"qw1-11","prompt":"Write a vision statement for your business."},
    {"id":"qw1-12","prompt":"Write a personal vision statement for yourself."}]'::jsonb,
  true, '2026-07-13'
)
on conflict (id) do update set
  session_id = excluded.session_id,
  type       = excluded.type,
  title      = excluded.title,
  max_score  = excluded.max_score,
  prompt     = excluded.prompt,
  questions  = excluded.questions,
  due_date   = excluded.due_date,
  published  = true;   -- activate Week 1 now (per request)

-- 4) Confirm.
select id, title, published, due_date, jsonb_array_length(questions) as num_questions
from public.quizzes order by due_date, id;
