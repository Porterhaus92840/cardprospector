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
    return {
      source: 'mock',
      price: Math.round(ask * factor),
      currency: 'USD',
      sampleSize: 3 + (h % 12),
    };
  },
};

// Placeholder for the real source. Implement fetchPrice() against eBay
// Marketplace Insights (sold comps) or a paid card-data API once a key exists.
// Read credentials from process.env (e.g. EBAY_OAUTH_TOKEN) — never hardcode.
const ebayProvider = {
  name: 'ebay',
  async fetchPrice() {
    throw new Error('eBay provider not implemented yet — awaiting Marketplace Insights API access.');
  },
};

export function getProvider() {
  const name = (process.env.PRICE_PROVIDER || '').toLowerCase();
  if (name === 'mock') return mockProvider;
  if (name === 'ebay') return ebayProvider;
  return null; // no provider configured → refresh job is a safe no-op
}
