-- Insert 4 free starter emotes
insert into public.emotes (id, name, image_url, asset_type, tier, sort_order) values
  ('elipses',   'Elipses',   '/emotes/elipses-emote.png',   'static', 'free', 1),
  ('nice-hand', 'Nice Hand', '/emotes/nice-hand-emote.png', 'static', 'free', 2),
  ('question',  'Question',  '/emotes/question-emote.png',  'static', 'free', 3),
  ('thanks',    'Thanks',    '/emotes/thanks-emote.png',    'static', 'free', 4)
on conflict (id) do nothing;

-- Update trigger to skip bots
create or replace function public.grant_free_emotes()
returns trigger language plpgsql security definer as $$
begin
  if NEW.is_bot then
    return NEW;
  end if;
  insert into public.user_emotes (user_id, emote_id)
  select NEW.id, e.id from public.emotes e where e.tier = 'free'
  on conflict do nothing;
  return NEW;
end;
$$;

-- Backfill: grant these free emotes to all existing non-bot users
insert into public.user_emotes (user_id, emote_id)
select p.id, e.id
from   public.profiles p
cross  join public.emotes e
where  e.tier = 'free'
  and  p.is_bot = false
on conflict do nothing;
