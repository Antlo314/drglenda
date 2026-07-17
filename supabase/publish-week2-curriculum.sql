-- ============================================================================
--  Publish Week 2 syllabus content for students (safe to re-run).
--  Requires public.curriculum (run curriculum.sql first if the table is missing).
-- ============================================================================

-- If the curriculum table does not exist yet, create it via curriculum.sql first.
-- This updates the main syllabus JSON so Week 2 is no longer "coming soon".

update public.curriculum
set
  weeks = (
    select jsonb_agg(
      case
        when (elem->>'week')::int = 2 then
          jsonb_build_object(
            'week', 2,
            'pending', false,
            'title', 'Business Structure & Legal Foundation',
            'objectives', '["Choose a legal structure that fits your goals and risk profile.","Understand EIN, state registration, and basic compliance steps.","Separate personal and business identity for funding readiness.","Identify documents lenders and funders expect from a new entity."]'::jsonb,
            'steps', '["Review sole prop vs LLC vs corporation trade-offs.","Confirm or file your entity registration in your state.","Obtain or verify your EIN with the IRS.","Open a dedicated business bank account.","Create a simple compliance checklist (licenses, permits, renewals)."]'::jsonb,
            'assignment', 'Complete a one-page Business Structure Plan: chosen entity type, why it fits, EIN status, bank account status, and next three legal steps.',
            'discussion', 'Which business structure did you choose (or are considering), and what risk or tax factor influenced that decision most?',
            'quiz', '["What is the main liability difference between a sole proprietorship and an LLC?","Why do funders care whether personal and business finances are separated?","What is an EIN and when do you need one?","Name two documents that typically prove your business is legally established.","What is one compliance or licensing step your business may need in your state or industry?","List the three next legal/administrative steps you will complete for your entity this week."]'::jsonb
          )
        else elem
      end
      order by (elem->>'week')::int
    )
    from jsonb_array_elements(weeks) as elem
  ),
  updated_at = now()
where id = 'main';

select
  (w->>'week')::int as week,
  w->>'title' as title,
  (w->>'pending')::boolean as pending
from public.curriculum c,
     jsonb_array_elements(c.weeks) w
where c.id = 'main'
order by 1;
