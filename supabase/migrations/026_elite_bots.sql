-- Elite bot support: add is_elite flag and elite-specific behavior knobs
ALTER TABLE public.bot_config
  ADD COLUMN IF NOT EXISTS is_elite boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS three_bet_freq float
    CHECK (three_bet_freq IS NULL OR (three_bet_freq >= 0 AND three_bet_freq <= 1)),
  ADD COLUMN IF NOT EXISTS blind_defense_bonus float
    CHECK (blind_defense_bonus IS NULL OR (blind_defense_bonus >= 0 AND blind_defense_bonus <= 1)),
  ADD COLUMN IF NOT EXISTS short_stack_aggression float
    CHECK (short_stack_aggression IS NULL OR (short_stack_aggression >= 0 AND short_stack_aggression <= 1)),
  ADD COLUMN IF NOT EXISTS trap_frequency float
    CHECK (trap_frequency IS NULL OR (trap_frequency >= 0 AND trap_frequency <= 1)),
  ADD COLUMN IF NOT EXISTS double_barrel_freq float
    CHECK (double_barrel_freq IS NULL OR (double_barrel_freq >= 0 AND double_barrel_freq <= 1));
