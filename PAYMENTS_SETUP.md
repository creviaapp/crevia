# AI Summit Paystack setup

Checkout is implemented with server-side transaction initialization and verification. It remains unavailable until the production environment is configured.

## 1. Configure Vercel environment variables

In the Crevia Vercel project, add these variables for **Production**:

- `PAYSTACK_SECRET_KEY`: the Paystack **secret** key (`sk_live_…`), copied directly from the Paystack dashboard. Never add it to this repository or browser code, and never send it in chat.
- `SUPABASE_URL`: the existing Crevia Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: that project's service-role key. Keep it only in server environment variables; it bypasses database row-level security.

Redeploy after setting the variables. Do not use the public `pk_live_…` key as `PAYSTACK_SECRET_KEY`.

## 2. Create the private registration table

Run [`crevia/ai-summit-registrations.sql`](crevia/ai-summit-registrations.sql) in the Crevia Supabase SQL editor. The table denies browser roles access; only the server function uses the service-role key. Registrations are inserted only after Paystack confirms a successful 1,500 KES payment.

## 3. Configure payment notifications

In Paystack dashboard settings, add the production webhook URL:

`https://crevia.app/api/paystack/webhook`

The webhook validates Paystack's HMAC signature and independently verifies each matching payment before saving it. The browser's return callback also verifies server-side and uses the Paystack reference as an idempotent database key.

## Payment flow

The browser submits attendee details to `/api/paystack/initialize`. The server fixes the amount and currency, creates a unique reference, and initializes the Paystack transaction using the secret key. The browser resumes that transaction using Paystack InlineJS. A browser callback alone never marks the order paid: `/api/paystack/verify` checks Paystack's transaction status, amount, currency, event metadata, and reference, then saves the registration. The signed webhook covers cases where the browser closes before returning.

Only collect the attendee information needed for this event. Payment card and M-Pesa details are entered with Paystack and are not collected by Crevia's page.
