-- ── Add sound support to emotes ────────────────────────────────────────────────

ALTER TABLE public.emotes ADD COLUMN sound_url text;

-- Populate sound URLs for the 5 non-free emotes
UPDATE public.emotes SET sound_url = '/sfx/emotes/mewing-emote.mp3'        WHERE id = 'mewing';
UPDATE public.emotes SET sound_url = '/sfx/emotes/patrick-spade-emote.mp3' WHERE id = 'patrick-spade';
UPDATE public.emotes SET sound_url = '/sfx/emotes/rage-bait-emote.mp3'     WHERE id = 'rage-baited';
UPDATE public.emotes SET sound_url = '/sfx/emotes/speed-emote.mp3'         WHERE id = 'speed';
UPDATE public.emotes SET sound_url = '/sfx/emotes/good-boy-emote.mp3'      WHERE id = 'good-boy';
