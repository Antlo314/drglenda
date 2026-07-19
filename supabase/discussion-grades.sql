-- ============================================================================
--  Discussion participation grades (admin Grading · one score per student / week)
--  Creates hidden quiz slots qdisc-w1 / qdisc-w2 used by submissions.
--  Safe to re-run. Does not touch student discussion_posts.
-- ============================================================================

insert into public.quizzes (id, session_id, type, title, max_score, prompt, questions, published, due_date)
values
(
  'qdisc-w1', null, 'manual', 'Week 1 Discussion',
  100, null,
  '[{"id":"qdisc-w1-1","prompt":"Discussion participation / post quality for Week 1"}]'::jsonb,
  false, null
),
(
  'qdisc-w2', null, 'manual', 'Week 2 Discussion',
  100, null,
  '[{"id":"qdisc-w2-1","prompt":"Discussion participation / post quality for Week 2"}]'::jsonb,
  false, null
)
on conflict (id) do update set
  title = excluded.title,
  max_score = excluded.max_score,
  questions = excluded.questions,
  published = false;

select id, title, published, jsonb_array_length(questions) as n
from public.quizzes
where id like 'qdisc-w%'
order by id;
