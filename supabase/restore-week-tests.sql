-- ============================================================================
--  Restore Week 1 (12 questions) + Week 2 (6 questions) on live quizzes.
--  Safe to re-run. Does NOT touch student submissions (answers stay intact).
--  Supabase → SQL Editor → paste → Run.
-- ============================================================================

-- Week 1 Test — full 12 free-response portfolio questions
insert into public.quizzes (id, session_id, type, title, max_score, prompt, questions, published, due_date)
values (
  'qw1', 's1', 'manual',
  'Week 1 Test — Entrepreneurial Mindset & Business Foundation',
  100, null,
  '[
    {"id":"qw1-1","prompt":"What is a growth mindset?"},
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
    {"id":"qw1-12","prompt":"Write a personal vision statement for yourself."}
  ]'::jsonb,
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
  published  = true;

-- Week 2 Test — original 6 free-response questions
insert into public.quizzes (id, session_id, type, title, max_score, prompt, questions, published, due_date)
values (
  'qw2', null, 'manual',
  'Week 2 Test — Business Structure & Legal Foundation',
  100, null,
  '[
    {"id":"qw2-1","prompt":"What is the main liability difference between a sole proprietorship and an LLC?"},
    {"id":"qw2-2","prompt":"Why do funders care whether personal and business finances are separated?"},
    {"id":"qw2-3","prompt":"What is an EIN and when do you need one?"},
    {"id":"qw2-4","prompt":"Name two documents that typically prove your business is legally established."},
    {"id":"qw2-5","prompt":"What is one compliance or licensing step your business may need in your state or industry?"},
    {"id":"qw2-6","prompt":"List the three next legal/administrative steps you will complete for your entity this week."}
  ]'::jsonb,
  true, '2026-07-20'
)
on conflict (id) do update set
  session_id = excluded.session_id,
  type       = excluded.type,
  title      = excluded.title,
  max_score  = excluded.max_score,
  prompt     = excluded.prompt,
  questions  = excluded.questions,
  due_date   = excluded.due_date,
  published  = true;

-- Confirm question counts
select id, title, published, due_date, jsonb_array_length(questions) as num_questions
from public.quizzes
where id in ('qw1', 'qw2', 'qwhy1')
order by id;
