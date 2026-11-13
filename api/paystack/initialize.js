const { randomUUID } = require('node:crypto');
const { AMOUNT_SUBUNITS, CURRENCY, EVENT_CODE, json, paystack, validOrigin, safeText } = require('../../lib/paystack');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  if (!validOrigin(req)) return json(res, 403, { error: 'Request origin not allowed.' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(res, 503, { error: 'Checkout is being configured. Please try again shortly.' });
  }
  const body = req.body || {};
  const name = safeText(body.name, 100);
  const email = safeText(body.email, 254).toLowerCase();
  const phone = safeText(body.phone, 30);
  const organization = safeText(body.organization, 120);
  const goal = safeText(body.goal, 120);
  const allowedGoals = new Set([
    'Apply AI to business operations',
    'Automate workflows and scale',
    'Explore AI tools and infrastructure',
    'Meet founders, builders, and investors'
  ]);
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.length < 7 || organization.length < 2 || !allowedGoals.has(goal)) {
    return json(res, 400, { error: 'Please complete all required attendee details.' });
  }
  const reference = `aisummit_${randomUUID().replaceAll('-', '')}`;
  try {
    const transaction = await paystack('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email,
        amount: AMOUNT_SUBUNITS,
        currency: CURRENCY,
        reference,
        callback_url: 'https://crevia.app/aisummit?checkout=return',
        metadata: {
          event_code: EVENT_CODE,
          attendee: { name, phone, organization, goal },
          custom_fields: [
            { display_name: 'Attendee name', variable_name: 'attendee_name', value: name },
            { display_name: 'Phone number', variable_name: 'attendee_phone', value: phone },
            { display_name: 'Organization', variable_name: 'organization', value: organization },
            { display_name: 'Event goal', variable_name: 'event_goal', value: goal }
          ]
        }
      })
    });
    if (!transaction?.access_code) return json(res, 502, { error: 'Could not start checkout. Please try again.' });
    return json(res, 200, { accessCode: transaction.access_code, reference });
  } catch (error) {
    const configured = error.message !== 'PAYMENT_NOT_CONFIGURED';
    return json(res, configured ? 502 : 503, { error: configured ? 'Could not start checkout. Please try again.' : 'Checkout is being configured. Please try again shortly.' });
  }
};
