-- ============================================================================
--  UMOF Learning Portal — DISCUSSION THREAD REPLIES
--  Run AFTER discussion.sql (Supabase → SQL Editor → Run). Safe to re-run.
--  Adds parent_id so students can reply to a classmate’s post (one level deep
--  in the app; deeper nests collapse to the root parent client-side).
-- ============================================================================

alter table public.discussion_posts
  add column if not exists parent_id uuid references public.discussion_posts(id) on delete cascade;

create index if not exists idx_discussion_parent
  on public.discussion_posts(parent_id, created_at);

-- Optional: prevent a post from parenting itself (defense in depth).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'discussion_posts_parent_not_self'
  ) then
    alter table public.discussion_posts
      add constraint discussion_posts_parent_not_self
      check (parent_id is null or parent_id <> id);
  end if;
end $$;
