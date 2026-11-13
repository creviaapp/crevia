const { Resend } = require('resend');
const { claimTicketEmail, finishTicketEmail } = require('./paystack');

function confirmationEmailHtml(reference) {
  const safeReference = reference.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);

  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#f3f5f2;color:#17211c;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5f2;padding:36px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;">
          <tr><td style="background:#0B2B20;padding:30px 36px;color:#ffffff;">
            <p style="margin:0;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#d3e0d8;">Crevia presents</p>
            <p style="margin:10px 0 0;font-size:25px;font-weight:700;letter-spacing:-.5px;">The 2nd Annual AI Summit</p>
          </td></tr>
          <tr><td style="padding:38px 36px 20px;">
            <p style="margin:0 0 12px;color:#47735f;font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;">Your place is confirmed</p>
            <h1 style="margin:0;color:#15221b;font-size:30px;line-height:1.2;letter-spacing:-.8px;">Welcome to the room.</h1>
            <p style="margin:18px 0 0;color:#536159;font-size:16px;line-height:1.7;">You’re joining us for <strong style="color:#17211c;">The 2nd Annual AI Summit: The Blueprint</strong> — a day for founders, builders, and investors putting AI to work across African business.</p>
          </td></tr>
          <tr><td style="padding:12px 36px 28px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f8f6;border-radius:14px;">
              <tr><td style="padding:20px 22px;border-bottom:1px solid #e5ebe6;">
                <p style="margin:0;color:#718077;font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;">Date</p>
                <p style="margin:7px 0 0;color:#17211c;font-size:16px;font-weight:600;">March 27th, 2027</p>
              </td></tr>
              <tr><td style="padding:20px 22px;border-bottom:1px solid #e5ebe6;">
                <p style="margin:0;color:#718077;font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;">Location</p>
                <p style="margin:7px 0 0;color:#17211c;font-size:16px;font-weight:600;">Nairobi, Kenya</p>
              </td></tr>
              <tr><td style="padding:20px 22px;">
                <p style="margin:0;color:#718077;font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;">Your ticket number</p>
                <p style="margin:8px 0 0;color:#0B2B20;font-family:Consolas,Monaco,monospace;font-size:14px;font-weight:700;overflow-wrap:anywhere;">${safeReference}</p>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:0 36px 34px;">
            <a href="https://crevia.app/aisummit" style="display:inline-block;border-radius:10px;background:#0B2B20;padding:14px 20px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">View summit details</a>
            <p style="margin:24px 0 0;color:#536159;font-size:15px;line-height:1.7;">Less talking. More doing. We look forward to seeing you there.</p>
          </td></tr>
          <tr><td style="border-top:1px solid #edf0ed;padding:20px 36px;color:#88938c;font-size:12px;line-height:1.6;">Crevia · Building the right way for Africa<br>Questions? <a href="mailto:hello@crevia.app" style="color:#0B2B20;">hello@crevia.app</a></td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

async function sendTicketConfirmation(transaction, reference, recipient = transaction.customer?.email) {
  if (!process.env.RESEND_API_KEY) {
    console.error('AI Summit confirmation email skipped: RESEND_API_KEY is not configured.');
    return false;
  }
  if (typeof recipient !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    console.error('AI Summit confirmation email skipped: recipient email is invalid.');
    return false;
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
      to: [recipient],
      subject: 'Your Ticket: The 2nd Annual AI Summit',
      html: confirmationEmailHtml(reference),
      text: `Your place is confirmed for The 2nd Annual AI Summit: The Blueprint.\n\nDate: March 27th, 2027\nLocation: Nairobi, Kenya\nTicket number: ${reference}\n\nLess talking. More doing.\n\nView summit details: https://crevia.app/aisummit`
    }, { idempotencyKey: `ai-summit-ticket/${reference}` });

    if (error) {
      console.error('AI Summit confirmation email failed:', error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error('AI Summit confirmation email failed:', error.message);
    return false;
  }
}

async function sendTicketConfirmationOnce(transaction, reference, recipient = transaction.customer?.email) {
  const claim = await claimTicketEmail(reference);
  if (!claim.claimed) return claim.sent || claim.processing;

  let sent = false;
  try {
    sent = await sendTicketConfirmation(transaction, reference, recipient);
    return sent;
  } finally {
    await finishTicketEmail(reference, claim.claimAt, sent);
  }
}

module.exports = { sendTicketConfirmation, sendTicketConfirmationOnce };
