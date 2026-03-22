-- ── emote tables ─────────────────────────────────────────────────────────────

-- Available emotes in the game
create table public.emotes (
  id         text        primary key,
  name       text        not null,
  image_url  text        not null,
  asset_type text        not null default 'static'
             check (asset_type in ('static', 'sprite')),
  tier       text        not null default 'free'
             check (tier in ('free', 'achievement', 'premium')),
  sort_order int         not null default 0,
  created_at timestamptz not null default now()
);

-- Which emotes a user has unlocked
create table public.user_emotes (
  user_id     uuid        references auth.users(id) on delete cascade,
  emote_id    text        references public.emotes(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, emote_id)
);

-- Which emotes a user has equipped for matches (max 4 slots, no duplicates)
create table public.equipped_emotes (
  user_id  uuid references auth.users(id) on delete cascade,
  slot     int  not null check (slot between 0 and 3),
  emote_id text references public.emotes(id) on delete cascade,
  primary key (user_id, slot),
  unique (user_id, emote_id)
);

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.emotes          enable row level security;
alter table public.user_emotes     enable row level security;
alter table public.equipped_emotes enable row level security;

-- emotes: readable by all authenticated users
create policy "emotes: anyone can read"
  on public.emotes for select
  to authenticated using (true);

-- user_emotes: users can read their own
create policy "user_emotes: owner can read"
  on public.user_emotes for select
  to authenticated using (auth.uid() = user_id);

-- equipped_emotes: users can read and write their own
create policy "equipped_emotes: owner can read"
  on public.equipped_emotes for select
  to authenticated using (auth.uid() = user_id);

create policy "equipped_emotes: owner can insert"
  on public.equipped_emotes for insert
  to authenticated with check (auth.uid() = user_id);

create policy "equipped_emotes: owner can update"
  on public.equipped_emotes for update
  to authenticated using (auth.uid() = user_id);

create policy "equipped_emotes: owner can delete"
  on public.equipped_emotes for delete
  to authenticated using (auth.uid() = user_id);

-- ── seed starter emotes ─────────────────────────────────────────────────────

insert into public.emotes (id, name, image_url, asset_type, tier, sort_order) values
  ('good-boy', 'Good Boy', '/emotes/good-boy-emote.png', 'static', 'achievement', 0);

-- backfill: grant free emotes to all existing users (conflict-safe)
insert into public.user_emotes (user_id, emote_id)
select p.id, e.id
from   public.profiles p
cross  join public.emotes e
where  e.tier = 'free'
on conflict do nothing;

-- ── auto-grant free emotes to new profiles ──────────────────────────────────

create or replace function public.grant_free_emotes()
returns trigger language plpgsql security definer as $$
begin
  insert into public.user_emotes (user_id, emote_id)
  select NEW.id, e.id from public.emotes e where e.tier = 'free'
  on conflict do nothing;
  return NEW;
end;
$$;

create trigger trg_grant_free_emotes
  after insert on public.profiles
  for each row execute function public.grant_free_emotes();
