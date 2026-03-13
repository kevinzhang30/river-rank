-- Fix: migration 008 allowed users to update ANY column (elo, wins, etc.)
-- We need two policies:
--   1. Initial profile setup (when username is NULL) — can set username, elo, country
--   2. Username change (when username already set) — can only change username + username_changed_at

drop policy if exists "profiles: user can update own profile" on public.profiles;
drop policy if exists "profiles: user can update own username" on public.profiles;

-- Policy 1: First-time onboarding (username not yet set)
create policy "profiles: user can set up profile"
  on public.profiles for update
  using  (auth.uid() = id and username is null)
  with check (
    auth.uid() = id
    and wins            is not distinct from (select wins            from public.profiles where id = auth.uid())
    and losses          is not distinct from (select losses          from public.profiles where id = auth.uid())
    and friend_code     is not distinct from (select friend_code     from public.profiles where id = auth.uid())
    and tournament_wins is not distinct from (select tournament_wins from public.profiles where id = auth.uid())
  );

-- Policy 2: Subsequent username changes (username already set)
create policy "profiles: user can change username"
  on public.profiles for update
  using  (auth.uid() = id and username is not null)
  with check (
    auth.uid() = id
    and elo             is not distinct from (select elo             from public.profiles where id = auth.uid())
    and wins            is not distinct from (select wins            from public.profiles where id = auth.uid())
    and losses          is not distinct from (select losses          from public.profiles where id = auth.uid())
    and country         is not distinct from (select country         from public.profiles where id = auth.uid())
    and friend_code     is not distinct from (select friend_code     from public.profiles where id = auth.uid())
    and tournament_wins is not distinct from (select tournament_wins from public.profiles where id = auth.uid())
  );
