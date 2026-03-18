-- Add is_bot flag to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_bot boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_profiles_is_bot
ON public.profiles (is_bot);

-- Bot config table: behavioral and availability settings for bot accounts
CREATE TABLE IF NOT EXISTS public.bot_config (
  id                   uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- IDENTITY (supplements profiles.username, profiles.country)
  avatar_seed          text,

  -- AVAILABILITY
  enabled              boolean NOT NULL DEFAULT true,
  show_on_leaderboard  boolean NOT NULL DEFAULT true,
  ranked_enabled       boolean NOT NULL DEFAULT true,
  unranked_enabled     boolean NOT NULL DEFAULT true,

  -- BEHAVIOR (Phase 1 primary knobs)
  style                text NOT NULL DEFAULT 'balanced'
                         CHECK (style IN ('tight', 'loose', 'balanced', 'aggro')),
  aggression           float NOT NULL DEFAULT 0.5
                         CHECK (aggression >= 0 AND aggression <= 1),
  bluff_frequency      float NOT NULL DEFAULT 0.1
                         CHECK (bluff_frequency >= 0 AND bluff_frequency <= 1),
  looseness            float NOT NULL DEFAULT 0.5
                         CHECK (looseness >= 0 AND looseness <= 1),

  -- BEHAVIOR (Phase 2+ knobs)
  preflop_tightness    float
                         CHECK (preflop_tightness IS NULL OR (preflop_tightness >= 0 AND preflop_tightness <= 1)),
  pot_odds_awareness   float
                         CHECK (pot_odds_awareness IS NULL OR (pot_odds_awareness >= 0 AND pot_odds_awareness <= 1)),

  -- TRACKING
  last_used_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
-- Update RLS policies to include is_bot in the guard for profile setup
-- (is_bot should not be changeable by regular users)
DROP POLICY IF EXISTS "profiles: user can set up profile" ON public.profiles;
CREATE POLICY "profiles: user can set up profile"
  ON public.profiles FOR UPDATE
  USING  (auth.uid() = id AND username IS NULL)
  WITH CHECK (
    auth.uid() = id
    AND elo             IS NOT DISTINCT FROM (SELECT elo             FROM public.profiles WHERE id = auth.uid())
    AND wins            IS NOT DISTINCT FROM (SELECT wins            FROM public.profiles WHERE id = auth.uid())
    AND losses          IS NOT DISTINCT FROM (SELECT losses          FROM public.profiles WHERE id = auth.uid())
    AND friend_code     IS NOT DISTINCT FROM (SELECT friend_code     FROM public.profiles WHERE id = auth.uid())
    AND is_bot          IS NOT DISTINCT FROM (SELECT is_bot          FROM public.profiles WHERE id = auth.uid())
  );
