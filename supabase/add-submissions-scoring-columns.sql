alter table public.submissions add column if not exists grade_derivation text;
alter table public.submissions add column if not exists question_scores jsonb;
alter table public.submissions add column if not exists scoring_method text;
alter table public.submissions add column if not exists graded_by text;
drop policy if exists "submissions admin insert" on public.submissions;
create policy "submissions admin insert" on public.submissions for insert with check (public.current_user_role() = 'admin');
