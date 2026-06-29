-- ============================================================================
--  UMOF Learning Portal — First-admin bootstrap
--  Run once (Supabase → SQL Editor → New query → paste → Run).
--
--  Replaces the new-user trigger so that the FIRST account created becomes the
--  admin automatically; everyone who signs up after is a student. This lets you
--  create your admin login from the portal's own Sign-up screen — no dashboard
--  or manual SQL needed.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_count int;
begin
  -- count existing admins (runs as definer, so RLS doesn't hide rows)
  select count(*) into admin_count from public.profiles where role = 'admin';

  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    new.email,
    case when admin_count = 0 then 'admin' else 'student' end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- (Trigger on_auth_user_created from schema.sql already calls this function.)

-- Optional: if you ever need to (re)appoint an admin by email, run:
--   update public.profiles set role = 'admin' where email = 'someone@example.com';
