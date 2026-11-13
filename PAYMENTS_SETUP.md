# AI Summit Paystack setup

Checkout is implemented with server-side transaction initialization and verification. It remains unavailable until the production environment is configured.

## 1. Configure Vercel environment variables

In the Crevia Vercel project, add these variables for **Production**:

- `PAYSTACK_SECRET_KEY`: the Paystack **secret** key (`sk_live_…`), copied directly from the Paystack dashboard. Never add it to this repository or browser code, and never send it in chat.
- `PAYSTACK_WEBHOOK_SECRET`: the dedicated Paystack webhook signing secret (`whsec_…`). The webhook now requires Paystack's timestamped `Paystack-Signature` header and rejects legacy unsigned-timestamp replayable deliveries.
- `SUPABASE_URL`: the existing Crevia Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: that project's service-role key. Keep it only in server environment variables; it bypasses database row-level security.
- `RESEND_API_KEY`: the server-side Resend API key used for ticket confirmations.
- `RESEND_FROM_EMAIL` (optional): a sender on your verified domain, such as `Crevia Tickets <tickets@crevia.app>`. Until the domain is verified, the function falls back to Resend's `onboarding@resend.dev` testing sender.

Redeploy after setting the variables. Do not use the public `pk_live_…` key as `PAYSTACK_SECRET_KEY`.

## 2. Apply the security migration before deploying

Run [`crevia/security-hardening.sql`](crevia/security-hardening.sql) in the Crevia Supabase SQL editor. It adds durable confirmation-email delivery state, an atomic rate-limit function, and admin-only contact submission reads. Keep `registrations` blocked to browser roles. The ticket price remains 1,500 KES, and the migration preserves the existing 50 KES test registration.

For the contact dashboard, create or use a Supabase Auth user, then assign its trusted app metadata in the SQL Editor (replace the email):

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where email = 'ADMIN_EMAIL';
```

Confirm the editor reports `UPDATE 1`, then sign in again at `/crevia/admin.html`. Do not put a service-role key or a shared admin password in browser code. The admin page now signs in through Supabase Auth.

## 3. Configure payment notifications

In Paystack dashboard settings, enable timestamped webhook signatures, copy the webhook signing secret into Vercel as `PAYSTACK_WEBHOOK_SECRET`, and add the production webhook URL:

`https://crevia.app/api/paystack/webhook`

The webhook validates the timestamped HMAC signature and independently verifies each matching payment before saving it. The browser's return callback also verifies server-side and uses the Paystack reference as an idempotent database key.

## Payment flow

The browser submits attendee details to `/api/paystack/initialize`. The server fixes the amount and currency, creates a unique reference, and initializes the Paystack transaction using the secret key. The browser resumes that transaction using Paystack InlineJS. A browser callback alone never marks the order paid: `/api/paystack/verify` checks Paystack's transaction status, amount, currency, event metadata, and reference, then saves the registration. The signed webhook covers cases where the browser closes before returning.

After a verified payment is saved, `/api/paystack/webhook` and `/api/paystack/verify` share a database-backed email claim so concurrent requests or webhook retries do not send duplicate confirmations. Resend's idempotency key remains as a secondary safeguard. The checkout initialization and verification endpoints also use the Supabase rate-limit function; apply the migration before enabling them. Install the SDK with `npm install resend` (already included in this repository).

Only collect the attendee information needed for this event. Payment card and M-Pesa details are entered with Paystack and are not collected by Crevia's page.
