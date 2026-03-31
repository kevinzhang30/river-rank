-- ── Add Doakes emote ─────────────────────────────────────────────────────────

insert into public.emotes (
  id,
  name,
  image_url,
  asset_type,
  tier,
  sort_order,
  sound_url
) values (
  'doakes',
  'Doakes',
  '/emotes/doakes-emote.png',
  'static',
  'premium',
  16,
  '/sfx/emotes/doakes-emote.mp3'
)
on conflict (id) do nothing;
