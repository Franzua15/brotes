create table if not exists public.rooms (
  code text primary key,
  status text not null default 'lobby',
  players jsonb not null default '[]'::jsonb,
  state jsonb,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rooms enable row level security;
revoke all on public.rooms from anon, authenticated;
