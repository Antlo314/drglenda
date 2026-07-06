/* =============================================================================
   UMOF Learning Portal — Seed data
   -----------------------------------------------------------------------------
   This is realistic SAMPLE data for the prototype. In production every entity
   below maps to a database table (Supabase/Postgres): users, sessions, notes,
   quizzes, submissions, leads. The portal never reads this file directly — it
   goes through store.js, which is the single seam to replace with real API
   calls later.
   ========================================================================== */

// NOTE: passwords are plaintext here ONLY because this is a front-end demo with
// no server. Real auth (hashed passwords / magic links) arrives with the backend.
export const SEED = {
  // ---- People who can log in -------------------------------------------------
  users: [
    {
      id: 'u-admin',
      role: 'admin',
      name: 'Dr. Glenda S. Williams',
      email: 'admin@umof.org',
      password: 'admin1234',
      title: 'Founder & Lead Instructor',
      phone: '(770) 555-0100',
    },
    { id: 'u-jordan', role: 'student', name: 'Jordan Ellis', email: 'jordan@umof.org', password: 'demo1234', phone: '(404) 555-0142', cohort: 'Summer 2026', enrolled: '2026-06-10', plan: 'Full Program' },
    { id: 'u-maya', role: 'student', name: 'Maya Thompson', email: 'maya@umof.org', password: 'demo1234', phone: '(678) 555-0188', cohort: 'Summer 2026', enrolled: '2026-06-09', plan: 'Full Program' },
    { id: 'u-andre', role: 'student', name: 'Andre Robinson', email: 'andre@umof.org', password: 'demo1234', phone: '(470) 555-0119', cohort: 'Summer 2026', enrolled: '2026-06-12', plan: 'Full Program' },
    { id: 'u-priya', role: 'student', name: 'Priya Nair', email: 'priya@umof.org', password: 'demo1234', phone: '(404) 555-0177', cohort: 'Summer 2026', enrolled: '2026-06-11', plan: 'Payment Plan' },
    { id: 'u-carlos', role: 'student', name: 'Carlos Mendez', email: 'carlos@umof.org', password: 'demo1234', phone: '(678) 555-0203', cohort: 'Summer 2026', enrolled: '2026-06-14', plan: 'Full Program' },
    { id: 'u-tasha', role: 'student', name: 'Tasha Greene', email: 'tasha@umof.org', password: 'demo1234', phone: '(770) 555-0166', cohort: 'Summer 2026', enrolled: '2026-06-13', plan: 'Payment Plan' },
    { id: 'u-wei', role: 'student', name: 'Wei Chen', email: 'wei@umof.org', password: 'demo1234', phone: '(404) 555-0151', cohort: 'Summer 2026', enrolled: '2026-06-15', plan: 'Full Program' },
    { id: 'u-destiny', role: 'student', name: 'Destiny Hughes', email: 'destiny@umof.org', password: 'demo1234', phone: '(470) 555-0190', cohort: 'Summer 2026', enrolled: '2026-06-16', plan: 'Scholarship', grantAwarded: true, grantAmount: 300 },
  ],

  // ---- Class sessions (the 12-week Funding Masterclass; 6 published so far) --
  sessions: [
    {
      id: 's1', week: 1, title: 'Foundations of Funding Readiness',
      date: '2026-07-06', durationMin: 58, thumb: '/assets/edu-1.png',
      videoUrl: 'https://www.youtube.com/embed/ScMzIvxBSi4',
      meetUrl: 'https://meet.google.com/lookup/umof-funding-week1', liveAt: '2026-07-06T18:00',
      summary: 'What lenders and funders actually look for, and how to assess where your business stands today.',
      notes: [
        'The 5 C’s of credit: Character, Capacity, Capital, Collateral, Conditions.',
        'Separate personal and business finances before applying for anything.',
        'Funding readiness = documentation + credit + cash flow + a clear use of funds.',
        'Homework: complete the Funding Readiness self-assessment worksheet.',
      ],
    },
    {
      id: 's2', week: 1, title: 'Business Credit & Entity Structure',
      date: '2026-07-06', durationMin: 64, thumb: '/assets/edu-2.png',
      videoUrl: 'https://www.youtube.com/embed/ScMzIvxBSi4',
      summary: 'Choosing the right entity, establishing an EIN, and building business credit separate from your personal score.',
      notes: [
        'LLC vs. S-Corp vs. C-Corp — tax and liability trade-offs.',
        'Register with Dun & Bradstreet to obtain a D-U-N-S number.',
        'Open net-30 vendor accounts to begin building tradelines.',
        'Homework: file for your EIN and request a D-U-N-S number.',
      ],
    },
    {
      id: 's3', week: 1, title: 'Bookkeeping, Financials & Cash Flow',
      date: '2026-07-06', durationMin: 61, thumb: '/assets/edu-3.png',
      videoUrl: 'https://www.youtube.com/embed/ScMzIvxBSi4',
      summary: 'Reading the three core financial statements and keeping books a funder will trust.',
      notes: [
        'Profit & Loss, Balance Sheet, and Cash Flow Statement — what each one tells a lender.',
        'Cash flow ≠ profit. Funders underwrite cash flow.',
        'Reconcile monthly; clean books shorten approval timelines.',
        'Homework: produce a 12-month cash flow projection.',
      ],
    },
    {
      id: 's4', week: 1, title: 'Building a Fundable Business Plan',
      date: '2026-07-06', durationMin: 72, thumb: '/assets/edu-4.webp',
      videoUrl: 'https://www.youtube.com/embed/ScMzIvxBSi4',
      summary: 'Translating your vision into a lender-ready plan with a defensible use-of-funds.',
      notes: [
        'Executive summary first — most reviewers decide here.',
        'Tie every funding dollar to a specific, revenue-generating use.',
        'Include market size, competition, and realistic financial projections.',
        'Assignment: submit your one-page business plan for instructor review.',
      ],
    },
    {
      id: 's5', week: 1, title: 'Grants, Loans & Investor Capital',
      date: '2026-07-06', durationMin: 67, thumb: '/assets/edu-1.png',
      videoUrl: 'https://www.youtube.com/embed/ScMzIvxBSi4',
      summary: 'Mapping the full capital landscape and matching the right source to your stage and need.',
      notes: [
        'Grants (non-dilutive) vs. debt (loans) vs. equity (investors).',
        'SBA 7(a) and microloans, CDFIs, and community lenders.',
        'Match the capital type to the use and to your risk tolerance.',
        'Homework: build your shortlist of 5 funding sources.',
      ],
    },
    {
      id: 's6', week: 1, title: 'The Funding Pitch & Lender Relationships',
      date: '2026-07-06', durationMin: 69, thumb: '/assets/edu-2.png',
      videoUrl: 'https://www.youtube.com/embed/ScMzIvxBSi4',
      summary: 'Delivering a confident pitch, anticipating underwriter questions, and building lasting funder relationships.',
      notes: [
        'Lead with the number, the use, and the repayment story.',
        'Prepare for the 10 questions every underwriter asks.',
        'Relationships compound — keep funders updated even between asks.',
        'Final: record and submit your 3-minute funding pitch.',
      ],
    },
  ],

  // ---- Tests / quizzes -------------------------------------------------------
  // type 'auto'   -> scored instantly from correctIndex
  // type 'manual' -> student submits text/work; admin grades it
  quizzes: [
    {
      id: 'q1', sessionId: 's1', type: 'auto', title: 'Funding Readiness Basics',
      questions: [
        { id: 'q1a', prompt: 'Which is NOT one of the 5 C’s of credit?', options: ['Capacity', 'Collateral', 'Charisma', 'Conditions'], correctIndex: 2 },
        { id: 'q1b', prompt: 'Funders primarily underwrite a business’s…', options: ['Social media following', 'Cash flow', 'Office size', 'Logo design'], correctIndex: 1 },
        { id: 'q1c', prompt: 'A first step toward funding readiness is to…', options: ['Mix personal & business funds', 'Separate personal & business finances', 'Avoid bookkeeping', 'Skip the EIN'], correctIndex: 1 },
        { id: 'q1d', prompt: 'Funding readiness is best described as…', options: ['Luck', 'Documentation + credit + cash flow + clear use of funds', 'A high follower count', 'A nice website'], correctIndex: 1 },
      ],
    },
    {
      id: 'q2', sessionId: 's2', type: 'auto', title: 'Business Credit Fundamentals',
      questions: [
        { id: 'q2a', prompt: 'A D-U-N-S number is issued by…', options: ['The IRS', 'Dun & Bradstreet', 'Your bank', 'The SBA'], correctIndex: 1 },
        { id: 'q2b', prompt: 'Net-30 vendor accounts help you…', options: ['Lower your taxes', 'Build business tradelines', 'Avoid an EIN', 'Skip bookkeeping'], correctIndex: 1 },
        { id: 'q2c', prompt: 'Which entity offers liability protection?', options: ['Sole proprietorship', 'LLC', 'Handshake deal', 'None'], correctIndex: 1 },
      ],
    },
    {
      id: 'q3', sessionId: 's4', type: 'manual', title: 'One-Page Business Plan (Instructor Review)',
      maxScore: 100,
      prompt: 'Submit your one-page business plan. Include: executive summary, the funding amount requested, a specific use-of-funds, and 12-month financial projections.',
    },
    {
      id: 'q4', sessionId: 's5', type: 'auto', title: 'Capital Sources',
      questions: [
        { id: 'q4a', prompt: 'Which capital type is non-dilutive?', options: ['Equity investment', 'Grants', 'Selling shares', 'Venture capital'], correctIndex: 1 },
        { id: 'q4b', prompt: 'A CDFI is a…', options: ['Credit card', 'Community Development Financial Institution', 'Tax form', 'Type of grant scam'], correctIndex: 1 },
        { id: 'q4c', prompt: 'SBA 7(a) refers to a…', options: ['Grant', 'Loan program', 'Tax credit', 'Stock'], correctIndex: 1 },
      ],
    },
  ],

  // ---- Per-student progress + quiz submissions -------------------------------
  // completed: array of session ids the student has finished
  // submissions: keyed by quizId
  progress: {
    'u-jordan': {
      completed: ['s1', 's2', 's3', 's4'],
      submissions: {
        q1: { type: 'auto', score: 100, total: 4, correct: 4, status: 'graded', submittedAt: '2026-07-07' },
        q2: { type: 'auto', score: 67, total: 3, correct: 2, status: 'graded', submittedAt: '2026-07-14' },
        q3: { type: 'manual', status: 'submitted', submittedAt: '2026-07-28', answer: 'Mobile detailing business. Requesting $25,000 to purchase a second van and hire one technician. 12-month projection attached: revenue grows from $6k/mo to $14k/mo by month 12.' },
      },
    },
    'u-maya': {
      completed: ['s1', 's2', 's3', 's4', 's5'],
      submissions: {
        q1: { type: 'auto', score: 100, total: 4, correct: 4, status: 'graded', submittedAt: '2026-07-06' },
        q2: { type: 'auto', score: 100, total: 3, correct: 3, status: 'graded', submittedAt: '2026-07-13' },
        q3: { type: 'manual', status: 'graded', score: 92, feedback: 'Strong use-of-funds and realistic projections. Tighten the competitive analysis.', submittedAt: '2026-07-27', gradedAt: '2026-07-29', answer: 'Boutique bakery expansion. Requesting $40,000 for a second location build-out. Detailed P&L and break-even by month 9 included.' },
        q4: { type: 'auto', score: 100, total: 3, correct: 3, status: 'graded', submittedAt: '2026-08-03' },
      },
    },
    'u-andre': {
      completed: ['s1', 's2'],
      submissions: {
        q1: { type: 'auto', score: 75, total: 4, correct: 3, status: 'graded', submittedAt: '2026-07-08' },
        q2: { type: 'auto', score: 33, total: 3, correct: 1, status: 'graded', submittedAt: '2026-07-15' },
      },
    },
    'u-priya': {
      completed: ['s1', 's2', 's3'],
      submissions: {
        q1: { type: 'auto', score: 100, total: 4, correct: 4, status: 'graded', submittedAt: '2026-07-06' },
        q2: { type: 'auto', score: 100, total: 3, correct: 3, status: 'graded', submittedAt: '2026-07-13' },
        q3: { type: 'manual', status: 'submitted', submittedAt: '2026-07-29', answer: 'Childcare center serving 30 families. Requesting $60,000 for licensing, build-out, and staff. Projections show full enrollment by month 8.' },
      },
    },
    'u-carlos': {
      completed: ['s1'],
      submissions: {
        q1: { type: 'auto', score: 50, total: 4, correct: 2, status: 'graded', submittedAt: '2026-07-09' },
      },
    },
    'u-tasha': {
      completed: ['s1', 's2', 's3', 's4', 's5', 's6'],
      submissions: {
        q1: { type: 'auto', score: 100, total: 4, correct: 4, status: 'graded', submittedAt: '2026-07-06' },
        q2: { type: 'auto', score: 100, total: 3, correct: 3, status: 'graded', submittedAt: '2026-07-13' },
        q3: { type: 'manual', status: 'graded', score: 88, feedback: 'Excellent plan. Add a sensitivity scenario for slower revenue.', submittedAt: '2026-07-26', gradedAt: '2026-07-28', answer: 'Landscaping & snow-removal LLC. Requesting $35,000 for equipment. Year-round revenue model with seasonal balancing.' },
        q4: { type: 'auto', score: 100, total: 3, correct: 3, status: 'graded', submittedAt: '2026-08-03' },
      },
    },
    'u-wei': {
      completed: ['s1', 's2', 's3', 's4'],
      submissions: {
        q1: { type: 'auto', score: 100, total: 4, correct: 4, status: 'graded', submittedAt: '2026-07-07' },
        q2: { type: 'auto', score: 67, total: 3, correct: 2, status: 'graded', submittedAt: '2026-07-14' },
      },
    },
    'u-destiny': {
      completed: [],
      submissions: {},
    },
  },

  // ---- CRM leads / prospects -------------------------------------------------
  // Starts empty — the admin adds records manually in the CRM (or they arrive
  // from the website signup form and Jotform enrollment webhook).
  leads: [],

  // ---- Approved-student emails (who may create an account) -------------------
  allowedStudents: [
    { email: 'jordan@umof.org', note: 'Summer 2026 cohort' },
    { email: 'maya@umof.org', note: 'Summer 2026 cohort' },
  ],

  // ---- Class materials (the resell-ready content library) --------------------
  // Per-session resources students view/download inside the login. kind:
  //   'pdf' | 'image' | 'video' -> hosted file (in prod: private Storage + signed URL)
  //   'link'                    -> an external URL (no file)
  materials: [
    { id: 'm1', sessionId: 's1', kind: 'pdf',   title: 'Funding Readiness Worksheet', url: '/assets/week1-worksheet.pdf' },
    { id: 'm2', sessionId: 's1', kind: 'image', title: 'The 5 C’s of Credit (infographic)', url: '/assets/edu-1.png' },
    { id: 'm3', sessionId: 's1', kind: 'link',  title: 'SBA — Fund your business (reference)', url: 'https://www.sba.gov/funding-programs' },
    { id: 'm4', sessionId: 's4', kind: 'video', title: 'Business plan walkthrough (recording)', url: '/umof-class.mp4' },
    { id: 'm5', sessionId: 's4', kind: 'pdf',   title: 'One-Page Business Plan template', url: '/assets/week1-worksheet.pdf' },
  ],
};
