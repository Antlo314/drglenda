-- ============================================================================
--  UMOF Learning Portal — HARDEN STUDENT SUBMISSIONS
--  Run in Supabase SQL Editor. Safe to re-run.
--
--  Students may insert their own work and update only while status = 'submitted'
--  (e.g. fix a draft resubmit). Once graded, only admins can change the row.
--  This prevents a student upsert from wiping an instructor grade.
-- ============================================================================

drop policy if exists "submissions student write" on public.submissions;
drop policy if exists "submissions student update" on public.submissions;

-- New insert: student owns the row; cannot self-mark as graded with a score game.
create policy "submissions student write" on public.submissions for insert
  with check (
    profile_id = auth.uid()
    and (
      status = 'submitted'
      or (status = 'graded' and type = 'auto')  -- auto quizzes score client-side then upsert graded
    )
  );

-- Update only own rows that are still awaiting instructor review.
-- Graded work is locked for students (admin uses "submissions admin grade").
create policy "submissions student update" on public.submissions for update
  using (
    profile_id = auth.uid()
    and status = 'submitted'
  )
  with check (
    profile_id = auth.uid()
    and status in ('submitted', 'graded')
    and (
      status = 'submitted'
      or (status = 'graded' and type = 'auto')
    )
  );

-- Keep admin policies as defined in schema.sql / fix-submissions-visibility.sql
-- (admin insert + admin grade). Re-assert admin grade if missing:
drop policy if exists "submissions admin grade" on public.submissions;
create policy "submissions admin grade" on public.submissions for update
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists "submissions admin insert" on public.submissions;
create policy "submissions admin insert" on public.submissions for insert
  with check (public.current_user_role() = 'admin');
