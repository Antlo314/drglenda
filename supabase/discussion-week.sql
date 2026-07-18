-- ============================================================================
--  Tag discussion posts with a curriculum week number (for week-by-week boards).
--  Run once in Supabase SQL Editor. Safe to re-run.
-- ============================================================================

alter table public.discussion_posts
  add column if not exists week int;

create index if not exists idx_discussion_week
  on public.discussion_posts(week, created_at);
