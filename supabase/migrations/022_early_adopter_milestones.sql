-- Milestone broadcast notifications for early-adopter emote claims.
-- Triggers at: 25, 50, 75 claimed  |  25 left (75), 10 left (90), 5 left (95)  |  sold out (100)

-- Track which milestones have already been broadcast (idempotency guard)
create table if not exists public.early_adopter_milestones_sent (
  threshold int primary key
);

create or replace function public.claim_early_adopter_emotes(p_user_id uuid)
returns text -- 'claimed', 'already_claimed', 'limit_reached', 'not_eligible'
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_count int;
  v_new_total   int;
  v_message     text;
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

  -- ── Milestone broadcast ──────────────────────────────────────────────────
  v_new_total := v_claim_count + 1;
  v_message := null;

  case v_new_total
    when 25  then v_message := '25 players have claimed exclusive emotes!';
    when 50  then v_message := '50 players have claimed exclusive emotes!';
    when 75  then v_message := '75 players have claimed — only 25 spots left!';
    when 90  then v_message := 'Only 10 spots remaining for exclusive emotes!';
    when 95  then v_message := 'Only 5 spots remaining for exclusive emotes!';
    when 100 then v_message := 'All 100 exclusive emote spots have been claimed!';
    else null;
  end case;

  if v_message is not null then
    -- Only broadcast if this milestone hasn't been sent before
    insert into public.early_adopter_milestones_sent (threshold)
    values (v_new_total)
    on conflict do nothing;

    if found then
      insert into public.notifications (user_id, type, data)
      select p.id, 'announcement', jsonb_build_object('message', v_message)
      from public.profiles p
      where p.is_bot = false;
    end if;
  end if;

  return 'claimed';
end;
$$;
