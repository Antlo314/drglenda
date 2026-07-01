-- ============================================================================
--  UMOF Learning Portal — LIVE CLASSES (Google Meet launcher)
--  Run AFTER schema.sql (Supabase → SQL Editor → New query → Run). Safe to re-run.
--
--  Adds a per-session Google Meet link + scheduled time. Enrolled students see a
--  "Join Live Class" button on that session; the call opens in Google Meet
--  (a separate tab) where the instructor runs it. The link is readable only by
--  logged-in users (existing "sessions read" policy), so it isn't public.
-- ============================================================================

alter table public.sessions add column if not exists meet_url text;
alter table public.sessions add column if not exists live_at  timestamptz;

-- Reads/writes are already governed by the existing session policies:
--   "sessions read"        -> any logged-in user can read (see the link)
--   "sessions admin write" -> only admins can set meet_url / live_at
