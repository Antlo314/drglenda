-- ============================================================================
--  UMOF Learning Portal — Hand admin over to info@umof.org, remove founder login
--  Run once (Supabase → SQL Editor → New query → paste → Run). Safe to re-run.
--
--  Effect:
--    • info@umof.org becomes THE admin (and stays admin-by-default on re-signup).
--    • The bootstrap founder login (iamwhoiambook@gmail.com) is deleted entirely —
--      profile, notes, and submissions cascade away via the auth.users FK.
--
--  IMPORTANT precondition:
--    info@umof.org must have ALREADY signed up (so a profiles row exists). If it
--    hasn't, sign up with info@umof.org first — the admin allowlist makes it an
--    admin automatically — THEN run this. Step 3 aborts rather than delete your
--    last admin, so you can never lock yourself out.
-- ============================================================================

-- 1) Make info@umof.org the admin. (No-op if it hasn't signed up yet.)
update public.profiles
set role = 'admin'
where lower(email) = 'info@umof.org';

-- 2) Keep it admin-by-default if it ever re-signs up.
insert into public.admin_emails (email) values ('info@umof.org')
on conflict (email) do nothing;

-- 3) Safety guard — refuse to continue unless an admin OTHER THAN the founder
--    login already exists, so we never delete the last admin.
do $$
begin
  if not exists (
    select 1 from public.profiles
    where role = 'admin' and lower(email) <> 'iamwhoiambook@gmail.com'
  ) then
    raise exception
      'Abort: no admin other than iamwhoiambook@gmail.com exists. Sign up / promote info@umof.org first.';
  end if;
end $$;

-- 4) Delete the founder's personal login entirely (cascades to profile + data).
delete from auth.users
where lower(email) = 'iamwhoiambook@gmail.com';

-- 5) Confirm the final state.
select email, role from public.profiles order by role, email;
