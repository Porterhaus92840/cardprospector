/**
 * Catalog ingestion — pull real cards from SportsCardsPro's product search into
 * the DB. Used by the Control Console "Pull cards" function. Each pulled card
 * gets real prices (from the search response) but placeholder traits (pending
 * curation) and no pop — both surfaced by the console ✓/○ indicators.
 */
import { getCards, createCard, recordPrice } from './db.js';

const TRAIT_KEYS = ['hof', 'peak', 'market', 'position', 'narrative', 'unique', 'longevity'];
const pennies = (v) => (v != null && v !== '' ? Math.round(Number(v)) / 100 : null);
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z]/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Per-sport search config. `prefix` matches the SCP console-name; queries are the
// sets we harvest (base autos / rookies). Only sports with engine archetypes.
const SPORTS = {
  baseball: {
    label: 'Baseball',
    prefix: /^baseball cards/i,
    queries: [
      '2024 bowman chrome prospect autographs', '2023 bowman chrome prospect autographs',
      '2022 bowman chrome prospect autographs', '2021 bowman chrome prospect autographs',
      '2020 bowman chrome prospect autographs', '2019 bowman chrome prospect autographs',
      '2024 bowman draft chrome prospect autographs', '2023 bowman draft chrome prospect autographs',
      '2022 bowman draft chrome prospect autographs',
    ],
  },
  basketball: {
    label: 'Basketball',
    prefix: /^basketball cards/i,
    queries: [
      '2023-24 panini prizm basketball', '2022-23 panini prizm basketball',
      '2021-22 panini prizm basketball', '2020-21 panini prizm basketball',
      '2019-20 panini prizm basketball', '2018-19 panini prizm basketball',
    ],
  },
};

export function pullSports() {
  return Object.entries(SPORTS).map(([id, s]) => ({ id, label: s.label }));
}

async function search(token, q) {
  try {
    const res = await fetch(`https://www.sportscardspro.com/api/products?t=${token}&q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const j = await res.json();
    return j.status === 'success' ? (j.products || []) : [];
  } catch {
    return [];
  }
}

/**
 * Pull up to `count` distinct new cards for `sport`. Skips parallels, non-sport
 * rows, pre-2010, and any player/id already in the DB. Returns a summary.
 */
export async function pullCards({ sport = 'baseball', count = 10 }) {
  const cfg = SPORTS[sport];
  if (!cfg) throw new Error(`Unsupported sport: ${sport}`);
  const token = process.env.SCP_TOKEN;
  if (!token) throw new Error('SCP_TOKEN not set');
  const n = Math.max(1, Math.min(200, Number(count) || 0));

  const raw = [];
  for (const q of cfg.queries) {
    raw.push(...(await search(token, q)));
    await sleep(1100); // SCP ~1 req/sec
  }

  const existing = await getCards();
  const exPlayers = new Set(existing.map((c) => norm(c.player)));
  const exIds = new Set(existing.map((c) => String(c.sportscardsproId)).filter(Boolean));

  const byPlayer = new Map();
  for (const p of raw) {
    const cn = String(p['console-name'] || '');
    const pn = String(p['product-name'] || '');
    if (!cfg.prefix.test(cn)) continue;      // right sport only
    if (/university/i.test(cn)) continue;    // college/multi-sport sets
    if (pn.includes('[')) continue;          // base only (no parallels)
    const m = pn.match(/^(.*?)\s*#(\S+)\s*$/);
    const player = (m ? m[1] : pn).trim();
    const cardNumber = m ? m[2] : null;
    if (!player || player.length < 3) continue;
    const rawPrice = pennies(p['loose-price']);
    if (rawPrice == null || rawPrice <= 0) continue;
    const yearM = cn.match(/((?:19|20)\d{2})/);
    const year = yearM ? Number(yearM[1]) : null;
    if (!year || year < 2010) continue;
    if (exIds.has(String(p.id))) continue;
    const key = norm(player);
    if (exPlayers.has(key)) continue;
    const vol = Number(p['sales-volume']) || 0;
    const rec = {
      id: p.id, player, cardNumber, rawPrice, vol,
      set: cn.replace(/^(baseball|basketball|football) cards\s+/i, '').trim(),
      variant: /autograph/i.test(cn) ? 'auto_base' : 'base_raw',
      prices: {
        priceRaw: rawPrice, priceG7: pennies(p['cib-price']), priceG8: pennies(p['new-price']),
        priceG9: pennies(p['graded-price']), priceG95: pennies(p['box-only-price']),
        pricePsa10: pennies(p['manual-only-price']), priceBgs10: pennies(p['bgs-10-price']),
        sampleSize: Number(p['sales-volume']) || null,
      },
    };
    const cur = byPlayer.get(key);
    if (!cur || vol > cur.vol) byPlayer.set(key, rec); // most-traded card per player
  }

  const pool = [...byPlayer.values()].sort((a, b) => b.vol - a.vol);
  const chosen = pool.slice(0, n);
  const today = new Date().toISOString().slice(0, 10);
  const added = [];
  for (const r of chosen) {
    try {
      const id = await createCard({
        sport, player: r.player, card_set: r.set, card_number: r.cardNumber,
        variant_id: r.variant, sportscardspro_id: String(r.id),
        traits: Object.fromEntries(TRAIT_KEYS.map((t) => [t, 70])), ask_price: Math.round(r.rawPrice),
      }, { markReviewed: false });
      await recordPrice(id, { source: 'sportscardspro', ...r.prices, currency: 'USD', observedOn: today });
      added.push({ player: r.player, set: r.set, rawPrice: r.rawPrice });
    } catch {
      /* skip a bad row */
    }
  }
  return { requested: n, inserted: added.length, available: pool.length, sport, added };
}
