-- supabase-contacts.sql
-- Create a contacts table and example Row Level Security (RLS) policy
-- Apply this in the SQL editor of your Supabase project (SQL > New query)

-- Enable extension for UUID generation
create extension if not exists "pgcrypto";

-- Create table
create table if not exists public.contacts (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  email text not null,
  company text,
  message text not null,
  created_at timestamptz default now()
);

-- Enable Row Level Security
alter table public.contacts enable row level security;

drop policy if exists allow_anon_insert on public.contacts;
-- Allow anonymous contact-form submissions with basic validation.
create policy allow_anon_insert on public.contacts
  for insert
  with check (
    auth.role() = 'anon'
    and char_length(coalesce(name, '')) > 2
    and email ~* '^[^@]+@[^@]+\.[^@]+' -- simple email pattern
    and char_length(coalesce(message, '')) > 10
  );

-- Public users may submit contact forms but may not read or alter submissions.
revoke all on table public.contacts from public, anon, authenticated;
grant insert on table public.contacts to anon;
grant select on table public.contacts to authenticated;

-- Dashboard access requires a Supabase Auth user with app_metadata.role = 'admin'.
drop policy if exists contacts_admin_select on public.contacts;
create policy contacts_admin_select on public.contacts
  for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists contacts_select_requires_admin on public.contacts;
create policy contacts_select_requires_admin on public.contacts
  as restrictive for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists contacts_deny_anon_select on public.contacts;
create policy contacts_deny_anon_select on public.contacts
  as restrictive for select to anon
  using (false);

-- Notes:
-- Use a publishable key in the browser; RLS protects private rows.
-- Assign app_metadata.role = 'admin' only to trusted Supabase Auth users.
