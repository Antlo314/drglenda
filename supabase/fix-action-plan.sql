-- ============================================================================
--  Curriculum Action plan ≠ My Tests questions
--  ----------------------------------------------------------------------------
--  Week 1: remove the 12 graded test prompts from syllabus "quiz" (Action plan)
--  Week 2: restore a real action checklist (not MC test lines)
--  Weeks 3–12: ensure quiz array exists for Action plan section
--  Safe to re-run. Does NOT change quizzes / submissions tables.
-- ============================================================================

update public.curriculum c
set
  weeks = (
    select jsonb_agg(fixed.week_obj order by (fixed.week_obj->>'week')::int)
    from (
      select
        case
          when (elem->>'week')::int = 1 then
            elem || jsonb_build_object(
              'quiz', jsonb_build_array(
                'Write your full “Why” reflection (use the Week 1 Why section under My Tests).',
                'Identify your target market in one clear paragraph.',
                'List short-term (90-day) and long-term (1–3 year) business goals.',
                'Draft a business vision statement and a personal vision statement.',
                'Complete a self-assessment of entrepreneurial readiness.',
                'Submit your one-page Business Vision Plan.'
              )
            )
          when (elem->>'week')::int = 2 then
            elem || jsonb_build_object(
              'quiz', jsonb_build_array(
                'Decide your entity type (sole prop, LLC, corporation, etc.) and write why it fits.',
                'Confirm or file your state business registration.',
                'Obtain or verify your EIN with the IRS.',
                'Open (or schedule) a dedicated business bank account.',
                'List licenses, permits, and renewal dates for your industry/location.',
                'Complete the one-page Business Structure Plan assignment.'
              )
            )
          when elem ? 'quiz' then elem
          else elem || jsonb_build_object('quiz', '[]'::jsonb)
        end as week_obj
      from jsonb_array_elements(c.weeks) as elem
    ) fixed
  ),
  updated_at = now()
where c.id = 'main';

select
  (elem->>'week')::int as week,
  elem->>'title' as title,
  jsonb_array_length(coalesce(elem->'quiz', '[]'::jsonb)) as action_plan_items,
  left(coalesce(elem->'quiz'->>0, ''), 60) as first_item
from public.curriculum c,
     jsonb_array_elements(c.weeks) as elem
where c.id = 'main'
order by 1;
