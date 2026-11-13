const { json, paystack, validOrigin, persistPaidRegistration, consumeRateLimit, isValidPaidTransaction } = require('../../lib/paystack');
const { sendTicketConfirmationOnce } = require('../../lib/confirmation-email');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  if (!validOrigin(req)) {
    return json(res, 403, { error: 'Request origin not allowed.' });
  }
  try {
    if (!await consumeRateLimit(req, 'verify', 20, 300)) return json(res, 429, { error: 'Too many confirmation attempts. Please wait a few minutes and try again.' });
  } catch {
    return json(res, 503, { error: 'Payment confirmation is temporarily unavailable. Please retry shortly.' });
  }
  const reference = typeof req.body?.reference === 'string' ? req.body.reference : '';
  if (!/^aisummit_[a-f0-9]{32}$/.test(reference)) return json(res, 400, { error: 'Invalid payment reference.' });
  try {
    const transaction = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
    if (!isValidPaidTransaction(transaction, reference)) return json(res, 402, { paid: false, error: 'Payment has not been confirmed.' });
    await persistPaidRegistration(transaction);
    const emailSent = await sendTicketConfirmationOnce(transaction, reference);
    return json(res, 200, { paid: true, emailSent, reference });
  } catch (error) {
    const notConfigured = error.message === 'PAYMENT_NOT_CONFIGURED' || error.message === 'REGISTRATION_STORAGE_NOT_CONFIGURED';
    return json(res, notConfigured ? 503 : 502, { error: notConfigured ? 'Payment confirmation is temporarily unavailable. Your payment has not been confirmed here yet.' : 'We could not finish confirming your payment. Please retry in a moment.' });
  }
};
