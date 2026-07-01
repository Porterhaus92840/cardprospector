/**
 * Transactional email via Resend (https://resend.com). Sending requires
 * RESEND_API_KEY in the server .env and a VERIFIED sending domain
 * (EMAIL_FROM must be on that domain). Until the domain is verified, sends
 * throw — callers log the error and degrade gracefully.
 */
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'CardProspector <noreply@cardprospector.app>';
// Set EMAIL_LOGO_URL to a hosted PNG (~360px wide) to show the logo in email
// headers; falls back to the text wordmark until it's set.
const EMAIL_LOGO_URL = process.env.EMAIL_LOGO_URL || '';

export const emailEnabled = () => Boolean(RESEND_API_KEY);

export async function sendEmail({ to, subject, html, text }) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not set');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: Array.isArray(to) ? to : [to], subject, html, text }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

// Branded wrapper so all our emails share a look.
function shell(bodyHtml) {
  const header = EMAIL_LOGO_URL
    ? `<img src="${EMAIL_LOGO_URL}" alt="CardProspector" width="180" style="display:block;margin-bottom:16px;max-width:180px;height:auto;border:0" />`
    : `<div style="font-size:20px;font-weight:700;margin-bottom:16px">Card<span style="color:#f97316">Prospector</span></div>`;
  return `<div style="font-family:system-ui,-apple-system,sans-serif;background:#0c0a09;color:#f5f5f4;padding:24px">
    <div style="max-width:480px;margin:0 auto;background:#18181b;border:1px solid #27272a;border-radius:12px;padding:24px">
      ${header}
      ${bodyHtml}
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #27272a;font-size:11px;color:#71717a">
        For educational and informational purposes only — not financial or investment advice.
      </div>
    </div>
  </div>`;
}

export async function sendWatchlistAlertEmail(to, items, appUrl, unsubscribeUrl) {
  const toneColor = (t) => ({ good: '#34d399', warn: '#fbbf24', info: '#a1a1aa' }[t] || '#d4d4d8');
  const rows = items.map((it) => `
    <div style="padding:12px 0;border-bottom:1px solid #27272a">
      <div style="font-size:14px;font-weight:600;color:#f5f5f4">${it.player}</div>
      <div style="font-size:12px;color:#a1a1aa">${it.set || ''}</div>
      <div style="font-size:13px;color:${toneColor(it.tone)};margin-top:4px">${it.headline}</div>
    </div>`).join('');
  const html = shell(`
    <p style="font-size:14px;line-height:1.6;color:#d4d4d8">
      ${items.length === 1 ? "Here's an update on a card you track:" : `Here are ${items.length} updates on cards you track:`}
    </p>
    <div style="margin:8px 0 16px">${rows}</div>
    <p style="margin:16px 0"><a href="${appUrl}" style="display:inline-block;background:#f97316;color:#0c0a09;font-weight:600;text-decoration:none;padding:10px 18px;border-radius:8px">Open CardProspector</a></p>
    <p style="font-size:11px;color:#71717a">You get these because you have watchlist alerts on. <a href="${unsubscribeUrl}" style="color:#a1a1aa">Unsubscribe</a>.</p>
  `);
  const text = `Watchlist update:\n${items.map((it) => `- ${it.player}: ${it.headline}`).join('\n')}\n\nOpen: ${appUrl}\nUnsubscribe: ${unsubscribeUrl}`;
  return sendEmail({ to, subject: `Watchlist update — ${items[0].player}${items.length > 1 ? ` +${items.length - 1} more` : ''}`, html, text });
}

export async function sendPasswordResetEmail(to, resetUrl) {
  const html = shell(`
    <p style="font-size:14px;line-height:1.6;color:#d4d4d8">
      We got a request to reset your CardProspector password. Click below to choose a new one —
      this link expires in 1 hour. If you didn't request this, you can safely ignore this email.
    </p>
    <p style="margin:20px 0">
      <a href="${resetUrl}" style="display:inline-block;background:#f97316;color:#0c0a09;font-weight:600;text-decoration:none;padding:10px 18px;border-radius:8px">Reset password</a>
    </p>
    <p style="font-size:12px;color:#a1a1aa;word-break:break-all">Or paste this link: ${resetUrl}</p>
  `);
  const text = `Reset your CardProspector password (expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, ignore this email.`;
  return sendEmail({ to, subject: 'Reset your CardProspector password', html, text });
}
