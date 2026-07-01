/**
 * Watchlist alerts (Elite feature). Runs after the nightly price refresh:
 * for each card that an eligible user (Elite/beta, alerts on) is watching, it
 * compares the current price + recommendation to a stored per-card baseline and,
 * when something notable happens, emails the watcher a digest.
 *
 * Triggers:
 *   - price drop ≥ ALERT_DROP_PCT (default 8%) day-over-day
 *   - the card flips to "recommended" (PSA-10 flip crosses the threshold)
 *
 * First run just establishes baselines (no emails). Run manually:
 *   node jobs/send-alerts.js         (live)
 *   node jobs/send-alerts.js --dry   (detect + log, no emails, no baseline writes)
 * Scheduled via PM2 cron.
 */
import 'dotenv/config';
import crypto from 'crypto';
import { getCards, getCardBaselines, setCardBaseline, getEligibleWatches, pool } from '../db.js';
import { scoreCard } from '../scoring.js';
import { sendWatchlistAlertEmail } from '../email.js';

const DROP_PCT = Number(process.env.ALERT_DROP_PCT) || 0.08;
const APP_URL = process.env.APP_URL || 'https://cardprospector.app';
const DRY = process.argv.includes('--dry');

// Stateless unsubscribe token — an HMAC of the user id (not a session token).
function unsubUrl(userId) {
  const sig = crypto.createHmac('sha256', process.env.JWT_SECRET || '').update(`unsub:${userId}`).digest('hex').slice(0, 32);
  return `${APP_URL}/api/alerts/unsubscribe?u=${userId}&t=${sig}`;
}

async function main() {
  const [cards, baselines, watches] = await Promise.all([getCards(), getCardBaselines(), getEligibleWatches()]);
  const cardById = Object.fromEntries(cards.map((c) => [c.id, c]));

  const watchersByCard = {};
  for (const w of watches) (watchersByCard[w.cardId] ||= []).push(w);

  const alertsByUser = {}; // userId -> { email, items: [] }
  let evaluated = 0, changed = 0;

  for (const cardId of Object.keys(watchersByCard)) {
    const card = cardById[cardId];
    if (!card) continue;
    evaluated++;
    const score = scoreCard(card, { withFlip: true });
    const rawNow = card.price?.raw ?? null;
    const recNow = score.recommendation ? (score.recommendation.recommended ? 1 : 0) : null;
    const base = baselines[cardId] || { raw: null, rec: null };
    const first = base.raw == null && base.rec == null;

    const triggers = [];
    if (!first) {
      if (rawNow != null && base.raw != null && base.raw > 0 && rawNow <= base.raw * (1 - DROP_PCT)) {
        const pct = Math.round((1 - rawNow / base.raw) * 100);
        triggers.push({ tone: 'good', headline: `Price dropped ${pct}% — now $${Math.round(rawNow).toLocaleString()} (buy target ~$${Math.round(rawNow * 0.9).toLocaleString()}).` });
      }
      if (recNow === 1 && base.rec !== 1) {
        const rp = score.flip?.returnPct;
        triggers.push({ tone: 'good', headline: `Now recommended${rp != null ? ` — projected +${rp}% grade-flip to PSA 10.` : '.'}` });
      }
    }

    if (triggers.length) {
      changed++;
      for (const w of watchersByCard[cardId]) {
        const u = (alertsByUser[w.userId] ||= { email: w.email, items: [] });
        for (const t of triggers) u.items.push({ player: card.player, set: card.set, headline: t.headline, tone: t.tone });
      }
    }
    if (!DRY) await setCardBaseline(cardId, rawNow, recNow);
  }

  const userIds = Object.keys(alertsByUser);
  console.log(`[alerts] evaluated ${evaluated} watched cards · ${changed} changed · ${userIds.length} user(s) to email${DRY ? ' (DRY)' : ''}`);
  for (const userId of userIds) {
    const u = alertsByUser[userId];
    if (DRY) { console.log(`  → ${u.email}: ${u.items.map((i) => `${i.player} / ${i.headline}`).join(' | ')}`); continue; }
    try {
      await sendWatchlistAlertEmail(u.email, u.items, APP_URL, unsubUrl(userId));
      console.log(`  emailed ${u.email} (${u.items.length} item(s))`);
    } catch (e) {
      console.error(`  email to ${u.email} failed: ${e.message}`);
    }
  }
}

main()
  .catch((err) => { console.error('[alerts] fatal:', err.message); process.exitCode = 1; })
  .finally(async () => { await pool.end(); });
