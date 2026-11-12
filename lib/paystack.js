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
  const attendee = metadata.attendee || {};
  if (metadata.event_code !== EVENT_CODE || !attendee.name || !attendee.phone || !transaction.customer?.email) {
    throw new Error('INVALID_PAYMENT_METADATA');
  }
  const record = {
    paystack_reference: transaction.reference,
    full_name: safeText(attendee.name, 100),
    email: safeText(transaction.customer.email, 254).toLowerCase(),
    phone: safeText(attendee.phone, 30),
    organization: safeText(attendee.organization, 120) || null,
    amount_kes: transaction.amount / 100,
    currency: transaction.currency,
    status: 'paid',
    paid_at: transaction.paid_at || transaction.transaction_date || new Date().toISOString()
  };
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/ai_summit_registrations?on_conflict=paystack_reference`, {
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

function isValidPaidTransaction(transaction, reference) {
  return transaction && transaction.status === 'success' &&
    transaction.amount === AMOUNT_SUBUNITS && transaction.currency === CURRENCY &&
    transaction.reference === reference && transaction.metadata?.event_code === EVENT_CODE;
}

module.exports = { AMOUNT_SUBUNITS, CURRENCY, EVENT_CODE, json, paystack, validOrigin, safeText, persistPaidRegistration, isValidPaidTransaction };
