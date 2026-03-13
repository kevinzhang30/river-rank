-- Allow users to change their username (previously restricted to one-time set)
drop policy if exists "profiles: user can set username once" on public.profiles;

create policy "profiles: user can update own profile"
  on public.profiles for update
  using  (auth.uid() = id)
  with check (auth.uid() = id);

-- Track when username was last changed (for 30-day cooldown)
alter table public.profiles add column if not exists username_changed_at timestamptz;
