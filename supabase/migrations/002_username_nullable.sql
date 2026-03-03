-- Allow username to be NULL (set during onboarding)
alter table public.profiles
  alter column username drop not null;

-- Drop old update policy (allowed any update to own username)
drop policy if exists "profiles: user can update own username" on public.profiles;

-- New policy: user may set their username ONLY if it is currently NULL
-- Prevents username changes after it has been set.
drop policy if exists "profiles: user can set username once" on public.profiles;
create policy "profiles: user can set username once"
  on public.profiles for update
  using  (auth.uid() = id and username is null)
  with check (auth.uid() = id);

-- Update new-user trigger to insert NULL username so onboarding UI takes over
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, username)
  values (new.id, null)
  on conflict (id) do nothing;
  return new;
end;
$$;
