-- Tournament tables

create table public.tournaments (
  id          uuid primary key default gen_random_uuid(),
  host_id     uuid not null references public.profiles(id),
  join_code   text not null unique,
  size        int  not null check (size in (4, 8)),
  status      text not null default 'lobby' check (status in ('lobby','in_progress','completed')),
  winner_id   uuid null references public.profiles(id),
  created_at  timestamptz not null default now(),
  started_at  timestamptz null,
  ended_at    timestamptz null
);
alter table public.tournaments enable row level security;
create policy "tournaments: anyone can read" on public.tournaments for select using (true);

create table public.tournament_participants (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id       uuid not null references public.profiles(id),
  seed          int  null,
  joined_at     timestamptz not null default now(),
  primary key (tournament_id, user_id)
);
alter table public.tournament_participants enable row level security;
create policy "tp: anyone can read" on public.tournament_participants for select using (true);

create table public.tournament_matches (
  id              uuid primary key default gen_random_uuid(),
  tournament_id   uuid not null references public.tournaments(id) on delete cascade,
  round           int  not null,
  position        int  not null,
  p1_id           uuid null references public.profiles(id),
  p2_id           uuid null references public.profiles(id),
  winner_id       uuid null references public.profiles(id),
  match_id        uuid null,
  status          text not null default 'pending'
                  check (status in ('pending','ready','in_progress','completed','bye')),
  created_at      timestamptz not null default now(),
  unique (tournament_id, round, position)
);
alter table public.tournament_matches enable row level security;
create policy "tm: anyone can read" on public.tournament_matches for select using (true);
