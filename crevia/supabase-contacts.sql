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

-- Example restrictive policy allowing anonymous inserts with basic validation
create policy allow_anon_insert on public.contacts
  for insert
  with check (
    auth.role() = 'anon'
    and char_length(coalesce(name, '')) > 2
    and email ~* '^[^@]+@[^@]+\.[^@]+' -- simple email pattern
    and char_length(coalesce(message, '')) > 10
  );

-- NOTE: SELECT policy intentionally removed
-- Admin dashboard uses password-only client-side auth (not ideal for production)
-- For production: implement a backend API endpoint that:
-- 1. Uses SERVICE_ROLE key (never expose in frontend)
-- 2. Validates admin session server-side
-- 3. Returns submissions securely
-- See todo: "Implement serverless submission endpoint"

-- Grant permissions
grant insert on public.contacts to anon;
grant select on public.contacts to anon;

-- Notes:
-- 1) For production, prefer a server-side endpoint that uses the SERVICE_ROLE key
--    and keep the SERVICE_ROLE key in environment variables (do NOT store in frontend).
-- 2) Use server-side validation, CAPTCHA verification, and rate-limiting to reduce abuse.
-- 3) Tailor the RLS policy to your exact validation needs; Postgres functions can help
--    with more advanced checks (spam scoring, domain allowlists, etc.).
