-- ============================================================================
--  Prevent students from self-promoting to admin via profiles self-update.
--  Only an existing admin (or this security-definer path) may change `role`.
--  Safe to re-run.
-- ============================================================================

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and public.current_user_role() is distinct from 'admin' then
    raise exception 'Only admins can change a profile role';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role
  before update on public.profiles
  for each row execute function public.protect_profile_role();
