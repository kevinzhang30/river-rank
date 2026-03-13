-- Fix: the 008 policy allowed users to update ANY column (elo, wins, etc.)
-- Replace it with a policy that only allows changing username and username_changed_at

drop policy if exists "profiles: user can update own profile" on public.profiles;

create policy "profiles: user can update own username"
  on public.profiles for update
  using  (auth.uid() = id)
  with check (
    auth.uid() = id
    and elo             is not distinct from (select elo             from public.profiles where id = auth.uid())
    and wins            is not distinct from (select wins            from public.profiles where id = auth.uid())
    and losses          is not distinct from (select losses          from public.profiles where id = auth.uid())
    and country         is not distinct from (select country         from public.profiles where id = auth.uid())
    and friend_code     is not distinct from (select friend_code     from public.profiles where id = auth.uid())
    and tournament_wins is not distinct from (select tournament_wins from public.profiles where id = auth.uid())
  );
