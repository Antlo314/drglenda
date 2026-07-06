-- ============================================================================
--  UMOF Learning Portal — seed content (run AFTER schema.sql)
--  Loads the 6 published sessions, their quizzes, and sample CRM leads.
--  Student/instructor accounts are created through Supabase Auth (see
--  SUPABASE_SETUP.md) — their progress & submissions accrue as they use the app.
-- ============================================================================

-- ── Sessions ────────────────────────────────────────────────────────────────
insert into public.sessions (id, week, title, date, duration_min, thumb, video_url, summary, notes) values
('s1',1,'Foundations of Funding Readiness','2026-07-06',58,'/assets/edu-1.png','https://www.youtube.com/embed/ScMzIvxBSi4',
 'What lenders and funders actually look for, and how to assess where your business stands today.',
 '["The 5 C''s of credit: Character, Capacity, Capital, Collateral, Conditions.","Separate personal and business finances before applying for anything.","Funding readiness = documentation + credit + cash flow + a clear use of funds.","Homework: complete the Funding Readiness self-assessment worksheet."]'),
('s2',1,'Business Credit & Entity Structure','2026-07-06',64,'/assets/edu-2.png','https://www.youtube.com/embed/ScMzIvxBSi4',
 'Choosing the right entity, establishing an EIN, and building business credit separate from your personal score.',
 '["LLC vs. S-Corp vs. C-Corp — tax and liability trade-offs.","Register with Dun & Bradstreet to obtain a D-U-N-S number.","Open net-30 vendor accounts to begin building tradelines.","Homework: file for your EIN and request a D-U-N-S number."]'),
('s3',1,'Bookkeeping, Financials & Cash Flow','2026-07-06',61,'/assets/edu-3.png','https://www.youtube.com/embed/ScMzIvxBSi4',
 'Reading the three core financial statements and keeping books a funder will trust.',
 '["Profit & Loss, Balance Sheet, and Cash Flow Statement — what each one tells a lender.","Cash flow is not profit. Funders underwrite cash flow.","Reconcile monthly; clean books shorten approval timelines.","Homework: produce a 12-month cash flow projection."]'),
('s4',1,'Building a Fundable Business Plan','2026-07-06',72,'/assets/edu-4.webp','https://www.youtube.com/embed/ScMzIvxBSi4',
 'Translating your vision into a lender-ready plan with a defensible use-of-funds.',
 '["Executive summary first — most reviewers decide here.","Tie every funding dollar to a specific, revenue-generating use.","Include market size, competition, and realistic financial projections.","Assignment: submit your one-page business plan for instructor review."]'),
('s5',1,'Grants, Loans & Investor Capital','2026-07-06',67,'/assets/edu-1.png','https://www.youtube.com/embed/ScMzIvxBSi4',
 'Mapping the full capital landscape and matching the right source to your stage and need.',
 '["Grants (non-dilutive) vs. debt (loans) vs. equity (investors).","SBA 7(a) and microloans, CDFIs, and community lenders.","Match the capital type to the use and to your risk tolerance.","Homework: build your shortlist of 5 funding sources."]'),
('s6',1,'The Funding Pitch & Lender Relationships','2026-07-06',69,'/assets/edu-2.png','https://www.youtube.com/embed/ScMzIvxBSi4',
 'Delivering a confident pitch, anticipating underwriter questions, and building lasting funder relationships.',
 '["Lead with the number, the use, and the repayment story.","Prepare for the 10 questions every underwriter asks.","Relationships compound — keep funders updated even between asks.","Final: record and submit your 3-minute funding pitch."]')
on conflict (id) do update set
  week=excluded.week, title=excluded.title, date=excluded.date, duration_min=excluded.duration_min,
  thumb=excluded.thumb, video_url=excluded.video_url, summary=excluded.summary, notes=excluded.notes;

-- ── Quizzes ──────────────────────────────────────────────────────────────────
-- ONE test per week, using the exact free-response questions from the curriculum.
-- `published` gates student visibility: a test stays offline until an admin
-- clicks "Go live" on the Sessions panel.
insert into public.quizzes (id, session_id, type, title, max_score, prompt, questions, published) values
('qw1','s1','manual','Week 1 Test — Entrepreneurial Mindset & Business Foundation',100,null,
 '[{"id":"qw1-1","prompt":"What is a growth mindset?"},
   {"id":"qw1-2","prompt":"Why is goal setting important in business?"},
   {"id":"qw1-3","prompt":"What is the purpose of a business vision statement?"},
   {"id":"qw1-4","prompt":"Name two characteristics of successful entrepreneurs."},
   {"id":"qw1-5","prompt":"What is entrepreneurial readiness?"}]', false)
on conflict (id) do update set
  session_id=excluded.session_id, type=excluded.type, title=excluded.title,
  max_score=excluded.max_score, prompt=excluded.prompt, questions=excluded.questions;
  -- NOTE: `published` is intentionally NOT overwritten on re-seed, so re-running
  -- this file never takes a live test offline.

-- ── CRM leads ────────────────────────────────────────────────────────────────
-- The CRM starts empty. The admin adds records manually in the portal, and new
-- leads arrive from the website signup form and the Jotform enrollment webhook.
-- (To wipe leads from an existing database, run:  delete from public.leads;)
