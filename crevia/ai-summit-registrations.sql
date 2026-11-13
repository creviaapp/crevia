-- Apply in the Supabase SQL editor for the Crevia project.
create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  paystack_reference text not null unique,
  email text not null,
  amount integer not null default 1500,
  currency text not null default 'KES' check (currency = 'KES'),
  status text not null default 'confirmed' check (status = 'confirmed'),
  created_at timestamptz not null default now()
);

-- Restore the default price while preserving the existing KES 50 test registration.
alter table public.registrations alter column amount set default 1500;
alter table public.registrations drop constraint if exists registrations_amount_check;
alter table public.registrations
  add constraint registrations_amount_check check (amount in (50, 1500));

alter table public.registrations enable row level security;
revoke all on table public.registrations from public, anon, authenticated;

drop policy if exists "Deny all client access" on public.registrations;
create policy "Deny all client access"
  on public.registrations
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

grant all on table public.registrations to service_role;
