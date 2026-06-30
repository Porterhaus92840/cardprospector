/**
 * Refresh card images from the eBay Browse API. Searches the top active listing
 * for each card and caches its image URL. Re-run periodically so images don't
 * go stale when listings end. No-op if eBay isn't configured.
 *
 *   node jobs/refresh-images.js          (all cards)
 *   node jobs/refresh-images.js --missing (only cards without an image)
 */
import 'dotenv/config';
import { getCards, setCardImage, pool } from '../db.js';
import { searchCardImage, ebayEnabled } from '../ebay.js';

const onlyMissing = process.argv.includes('--missing');
const THROTTLE_MS = Number(process.env.EBAY_THROTTLE_MS) || 350;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!ebayEnabled()) {
    console.log('[images] eBay not configured (EBAY_CLIENT_ID/SECRET) — nothing to do.');
    return;
  }
  const cards = (await getCards()).filter((c) => (onlyMissing ? !c.image : true));
  console.log(`[images] ${cards.length} cards to refresh${onlyMissing ? ' (missing only)' : ''}`);

  let ok = 0;
  let fail = 0;
  for (const card of cards) {
    const query = `${card.player} ${card.set} ${card.cardNumber || ''}`.replace(/·/g, ' ').replace(/\s+/g, ' ').trim();
    try {
      const r = await searchCardImage(query);
      if (r && r.imageUrl) {
        await setCardImage(card.id, r.imageUrl);
        ok++;
        console.log(`[images] ${card.id} ← ${r.imageUrl}`);
      } else {
        console.log(`[images] ${card.id} — no listing image found`);
      }
    } catch (err) {
      fail++;
      console.error(`[images] ${card.id} failed: ${err.message}`);
    }
    await sleep(THROTTLE_MS);
  }
  console.log(`[images] done: ${ok} updated, ${fail} failed.`);
}

main()
  .catch((err) => { console.error('[images] fatal:', err.message); process.exitCode = 1; })
  .finally(async () => { await pool.end(); });
