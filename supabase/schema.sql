create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  github_id text not null unique,
  username text not null unique,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.oauth_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null,
  provider_user_id text not null,
  created_at timestamptz not null default now(),
  unique(provider, provider_user_id)
);

create index if not exists oauth_accounts_user_id_idx on public.oauth_accounts(user_id);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create index if not exists sessions_user_id_idx on public.sessions(user_id);
create index if not exists sessions_expires_at_idx on public.sessions(expires_at);

alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.oauth_accounts enable row level security;

-- The server uses the Supabase service-role key for these server-side operations.
-- Never expose that key to browser code.
