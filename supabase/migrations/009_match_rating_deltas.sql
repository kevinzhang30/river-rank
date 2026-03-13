-- Add rating delta columns to matches so the frontend can display ELO changes.
alter table public.matches
  add column p1_delta int,
  add column p2_delta int;

-- Re-create end_match to persist deltas into the match row.
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
  v_p1_elo_before int;
  v_p2_elo_before int;
  v_winner_elo    int;
  v_loser_elo     int;
  v_loser         uuid;
  v_expected      float;
  v_delta         int;
  v_p1_delta      int := 0;
  v_p2_delta      int := 0;
begin
  -- ── Idempotency guard ──────────────────────────────────────────────────────
  insert into public.matches (id, p1, p2, winner, ranked, ended_at)
  values (p_match_id, p_p1, p_p2, p_winner, p_ranked, now())
  on conflict (id) do nothing;

  if not found then
    return null;
  end if;

  -- ── Lock both profile rows (consistent order: p1 then p2) ─────────────────
  select elo into v_p1_elo_before from public.profiles where id = p_p1 for update;
  select elo into v_p2_elo_before from public.profiles where id = p_p2 for update;

  -- ── Tie / chop: no elo or win/loss change ─────────────────────────────────
  if p_winner is null then
    update public.matches set p1_delta = 0, p2_delta = 0 where id = p_match_id;

    return json_build_object(
      'p1Delta',     0,
      'p2Delta',     0,
      'p1EloBefore', v_p1_elo_before,
      'p2EloBefore', v_p2_elo_before,
      'p1EloAfter',  v_p1_elo_before,
      'p2EloAfter',  v_p2_elo_before,
      'winnerId',    null,
      'ranked',      p_ranked
    );
  end if;

  -- ── Wins / losses ─────────────────────────────────────────────────────────
  v_loser := case when p_p1 = p_winner then p_p2 else p_p1 end;

  update public.profiles set wins   = wins   + 1 where id = p_winner;
  update public.profiles set losses = losses + 1 where id = v_loser;

  -- ── Elo (ranked only, K = 32) ─────────────────────────────────────────────
  if p_ranked then
    v_winner_elo := case when p_p1 = p_winner then v_p1_elo_before else v_p2_elo_before end;
    v_loser_elo  := case when p_p1 = v_loser  then v_p1_elo_before else v_p2_elo_before end;

    v_expected := 1.0 / (1.0 + power(10.0, (v_loser_elo - v_winner_elo)::float / 400.0));
    v_delta    := round(32.0 * (1.0 - v_expected))::int;

    v_p1_delta := case when p_p1 = p_winner then v_delta else -v_delta end;
    v_p2_delta := case when p_p2 = p_winner then v_delta else -v_delta end;

    update public.profiles set elo = elo + v_p1_delta where id = p_p1;
    update public.profiles set elo = elo + v_p2_delta where id = p_p2;
  end if;

  -- ── Persist deltas into the match row ─────────────────────────────────────
  update public.matches set p1_delta = v_p1_delta, p2_delta = v_p2_delta where id = p_match_id;

  return json_build_object(
    'p1Delta',     v_p1_delta,
    'p2Delta',     v_p2_delta,
    'p1EloBefore', v_p1_elo_before,
    'p2EloBefore', v_p2_elo_before,
    'p1EloAfter',  v_p1_elo_before + v_p1_delta,
    'p2EloAfter',  v_p2_elo_before + v_p2_delta,
    'winnerId',    p_winner,
    'ranked',      p_ranked
  );
end;
$$;
