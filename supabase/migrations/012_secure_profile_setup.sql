-- Fix: Policy 1 (onboarding) did not lock elo, allowing users to set arbitrary elo values.
-- Solution: (a) add elo check to Policy 1, (b) create a secure RPC for profile setup.

-- 1. Tighten Policy 1 to also lock elo
drop policy "profiles: user can set up profile" on public.profiles;
create policy "profiles: user can set up profile"
  on public.profiles for update
  using  (auth.uid() = id and username is null)
  with check (
    auth.uid() = id
    and elo             is not distinct from (select elo             from public.profiles where id = auth.uid())
    and wins            is not distinct from (select wins            from public.profiles where id = auth.uid())
    and losses          is not distinct from (select losses          from public.profiles where id = auth.uid())
    and friend_code     is not distinct from (select friend_code     from public.profiles where id = auth.uid())
  );

-- 2. Secure RPC for onboarding — sets elo server-side based on level choice
create or replace function public.setup_profile(
  p_username text,
  p_level    text,
  p_country  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_elo int;
begin
  -- Validate level
  if p_level not in ('beginner', 'intermediate') then
    raise exception 'Invalid level: must be beginner or intermediate';
  end if;

  -- Map level to elo
  if p_level = 'beginner' then
    v_elo := 600;
  else
    v_elo := 1200;
  end if;

  -- Only allow setup when username is not yet set (onboarding)
  update public.profiles
  set username = p_username,
      elo      = v_elo,
      country  = p_country
  where id = auth.uid()
    and username is null;

  if not found then
    raise exception 'Profile already set up or user not found';
  end if;
end;
$$;
