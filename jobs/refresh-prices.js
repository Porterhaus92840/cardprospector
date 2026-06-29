/**
 * Nightly price refresh.
 *
 * Pulls a representative recent price for each card we track and stores a daily
 * snapshot in price_history. Reads from one provider (PRICE_PROVIDER env). This
 * is the ONLY thing that calls the external API — users always read the cached
 * data from MySQL via /api/cards, never the provider directly.
 *
 *   # cards in our DB  ×  once per night  =  total API calls.
 *
 * No-op if no provider is configured, so it's safe to schedule before a data
 * source is wired up.
 *
 * Run manually:   PRICE_PROVIDER=mock node jobs/refresh-prices.js
 * Scheduled via:  PM2 cron (see the database-backend memo / deploy notes).
 */
import 'dotenv/config';
import { getCards, recordPrice, pool } from '../db.js';
import { getProvider } from '../pricing.js';

const THROTTLE_MS = Number(process.env.PRICE_THROTTLE_MS) || 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const provider = getProvider();
  if (!provider) {
    console.log('[refresh] PRICE_PROVIDER not set — nothing to do.');
    return;
  }

  const observedOn = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const cards = await getCards();
  console.log(`[refresh] provider=${provider.name} cards=${cards.length} date=${observedOn}`);

  let ok = 0;
  let fail = 0;
  for (const card of cards) {
    try {
      const r = await provider.fetchPrice(card);
      if (r && r.price != null) {
        await recordPrice(card.id, { ...r, observedOn });
        ok++;
        console.log(`[refresh] ${card.id} ← ${r.price} ${r.currency} (${r.source}, n=${r.sampleSize ?? '?'})`);
      } else {
        console.log(`[refresh] ${card.id} — no data (kept prior snapshot)`);
      }
    } catch (err) {
      // keep-last-on-fail: we simply don't write a new row, so the most recent
      // successful snapshot remains the card's latest known price.
      fail++;
      console.error(`[refresh] ${card.id} failed: ${err.message}`);
    }
    await sleep(THROTTLE_MS);
  }
  console.log(`[refresh] done: ${ok} updated, ${fail} failed.`);
}

main()
  .catch((err) => { console.error('[refresh] fatal:', err.message); process.exitCode = 1; })
  .finally(async () => { await pool.end(); });
