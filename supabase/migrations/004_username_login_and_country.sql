-- RPC: resolve username → email for login
-- Case-sensitive exact match. Security definer to access auth.users.
create or replace function public.get_email_by_username(p_username text)
returns text
language plpgsql
security definer
as $$
declare
  v_email text;
begin
  select u.email into v_email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.username = p_username;
  return v_email;
end;
$$;

-- Add country column to profiles
alter table public.profiles add column if not exists country text;
