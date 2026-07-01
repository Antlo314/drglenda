/* =============================================================================
   UMOF Learning Portal — Course curriculum (syllabus)
   -----------------------------------------------------------------------------
   The official 12-week syllabus for "The Entrepreneur's Journey: Funding
   Masterclass." This is the course OUTLINE (objectives, steps, assignment,
   discussion prompt, weekly quiz) — distinct from `sessions` in data.js, which
   are the recorded class videos + notes. Rendered read-only behind the login
   for both students and admins (see curriculumView in app.js).

   To publish a week, fill in its fields and remove `pending: true`.
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
      quiz: [
        'What is a growth mindset?',
        'Why is goal setting important in business?',
        'What is the purpose of a business vision statement?',
        'Name two characteristics of successful entrepreneurs.',
        'What is entrepreneurial readiness?',
      ],
    },

    // Weeks are published one at a time as the class progresses. To add the next
    // week, append a fully-filled object here (same shape as Week 1 above).
    // No placeholders — only live weeks appear in the portal.
  ],
};
