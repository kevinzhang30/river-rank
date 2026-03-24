-- ── Add manually granted premium emotes ──────────────────────────────────────

insert into public.emotes (
  id,
  name,
  image_url,
  asset_type,
  tier,
  sort_order,
  sound_url
) values
  (
    'jackpot',
    'Jackpot',
    '/emotes/jackpot-emote.png',
    'static',
    'premium',
    14,
    '/sfx/emotes/jackpot-emote.mp3'
  ),
  (
    'all-roads',
    'All Roads',
    '/emotes/all-roads-emote.png',
    'static',
    'premium',
    15,
    '/sfx/emotes/all-roads-emote.mp3'
  )
on conflict (id) do nothing;
