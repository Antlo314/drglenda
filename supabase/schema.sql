-- ============================================================================
--  UMOF Learning Portal — Supabase schema + Row-Level Security
--  Run once in your project: Supabase Dashboard → SQL Editor → New query → Run.
--  Safe to re-run (idempotent where practical).
-- ============================================================================

-- ── 1. PROFILES — one row per auth user, holds role (student/admin) ─────────
create table if not exists public.profiles (
  id        uuid primary key references auth.users(id) on delete cascade,
  role      text not null default 'student' check (role in ('student','admin')),
  name      text not null default '',
  email     text not null default '',
  phone     text default '',
  title     text default '',        -- admins (e.g. "Founder & Lead Instructor")
  cohort    text default '',        -- students (e.g. "Summer 2026")
  enrolled  date,
  plan      text default ''
);
alter table public.profiles enable row level security;

-- Returns the calling user's role WITHOUT triggering RLS recursion on profiles.
create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

drop policy if exists "profiles read"  on public.profiles;
drop policy if exists "profiles self update" on public.profiles;
drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles read" on public.profiles for select
  using (id = auth.uid() or public.current_user_role() = 'admin');
create policy "profiles self update" on public.profiles for update
  using (id = auth.uid());
create policy "profiles admin update" on public.profiles for update
  using (public.current_user_role() = 'admin');

-- Auto-create a profile row whenever someone signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''), new.email)
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ── 2. SESSIONS — class recordings + notes (course content) ────────────────
create table if not exists public.sessions (
  id           text primary key,
  week         int  not null,
  title        text not null,
  date         date,
  duration_min int,
  thumb        text,
  video_url    text,
  summary      text,
  notes        jsonb default '[]'::jsonb
);
alter table public.sessions enable row level security;
drop policy if exists "sessions read" on public.sessions;
drop policy if exists "sessions admin write" on public.sessions;
create policy "sessions read" on public.sessions for select
  using (auth.uid() is not null);
create policy "sessions admin write" on public.sessions for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ── 3. QUIZZES — auto quizzes + manual assignments ─────────────────────────
create table if not exists public.quizzes (
  id         text primary key,
  session_id text references public.sessions(id) on delete set null,
  type       text not null check (type in ('auto','manual')),
  title      text not null,
  max_score  int default 100,
  prompt     text,
  questions  jsonb default '[]'::jsonb,  -- auto: [{id,prompt,options[],correctIndex}]
                                          -- written: [{id,prompt}] (free response)
  published  boolean not null default false,  -- false until an admin sets it "live"
  due_date   date                             -- optional deadline shown to students
);
-- for existing databases created before these columns were added:
alter table public.quizzes add column if not exists published boolean not null default false;
alter table public.quizzes add column if not exists due_date date;
alter table public.quizzes enable row level security;
drop policy if exists "quizzes read" on public.quizzes;
drop policy if exists "quizzes admin write" on public.quizzes;
create policy "quizzes read" on public.quizzes for select
  using (auth.uid() is not null);
create policy "quizzes admin write" on public.quizzes for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ── 4. SESSION COMPLETIONS — which sessions a student finished ─────────────
create table if not exists public.session_completions (
  profile_id   uuid references public.profiles(id) on delete cascade,
  session_id   text references public.sessions(id) on delete cascade,
  completed_at timestamptz default now(),
  primary key (profile_id, session_id)
);
alter table public.session_completions enable row level security;
drop policy if exists "completions own" on public.session_completions;
drop policy if exists "completions admin read" on public.session_completions;
create policy "completions own" on public.session_completions for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "completions admin read" on public.session_completions for select
  using (public.current_user_role() = 'admin');

-- ── 5. SUBMISSIONS — quiz attempts + assignment submissions ────────────────
create table if not exists public.submissions (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid references public.profiles(id) on delete cascade,
  quiz_id      text references public.quizzes(id) on delete cascade,
  type         text not null check (type in ('auto','manual')),
  status       text not null default 'submitted' check (status in ('submitted','graded')),
  score        int,
  total        int,
  correct      int,
  answer       text,
  answers      jsonb,
  feedback     text,
  -- Optional grade documentation (Grading Breakdown / scoring metadata):
  grade_derivation text,          -- written rationale / formula
  question_scores  jsonb,         -- optional { criterionId|questionId: points }
  scoring_method   text,          -- 'auto' | 'rubric' | 'per_question' | 'instructor'
  graded_by        text,          -- instructor display name at last grade save
  submitted_at timestamptz default now(),
  graded_at    timestamptz,
  unique (profile_id, quiz_id)
);
-- for databases created before grade-derivation columns existed:
alter table public.submissions add column if not exists grade_derivation text;
alter table public.submissions add column if not exists question_scores jsonb;
alter table public.submissions add column if not exists scoring_method text;
alter table public.submissions add column if not exists graded_by text;
alter table public.submissions enable row level security;
drop policy if exists "submissions read" on public.submissions;
drop policy if exists "submissions student write" on public.submissions;
drop policy if exists "submissions student update" on public.submissions;
drop policy if exists "submissions admin grade" on public.submissions;
create policy "submissions read" on public.submissions for select
  using (profile_id = auth.uid() or public.current_user_role() = 'admin');
-- Students insert own work; auto quizzes may upsert as graded.
create policy "submissions student write" on public.submissions for insert
  with check (
    profile_id = auth.uid()
    and (status = 'submitted' or (status = 'graded' and type = 'auto'))
  );
-- Students may update only while awaiting review (cannot wipe a graded row).
create policy "submissions student update" on public.submissions for update
  using (profile_id = auth.uid() and status = 'submitted')
  with check (
    profile_id = auth.uid()
    and (status = 'submitted' or (status = 'graded' and type = 'auto'))
  );
create policy "submissions admin grade" on public.submissions for update
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
drop policy if exists "submissions admin insert" on public.submissions;
create policy "submissions admin insert" on public.submissions for insert
  with check (public.current_user_role() = 'admin');

-- ── 6. LEADS — CRM prospects (admin-only) ──────────────────────────────────
create table if not exists public.leads (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text,
  phone      text,
  source     text,
  interest   text,
  status     text default 'new' check (status in ('new','contacted','qualified','enrolled','lost')),
  created_at date default current_date,
  notes      text
);
alter table public.leads enable row level security;
drop policy if exists "leads admin all" on public.leads;
create policy "leads admin all" on public.leads for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
-- To let your PUBLIC marketing form create leads directly, you could add:
--   create policy "leads anon insert" on public.leads for insert to anon with check (true);
-- (Or, safer, capture website leads through an Edge Function using the service role.)

-- ── Helpful indexes ────────────────────────────────────────────────────────
create index if not exists idx_submissions_profile on public.submissions(profile_id);
create index if not exists idx_submissions_status  on public.submissions(status);
create index if not exists idx_completions_profile on public.session_completions(profile_id);
create index if not exists idx_leads_status        on public.leads(status);
