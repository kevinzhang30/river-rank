-- Add last_online column to profiles
ALTER TABLE public.profiles ADD COLUMN last_online timestamptz;

-- RPC: head-to-head records against all opponents
CREATE FUNCTION public.get_h2h_records(p_user_id uuid)
RETURNS TABLE(opponent_id uuid, wins bigint, losses bigint)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    CASE WHEN p1 = p_user_id THEN p2 ELSE p1 END AS opponent_id,
    COUNT(*) FILTER (WHERE winner = p_user_id) AS wins,
    COUNT(*) FILTER (WHERE winner IS NOT NULL AND winner <> p_user_id) AS losses
  FROM public.matches
  WHERE ended_at IS NOT NULL AND (p1 = p_user_id OR p2 = p_user_id)
  GROUP BY opponent_id;
$$;
