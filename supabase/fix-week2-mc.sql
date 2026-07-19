-- ============================================================================
--  Fix Week 2 test: A/B/C/D lines were stored as separate free-response questions.
--  Replaces qw2 with 3 real multiple-choice items. Safe to re-run.
-- ============================================================================

insert into public.quizzes (id, session_id, type, title, max_score, prompt, questions, published, due_date)
values (
  'qw2', null, 'auto',
  'Week 2 Test — Business Structure & Legal Foundation',
  100, null,
  '[
    {
      "id": "qw2-1",
      "prompt": "Which business structure provides the least liability protection?",
      "options": ["LLC", "Corporation", "Sole Proprietorship", "Nonprofit"],
      "correctIndex": 2
    },
    {
      "id": "qw2-2",
      "prompt": "What does LLC stand for?",
      "options": ["Limited Liability Company", "Legal Liability Corporation", "Limited Loan Company", "Licensed Liability Company"],
      "correctIndex": 0
    },
    {
      "id": "qw2-3",
      "prompt": "Which structure is often preferred by investors?",
      "options": ["Sole Proprietorship", "Corporation", "Partnership", "DBA"],
      "correctIndex": 1
    }
  ]'::jsonb,
  true, '2026-07-20'
)
on conflict (id) do update set
  type = excluded.type,
  title = excluded.title,
  max_score = excluded.max_score,
  questions = excluded.questions,
  published = true,
  due_date = excluded.due_date;

select id, title, type, jsonb_array_length(questions) as n,
  questions->0->>'prompt' as q1,
  jsonb_array_length(questions->0->'options') as q1_opts
from public.quizzes where id = 'qw2';
