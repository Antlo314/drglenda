-- ============================================================================
--  FAILSAFE ARCHIVE — student answers & grades never disappear for good
--  ----------------------------------------------------------------------------
--  Run once (Supabase → SQL Editor → paste → Run). Safe to re-run.
--
--  What this does:
--    • Append-only history of every submissions INSERT / UPDATE / DELETE
--    • Same for discussion_posts (board answers)
--    • Archives keep rows even if the live row or profile is deleted
--      (no ON DELETE CASCADE from profiles/quizzes)
--    • Admins can SELECT archives and restore a submission snapshot via RPC
--
--  Students never write to archives directly — DB triggers only.
-- ============================================================================

-- ── 1) SUBMISSION ARCHIVE (tests, Why section, discussion grades, etc.) ─────
create table if not exists public.submission_archive (
  archive_id       bigserial primary key,
  archived_at      timestamptz not null default now(),
  event            text not null check (event in ('insert', 'update', 'delete')),
  -- Who triggered the change (student or admin), when available
  actor_id         uuid,
  -- Snapshot fields (denormalized so restore works without joins)
  submission_id    uuid,
  profile_id       uuid,
  quiz_id          text,
  type             text,
  status           text,
  score            int,
  total            int,
  correct          int,
  answer           text,
  answers          jsonb,
  feedback         text,
  grade_derivation text,
  question_scores  jsonb,
  scoring_method   text,
  graded_by        text,
  submitted_at     timestamptz,
  graded_at        timestamptz,
  -- Full row as JSON for forward-compat if columns are added later
  row_payload      jsonb not null default '{}'::jsonb
);

create index if not exists idx_sub_arch_profile
  on public.submission_archive (profile_id, archived_at desc);
create index if not exists idx_sub_arch_quiz
  on public.submission_archive (quiz_id, archived_at desc);
create index if not exists idx_sub_arch_submission
  on public.submission_archive (submission_id, archived_at desc);

comment on table public.submission_archive is
  'Immutable history of student test/assignment answers. Written only by triggers.';

alter table public.submission_archive enable row level security;

drop policy if exists "submission_archive admin read" on public.submission_archive;
drop policy if exists "submission_archive student read own" on public.submission_archive;
-- Admins can audit/restore; students can see their own backup history (read-only).
create policy "submission_archive admin read" on public.submission_archive
  for select using (public.current_user_role() = 'admin');
create policy "submission_archive student read own" on public.submission_archive
  for select using (profile_id = auth.uid());
-- No insert/update/delete policies for clients — only SECURITY DEFINER triggers write.

create or replace function public.archive_submission_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event text;
  r public.submissions%rowtype;
begin
  if tg_op = 'DELETE' then
    v_event := 'delete';
    r := old;
  elsif tg_op = 'UPDATE' then
    v_event := 'update';
    r := new;
  else
    v_event := 'insert';
    r := new;
  end if;

  insert into public.submission_archive (
    event, actor_id,
    submission_id, profile_id, quiz_id, type, status,
    score, total, correct, answer, answers, feedback,
    grade_derivation, question_scores, scoring_method, graded_by,
    submitted_at, graded_at, row_payload
  ) values (
    v_event,
    auth.uid(),
    r.id, r.profile_id, r.quiz_id, r.type, r.status,
    r.score, r.total, r.correct, r.answer, r.answers, r.feedback,
    r.grade_derivation, r.question_scores, r.scoring_method, r.graded_by,
    r.submitted_at, r.graded_at,
    to_jsonb(r)
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_submissions_archive_ins on public.submissions;
drop trigger if exists trg_submissions_archive_upd on public.submissions;
drop trigger if exists trg_submissions_archive_del on public.submissions;

create trigger trg_submissions_archive_ins
  after insert on public.submissions
  for each row execute function public.archive_submission_row();

create trigger trg_submissions_archive_upd
  after update on public.submissions
  for each row execute function public.archive_submission_row();

-- BEFORE DELETE so the row still exists for the snapshot
create trigger trg_submissions_archive_del
  before delete on public.submissions
  for each row execute function public.archive_submission_row();

-- ── 2) DISCUSSION POST ARCHIVE ──────────────────────────────────────────────
create table if not exists public.discussion_post_archive (
  archive_id   bigserial primary key,
  archived_at  timestamptz not null default now(),
  event        text not null check (event in ('insert', 'update', 'delete')),
  actor_id     uuid,
  post_id      uuid,
  author_id    uuid,
  author_name  text,
  author_role  text,
  body         text,
  parent_id    uuid,
  week         int,
  created_at   timestamptz,
  row_payload  jsonb not null default '{}'::jsonb
);

create index if not exists idx_disc_arch_author
  on public.discussion_post_archive (author_id, archived_at desc);
create index if not exists idx_disc_arch_week
  on public.discussion_post_archive (week, archived_at desc);

comment on table public.discussion_post_archive is
  'Immutable history of discussion posts/replies. Written only by triggers.';

alter table public.discussion_post_archive enable row level security;

drop policy if exists "discussion_post_archive admin read" on public.discussion_post_archive;
drop policy if exists "discussion_post_archive student read own" on public.discussion_post_archive;
create policy "discussion_post_archive admin read" on public.discussion_post_archive
  for select using (public.current_user_role() = 'admin');
create policy "discussion_post_archive student read own" on public.discussion_post_archive
  for select using (author_id = auth.uid());

create or replace function public.archive_discussion_post_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event text;
  r public.discussion_posts%rowtype;
begin
  if tg_op = 'DELETE' then
    v_event := 'delete';
    r := old;
  elsif tg_op = 'UPDATE' then
    v_event := 'update';
    r := new;
  else
    v_event := 'insert';
    r := new;
  end if;

  insert into public.discussion_post_archive (
    event, actor_id,
    post_id, author_id, author_name, author_role,
    body, parent_id, week, created_at, row_payload
  ) values (
    v_event,
    auth.uid(),
    r.id, r.author_id, r.author_name, r.author_role,
    r.body, r.parent_id, r.week, r.created_at,
    to_jsonb(r)
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_discussion_archive_ins on public.discussion_posts;
drop trigger if exists trg_discussion_archive_upd on public.discussion_posts;
drop trigger if exists trg_discussion_archive_del on public.discussion_posts;

create trigger trg_discussion_archive_ins
  after insert on public.discussion_posts
  for each row execute function public.archive_discussion_post_row();

create trigger trg_discussion_archive_upd
  after update on public.discussion_posts
  for each row execute function public.archive_discussion_post_row();

create trigger trg_discussion_archive_del
  before delete on public.discussion_posts
  for each row execute function public.archive_discussion_post_row();

-- ── 3) ONE-TIME BACKFILL of current live data ───────────────────────────────
-- So anything already in the DB is protected going forward even if never edited.
insert into public.submission_archive (
  event, actor_id,
  submission_id, profile_id, quiz_id, type, status,
  score, total, correct, answer, answers, feedback,
  grade_derivation, question_scores, scoring_method, graded_by,
  submitted_at, graded_at, row_payload
)
select
  'insert',
  null,
  s.id, s.profile_id, s.quiz_id, s.type, s.status,
  s.score, s.total, s.correct, s.answer, s.answers, s.feedback,
  s.grade_derivation, s.question_scores, s.scoring_method, s.graded_by,
  s.submitted_at, s.graded_at,
  to_jsonb(s)
from public.submissions s
where not exists (
  select 1 from public.submission_archive a
  where a.submission_id = s.id and a.event = 'insert'
);

insert into public.discussion_post_archive (
  event, actor_id,
  post_id, author_id, author_name, author_role,
  body, parent_id, week, created_at, row_payload
)
select
  'insert',
  null,
  d.id, d.author_id, d.author_name, d.author_role,
  d.body, d.parent_id, d.week, d.created_at,
  to_jsonb(d)
from public.discussion_posts d
where not exists (
  select 1 from public.discussion_post_archive a
  where a.post_id = d.id and a.event = 'insert'
);

-- ── 4) ADMIN RESTORE RPC ────────────────────────────────────────────────────
-- Restore a submission snapshot into live `submissions` (upsert by profile+quiz).
-- Only admins. Does not remove archive history.
create or replace function public.restore_submission_from_archive(p_archive_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.submission_archive%rowtype;
  restored_id uuid;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only admins can restore submissions';
  end if;

  select * into a from public.submission_archive where archive_id = p_archive_id;
  if not found then
    raise exception 'Archive row % not found', p_archive_id;
  end if;
  if a.profile_id is null or a.quiz_id is null then
    raise exception 'Archive row missing profile_id or quiz_id';
  end if;
  -- Quiz must still exist (FK). If deleted, re-create quizzes first.
  if not exists (select 1 from public.quizzes where id = a.quiz_id) then
    raise exception 'Quiz % missing — restore or re-seed the quiz first', a.quiz_id;
  end if;
  if not exists (select 1 from public.profiles where id = a.profile_id) then
    raise exception 'Profile % missing — student account must exist', a.profile_id;
  end if;

  insert into public.submissions (
    id, profile_id, quiz_id, type, status,
    score, total, correct, answer, answers, feedback,
    grade_derivation, question_scores, scoring_method, graded_by,
    submitted_at, graded_at
  ) values (
    coalesce(a.submission_id, gen_random_uuid()),
    a.profile_id, a.quiz_id,
    coalesce(a.type, 'manual'),
    coalesce(a.status, 'submitted'),
    a.score, a.total, a.correct, a.answer, a.answers, a.feedback,
    a.grade_derivation, a.question_scores, a.scoring_method, a.graded_by,
    coalesce(a.submitted_at, now()), a.graded_at
  )
  on conflict (profile_id, quiz_id) do update set
    type = excluded.type,
    status = excluded.status,
    score = excluded.score,
    total = excluded.total,
    correct = excluded.correct,
    answer = excluded.answer,
    answers = excluded.answers,
    feedback = excluded.feedback,
    grade_derivation = excluded.grade_derivation,
    question_scores = excluded.question_scores,
    scoring_method = excluded.scoring_method,
    graded_by = excluded.graded_by,
    submitted_at = excluded.submitted_at,
    graded_at = excluded.graded_at
  returning id into restored_id;

  return jsonb_build_object(
    'ok', true,
    'submission_id', restored_id,
    'profile_id', a.profile_id,
    'quiz_id', a.quiz_id,
    'restored_from_archive_id', p_archive_id
  );
end;
$$;

revoke all on function public.restore_submission_from_archive(bigint) from public;
grant execute on function public.restore_submission_from_archive(bigint) to authenticated;

-- ── 5) Sanity checks ────────────────────────────────────────────────────────
select
  (select count(*) from public.submission_archive) as submission_archive_rows,
  (select count(*) from public.discussion_post_archive) as discussion_archive_rows,
  (select count(*) from public.submissions) as live_submissions,
  (select count(*) from public.discussion_posts) as live_discussion_posts;

-- Example restore (admin only), after looking up archive_id:
--   select * from public.submission_archive
--   where profile_id = '…' and quiz_id = 'qw1'
--   order by archived_at desc limit 20;
--   select public.restore_submission_from_archive(12345);
