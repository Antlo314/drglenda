/* =============================================================================
   UMOF Learning Portal — Course curriculum (syllabus) DEFAULT
   -----------------------------------------------------------------------------
   Default seed for "The Entrepreneur's Journey: Funding Masterclass."
   Live data lives in store.js (localStorage / Supabase). Admins fully edit
   the syllabus in the portal Curriculum page; this file is only the initial
   template for new demos / empty databases.

   Distinct from `sessions` (recorded videos + notes). A week with
   `pending: true` shows as "coming soon" to students until an admin publishes it.
   ========================================================================== */

export const CURRICULUM = {
  title: 'The Entrepreneur’s Journey: Funding Masterclass',
  tagline: 'Building a Fundable Business from Startup to Success',
  length: '12 Weeks',
  format: 'Online Instructor-Led',
  learningStyle:
    'Reading, Video Lessons, Interactive Discussions, Worksheets, Case Studies, Practical Exercises, Quizzes, and Funding Readiness Assessments',
  description:
    'The Entrepreneur’s Journey: Funding Masterclass is designed to guide aspiring and existing entrepreneurs through the process of building a business that qualifies for funding. Students will learn how to establish a legal business structure, build business credit, develop financial literacy, create funding-ready documentation, and position their businesses for grants, loans, contracts, and investor opportunities.',

  weeks: [
    {
      week: 1,
      title: 'Entrepreneurial Mindset & Business Foundation',
      objectives: [
        'Understand the entrepreneurial journey.',
        'Identify characteristics of successful entrepreneurs.',
        'Develop a growth mindset.',
        'Clarify business vision and goals.',
      ],
      steps: [
        'Define your "Why."',
        'Identify your target market.',
        'Establish short-term and long-term goals.',
        'Create a business vision statement.',
        'Complete a self-assessment of entrepreneurial readiness.',
      ],
      assignment: 'Create a one-page Business Vision Plan.',
      discussion:
        'What motivated you to become an entrepreneur, and what challenges do you anticipate facing?',
      discussionPublished: true,
      quiz: [
        'What is a growth mindset?',
        'Why is goal setting important in business?',
        'What is the purpose of a business vision statement?',
        'Name two characteristics of successful entrepreneurs.',
        'What is entrepreneurial readiness?',
        'Set a SMART goal for your business — make it Specific, Measurable, Achievable, Relevant, and Time-bound.',
        'Complete and expand on this goal: “I will increase my monthly revenue by ______.” (Tip: a revenue target paired with a customer-retention strategy is a cheat code that shows lenders you can sustain growth.)',
        'What are your financial goals?',
        'What are your operational goals?',
        'What are your marketing goals?',
        'Write a vision statement for your business.',
        'Write a personal vision statement for yourself.',
      ],
    },

    {
      week: 2,
      title: 'Business Structure & Legal Foundation',
      // Published for students (syllabus week 2 is live)
      pending: false,
      objectives: [
        'Choose a legal structure that fits your goals and risk profile.',
        'Understand EIN, state registration, and basic compliance steps.',
        'Separate personal and business identity for funding readiness.',
        'Identify documents lenders and funders expect from a new entity.',
      ],
      steps: [
        'Review sole prop vs LLC vs corporation trade-offs.',
        'Confirm or file your entity registration in your state.',
        'Obtain or verify your EIN with the IRS.',
        'Open a dedicated business bank account.',
        'Create a simple compliance checklist (licenses, permits, renewals).',
      ],
      assignment:
        'Complete a one-page Business Structure Plan: chosen entity type, why it fits, EIN status, bank account status, and next three legal steps.',
      discussion:
        'Part 1. Many entrepreneurs start businesses without understanding the legal structure they need. In your opinion, should all entrepreneurs establish an LLC before launching their business? Why or why not? Support your response with examples.\n\nPart 2. Which business structure did you choose (or are considering), and what risk or tax factor influenced that decision most?',
      discussionPublished: true,
      // Multiple-choice stems + A–D options (parsed into real MC on the test form)
      quiz: [
        'Which business structure provides the least liability protection?\nA. LLC\nB. Corporation\nC. Sole Proprietorship\nD. Nonprofit\nCorrect: C',
        'What does LLC stand for?\nA. Limited Liability Company\nB. Legal Liability Corporation\nC. Limited Loan Company\nD. Licensed Liability Company\nCorrect: A',
        'Which structure is often preferred by investors?\nA. Sole Proprietorship\nB. Corporation\nC. Partnership\nD. DBA\nCorrect: B',
      ],
    },

    // ── Weeks 3–12: pending — fill in content as class progresses ──
    { week: 3,  pending: true, title: 'Business Credit & Financial Identity' },
    { week: 4,  pending: true, title: 'Bookkeeping, Financials & Cash Flow' },
    { week: 5,  pending: true, title: 'Building a Fundable Business Plan' },
    { week: 6,  pending: true, title: 'Grants, Loans & Investor Capital' },
    { week: 7,  pending: true, title: 'The Funding Pitch & Lender Relationships' },
    { week: 8,  pending: true, title: 'Government Contracting & Procurement' },
    { week: 9,  pending: true, title: 'Marketing, Branding & Digital Presence' },
    { week: 10, pending: true, title: 'Operations, Scaling & Team Building' },
    { week: 11, pending: true, title: 'Financial Management & Tax Strategy' },
    { week: 12, pending: true, title: 'Funding Readiness Assessment & Next Steps' },
  ],
};
