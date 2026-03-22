-- ─── 4 premium emotes (early-adopter / future store) ─────────────────────────
insert into public.emotes (id, name, image_url, asset_type, tier, sort_order) values
  ('mewing',        'Mewing',        '/emotes/mewing-emote.png',        'static', 'premium', 10),
  ('patrick-spade', 'Patrick Spade', '/emotes/patrick-spade-emote.png', 'static', 'premium', 11),
  ('rage-baited',   'Rage Baited',   '/emotes/rage-baited-emote.png',   'static', 'premium', 12),
  ('speed',         'Speed',         '/emotes/speed-emote.png',         'static', 'premium', 13)
on conflict (id) do nothing;

-- ─── Tracking table: first 100 non-bot users to claim ────────────────────────
create table if not exists public.early_adopter_claims (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now()
);
alter table public.early_adopter_claims enable row level security;

-- ─── Claim function (called by backend on login) ────────────────────────────
create or replace function public.claim_early_adopter_emotes(p_user_id uuid)
returns text -- 'claimed', 'already_claimed', 'limit_reached', 'not_eligible'
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_count int;
begin
  -- Service-role guard
  if auth.role() <> 'service_role' then
    raise exception 'unauthorized';
  end if;

  -- Skip bots
  if exists (select 1 from public.profiles where id = p_user_id and is_bot) then
    return 'not_eligible';
  end if;

  -- Quick check before acquiring lock (avoids lock contention for repeat logins)
  if exists (select 1 from public.early_adopter_claims where user_id = p_user_id) then
    return 'already_claimed';
  end if;

  -- Serialize claim attempts so count + insert is atomic
  perform pg_advisory_xact_lock(2147483001);

  -- Re-check after lock (another connection may have claimed in the meantime)
  if exists (select 1 from public.early_adopter_claims where user_id = p_user_id) then
    return 'already_claimed';
  end if;

  select count(*) into v_claim_count from public.early_adopter_claims;

  if v_claim_count >= 100 then
    return 'limit_reached';
  end if;

  -- Claim slot
  insert into public.early_adopter_claims (user_id) values (p_user_id);

  -- Grant the 4 emotes
  insert into public.user_emotes (user_id, emote_id)
  select p_user_id, e.id from public.emotes e
  where e.id in ('mewing', 'patrick-spade', 'rage-baited', 'speed')
  on conflict do nothing;

  -- Congrats notification
  insert into public.notifications (user_id, type, data)
  values (p_user_id, 'early_adopter', jsonb_build_object(
    'emote_names', jsonb_build_array('Mewing', 'Patrick Spade', 'Rage Baited', 'Speed'),
    'message',     'You''re one of the first 100 players! Enjoy 4 exclusive emotes.'
  ));

  return 'claimed';
end;
$$;

-- ─── Admin backdoor: manually grant any emote to any user ────────────────────
create or replace function public.admin_grant_emote(p_user_id uuid, p_emote_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'unauthorized';
  end if;
  insert into public.user_emotes (user_id, emote_id)
  values (p_user_id, p_emote_id)
  on conflict do nothing;
end;
$$;

-- Lock down admin function — only service_role can execute
revoke all on function public.admin_grant_emote(uuid, text) from public;
revoke all on function public.admin_grant_emote(uuid, text) from anon;
revoke all on function public.admin_grant_emote(uuid, text) from authenticated;

-- ─── Broadcast announcement to all existing non-bot users ────────────────────
insert into public.notifications (user_id, type, data)
select p.id, 'announcement', jsonb_build_object(
  'title',   'New Emotes!',
  'message', 'Be one of the first 100 players to log in and claim 4 exclusive emotes for free!'
)
from public.profiles p
where p.is_bot = false;
