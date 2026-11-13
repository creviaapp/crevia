-- Apply once in the Crevia Supabase SQL Editor before deploying the matching code.

-- Persist ticket-email delivery state so webhook retries and browser verification
-- share one durable, atomic email claim (Resend idempotency is only time-limited).
alter table public.registrations
  add column if not exists confirmation_email_sent_at timestamptz,
  add column if not exists confirmation_email_claimed_at timestamptz;

-- Keep registrations private even if another permissive client policy is added later.
alter table public.registrations enable row level security;
revoke all on table public.registrations from public, anon, authenticated;
grant all on table public.registrations to service_role;
drop policy if exists "Deny all client access" on public.registrations;
create policy "Deny all client access"
  on public.registrations
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- Contacts are insert-only for the public; authenticated admins can read them.
alter table public.contacts enable row level security;
revoke all on table public.contacts from public, anon, authenticated;
grant insert on table public.contacts to anon;
grant select on table public.contacts to authenticated;
drop policy if exists allow_anon_insert on public.contacts;
create policy allow_anon_insert on public.contacts
  for insert to anon
  with check (
    auth.role() = 'anon'
    and char_length(coalesce(name, '')) > 2
    and email ~* '^[^@]+@[^@]+\.[^@]+'
    and char_length(coalesce(message, '')) > 10
  );
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

-- Durable rate-limit buckets, inaccessible to browser roles.
create table if not exists public.ai_summit_rate_limits (
  rate_key text primary key check (rate_key ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0)
);
create index if not exists ai_summit_rate_limits_window_idx
  on public.ai_summit_rate_limits (window_started_at);
alter table public.ai_summit_rate_limits enable row level security;
revoke all on table public.ai_summit_rate_limits from public, anon, authenticated;
grant all on table public.ai_summit_rate_limits to service_role;

create or replace function public.consume_ai_summit_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer;
begin
  if p_key !~ '^[0-9a-f]{64}$' or p_limit < 1 or p_limit > 1000
     or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit arguments';
  end if;

  insert into public.ai_summit_rate_limits as bucket (rate_key, window_started_at, request_count)
  values (p_key, v_now, 1)
  on conflict (rate_key) do update
    set window_started_at = case
          when bucket.window_started_at + (p_window_seconds * interval '1 second') <= v_now then v_now
          else bucket.window_started_at
        end,
        request_count = case
          when bucket.window_started_at + (p_window_seconds * interval '1 second') <= v_now then 1
          else bucket.request_count + 1
        end
  returning request_count into v_count;

  if random() < 0.01 then
    delete from public.ai_summit_rate_limits
      where window_started_at < v_now - interval '1 day';
  end if;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.consume_ai_summit_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_ai_summit_rate_limit(text, integer, integer)
  to service_role;
