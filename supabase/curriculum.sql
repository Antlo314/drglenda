-- ============================================================================
--  UMOF Learning Portal — COURSE CURRICULUM (admin-editable syllabus)
--  Run AFTER schema.sql (Supabase → SQL Editor → New query → Run).
--  Single-row document for the full course outline: title, meta, and weekly
--  blocks (objectives, steps, assignment, discussion, quiz). Safe to re-run.
-- ============================================================================

create table if not exists public.curriculum (
  id              text primary key default 'main',
  title           text not null default '',
  tagline         text not null default '',
  length          text not null default '',
  format          text not null default '',
  learning_style  text not null default '',
  description     text not null default '',
  -- Array of week objects:
  --   { week, title, pending?, objectives[], steps[], assignment, discussion, quiz[] }
  weeks           jsonb not null default '[]'::jsonb,
  updated_at      timestamptz not null default now()
);
alter table public.curriculum enable row level security;

-- Any logged-in user can read the syllabus; only admins can edit.
drop policy if exists "curriculum read"        on public.curriculum;
drop policy if exists "curriculum admin write" on public.curriculum;
create policy "curriculum read" on public.curriculum for select
  using (auth.uid() is not null);
create policy "curriculum admin write" on public.curriculum for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- Seed the default 12-week outline if the row doesn't exist yet.
-- (Does not overwrite admin edits on re-run.)
insert into public.curriculum (id, title, tagline, length, format, learning_style, description, weeks)
values (
  'main',
  'The Entrepreneur''s Journey: Funding Masterclass',
  'Building a Fundable Business from Startup to Success',
  '12 Weeks',
  'Online Instructor-Led',
  'Reading, Video Lessons, Interactive Discussions, Worksheets, Case Studies, Practical Exercises, Quizzes, and Funding Readiness Assessments',
  'The Entrepreneur''s Journey: Funding Masterclass is designed to guide aspiring and existing entrepreneurs through the process of building a business that qualifies for funding. Students will learn how to establish a legal business structure, build business credit, develop financial literacy, create funding-ready documentation, and position their businesses for grants, loans, contracts, and investor opportunities.',
  '[
    {
      "week": 1,
      "title": "Entrepreneurial Mindset & Business Foundation",
      "objectives": [
        "Understand the entrepreneurial journey.",
        "Identify characteristics of successful entrepreneurs.",
        "Develop a growth mindset.",
        "Clarify business vision and goals."
      ],
      "steps": [
        "Define your \"Why.\"",
        "Identify your target market.",
        "Establish short-term and long-term goals.",
        "Create a business vision statement.",
        "Complete a self-assessment of entrepreneurial readiness."
      ],
      "assignment": "Create a one-page Business Vision Plan.",
      "discussion": "What motivated you to become an entrepreneur, and what challenges do you anticipate facing?",
      "quiz": [
        "What is a growth mindset?",
        "Why is goal setting important in business?",
        "What is the purpose of a business vision statement?",
        "Name two characteristics of successful entrepreneurs.",
        "What is entrepreneurial readiness?",
        "Set a SMART goal for your business — make it Specific, Measurable, Achievable, Relevant, and Time-bound.",
        "Complete and expand on this goal: \"I will increase my monthly revenue by ______.\" (Tip: a revenue target paired with a customer-retention strategy is a cheat code that shows lenders you can sustain growth.)",
        "What are your financial goals?",
        "What are your operational goals?",
        "What are your marketing goals?",
        "Write a vision statement for your business.",
        "Write a personal vision statement for yourself."
      ]
    },
    {
      "week": 2,
      "pending": false,
      "title": "Business Structure & Legal Foundation",
      "objectives": [
        "Choose a legal structure that fits your goals and risk profile.",
        "Understand EIN, state registration, and basic compliance steps.",
        "Separate personal and business identity for funding readiness.",
        "Identify documents lenders and funders expect from a new entity."
      ],
      "steps": [
        "Review sole prop vs LLC vs corporation trade-offs.",
        "Confirm or file your entity registration in your state.",
        "Obtain or verify your EIN with the IRS.",
        "Open a dedicated business bank account.",
        "Create a simple compliance checklist (licenses, permits, renewals)."
      ],
      "assignment": "Complete a one-page Business Structure Plan: chosen entity type, why it fits, EIN status, bank account status, and next three legal steps.",
      "discussion": "Which business structure did you choose (or are considering), and what risk or tax factor influenced that decision most?",
      "quiz": [
        "What is the main liability difference between a sole proprietorship and an LLC?",
        "Why do funders care whether personal and business finances are separated?",
        "What is an EIN and when do you need one?",
        "Name two documents that typically prove your business is legally established.",
        "What is one compliance or licensing step your business may need in your state or industry?",
        "List the three next legal/administrative steps you will complete for your entity this week."
      ]
    },
    {"week": 3,  "pending": true, "title": "Business Credit & Financial Identity"},
    {"week": 4,  "pending": true, "title": "Bookkeeping, Financials & Cash Flow"},
    {"week": 5,  "pending": true, "title": "Building a Fundable Business Plan"},
    {"week": 6,  "pending": true, "title": "Grants, Loans & Investor Capital"},
    {"week": 7,  "pending": true, "title": "The Funding Pitch & Lender Relationships"},
    {"week": 8,  "pending": true, "title": "Government Contracting & Procurement"},
    {"week": 9,  "pending": true, "title": "Marketing, Branding & Digital Presence"},
    {"week": 10, "pending": true, "title": "Operations, Scaling & Team Building"},
    {"week": 11, "pending": true, "title": "Financial Management & Tax Strategy"},
    {"week": 12, "pending": true, "title": "Funding Readiness Assessment & Next Steps"}
  ]'::jsonb
)
on conflict (id) do nothing;
