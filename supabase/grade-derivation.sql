-- ============================================================================
--  Grade derivation fields for lender-ready documentation
--  Run in Supabase SQL Editor after the base schema.
--  Safe to re-run (IF NOT EXISTS / nullable columns).
-- ============================================================================
-- Stores how the instructor (or auto-scorer) arrived at each final score so
-- UMOF can produce transparent packets for lenders / underwriting.

alter table public.submissions
  add column if not exists grade_derivation text,
  add column if not exists question_scores jsonb,
  add column if not exists scoring_method text,
  add column if not exists graded_by text;

comment on column public.submissions.grade_derivation is
  'Instructor or system explanation of how the final score was determined (lender-facing).';
comment on column public.submissions.question_scores is
  'Optional map of criterion_id (or question_id) → points. Rubric keys: completed, understanding, reflection, organization, grammar (each /20).';
comment on column public.submissions.scoring_method is
  'auto | rubric | per_question | instructor — how the score was produced.';
comment on column public.submissions.graded_by is
  'Display name of the instructor/admin who last saved the grade.';
