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
('s2',2,'Business Credit & Entity Structure','2026-07-13',64,'/assets/edu-2.png','https://www.youtube.com/embed/ScMzIvxBSi4',
 'Choosing the right entity, establishing an EIN, and building business credit separate from your personal score.',
 '["LLC vs. S-Corp vs. C-Corp — tax and liability trade-offs.","Register with Dun & Bradstreet to obtain a D-U-N-S number.","Open net-30 vendor accounts to begin building tradelines.","Homework: file for your EIN and request a D-U-N-S number."]'),
('s3',3,'Bookkeeping, Financials & Cash Flow','2026-07-20',61,'/assets/edu-3.png','https://www.youtube.com/embed/ScMzIvxBSi4',
 'Reading the three core financial statements and keeping books a funder will trust.',
 '["Profit & Loss, Balance Sheet, and Cash Flow Statement — what each one tells a lender.","Cash flow is not profit. Funders underwrite cash flow.","Reconcile monthly; clean books shorten approval timelines.","Homework: produce a 12-month cash flow projection."]'),
('s4',4,'Building a Fundable Business Plan','2026-07-27',72,'/assets/edu-4.webp','https://www.youtube.com/embed/ScMzIvxBSi4',
 'Translating your vision into a lender-ready plan with a defensible use-of-funds.',
 '["Executive summary first — most reviewers decide here.","Tie every funding dollar to a specific, revenue-generating use.","Include market size, competition, and realistic financial projections.","Assignment: submit your one-page business plan for instructor review."]'),
('s5',5,'Grants, Loans & Investor Capital','2026-08-03',67,'/assets/edu-1.png','https://www.youtube.com/embed/ScMzIvxBSi4',
 'Mapping the full capital landscape and matching the right source to your stage and need.',
 '["Grants (non-dilutive) vs. debt (loans) vs. equity (investors).","SBA 7(a) and microloans, CDFIs, and community lenders.","Match the capital type to the use and to your risk tolerance.","Homework: build your shortlist of 5 funding sources."]'),
('s6',6,'The Funding Pitch & Lender Relationships','2026-08-10',69,'/assets/edu-2.png','https://www.youtube.com/embed/ScMzIvxBSi4',
 'Delivering a confident pitch, anticipating underwriter questions, and building lasting funder relationships.',
 '["Lead with the number, the use, and the repayment story.","Prepare for the 10 questions every underwriter asks.","Relationships compound — keep funders updated even between asks.","Final: record and submit your 3-minute funding pitch."]')
on conflict (id) do update set
  week=excluded.week, title=excluded.title, date=excluded.date, duration_min=excluded.duration_min,
  thumb=excluded.thumb, video_url=excluded.video_url, summary=excluded.summary, notes=excluded.notes;

-- ── Quizzes ──────────────────────────────────────────────────────────────────
insert into public.quizzes (id, session_id, type, title, max_score, prompt, questions) values
('q1','s1','auto','Funding Readiness Basics',100,null,
 '[{"id":"q1a","prompt":"Which is NOT one of the 5 C''s of credit?","options":["Capacity","Collateral","Charisma","Conditions"],"correctIndex":2},
   {"id":"q1b","prompt":"Funders primarily underwrite a business''s…","options":["Social media following","Cash flow","Office size","Logo design"],"correctIndex":1},
   {"id":"q1c","prompt":"A first step toward funding readiness is to…","options":["Mix personal & business funds","Separate personal & business finances","Avoid bookkeeping","Skip the EIN"],"correctIndex":1},
   {"id":"q1d","prompt":"Funding readiness is best described as…","options":["Luck","Documentation + credit + cash flow + clear use of funds","A high follower count","A nice website"],"correctIndex":1}]'),
('q2','s2','auto','Business Credit Fundamentals',100,null,
 '[{"id":"q2a","prompt":"A D-U-N-S number is issued by…","options":["The IRS","Dun & Bradstreet","Your bank","The SBA"],"correctIndex":1},
   {"id":"q2b","prompt":"Net-30 vendor accounts help you…","options":["Lower your taxes","Build business tradelines","Avoid an EIN","Skip bookkeeping"],"correctIndex":1},
   {"id":"q2c","prompt":"Which entity offers liability protection?","options":["Sole proprietorship","LLC","Handshake deal","None"],"correctIndex":1}]'),
('q3','s4','manual','One-Page Business Plan (Instructor Review)',100,
 'Submit your one-page business plan. Include: executive summary, the funding amount requested, a specific use-of-funds, and 12-month financial projections.','[]'),
('q4','s5','auto','Capital Sources',100,null,
 '[{"id":"q4a","prompt":"Which capital type is non-dilutive?","options":["Equity investment","Grants","Selling shares","Venture capital"],"correctIndex":1},
   {"id":"q4b","prompt":"A CDFI is a…","options":["Credit card","Community Development Financial Institution","Tax form","Type of grant scam"],"correctIndex":1},
   {"id":"q4c","prompt":"SBA 7(a) refers to a…","options":["Grant","Loan program","Tax credit","Stock"],"correctIndex":1}]')
on conflict (id) do update set
  session_id=excluded.session_id, type=excluded.type, title=excluded.title,
  max_score=excluded.max_score, prompt=excluded.prompt, questions=excluded.questions;

-- ── CRM leads ────────────────────────────────────────────────────────────────
insert into public.leads (name, email, phone, source, interest, status, created_at, notes) values
('Renee Carter','renee.carter@example.com','(404) 555-0311','Website form','Funding Masterclass','new','2026-06-26','Asked about the payment plan option.'),
('Marcus Bell','marcus.bell@example.com','(678) 555-0344','Instagram','Funding Masterclass','contacted','2026-06-24','Sent enrollment link; following up Monday.'),
('Latoya Simmons','latoya.s@example.com','(470) 555-0356','Event — Boss Court TV','Business Growth Plan','qualified','2026-06-20','Already has an LLC; ready to enroll.'),
('Daniel Okoro','d.okoro@example.com','(404) 555-0367','Referral','Funding Masterclass','new','2026-06-27','Referred by Maya Thompson.'),
('Sophia Reyes','sophia.reyes@example.com','(678) 555-0389','Website form','Scholarship','contacted','2026-06-22','Sent scholarship application form.'),
('Kevin Walsh','kevin.walsh@example.com','(770) 555-0390','Newsletter','Funding Masterclass','lost','2026-06-12','Timing not right; revisit in fall cohort.'),
('Imani Brooks','imani.brooks@example.com','(404) 555-0402','Event — Boss Court TV','Funding Masterclass','qualified','2026-06-25','Wants to start before July 2nd deadline.'),
('Gregory Tan','greg.tan@example.com','(470) 555-0415','Website form','Business Growth Plan','new','2026-06-28','Requested a callback.')
on conflict do nothing;
