-- ============================================================================
--  Allow admins to DELETE submission rows (reset a student test to blank).
--  Run once in Supabase → SQL Editor → New query → paste → Run.
--  Safe to re-run.
-- ============================================================================

drop policy if exists "submissions admin delete" on public.submissions;
create policy "submissions admin delete" on public.submissions
  for delete
  using (public.current_user_role() = 'admin');
