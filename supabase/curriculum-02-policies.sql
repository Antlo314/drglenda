-- STEP 2 of 3: RLS policies only (run AFTER step 1 succeeds)
-- Supabase SQL Editor -> New query -> paste this entire file -> Run
-- Requires public.current_user_role() from schema.sql (already on your project)

drop policy if exists "curriculum read" on public.curriculum;
drop policy if exists "curriculum admin write" on public.curriculum;
create policy "curriculum read" on public.curriculum for select using (auth.uid() is not null);
create policy "curriculum admin write" on public.curriculum for all using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
