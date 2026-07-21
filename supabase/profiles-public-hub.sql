-- ============================================================================
--  UMOF Learning Portal — Class profile hub (public-within-class profiles)
--  Run AFTER schema.sql (+ protect-profile-role.sql if not already applied).
--  Safe to re-run (idempotent).
--
--  ALSO create Storage bucket (Dashboard → Storage → New bucket):
--    Name: avatars
--    Public: OFF (private)
--    File size limit: 5 MB
--    Allowed MIME: image/jpeg, image/png, image/webp, image/gif
--  Then run the storage policies section at the bottom (or via Dashboard).
-- ============================================================================

-- ── 1. Profile hub columns ──────────────────────────────────────────────────
alter table public.profiles add column if not exists bio text default '';
alter table public.profiles add column if not exists website_url text default '';
alter table public.profiles add column if not exists linkedin_url text default '';
alter table public.profiles add column if not exists instagram_url text default '';
alter table public.profiles add column if not exists facebook_url text default '';
alter table public.profiles add column if not exists tiktok_url text default '';
alter table public.profiles add column if not exists youtube_url text default '';
alter table public.profiles add column if not exists x_url text default '';
alter table public.profiles add column if not exists avatar_path text default '';
alter table public.profiles add column if not exists profile_updated_at timestamptz;

-- Soft length limit on bio (app also enforces)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_bio_len'
  ) then
    alter table public.profiles
      add constraint profiles_bio_len check (bio is null or char_length(bio) <= 2000);
  end if;
end $$;

-- Optional URL shape (empty or http/https)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_website_url_fmt') then
    alter table public.profiles add constraint profiles_website_url_fmt
      check (website_url is null or website_url = '' or website_url ~* '^https?://');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_linkedin_url_fmt') then
    alter table public.profiles add constraint profiles_linkedin_url_fmt
      check (linkedin_url is null or linkedin_url = '' or linkedin_url ~* '^https?://');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_instagram_url_fmt') then
    alter table public.profiles add constraint profiles_instagram_url_fmt
      check (instagram_url is null or instagram_url = '' or instagram_url ~* '^https?://');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_facebook_url_fmt') then
    alter table public.profiles add constraint profiles_facebook_url_fmt
      check (facebook_url is null or facebook_url = '' or facebook_url ~* '^https?://');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_tiktok_url_fmt') then
    alter table public.profiles add constraint profiles_tiktok_url_fmt
      check (tiktok_url is null or tiktok_url = '' or tiktok_url ~* '^https?://');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_youtube_url_fmt') then
    alter table public.profiles add constraint profiles_youtube_url_fmt
      check (youtube_url is null or youtube_url = '' or youtube_url ~* '^https?://');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_x_url_fmt') then
    alter table public.profiles add constraint profiles_x_url_fmt
      check (x_url is null or x_url = '' or x_url ~* '^https?://');
  end if;
end $$;

-- ── 2. RLS: classmates can read each other's profiles (authenticated only) ──
drop policy if exists "profiles read" on public.profiles;
drop policy if exists "profiles read authenticated" on public.profiles;
create policy "profiles read authenticated" on public.profiles for select
  using (auth.uid() is not null);

-- Keep self + admin update (recreate if missing)
drop policy if exists "profiles self update" on public.profiles;
drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles self update" on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());
create policy "profiles admin update" on public.profiles for update
  using (public.current_user_role() = 'admin');

-- Bump profile_updated_at on content change
create or replace function public.touch_profile_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.profile_updated_at := now();
  return new;
end; $$;
drop trigger if exists on_profiles_touch on public.profiles;
create trigger on_profiles_touch
  before update on public.profiles
  for each row execute function public.touch_profile_updated_at();

-- ── 3. Storage policies for `avatars` bucket ────────────────────────────────
-- Create the bucket first in the Dashboard (private). Then run:

-- insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- values (
--   'avatars', 'avatars', false, 5242880,
--   array['image/jpeg','image/png','image/webp','image/gif']
-- )
-- on conflict (id) do update set
--   public = excluded.public,
--   file_size_limit = excluded.file_size_limit,
--   allowed_mime_types = excluded.allowed_mime_types;

-- Authenticated users can read any class avatar (hub)
drop policy if exists "avatars read auth" on storage.objects;
create policy "avatars read auth" on storage.objects for select
  using (bucket_id = 'avatars' and auth.uid() is not null);

-- Users can upload/update/delete only under their own folder: {uid}/...
drop policy if exists "avatars insert own" on storage.objects;
create policy "avatars insert own" on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars update own" on storage.objects;
create policy "avatars update own" on storage.objects for update
  using (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars delete own" on storage.objects;
create policy "avatars delete own" on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Admins can manage any avatar (moderation)
drop policy if exists "avatars admin all" on storage.objects;
create policy "avatars admin all" on storage.objects for all
  using (bucket_id = 'avatars' and public.current_user_role() = 'admin');
