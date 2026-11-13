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

function verifyPaystackSignature(rawBody, header, secret, now = Math.floor(Date.now() / 1000)) {
  if (!Buffer.isBuffer(rawBody) || typeof header !== 'string' || !secret) return false;
  let timestamp = null;
  const signatures = [];
  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === 't') {
      if (timestamp !== null || !/^\d+$/.test(value)) return false;
      timestamp = Number(value);
    } else if (name === 'v1') {
      const keySeparator = value.indexOf(':');
      if (keySeparator > 0) signatures.push(value.slice(keySeparator + 1));
    }
  }
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > 300 || signatures.length === 0) return false;

  const expected = crypto.createHmac('sha512', secret).update(`${timestamp}.`).update(rawBody).digest();
  return signatures.some((signature) => {
    if (!/^[0-9a-f]{128}$/.test(signature)) return false;
    return crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'));
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  const secret = process.env.PAYSTACK_WEBHOOK_SECRET;
  const signature = req.headers['paystack-signature'];
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
