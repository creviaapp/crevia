-- Apply in the Supabase SQL editor for the Crevia project.
create table if not exists public.ai_summit_registrations (
  id uuid primary key default gen_random_uuid(),
  paystack_reference text not null unique,
  full_name text not null,
  email text not null,
  phone text not null,
  organization text,
  amount_kes integer not null check (amount_kes = 1500),
  currency text not null check (currency = 'KES'),
  status text not null check (status = 'paid'),
  paid_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.ai_summit_registrations enable row level security;
revoke all on public.ai_summit_registrations from anon, authenticated;
grant all on public.ai_summit_registrations to service_role;
