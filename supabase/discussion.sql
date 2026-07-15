-- ============================================================================
--  UMOF Learning Portal — CLASS DISCUSSION BOARD
--  Run AFTER schema.sql (Supabase → SQL Editor → New query → Run). Safe to re-run.
--  Adds a shared, real-time class feed where students post their Discussion Post
--  answers, ask questions, and reply to one another; the instructor can join in.
--
--  Security model:
--    • Any signed-in user can READ the whole board (so classmates see each other).
--    • A signed-in user can POST only as themselves (author_id = their uid).
--    • Author name/role are stamped SERVER-SIDE by a trigger, so they can't be
--      spoofed (a student can't post as "Instructor" or under another name).
--    • Authors can delete their own posts; admins can delete anyone's (moderation).
--  Realtime: the table is added to the supabase_realtime publication so new
--  posts appear instantly for everyone in the class.
-- ============================================================================

create table if not exists public.discussion_posts (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid references public.profiles(id) on delete set null,
  -- Denormalized so classmates can see who wrote a post without reading each
  -- other's profiles row (blocked by RLS). Set authoritatively by the trigger.
  author_name text not null default 'Student',
  author_role text not null default 'student',
  body        text not null check (char_length(body) between 1 and 4000),
  -- Null = top-level post; set for replies (see discussion-replies.sql).
  parent_id   uuid references public.discussion_posts(id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.discussion_posts enable row level security;

-- Stamp author identity from the server on insert (prevents name/role spoofing).
create or replace function public.discussion_set_author()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.author_id := auth.uid();
  select coalesce(nullif(p.name, ''), 'Student'), coalesce(p.role, 'student')
    into new.author_name, new.author_role
    from public.profiles p
    where p.id = auth.uid();
  if new.author_name is null then new.author_name := 'Student'; end if;
  if new.author_role is null then new.author_role := 'student'; end if;
  return new;
end; $$;
drop trigger if exists on_discussion_insert on public.discussion_posts;
create trigger on_discussion_insert
  before insert on public.discussion_posts
  for each row execute function public.discussion_set_author();

-- Policies
drop policy if exists "discussion read"        on public.discussion_posts;
drop policy if exists "discussion insert own"  on public.discussion_posts;
drop policy if exists "discussion delete own"  on public.discussion_posts;
create policy "discussion read" on public.discussion_posts for select
  using (auth.uid() is not null);
create policy "discussion insert own" on public.discussion_posts for insert
  with check (author_id = auth.uid());
create policy "discussion delete own" on public.discussion_posts for delete
  using (author_id = auth.uid() or public.current_user_role() = 'admin');

create index if not exists idx_discussion_created on public.discussion_posts(created_at);
create index if not exists idx_discussion_parent on public.discussion_posts(parent_id, created_at);

-- Live updates so new posts appear instantly for the whole class.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'discussion_posts'
  ) then
    alter publication supabase_realtime add table public.discussion_posts;
  end if;
end $$;
