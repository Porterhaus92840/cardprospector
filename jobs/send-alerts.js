/**
 * Watchlist + portfolio alerts (Elite feature). Runs after the nightly price
 * refresh. For each card an eligible user (Elite/beta, alerts on) watches, and
 * each holding they own, it compares the current state to stored per-card /
 * per-holding baselines and emails a digest of what changed.
 *
 * TRIGGERS
 *   Watchlist (card-level):
 *     • price down >= ALERT_DROP_PCT from the running HIGH (catches cumulative
 *       "rollback": a slow multi-day slide fires once it totals the threshold)
 *     • price up   >= ALERT_RISE_PCT from the running LOW  (cumulative "rollup")
 *     • flips to recommended / no longer recommended
 *     • hold horizon changes (short/mid/long)
 *   Portfolio (holding-level, anchored to your purchase price):
 *     • up   >= ALERT_PORTFOLIO_UP   vs cost  (take-profit nudge)
 *     • down >= ALERT_PORTFOLIO_DOWN vs cost  (drawdown warning)
 *   (hysteresis prevents the same holding re-firing every night)
 *
 * The running high/low reset after a price alert fires, so the next alert needs
 * a fresh threshold-sized move. First run just seeds baselines (no emails).
 *   node jobs/send-alerts.js         (live)
 *   node jobs/send-alerts.js --dry   (detect + log; no emails, no writes)
 */
import 'dotenv/config';
import crypto from 'crypto';
import {
  getCards, getCardBaselines, setCardBaseline, getEligibleWatches,
  getEligiblePortfolios, setPortfolioAlertFlags, pool,
} from '../db.js';
import { scoreCard } from '../scoring.js';
import { sendWatchlistAlertEmail } from '../email.js';

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const DROP = num(process.env.ALERT_DROP_PCT, 0.08);
const RISE = num(process.env.ALERT_RISE_PCT, 0.12);
const PORT_UP = num(process.env.ALERT_PORTFOLIO_UP, 0.25);
const PORT_DOWN = num(process.env.ALERT_PORTFOLIO_DOWN, 0.20);
const HYST = 0.05; // reset a portfolio flag once it pulls back this far
const APP_URL = process.env.APP_URL || 'https://cardprospector.app';
const DRY = process.argv.includes('--dry');

const HORIZON_LABEL = { short: 'short-term', mid: 'mid-term', long: 'long-term' };
const CONDITION_LABEL = { raw: 'Raw', g7: 'PSA 7', g8: 'PSA 8', g9: 'PSA 9', g95: 'Grade 9.5', psa10: 'PSA 10', bgs10: 'BGS 10' };

function unsubUrl(userId) {
  const sig = crypto.createHmac('sha256', process.env.JWT_SECRET || '').update(`unsub:${userId}`).digest('hex').slice(0, 32);
  return `${APP_URL}/api/alerts/unsubscribe?u=${userId}&t=${sig}`;
}

async function main() {
  const [cards, baselines, watches, holdings] = await Promise.all([
    getCards(), getCardBaselines(), getEligibleWatches(), getEligiblePortfolios(),
  ]);
  const cardById = Object.fromEntries(cards.map((c) => [c.id, c]));
  const scoreCache = {};
  const scoreOf = (card) => (scoreCache[card.id] ||= scoreCard(card, { withFlip: true }));

  const alertsByUser = {}; // userId -> { email, items: [] }
  const push = (userId, email, item) => { (alertsByUser[userId] ||= { email, items: [] }).items.push(item); };

  // ---------- Watchlist (card-level) ----------
  const watchersByCard = {};
  for (const w of watches) (watchersByCard[w.cardId] ||= []).push(w);

  for (const cardId of Object.keys(watchersByCard)) {
    const card = cardById[cardId];
    if (!card) continue;
    const score = scoreOf(card);
    const raw = card.price?.raw ?? null;
    const rec = score.recommendation ? (score.recommendation.recommended ? 1 : 0) : null;
    const horizon = score.horizon?.key || null;
    const base = baselines[cardId] || {};

    const triggers = [];
    let newHigh = base.high, newLow = base.low, newRec = base.rec, newHorizon = base.horizon;

    // Cumulative price drop / rise from running extremes
    if (raw != null) {
      if (base.high == null && base.low == null) { newHigh = raw; newLow = raw; } // seed
      else {
        newHigh = Math.max(base.high ?? raw, raw);
        newLow = Math.min(base.low ?? raw, raw);
        if (newHigh > 0 && raw <= newHigh * (1 - DROP)) {
          const pct = Math.round((1 - raw / newHigh) * 100);
          triggers.push({ tone: 'good', headline: `Price is down ${pct}% from its recent high — now $${Math.round(raw).toLocaleString()} (buy target ~$${Math.round(raw * 0.9).toLocaleString()}).` });
          newHigh = raw; newLow = raw;
        } else if (newLow > 0 && raw >= newLow * (1 + RISE)) {
          const pct = Math.round((raw / newLow - 1) * 100);
          triggers.push({ tone: 'warn', headline: `Price is up ${pct}% from its recent low — now $${Math.round(raw).toLocaleString()}.` });
          newHigh = raw; newLow = raw;
        }
      }
    }

    // Recommendation flip
    if (rec != null) {
      if (base.rec == null) newRec = rec;
      else if (rec === 1 && base.rec === 0) {
        const rp = score.flip?.returnPct;
        triggers.push({ tone: 'good', headline: `Now recommended${rp != null ? ` — projected +${rp}% grade-flip to PSA 10.` : '.'}` });
        newRec = 1;
      } else if (rec === 0 && base.rec === 1) {
        triggers.push({ tone: 'warn', headline: 'No longer recommended — the PSA 10 grade-flip fell below our threshold.' });
        newRec = 0;
      } else newRec = rec;
    }

    // Hold horizon change
    if (horizon) {
      if (!base.horizon) newHorizon = horizon;
      else if (horizon !== base.horizon) {
        triggers.push({ tone: 'info', headline: `Hold horizon changed: ${HORIZON_LABEL[base.horizon] || base.horizon} → ${HORIZON_LABEL[horizon] || horizon}.` });
        newHorizon = horizon;
      }
    }

    for (const t of triggers) for (const w of watchersByCard[cardId]) push(w.userId, w.email, { player: card.player, set: card.set, ...t });
    if (!DRY) await setCardBaseline(cardId, { high: newHigh, low: newLow, rec: newRec, horizon: newHorizon });
  }

  // ---------- Portfolio (holding-level) ----------
  for (const h of holdings) {
    const card = cardById[h.cardId];
    if (!card || !h.purchasePrice) continue;
    const value = card.price?.[h.condition] ?? null;
    if (value == null) continue;
    const pct = (value - h.purchasePrice) / h.purchasePrice;
    const cond = CONDITION_LABEL[h.condition] || h.condition;
    let upDone = h.upDone, downDone = h.downDone;

    if (pct >= PORT_UP && !upDone) {
      push(h.userId, h.email, { player: card.player, set: `Your ${cond} · holding`, tone: 'good',
        headline: `Up ${Math.round(pct * 100)}% vs your cost — now $${Math.round(value).toLocaleString()} (paid $${Math.round(h.purchasePrice).toLocaleString()}). Consider taking profit.` });
      upDone = true;
    } else if (pct < PORT_UP - HYST) upDone = false;

    if (pct <= -PORT_DOWN && !downDone) {
      push(h.userId, h.email, { player: card.player, set: `Your ${cond} · holding`, tone: 'warn',
        headline: `Down ${Math.round(-pct * 100)}% vs your cost — now $${Math.round(value).toLocaleString()} (paid $${Math.round(h.purchasePrice).toLocaleString()}).` });
      downDone = true;
    } else if (pct > -(PORT_DOWN - HYST)) downDone = false;

    if (!DRY && (upDone !== h.upDone || downDone !== h.downDone)) await setPortfolioAlertFlags(h.userId, h.cardId, upDone, downDone);
  }

  // ---------- Send digests ----------
  const userIds = Object.keys(alertsByUser);
  console.log(`[alerts] ${userIds.length} user(s) to email${DRY ? ' (DRY)' : ''}`);
  for (const userId of userIds) {
    const u = alertsByUser[userId];
    if (DRY) { console.log(`  → ${u.email} (${u.items.length}): ${u.items.map((i) => `${i.player}: ${i.headline}`).join(' | ')}`); continue; }
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
