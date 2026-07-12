/* =============================================================================
   UMOF Learning Portal — Seed data
   -----------------------------------------------------------------------------
   This is realistic SAMPLE data for the prototype. In production every entity
   below maps to a database table (Supabase/Postgres): users, sessions, notes,
   quizzes, submissions, leads. The portal never reads this file directly — it
   goes through store.js, which is the single seam to replace with real API
   calls later.
   ========================================================================== */

import { CURRICULUM } from './curriculum.js';

// The Week 1 test shows students the EXACT free-response questions from the
// curriculum (curriculum.js is the single source of truth — we never redefine
// them here). It is manually graded and starts OFFLINE until an admin sets it
// live from the Sessions panel.
const week1 = CURRICULUM.weeks.find((w) => w.week === 1);
const WEEK1_TEST = {
  id: 'qw1',
  sessionId: 's1',
  type: 'manual',
  published: true, // active — students can answer to build their portfolio
  due: '2026-07-13', // Monday
  title: 'Week 1 Test — Entrepreneurial Mindset & Business Foundation',
  maxScore: 100,
  questions: (week1?.quiz || []).map((prompt, i) => ({ id: `qw1-${i + 1}`, prompt })),
};

// Week 1 "Why" reflection — a separate portfolio deliverable, due before the quiz.
const WEEK1_WHY = {
  id: 'qwhy1',
  sessionId: 's1',
  type: 'manual',
  published: true, // active now
  due: '2026-07-10', // Friday
  title: 'Week 1 — Why Section',
  maxScore: 100,
  questions: [
    { id: 'qwhy1-1', prompt: 'Why do I want a business?' },
    { id: 'qwhy1-2', prompt: 'Why? (Dig deeper — what is the deeper reason behind that?)' },
    { id: 'qwhy1-3', prompt: 'Why would you want to leave a legacy?' },
    { id: 'qwhy1-4', prompt: 'Why do I want financial stability?' },
    { id: 'qwhy1-5', prompt: 'Why is creating generational wealth and opportunity important?' },
  ],
};

// NOTE: passwords are plaintext here ONLY because this is a front-end demo with
// no server. Real auth (hashed passwords / magic links) arrives with the backend.
export const SEED = {
  // ---- Course syllabus (admin-editable in the Curriculum page) --------------
  curriculum: {
    title: CURRICULUM.title,
    tagline: CURRICULUM.tagline,
    length: CURRICULUM.length,
    format: CURRICULUM.format,
    learningStyle: CURRICULUM.learningStyle,
    description: CURRICULUM.description,
    weeks: CURRICULUM.weeks.map((w) => ({ ...w })),
  },

  // ---- People who can log in -------------------------------------------------
  users: [
    {
      id: 'u-admin',
      role: 'admin',
      name: 'Dr. Glenda S. Williams, CFWF',
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
  // Week 1 deliverables: the "Why" reflection (due Fri) + the quiz (due Mon,
  // questions from curriculum.js). Written tests are free-response and
  // instructor-graded; `published` stays false until an admin sets them "live".
  quizzes: [WEEK1_WHY, WEEK1_TEST],

  // ---- Per-student progress + quiz submissions -------------------------------
  // completed: array of session ids the student has finished
  // submissions: keyed by quizId
  // Submissions are keyed by the single per-week test id (qw1). Written-test
  // answers are keyed by question id (qw1-1 … qw1-5).
  progress: {
    'u-jordan': {
      completed: ['s1', 's2', 's3', 's4'],
      submissions: {
        qw1: { type: 'manual', status: 'submitted', submittedAt: '2026-07-07', answers: {
          'qw1-1': 'Believing your skills can grow through effort and learning.',
          'qw1-2': 'It gives the business clear, measurable targets to work toward.',
          'qw1-3': 'To describe the long-term direction and purpose of the business.',
          'qw1-4': 'Resilience and a willingness to take calculated risks.',
          'qw1-5': 'Being financially and mentally prepared to launch and run a business.',
        } },
      },
    },
    'u-maya': {
      completed: ['s1', 's2', 's3', 's4', 's5'],
      submissions: {
        qw1: { type: 'manual', status: 'graded', score: 92, feedback: 'Strong, well-articulated answers. Expand a little on readiness in Q5.', submittedAt: '2026-07-06', gradedAt: '2026-07-08', answers: {
          'qw1-1': 'A mindset that treats ability as something you develop, not a fixed trait.',
          'qw1-2': 'Goals turn a vision into concrete milestones and keep the team accountable.',
          'qw1-3': 'It aligns everyone around where the business is headed and why.',
          'qw1-4': 'Persistence and adaptability.',
          'qw1-5': 'Having the documentation, mindset, and resources in place to start.',
        } },
      },
    },
    'u-andre': {
      completed: ['s1', 's2'],
      submissions: {},
    },
    'u-priya': {
      completed: ['s1', 's2', 's3'],
      submissions: {
        qw1: { type: 'manual', status: 'submitted', submittedAt: '2026-07-08', answers: {
          'qw1-1': 'The belief that intelligence and skills improve with practice.',
          'qw1-2': 'Setting goals keeps the business focused and makes progress measurable.',
          'qw1-3': 'It communicates the purpose and future of the business clearly.',
          'qw1-4': 'Vision and discipline.',
          'qw1-5': 'Readiness to commit the time, money, and effort a business requires.',
        } },
      },
    },
    'u-carlos': {
      completed: ['s1'],
      submissions: {},
    },
    'u-tasha': {
      completed: ['s1', 's2', 's3', 's4', 's5', 's6'],
      submissions: {
        qw1: { type: 'manual', status: 'graded', score: 88, feedback: 'Great work. Give a second characteristic more detail in Q4.', submittedAt: '2026-07-06', gradedAt: '2026-07-09', answers: {
          'qw1-1': 'Seeing challenges as chances to learn and improve.',
          'qw1-2': 'It provides direction and a way to track whether the business is on course.',
          'qw1-3': 'To capture the long-term vision that guides decisions.',
          'qw1-4': 'Resourcefulness and resilience.',
          'qw1-5': 'Being prepared — financially, legally, and personally — to run a business.',
        } },
      },
    },
    'u-wei': {
      completed: ['s1', 's2', 's3', 's4'],
      submissions: {},
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

  // ---- Class discussion board (student-to-student chat) ----------------------
  // A shared, real-time class feed where students post their Discussion Post
  // answers, ask questions, and support one another; the instructor can join in.
  // Oldest first (the view renders chronologically and pins to the newest).
  discussion: [
    { id: 'd1', authorId: 'u-admin', authorName: 'Dr. Glenda S. Williams, CFWF', authorRole: 'admin',
      body: 'Welcome to the class discussion board! 🎉 This is your space to post your Discussion Post answers, ask questions, and support one another. Kick us off with this week’s prompt: “What motivated you to become an entrepreneur, and what challenges do you anticipate facing?”',
      createdAt: '2026-07-06T18:05:00' },
    { id: 'd2', authorId: 'u-maya', authorName: 'Maya Thompson', authorRole: 'student',
      body: 'So excited to be here! I started my business because I want to build something my kids can inherit. My biggest worry is the funding side — that’s exactly why I signed up.',
      createdAt: '2026-07-06T19:12:00' },
    { id: 'd3', authorId: 'u-jordan', authorName: 'Jordan Ellis', authorRole: 'student',
      body: 'Same here, Maya! For me it’s about freedom and financial stability. Quick question for the group — did anyone else find the 5 C’s of Credit in Session 1 eye-opening? I had no idea “Character” actually counted.',
      createdAt: '2026-07-07T08:41:00' },
    { id: 'd4', authorId: 'u-priya', authorName: 'Priya Nair', authorRole: 'student',
      body: 'Yes, Jordan — the Character piece surprised me too! My anticipated challenge is keeping my books clean enough for a lender to trust them. Does anyone have a bookkeeping tool they love?',
      createdAt: '2026-07-07T13:20:00' },
  ],
};
