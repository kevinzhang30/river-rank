-- RPC: end_match
-- Atomically inserts a completed match row and updates player profiles.
-- Returns JSON with elo deltas (0 for unranked).

create or replace function public.end_match(
  p_match_id uuid,
  p_p1       uuid,
  p_p2       uuid,
  p_winner   uuid,
  p_ranked   boolean
)
returns json
language plpgsql
security definer
as $$
declare
  v_loser        uuid;
  v_winner_elo   int;
  v_loser_elo    int;
  v_expected     float;
  v_delta        int;
begin
  v_loser := case when p_p1 = p_winner then p_p2 else p_p1 end;

  -- Insert completed match row
  insert into public.matches (id, p1, p2, winner, ranked, ended_at)
  values (p_match_id, p_p1, p_p2, p_winner, p_ranked, now());

  if p_ranked then
    select elo into v_winner_elo from public.profiles where id = p_winner;
    select elo into v_loser_elo  from public.profiles where id = v_loser;

    v_expected := 1.0 / (1.0 + power(10.0, (v_loser_elo - v_winner_elo)::float / 400.0));
    v_delta    := round(32.0 * (1.0 - v_expected))::int;

    update public.profiles
    set  elo  = elo + v_delta,
         wins = wins + 1
    where id = p_winner;

    update public.profiles
    set  elo    = elo - v_delta,
         losses = losses + 1
    where id = v_loser;

    return json_build_object(
      'winnerDelta', v_delta,
      'loserDelta',  -v_delta,
      'loserId',     v_loser
    );
  else
    update public.profiles set wins   = wins + 1   where id = p_winner;
    update public.profiles set losses = losses + 1 where id = v_loser;

    return json_build_object(
      'winnerDelta', 0,
      'loserDelta',  0,
      'loserId',     v_loser
    );
  end if;
end;
$$;
