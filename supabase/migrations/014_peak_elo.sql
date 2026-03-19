-- Add peak_elo column to track all-time highest Elo
ALTER TABLE public.profiles ADD COLUMN peak_elo int NOT NULL DEFAULT 1200;

-- Backfill: set peak_elo to every user's current elo
UPDATE public.profiles SET peak_elo = elo;
