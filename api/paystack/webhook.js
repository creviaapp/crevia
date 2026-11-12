const crypto = require('node:crypto');
const { json, paystack, persistPaidRegistration, isValidPaidTransaction } = require('../../lib/paystack');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const signature = req.headers['x-paystack-signature'];
  if (!secret || typeof signature !== 'string' || !Buffer.isBuffer(req.body)) return json(res, 401, { error: 'Invalid webhook signature.' });
  const expected = crypto.createHmac('sha512', secret).update(req.body).digest('hex');
  const actualBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    return json(res, 401, { error: 'Invalid webhook signature.' });
  }
  let event;
  try { event = JSON.parse(req.body.toString('utf8')); } catch { return json(res, 400, { error: 'Invalid webhook payload.' }); }
  if (event.event !== 'charge.success') return res.status(200).end();
  const reference = event.data?.reference;
  if (typeof reference !== 'string' || !/^aisummit_[a-f0-9]{32}$/.test(reference)) return res.status(200).end();
  try {
    const verified = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
    if (isValidPaidTransaction(verified, reference)) await persistPaidRegistration(verified);
    return res.status(200).end();
  } catch {
    return json(res, 500, { error: 'Could not process payment notification.' });
  }
};

module.exports.config = { api: { bodyParser: false } };
