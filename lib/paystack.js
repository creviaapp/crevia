const crypto = require('node:crypto');

const AMOUNT_SUBUNITS = 150000;
const CURRENCY = 'KES';
const EVENT_CODE = 'ai-summit-2027';

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

function paystackSecret() {
  return process.env.PAYSTACK_SECRET_KEY;
}

async function paystack(path, options = {}) {
  const secret = paystackSecret();
  if (!secret || !secret.startsWith('sk_')) throw new Error('PAYMENT_NOT_CONFIGURED');
  const response = await fetch(`https://api.paystack.co${path}`, {
    ...options,
    signal: AbortSignal.timeout(12000),
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers
    }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.status) throw new Error('PAYSTACK_REQUEST_FAILED');
  return data.data;
}

function validOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && (
      url.hostname === 'crevia.app' ||
      url.hostname === 'www.crevia.app'
    );
  } catch { return false; }
}

function safeText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function persistPaidRegistration(transaction) {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('REGISTRATION_STORAGE_NOT_CONFIGURED');
  const metadata = transaction.metadata || {};
  if (metadata.event_code !== EVENT_CODE || !transaction.customer?.email) {
    throw new Error('INVALID_PAYMENT_METADATA');
  }
  const record = {
    paystack_reference: transaction.reference,
    email: safeText(transaction.customer.email, 254).toLowerCase(),
    amount: transaction.amount / 100,
    currency: transaction.currency,
    status: 'confirmed'
  };
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/registrations?on_conflict=paystack_reference`, {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(record)
  });
  if (!response.ok) throw new Error('REGISTRATION_SAVE_FAILED');
}

async function consumeRateLimit(req, scope, limit, windowSeconds) {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('REGISTRATION_STORAGE_NOT_CONFIGURED');
  const forwardedIp = req.headers['x-forwarded-for'];
  const ip = typeof forwardedIp === 'string' ? forwardedIp.split(',')[0].trim() : '';
  if (!ip) throw new Error('CLIENT_IP_UNAVAILABLE');
  const key = crypto.createHmac('sha256', serviceKey).update(`${scope}:${ip}`).digest('hex');
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/consume_ai_summit_rate_limit`, {
    method: 'POST',
    signal: AbortSignal.timeout(5000),
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ p_key: key, p_limit: limit, p_window_seconds: windowSeconds })
  });
  if (!response.ok) throw new Error('RATE_LIMIT_CHECK_FAILED');
  return response.json();
}

async function claimTicketEmail(reference) {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('REGISTRATION_STORAGE_NOT_CONFIGURED');
  const baseUrl = url.replace(/\/$/, '');
  const claimAt = new Date().toISOString();
  const staleClaim = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const query = new URLSearchParams({
    paystack_reference: `eq.${reference}`,
    confirmation_email_sent_at: 'is.null',
    or: `(confirmation_email_claimed_at.is.null,confirmation_email_claimed_at.lt.${staleClaim})`,
    select: 'confirmation_email_claimed_at'
  });
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
  const claimedResponse = await fetch(`${baseUrl}/rest/v1/registrations?${query}`, {
    method: 'PATCH', signal: AbortSignal.timeout(5000),
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({ confirmation_email_claimed_at: claimAt })
  });
  if (!claimedResponse.ok) throw new Error('EMAIL_CLAIM_FAILED');
  const claimedRows = await claimedResponse.json();
  if (Array.isArray(claimedRows) && claimedRows.length) {
    return { claimed: true, claimAt: claimedRows[0].confirmation_email_claimed_at };
  }

  const statusQuery = new URLSearchParams({
    paystack_reference: `eq.${reference}`,
    select: 'confirmation_email_sent_at,confirmation_email_claimed_at'
  });
  const statusResponse = await fetch(`${baseUrl}/rest/v1/registrations?${statusQuery}`, {
    signal: AbortSignal.timeout(5000), headers
  });
  if (!statusResponse.ok) throw new Error('EMAIL_STATUS_CHECK_FAILED');
  const rows = await statusResponse.json();
  return { claimed: false, sent: Boolean(rows[0]?.confirmation_email_sent_at), processing: Boolean(rows[0]?.confirmation_email_claimed_at) };
}

async function finishTicketEmail(reference, claimAt, sent) {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('REGISTRATION_STORAGE_NOT_CONFIGURED');
  const query = new URLSearchParams({
    paystack_reference: `eq.${reference}`,
    confirmation_email_claimed_at: `eq.${claimAt}`
  });
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/registrations?${query}`, {
    method: 'PATCH', signal: AbortSignal.timeout(5000),
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({
      confirmation_email_sent_at: sent ? new Date().toISOString() : null,
      confirmation_email_claimed_at: null
    })
  });
  if (!response.ok) throw new Error('EMAIL_STATUS_SAVE_FAILED');
}

function isValidPaidTransaction(transaction, reference) {
  return transaction && transaction.status === 'success' &&
    transaction.amount === AMOUNT_SUBUNITS && transaction.currency === CURRENCY &&
    transaction.reference === reference && transaction.metadata?.event_code === EVENT_CODE;
}

module.exports = { AMOUNT_SUBUNITS, CURRENCY, EVENT_CODE, json, paystack, validOrigin, safeText, persistPaidRegistration, consumeRateLimit, claimTicketEmail, finishTicketEmail, isValidPaidTransaction };
