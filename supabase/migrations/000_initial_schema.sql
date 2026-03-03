-- ── profiles ──────────────────────────────────────────────────────────────────

create table public.profiles (
  id         uuid        primary key references auth.users(id) on delete cascade,
  username   text        unique,
  elo        int         not null default 1200,
  wins       int         not null default 0,
  losses     int         not null default 0,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: anyone can read"
  on public.profiles for select
  using (true);

-- Initial set-once policy (002 migration will replace this)
create policy "profiles: user can set username once"
  on public.profiles for update
  using  (auth.uid() = id and username is null)
  with check (auth.uid() = id);

-- Block direct mutations to elo/wins/losses from client
create or replace function public.guard_profile_stats()
returns trigger language plpgsql security definer as $$
begin
  if new.elo    <> old.elo    then raise exception 'cannot update elo directly';    end if;
  if new.wins   <> old.wins   then raise exception 'cannot update wins directly';   end if;
  if new.losses <> old.losses then raise exception 'cannot update losses directly'; end if;
  return new;
end;
$$;

create trigger trg_guard_profile_stats
  before update on public.profiles
  for each row execute function public.guard_profile_stats();

-- ── matches ───────────────────────────────────────────────────────────────────

create table public.matches (
  id         uuid        primary key default gen_random_uuid(),
  p1         uuid        not null references public.profiles(id),
  p2         uuid        not null references public.profiles(id),
  winner     uuid        null     references public.profiles(id),
  ranked     boolean     not null,
  created_at timestamptz not null default now(),
  ended_at   timestamptz null
);

alter table public.matches enable row level security;

create policy "matches: participants can read"
  on public.matches for select
  using (auth.uid() = p1 or auth.uid() = p2);

-- ── auto-create profile on signup ─────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, username)
  values (new.id, null)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
