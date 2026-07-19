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
      // Action plan (syllabus checklist) — graded tests live under My Tests, not here
      quiz: [
        'Write your full “Why” reflection (use the Week 1 Why section under My Tests).',
        'Identify your target market in one clear paragraph.',
        'List short-term (90-day) and long-term (1–3 year) business goals.',
        'Draft a business vision statement and a personal vision statement.',
        'Complete a self-assessment of entrepreneurial readiness.',
        'Submit your one-page Business Vision Plan.',
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
      // Action plan checklist (not the multiple-choice My Tests questions)
      quiz: [
        'Decide your entity type (sole prop, LLC, corporation, etc.) and write why it fits.',
        'Confirm or file your state business registration.',
        'Obtain or verify your EIN with the IRS.',
        'Open (or schedule) a dedicated business bank account.',
        'List licenses, permits, and renewal dates for your industry/location.',
        'Complete the one-page Business Structure Plan assignment.',
      ],
    },

    // ── Weeks 3–12: pending — action plan ready for admin to fill ──
    { week: 3,  pending: true, title: 'Business Credit & Financial Identity', quiz: [] },
    { week: 4,  pending: true, title: 'Bookkeeping, Financials & Cash Flow', quiz: [] },
    { week: 5,  pending: true, title: 'Building a Fundable Business Plan', quiz: [] },
    { week: 6,  pending: true, title: 'Grants, Loans & Investor Capital', quiz: [] },
    { week: 7,  pending: true, title: 'The Funding Pitch & Lender Relationships', quiz: [] },
    { week: 8,  pending: true, title: 'Government Contracting & Procurement', quiz: [] },
    { week: 9,  pending: true, title: 'Marketing, Branding & Digital Presence', quiz: [] },
    { week: 10, pending: true, title: 'Operations, Scaling & Team Building', quiz: [] },
    { week: 11, pending: true, title: 'Financial Management & Tax Strategy', quiz: [] },
    { week: 12, pending: true, title: 'Funding Readiness Assessment & Next Steps', quiz: [] },
  ],
};
