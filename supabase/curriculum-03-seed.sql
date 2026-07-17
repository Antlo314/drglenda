-- STEP 3 of 3: seed syllabus (Week 1 + Week 2 live)
-- Supabase SQL Editor -> New query -> paste this entire file -> Run
-- Run AFTER step 1 (and preferably step 2)

insert into public.curriculum (
  id, title, tagline, length, format, learning_style, description, weeks, updated_at
) values (
  'main',
  'The Entrepreneur''s Journey: Funding Masterclass',
  'Building a Fundable Business from Startup to Success',
  '12 Weeks',
  'Online Instructor-Led',
  'Reading, Video Lessons, Interactive Discussions, Worksheets, Case Studies, Practical Exercises, Quizzes, and Funding Readiness Assessments',
  'The Entrepreneur''s Journey: Funding Masterclass is designed to guide aspiring and existing entrepreneurs through the process of building a business that qualifies for funding.',
  jsonb_build_array(
    jsonb_build_object(
      'week', 1,
      'title', 'Entrepreneurial Mindset & Business Foundation',
      'objectives', jsonb_build_array(
        'Understand the entrepreneurial journey.',
        'Identify characteristics of successful entrepreneurs.',
        'Develop a growth mindset.',
        'Clarify business vision and goals.'
      ),
      'steps', jsonb_build_array(
        'Define your Why.',
        'Identify your target market.',
        'Establish short-term and long-term goals.',
        'Create a business vision statement.',
        'Complete a self-assessment of entrepreneurial readiness.'
      ),
      'assignment', 'Create a one-page Business Vision Plan.',
      'discussion', 'What motivated you to become an entrepreneur, and what challenges do you anticipate facing?',
      'quiz', jsonb_build_array(
        'What is a growth mindset?',
        'Why is goal setting important in business?',
        'What is the purpose of a business vision statement?',
        'Name two characteristics of successful entrepreneurs.',
        'What is entrepreneurial readiness?',
        'Set a SMART goal for your business.',
        'What are your financial goals?',
        'What are your operational goals?',
        'What are your marketing goals?',
        'Write a vision statement for your business.',
        'Write a personal vision statement for yourself.'
      )
    ),
    jsonb_build_object(
      'week', 2,
      'pending', false,
      'title', 'Business Structure & Legal Foundation',
      'objectives', jsonb_build_array(
        'Choose a legal structure that fits your goals and risk profile.',
        'Understand EIN, state registration, and basic compliance steps.',
        'Separate personal and business identity for funding readiness.',
        'Identify documents lenders and funders expect from a new entity.'
      ),
      'steps', jsonb_build_array(
        'Review sole prop vs LLC vs corporation trade-offs.',
        'Confirm or file your entity registration in your state.',
        'Obtain or verify your EIN with the IRS.',
        'Open a dedicated business bank account.',
        'Create a simple compliance checklist (licenses, permits, renewals).'
      ),
      'assignment', 'Complete a one-page Business Structure Plan: chosen entity type, why it fits, EIN status, bank account status, and next three legal steps.',
      'discussion', 'Which business structure did you choose (or are considering), and what risk or tax factor influenced that decision most?',
      'quiz', jsonb_build_array(
        'What is the main liability difference between a sole proprietorship and an LLC?',
        'Why do funders care whether personal and business finances are separated?',
        'What is an EIN and when do you need one?',
        'Name two documents that typically prove your business is legally established.',
        'What is one compliance or licensing step your business may need in your state or industry?',
        'List the three next legal or administrative steps you will complete for your entity this week.'
      )
    ),
    jsonb_build_object('week', 3, 'pending', true, 'title', 'Business Credit & Financial Identity'),
    jsonb_build_object('week', 4, 'pending', true, 'title', 'Bookkeeping, Financials & Cash Flow'),
    jsonb_build_object('week', 5, 'pending', true, 'title', 'Building a Fundable Business Plan'),
    jsonb_build_object('week', 6, 'pending', true, 'title', 'Grants, Loans & Investor Capital'),
    jsonb_build_object('week', 7, 'pending', true, 'title', 'The Funding Pitch & Lender Relationships'),
    jsonb_build_object('week', 8, 'pending', true, 'title', 'Government Contracting & Procurement'),
    jsonb_build_object('week', 9, 'pending', true, 'title', 'Marketing, Branding & Digital Presence'),
    jsonb_build_object('week', 10, 'pending', true, 'title', 'Operations, Scaling & Team Building'),
    jsonb_build_object('week', 11, 'pending', true, 'title', 'Financial Management & Tax Strategy'),
    jsonb_build_object('week', 12, 'pending', true, 'title', 'Funding Readiness Assessment & Next Steps')
  ),
  now()
)
on conflict (id) do update set
  weeks = excluded.weeks,
  updated_at = now();

select
  (elem->>'week')::int as week,
  elem->>'title' as title,
  elem->>'pending' as pending
from public.curriculum c,
     jsonb_array_elements(c.weeks) as elem
where c.id = 'main'
order by 1;
