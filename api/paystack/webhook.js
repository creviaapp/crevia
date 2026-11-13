const crypto = require('node:crypto');
const { sendTicketConfirmationOnce } = require('../../lib/confirmation-email');
const { json, paystack, persistPaidRegistration, isValidPaidTransaction } = require('../../lib/paystack');

async function getRawBody(req) {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > 1024 * 1024) throw new Error('WEBHOOK_BODY_TOO_LARGE');
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('WEBHOOK_BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function verifyPaystackSignature(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string' || !secret) return false;
  // Paystack's x-paystack-signature is the hex HMAC-SHA512 of the exact raw body.
  if (!/^[a-f0-9]{128}$/i.test(signature)) return false;
  const expected = crypto.createHmac('sha512', secret).update(rawBody).digest();
  const received = Buffer.from(signature, 'hex');
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const signature = req.headers['x-paystack-signature'];
  if (!secret) return json(res, 503, { error: 'Webhook signing is not configured.' });
  let rawBody;
  try { rawBody = await getRawBody(req); } catch { return json(res, 413, { error: 'Webhook payload too large.' }); }
  if (!verifyPaystackSignature(rawBody, signature, secret)) {
    return json(res, 401, { error: 'Invalid webhook signature.' });
  }
  let event;
  try { event = JSON.parse(rawBody.toString('utf8')); } catch { return json(res, 400, { error: 'Invalid webhook payload.' }); }
  if (event.event !== 'charge.success') return res.status(200).end();
  const reference = event.data?.reference;
  if (typeof reference !== 'string' || !/^aisummit_[a-f0-9]{32}$/.test(reference)) return res.status(200).end();
  try {
    const verified = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
    if (!isValidPaidTransaction(verified, reference)) return res.status(200).end();

    // Persist first. A failed email must never undo a paid registration or trigger a Paystack retry.
    await persistPaidRegistration(verified);

    const recipient = event.data?.customer?.email;
    const verifiedEmail = verified.customer?.email;
    const emailMatchesPayment = typeof recipient === 'string' && typeof verifiedEmail === 'string' && recipient.toLowerCase() === verifiedEmail.toLowerCase();
    if (emailMatchesPayment) await sendTicketConfirmationOnce(verified, reference, recipient);
    else console.error('AI Summit confirmation email skipped: webhook email did not match the verified transaction.');

    return res.status(200).end();
  } catch {
    return json(res, 500, { error: 'Could not process payment notification.' });
  }
};

module.exports.config = { api: { bodyParser: false } };
