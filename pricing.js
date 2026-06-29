/**
 * Pricing providers — the swappable part of the price pipeline.
 *
 * The refresh job (jobs/refresh-prices.js) asks getProvider() for whichever
 * source is configured via the PRICE_PROVIDER env var, then calls
 * provider.fetchPrice(card) per card. To add a real data source you implement
 * one fetchPrice() and flip PRICE_PROVIDER — nothing else changes.
 *
 * fetchPrice(card) must return { source, price, currency, sampleSize } or null
 * (null = no data found for that card; the prior snapshot is kept).
 */

// Deterministic mock — derives a plausible "recent sale" from the card's ask
// price so the whole pipeline is testable WITHOUT a paid API. It only runs when
// PRICE_PROVIDER=mock is set explicitly; never enable it in production, since
// these are not real market prices.
const mockProvider = {
  name: 'mock',
  async fetchPrice(card) {
    const ask = card.askPrice || 100;
    let h = 0;
    for (let i = 0; i < card.id.length; i++) h = (h * 31 + card.id.charCodeAt(i)) >>> 0;
    const factor = 0.7 + (h % 40) / 100; // 0.70–1.09 of ask, stable per card
    const raw = Math.round(ask * factor);
    const psa10 = Math.round(raw * (1.8 + (h % 20) / 10)); // ~1.8–3.7x raw
    return {
      source: 'mock',
      priceRaw: raw,
      priceG7: Math.round(raw * 0.6),
      priceG8: Math.round(raw * 0.8),
      priceG9: Math.round(psa10 * 0.4),
      priceG95: Math.round(psa10 * 0.6),
      pricePsa10: psa10,
      priceBgs10: Math.round(psa10 * 1.1), // BGS 10 slightly above PSA 10
      currency: 'USD',
      sampleSize: 3 + (h % 12),
    };
  },
};

// SportsCardsPro — each card stores its product id (sportscardsproId). We read
// the ungraded ("loose-price") AND PSA 10 ("manual-only-price") values, in
// pennies, plus sales-volume as the sample size. Token from SCP_TOKEN in .env.
const sportscardsproProvider = {
  name: 'sportscardspro',
  async fetchPrice(card) {
    const id = card.sportscardsproId;
    if (!id) return null; // card not mapped to a product → skip
    const token = process.env.SCP_TOKEN;
    if (!token) throw new Error('SCP_TOKEN not set');

    const res = await fetch(`https://www.sportscardspro.com/api/product?id=${encodeURIComponent(id)}&t=${token}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    if (d.status !== 'success') throw new Error(`status ${d.status}`);

    // Field → grade mapping (verified against live products):
    //  loose=raw, cib=Grade 7, new=Grade 8, graded=Grade 9,
    //  box-only=Grade 9.5, manual-only=PSA 10, bgs-10=BGS 10.
    const c = (k) => (d[k] != null ? Math.round(d[k]) / 100 : null);
    const rawV = c('loose-price');
    if (rawV == null && c('manual-only-price') == null && c('bgs-10-price') == null) return null;
    return {
      source: 'sportscardspro',
      priceRaw: rawV,
      priceG7: c('cib-price'),
      priceG8: c('new-price'),
      priceG9: c('graded-price'),
      priceG95: c('box-only-price'),
      pricePsa10: c('manual-only-price'),
      priceBgs10: c('bgs-10-price'),
      currency: 'USD',
      sampleSize: d['sales-volume'] ?? null,
    };
  },
};

// Placeholder for eBay's Marketplace Insights (sold comps), if ever needed
// alongside SportsCardsPro. Read credentials from process.env — never hardcode.
const ebayProvider = {
  name: 'ebay',
  async fetchPrice() {
    throw new Error('eBay provider not implemented yet — awaiting Marketplace Insights API access.');
  },
};

export function getProvider() {
  const name = (process.env.PRICE_PROVIDER || '').toLowerCase();
  if (name === 'mock') return mockProvider;
  if (name === 'sportscardspro') return sportscardsproProvider;
  if (name === 'ebay') return ebayProvider;
  return null; // no provider configured → refresh job is a safe no-op
}
