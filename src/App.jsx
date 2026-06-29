import React, { useState, useEffect, useMemo, useCallback } from 'react';
import FEATURED_CARDS_SEED from './data/cards.seed.json';

/* ============================================================================
   CARDPROSPECTOR V2
   ----------------------------------------------------------------------------
   Stage 1 rebuild: sport-aware engine, scarcity-aware scoring, dossier-first
   card view, Learn tab, Admin panel for manual pop entry, eBay affiliate
   wiring, PSA cert verification stub.

   Architecture changes from V1 (CardProspectorV3 / CardProspector.jsx):
   - Engine is now sport-parameterized. Baseball is active; basketball is
     stubbed out for Stage 2.
   - CombinedScore = PlayerSignal × ScarcityMultiplier (normalized).
   - Scarcity inputs are nullable. Missing data falls back to neutral 1.0x
     and the card is flagged "Player signal only."
   - Card detail view is now a Dossier, not a verdict. Process over picks.
   - localStorage key bumped to v2 to avoid stomping V1 portfolios.

   CONFIG: fill in EPN_TRACKING_ID and PSA_API_TOKEN once you have them.
   ============================================================================ */

const CONFIG = {
  // Get this from partnernetwork.ebay.com after approval (Campaign ID).
  // Format is usually a long numeric string. Used as `mkcid=1&mkrid=...&campid=YOUR_ID`.
  EPN_CAMPAIGN_ID: '5339158521',
  EPN_GEO: 'US', // your audience geo; affects which eBay site to link to
  // PSA API token (Bearer). Get from psacard.com/publicapi after registration.
  // Used for portfolio cert verification only — pop data is NOT in this API.
  PSA_API_TOKEN: '',
  // Grading-flip model (tunable). Costs below are real, not assumptions:
  //  - TAG Basic grading is $22/card (10-card minimum order).
  //  - eBay trading-card final value fee is 13.6% + $0.40/order (2026).
  // (Cards sold $1,000+ may qualify for a 50% FVF discount promo — not modeled.)
  BUY_DISCOUNT: 0.10,        // target buy = raw price minus this
  GRADING_COST: 22,          // TAG Basic, $/card
  EBAY_FEE_RATE: 0.136,      // eBay final value fee
  EBAY_PER_ORDER_FEE: 0.40,
  // NOTE: the admin gate now lives server-side (ADMIN_TOKEN in the server .env),
  // verified via POST /api/admin/verify — not in this public bundle.
  // Where the footer "Send feedback" link points. Consider a dedicated
  // address (e.g. hello@cardprospector.app) instead of a personal inbox.
  CONTACT_EMAIL: 'daleporter2009@yahoo.com',
  // Newsletter signup form URL (ConvertKit / Substack / Beehiiv). When empty,
  // the email CTA falls back to a mailto. Wire a real provider in Stage 2.
  NEWSLETTER_URL: '',
};

const STORAGE_KEY = 'cardprospector:v2';

/* ============================================================================
   PLAYBOOKS — historical premium-card archetypes by sport
   ----------------------------------------------------------------------------
   Each archetype scores 0-100 on the seven traits. The engine matches a
   candidate card's player profile against these archetypes via weighted
   cosine similarity to find the closest historical comp.

   Traits:
   - hof:        HOF trajectory probability
   - peak:       MVP-tier peak intensity
   - market:     Big-market / national-spotlight team
   - position:   Premium position (C/SS/CF in baseball; PG/SF in basketball)
   - narrative:  Story / cultural resonance
   - unique:     Unique skill that defines the player
   - longevity:  Sustained career length
   ============================================================================ */

const PLAYBOOKS = {
  baseball: [
    { id: 'mantle',  name: 'Mickey Mantle',     era: '1951 Bowman',     traits: { hof: 100, peak: 98, market: 100, position: 95, narrative: 98, unique: 92, longevity: 85 } },
    { id: 'jeter',   name: 'Derek Jeter',       era: '1993 SP Foil',    traits: { hof: 100, peak: 78, market: 100, position: 95, narrative: 96, unique: 70, longevity: 98 } },
    { id: 'griffey', name: 'Ken Griffey Jr.',   era: '1989 Upper Deck', traits: { hof: 100, peak: 92, market: 70, position: 95, narrative: 90, unique: 88, longevity: 80 } },
    { id: 'trout',   name: 'Mike Trout',        era: '2011 Topps Update', traits: { hof: 98,  peak: 100, market: 55, position: 95, narrative: 75, unique: 95, longevity: 75 } },
    { id: 'ohtani',  name: 'Shohei Ohtani',     era: '2018 Topps Chrome', traits: { hof: 95,  peak: 100, market: 95, position: 80, narrative: 100, unique: 100, longevity: 70 } },
    { id: 'acuna',   name: 'Ronald Acuña Jr.',  era: '2018 Bowman Chrome', traits: { hof: 88,  peak: 95, market: 65, position: 75, narrative: 85, unique: 88, longevity: 70 } },
    { id: 'soto',    name: 'Juan Soto',         era: '2018 Bowman Chrome', traits: { hof: 92,  peak: 90, market: 95, position: 65, narrative: 88, unique: 85, longevity: 80 } },
    { id: 'judge',   name: 'Aaron Judge',       era: '2013 Bowman Chrome', traits: { hof: 85,  peak: 95, market: 100, position: 60, narrative: 92, unique: 90, longevity: 65 } },
  ],
  // Stage 2 — populated but engine doesn't activate until sport selector ships.
  basketball: [
    { id: 'jordan',  name: 'Michael Jordan',    era: '1986 Fleer',      traits: { hof: 100, peak: 100, market: 95, position: 70, narrative: 100, unique: 100, longevity: 90 } },
    { id: 'kobe',    name: 'Kobe Bryant',       era: '1996-97 Topps Chrome Refractor', traits: { hof: 100, peak: 95, market: 100, position: 70, narrative: 100, unique: 92, longevity: 95 } },
    { id: 'lebron',  name: 'LeBron James',      era: '2003-04 Topps Chrome', traits: { hof: 100, peak: 100, market: 95, position: 65, narrative: 100, unique: 95, longevity: 100 } },
    { id: 'kg',      name: 'Kevin Garnett',     era: '1995-96 Topps',   traits: { hof: 98,  peak: 90, market: 60, position: 78, narrative: 80, unique: 88, longevity: 95 } },
    { id: 'curry',   name: 'Stephen Curry',     era: '2009-10 Topps Chrome Refractor', traits: { hof: 100, peak: 95, market: 85, position: 90, narrative: 95, unique: 100, longevity: 92 } },
    { id: 'giannis', name: 'Giannis Antetokounmpo', era: '2013-14 Panini Prizm', traits: { hof: 95, peak: 95, market: 50, position: 70, narrative: 90, unique: 95, longevity: 80 } },
    { id: 'luka',    name: 'Luka Dončić',       era: '2018-19 Panini Prizm', traits: { hof: 92, peak: 95, market: 80, position: 90, narrative: 90, unique: 95, longevity: 75 } },
    { id: 'wemby',   name: 'Victor Wembanyama', era: '2023-24 Panini Prizm', traits: { hof: 90, peak: 95, market: 60, position: 65, narrative: 100, unique: 100, longevity: 70 } },
  ],
};

const TRAIT_WEIGHTS = {
  baseball:  { hof: 0.20, peak: 0.18, market: 0.12, position: 0.10, narrative: 0.18, unique: 0.12, longevity: 0.10 },
  basketball:{ hof: 0.18, peak: 0.18, market: 0.10, position: 0.08, narrative: 0.22, unique: 0.16, longevity: 0.08 },
};

/* ============================================================================
   SCARCITY LADDER — 15 parallel variants from base RC raw to Superfractor 1/1
   ----------------------------------------------------------------------------
   `rarity` is the multiplier applied to the player signal. Higher = more
   scarce. Values are calibrated to roughly track historical market premiums
   on Topps Chrome / Bowman Chrome RCs.
   ============================================================================ */

const SCARCITY_LADDER = [
  { id: 'base_raw',         label: 'Base RC (Raw)',                rarity: 1.00, print: null },
  { id: 'base_psa9',        label: 'Base RC PSA 9',                rarity: 1.15, print: null },
  { id: 'base_psa10',       label: 'Base RC PSA 10',               rarity: 1.40, print: null },
  { id: 'refractor',        label: 'Refractor',                    rarity: 1.30, print: null },
  { id: 'refractor_psa10',  label: 'Refractor PSA 10',             rarity: 1.65, print: null },
  { id: 'xfractor',         label: 'X-Fractor / Mosaic',           rarity: 1.55, print: 299 },
  { id: 'blue',             label: 'Blue Refractor /150',          rarity: 1.85, print: 150 },
  { id: 'green',            label: 'Green Refractor /99',          rarity: 2.10, print: 99 },
  { id: 'gold',             label: 'Gold Refractor /50',           rarity: 2.40, print: 50 },
  { id: 'orange',           label: 'Orange Refractor /25',         rarity: 2.65, print: 25 },
  { id: 'red',              label: 'Red Refractor /5',             rarity: 2.85, print: 5 },
  { id: 'auto_base',        label: 'Base Auto',                    rarity: 1.80, print: null },
  { id: 'auto_refractor',   label: 'Refractor Auto /499',          rarity: 2.05, print: 499 },
  { id: 'auto_gold',        label: 'Gold Auto /50',                rarity: 2.70, print: 50 },
  { id: 'superfractor',     label: 'Superfractor 1/1',             rarity: 3.00, print: 1 },
];

/* ============================================================================
   FEATURED CARDS — the rotating Scout list
   ----------------------------------------------------------------------------
   `pop` fields are optional. When present, the engine uses real scarcity
   data; when null, it falls back to ladder rarity only and flags the card
   "Player signal only."

   You (or an admin user) populate `pop` via the Admin tab. For Stage 1 these
   are seeded with realistic-ish placeholder values so the UI demonstrates
   both states.
   ============================================================================ */

// Legacy inline seed — superseded by the cards.seed.json import above and the
// live /api/cards data. Unused (tree-shaken from the production build); kept
// only as a reference and removed in a later cleanup.
const _LEGACY_INLINE_SEED = [
  {
    id: 'langford-bowman-chrome-orange',
    sport: 'baseball',
    player: 'Wyatt Langford',
    team: 'Rangers',
    position: 'LF',
    set: '2023 Bowman Chrome Prospect Auto',
    variantId: 'orange',
    askPrice: 850,
    traits: { hof: 65, peak: 75, market: 65, position: 55, narrative: 70, unique: 70, longevity: 65 },
    pop: { psa10: 12, psa10_30d_prior: 8, listings_active: 4 },
    bearCase: "Power tool is real but plate discipline regressed in AAA. If the 2026 K-rate drifts above 28%, archetype match weakens fast.",
  },
  {
    id: 'jackson-bowman-chrome-refractor-psa10',
    sport: 'baseball',
    player: 'Jackson Chourio',
    team: 'Brewers',
    position: 'CF',
    set: '2022 Bowman Chrome Prospect Auto',
    variantId: 'refractor_psa10',
    askPrice: 1200,
    traits: { hof: 78, peak: 80, market: 50, position: 95, narrative: 72, unique: 80, longevity: 70 },
    pop: { psa10: 84, psa10_30d_prior: 71, listings_active: 11 },
    bearCase: "Small-market drag is real and persistent. A trade to a coastal team would re-rate the card; absent that, ceiling is capped by Brewers narrative.",
  },
  {
    id: 'holliday-topps-chrome-gold',
    sport: 'baseball',
    player: 'Jackson Holliday',
    team: 'Orioles',
    position: 'SS',
    set: '2024 Topps Chrome Update Auto',
    variantId: 'gold',
    askPrice: 2400,
    traits: { hof: 82, peak: 82, market: 70, position: 95, narrative: 88, unique: 75, longevity: 72 },
    pop: null,
    bearCase: "Legacy premium (his dad's career) is doing real lifting in the narrative score. If first full MLB season disappoints, the comp drifts toward Wieters, not Jeter.",
  },
  {
    id: 'walker-bowman-chrome-blue',
    sport: 'baseball',
    player: 'Jordan Walker',
    team: 'Cardinals',
    position: 'RF',
    set: '2020 Bowman Chrome Prospect Auto',
    variantId: 'blue',
    askPrice: 380,
    traits: { hof: 68, peak: 78, market: 60, position: 55, narrative: 65, unique: 72, longevity: 68 },
    pop: { psa10: 38, psa10_30d_prior: 36, listings_active: 7 },
    bearCase: "Defensive home unsettled; if he ends up at 1B/DH the position score collapses and the comp set shrinks dramatically.",
  },
  {
    id: 'demayo-bowman-chrome-base',
    sport: 'baseball',
    player: 'Kyle Teel',
    team: 'White Sox',
    position: 'C',
    set: '2023 Bowman Draft Chrome Auto',
    variantId: 'refractor',
    askPrice: 95,
    traits: { hof: 70, peak: 70, market: 60, position: 100, narrative: 68, unique: 72, longevity: 70 },
    pop: { psa10: 142, psa10_30d_prior: 135, listings_active: 22 },
    bearCase: "Catcher longevity risk is structural — the position discount applies in reverse to long-term holds. Best as a 12-24 month flip, not a long hold.",
  },
  {
    id: 'crews-bowman-chrome-orange',
    sport: 'baseball',
    player: 'Dylan Crews',
    team: 'Nationals',
    position: 'CF',
    set: '2023 Bowman Draft Chrome Auto',
    variantId: 'orange',
    askPrice: 1850,
    traits: { hof: 80, peak: 82, market: 65, position: 95, narrative: 80, unique: 78, longevity: 75 },
    pop: { psa10: 18, psa10_30d_prior: 14, listings_active: 3 },
    bearCase: "Nationals market discount is the live risk. Soto-style narrative requires either a deep playoff run with Washington or a trade to NYY/LAD.",
  },
  {
    id: 'skenes-topps-chrome-gold-auto',
    sport: 'baseball',
    player: 'Paul Skenes',
    team: 'Pirates',
    position: 'SP',
    set: '2024 Topps Chrome Rookie Auto',
    variantId: 'auto_gold',
    askPrice: 3200,
    traits: { hof: 78, peak: 96, market: 45, position: 45, narrative: 92, unique: 95, longevity: 58 },
    pop: { psa10: 22, psa10_30d_prior: 19, listings_active: 5 },
    bearCase: "Pitcher attrition is the whole risk — one elbow re-rates this overnight. Pittsburgh also caps national demand; the ceiling needs a trade or a deep October run to fully unlock.",
  },
  {
    id: 'dominguez-bowman-chrome-blue',
    sport: 'baseball',
    player: 'Jasson Domínguez',
    team: 'Yankees',
    position: 'CF',
    set: '2019 Bowman Chrome Prospect Auto',
    variantId: 'blue',
    askPrice: 520,
    traits: { hof: 74, peak: 80, market: 100, position: 95, narrative: 90, unique: 76, longevity: 75 },
    pop: { psa10: 64, psa10_30d_prior: 58, listings_active: 14 },
    bearCase: "Hype ('The Martian') has run ahead of production for years. If he settles in as an average regular, the Yankees market premium can't carry the card by itself.",
  },
  {
    id: 'anthony-bowman-chrome-orange',
    sport: 'baseball',
    player: 'Roman Anthony',
    team: 'Red Sox',
    position: 'LF',
    set: '2022 Bowman Draft Chrome Auto',
    variantId: 'orange',
    askPrice: 950,
    traits: { hof: 80, peak: 82, market: 90, position: 55, narrative: 80, unique: 80, longevity: 76 },
    pop: { psa10: 16, psa10_30d_prior: 13, listings_active: 4 },
    bearCase: "Corner-OF profile leans entirely on the bat — there's no position cushion. If the in-game power lands below the projection, the comp set shrinks fast.",
  },
  {
    id: 'caminero-bowman-chrome-green',
    sport: 'baseball',
    player: 'Junior Caminero',
    team: 'Rays',
    position: '3B',
    set: '2023 Bowman Chrome Prospect Auto',
    variantId: 'green',
    askPrice: 300,
    traits: { hof: 76, peak: 88, market: 40, position: 60, narrative: 70, unique: 82, longevity: 72 },
    pop: { psa10: 121, psa10_30d_prior: 96, listings_active: 19 },
    bearCase: "Rays market is the structural drag and pop is growing fast (supply flooding in). Elite power plays anywhere, but national demand needs a trade or a postseason stage.",
  },
  {
    id: 'pca-bowman-chrome-refractor-psa10',
    sport: 'baseball',
    player: 'Pete Crow-Armstrong',
    team: 'Cubs',
    position: 'CF',
    set: '2021 Bowman Chrome Prospect Auto',
    variantId: 'refractor_psa10',
    askPrice: 240,
    traits: { hof: 72, peak: 80, market: 80, position: 95, narrative: 75, unique: 90, longevity: 78 },
    pop: { psa10: 58, psa10_30d_prior: 49, listings_active: 12 },
    bearCase: "Value is glove-first. If the bat stays below-average, the card is a defensive-highlight novelty rather than a premium long-term hold.",
  },
  {
    id: 'salas-bowman-chrome-gold',
    sport: 'baseball',
    player: 'Ethan Salas',
    team: 'Padres',
    position: 'C',
    set: '2023 Bowman Chrome Prospect Auto',
    variantId: 'gold',
    askPrice: 680,
    traits: { hof: 76, peak: 78, market: 60, position: 100, narrative: 82, unique: 80, longevity: 64 },
    pop: null,
    bearCase: "Catcher development is slow and nonlinear — he's years from MLB impact, and the position carries real longevity and injury risk that the narrative score currently underweights.",
  },
];

/* ============================================================================
   ENGINE
   ============================================================================ */

function cosineSimilarity(a, b, weights) {
  let dot = 0, normA = 0, normB = 0;
  for (const key of Object.keys(weights)) {
    const w = weights[key];
    const av = (a[key] ?? 0) * w;
    const bv = (b[key] ?? 0) * w;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function findBestComp(cardTraits, sport) {
  const playbook = PLAYBOOKS[sport] || [];
  const weights = TRAIT_WEIGHTS[sport] || TRAIT_WEIGHTS.baseball;
  let best = null;
  let bestScore = -1;
  for (const archetype of playbook) {
    const sim = cosineSimilarity(cardTraits, archetype.traits, weights);
    if (sim > bestScore) { bestScore = sim; best = archetype; }
  }
  // Identify the 2-3 traits doing the most lifting in the match.
  const matchDrivers = best
    ? Object.keys(weights)
        .map((k) => ({
          key: k,
          weight: weights[k],
          cardVal: cardTraits[k] ?? 0,
          archVal: best.traits[k] ?? 0,
          contribution: weights[k] * Math.min(cardTraits[k] ?? 0, best.traits[k] ?? 0),
        }))
        .sort((a, b) => b.contribution - a.contribution)
        .slice(0, 3)
    : [];
  return { archetype: best, similarity: bestScore, drivers: matchDrivers };
}

function computePlayerSignal(card) {
  const { similarity } = findBestComp(card.traits, card.sport);
  return Math.round(similarity * 100);
}

function computeScarcityMultiplier(card) {
  const variant = SCARCITY_LADDER.find((v) => v.id === card.variantId);
  const ladderRarity = variant ? variant.rarity : 1.0;

  if (!card.pop) {
    return { multiplier: ladderRarity, hasRealData: false, popVelocity: null };
  }
  // 30-day PSA-10 pop growth (percent), derived from our own snapshots.
  // Null until there's a snapshot ~30 days old → no velocity adjustment yet.
  // Slower growth = scarcer (less new supply); fast growth compresses the premium.
  const velPct = card.pop.change30dPsa10;
  let velocityAdj = 0;
  if (velPct != null) {
    if (velPct < 5) velocityAdj = 0.15;
    else if (velPct < 10) velocityAdj = 0.05;
    else if (velPct < 20) velocityAdj = -0.05;
    else velocityAdj = -0.15;
  }
  return {
    multiplier: ladderRarity + velocityAdj,
    hasRealData: true,
    popVelocity: velPct, // percent, or null while still accumulating snapshots
    gemRate: card.pop.gemRate,
    total: card.pop.total,
  };
}

function computeCombinedScore(card) {
  const playerSignal = computePlayerSignal(card);
  const scarcity = computeScarcityMultiplier(card);
  // Combined score: player signal scaled by scarcity, normalized to 0-100.
  // True max multiplier = 3.00 ladder (Superfractor 1/1) + 0.15 velocity = 3.15,
  // so a perfect-signal card with verified scarcity can reach ~100.
  const raw = playerSignal * scarcity.multiplier;
  const normalized = Math.min(100, Math.round(raw / 3.15));
  return { playerSignal, scarcity, combinedScore: normalized };
}

// Sell-ladder order, lowest grade → highest. Shared by the flip math and the
// dossier table so "best grade" highlighting stays in sync.
const GRADE_ROWS = [
  ['PSA 7', 'g7'], ['PSA 8', 'g8'], ['PSA 9', 'g9'], ['Grade 9.5', 'g95'],
  ['PSA 10', 'psa10'], ['BGS 10', 'bgs10'], ['TAG 10', 'tag10'],
];

/* ----------------------------------------------------------------------------
   GRADING FLIP — buy the raw card (at a discount), grade it (TAG), sell graded.
   All costs are real: TAG grading fee + eBay final value fee + per-order fee.
   We can't source TAG sale prices, so we show the NET return for each graded
   comp we DO have (PSA 10, BGS 10; TAG when known) and let the user judge.
   flipScore blends engine conviction with the (PSA-10-referenced) net arbitrage.
   Returns null unless the card has a raw price and at least one graded comp.
   ---------------------------------------------------------------------------- */
function computeFlip(card, combinedScore) {
  const raw = card.price?.raw;
  if (raw == null) return null;
  const targetBuy = raw * (1 - CONFIG.BUY_DISCOUNT);
  const costBasis = targetBuy + CONFIG.GRADING_COST;

  // Net profit selling at a given graded price, after eBay fees.
  const netFor = (sell) => {
    if (sell == null) return null;
    const proceeds = sell * (1 - CONFIG.EBAY_FEE_RATE) - CONFIG.EBAY_PER_ORDER_FEE;
    const profit = proceeds - costBasis;
    return { sell: Math.round(sell), net: Math.round(profit), pct: Math.round((profit / costBasis) * 100) };
  };

  const grades = {
    g7: netFor(card.price?.g7),
    g8: netFor(card.price?.g8),
    g9: netFor(card.price?.g9),
    g95: netFor(card.price?.g95),
    psa10: netFor(card.price?.psa10),
    bgs10: netFor(card.price?.bgs10),
    tag10: netFor(card.price?.tag10),
  };
  // Headline/ranking uses PSA 10 (deepest market) when present, else BGS 10.
  const primary = grades.psa10 || grades.bgs10 || grades.tag10;
  if (!primary) return null;
  const primaryLabel = grades.psa10 ? 'PSA 10' : grades.bgs10 ? 'BGS 10' : 'TAG 10';

  // Best net-return grade — the optimal sell target to highlight.
  let bestLabel = null, bestNet = -Infinity;
  for (const [label, key] of GRADE_ROWS) {
    const g = grades[key];
    if (g && g.net > bestNet) { bestNet = g.net; bestLabel = label; }
  }

  const arbScore = Math.max(0, Math.min(100, primary.pct / 3)); // +300% → 100
  const flipScore = Math.round(0.5 * combinedScore + 0.5 * arbScore);
  return {
    targetBuy: Math.round(targetBuy),
    gradingCost: CONFIG.GRADING_COST,
    costBasis: Math.round(costBasis),
    grades,
    primary,
    primaryLabel,
    bestLabel,
    returnPct: primary.pct,
    flipScore,
  };
}

/* ============================================================================
   STORAGE
   ============================================================================ */

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { portfolio: [], watchlist: [], popOverrides: {} };
    return JSON.parse(raw);
  } catch {
    return { portfolio: [], watchlist: [], popOverrides: {} };
  }
}
function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

/* ============================================================================
   EXTERNAL: eBay affiliate link builder
   ----------------------------------------------------------------------------
   Builds a search URL on eBay with the user's EPN campaign ID embedded so
   purchases earn commission. Falls back to a plain search URL if no campaign
   ID is configured yet.
   ============================================================================ */

function buildEbayLink(searchQuery) {
  const encoded = encodeURIComponent(searchQuery);
  const base = `https://www.ebay.com/sch/i.html?_nkw=${encoded}&_sop=12`;
  if (!CONFIG.EPN_CAMPAIGN_ID || CONFIG.EPN_CAMPAIGN_ID === 'YOUR_EPN_CAMPAIGN_ID') {
    return base;
  }
  // Rover URL pattern used by EPN. mkrid is the US site rotator.
  const mkrid = CONFIG.EPN_GEO === 'US' ? '711-53200-19255-0' : '711-53200-19255-0';
  return `https://www.ebay.com/sch/i.html?_nkw=${encoded}&_sop=12&mkcid=1&mkrid=${mkrid}&campid=${CONFIG.EPN_CAMPAIGN_ID}&toolid=10001`;
}

/* ============================================================================
   EXTERNAL: PSA cert verification (stub-friendly)
   ----------------------------------------------------------------------------
   PSA's public API supports cert verification by cert number. If
   PSA_API_TOKEN is unset, returns a clearly-labeled mock response so the
   Portfolio UI is testable before approval comes through.
   ============================================================================ */

async function verifyPSACert(certNumber) {
  if (!CONFIG.PSA_API_TOKEN) {
    return {
      ok: false,
      mock: true,
      message: 'PSA API not yet configured. Add your token to CONFIG.PSA_API_TOKEN to enable real verification.',
    };
  }
  try {
    const res = await fetch(
      `https://api.psacard.com/publicapi/cert/GetByCertNumber/${encodeURIComponent(certNumber)}`,
      {
        headers: { Authorization: `bearer ${CONFIG.PSA_API_TOKEN}` },
      }
    );
    if (!res.ok) return { ok: false, message: `PSA API returned ${res.status}` };
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

/* ============================================================================
   UI COMPONENTS
   ============================================================================ */

function Header({ sport, onSportChange }) {
  return (
    <header className="px-4 pt-5 pb-3 border-b border-zinc-800">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">
            Card<span className="text-orange-500">Prospector</span>
          </h1>
          <span className="text-[9px] font-bold uppercase tracking-widest bg-orange-500/20 text-orange-400 border border-orange-500/40 rounded px-1.5 py-0.5">
            Beta
          </span>
        </div>
        <select
          value={sport}
          onChange={(e) => onSportChange(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
        >
          <option value="baseball">Baseball</option>
          <option value="basketball" disabled>Basketball — coming soon</option>
          <option value="football"   disabled>Football — coming soon</option>
        </select>
      </div>
      <p className="mt-1 text-xs text-zinc-400">
        Reverse-engineering premium cards into flip frameworks.
      </p>
    </header>
  );
}

function ScoreBadge({ value, label }) {
  const color =
    value >= 75 ? 'bg-orange-500/20 text-orange-400 border-orange-500/40' :
    value >= 55 ? 'bg-amber-500/20 text-amber-400 border-amber-500/40' :
                  'bg-zinc-700/30 text-zinc-400 border-zinc-600/40';
  return (
    <div className={`inline-flex items-baseline gap-1.5 px-2 py-1 rounded border ${color}`}>
      <span className="text-lg font-bold tabular-nums">{value}</span>
      <span className="text-[10px] uppercase tracking-wider opacity-80">{label}</span>
    </div>
  );
}

function ScoutTab({ cards, onSelectCard, watchlist, onToggleWatch }) {
  // Cards + prices come from the API (MySQL). Rank by flip score (engine
  // conviction blended with raw→PSA10 grading upside); cards without prices
  // fall back to their combined score and sort below priced ones.
  const scored = cards
    .map((c) => {
      const cs = computeCombinedScore(c);
      return { card: c, ...cs, flip: computeFlip(c, cs.combinedScore) };
    })
    .sort((a, b) => (b.flip?.flipScore ?? b.combinedScore) - (a.flip?.flipScore ?? a.combinedScore));

  return (
    <div className="px-4 py-4 space-y-3">
      <div className="text-[11px] uppercase tracking-widest text-zinc-500">
        Today's prospects · raw → graded flip · net return
      </div>
      {scored.map(({ card, combinedScore, flip }) => {
        const variant = SCARCITY_LADDER.find((v) => v.id === card.variantId);
        const isWatched = watchlist.includes(card.id);
        const pctColor = !flip ? '' :
          flip.returnPct >= 60 ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40' :
          flip.returnPct >= 25 ? 'bg-amber-500/15 text-amber-400 border-amber-500/40' :
                                 'bg-zinc-700/30 text-zinc-400 border-zinc-600/40';
        return (
          <button
            key={card.id}
            onClick={() => onSelectCard(card.id)}
            className="w-full text-left bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800 rounded-lg p-3 transition"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold truncate">{card.player}</div>
                <div className="text-xs text-zinc-400 truncate">
                  {card.set}{card.cardNumber ? ` · ${card.cardNumber}` : ''}
                </div>
                {flip ? (
                  <div className="text-xs text-zinc-300 mt-1.5">
                    <span className="text-zinc-500">Buy</span> ${flip.targetBuy.toLocaleString()}
                    <span className="text-zinc-600 mx-1">→</span>
                    <span className="text-zinc-500">Sell</span> ${flip.primary.sell.toLocaleString()}
                    <span className="text-zinc-600"> {flip.primaryLabel}</span>
                  </div>
                ) : (
                  <div className="text-xs text-zinc-500 mt-1.5">
                    Ask ${card.askPrice.toLocaleString()} · price pending
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                {flip ? (
                  <div className={`inline-flex items-baseline gap-1 px-2 py-1 rounded border ${pctColor}`}>
                    <span className="text-lg font-bold tabular-nums">{flip.returnPct >= 0 ? '+' : ''}{flip.returnPct}%</span>
                    <span className="text-[9px] uppercase tracking-wider opacity-80">proj.</span>
                  </div>
                ) : (
                  <ScoreBadge value={combinedScore} label="Combined" />
                )}
                <div className="text-[10px] text-zinc-500">Score {combinedScore}</div>
              </div>
            </div>
            {isWatched && (
              <div className="mt-2 text-[10px] text-orange-400 uppercase tracking-wider">★ Watching</div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function DossierView({ card, onBack, isWatched, onToggleWatch, onAddToPortfolio }) {
  const { playerSignal, scarcity, combinedScore } = computeCombinedScore(card);
  const comp = findBestComp(card.traits, card.sport);
  const variant = SCARCITY_LADDER.find((v) => v.id === card.variantId);
  const ebayUrl = buildEbayLink(
    `${card.player} ${card.set} ${card.cardNumber || ''}`.replace(/·/g, ' ').replace(/\s+/g, ' ').trim()
  );
  const flip = computeFlip(card, combinedScore);

  return (
    <div className="px-4 py-4 pb-8 space-y-5">
      <button onClick={onBack} className="text-sm text-zinc-400 hover:text-zinc-200">
        ← Back to Scout
      </button>

      <div>
        <div className="text-[11px] uppercase tracking-widest text-zinc-500 mb-1">Dossier</div>
        <h2 className="text-xl font-bold">{card.player}</h2>
        <div className="text-sm text-zinc-400">{card.team} · {card.position}</div>
        <div className="text-xs text-zinc-500 mt-1">{card.set} · {variant?.label}{card.cardNumber ? ` · ${card.cardNumber}` : ''}</div>
      </div>

      <div className="flex items-center gap-2">
        <ScoreBadge value={combinedScore} label="Combined" />
        <ScoreBadge value={playerSignal} label="Player" />
        <div className="inline-flex items-baseline gap-1.5 px-2 py-1 rounded border bg-zinc-800/60 border-zinc-700 text-zinc-300">
          <span className="text-lg font-bold tabular-nums">{scarcity.multiplier.toFixed(2)}×</span>
          <span className="text-[10px] uppercase tracking-wider opacity-80">Scarcity</span>
        </div>
      </div>

      {/* How the scores are built */}
      <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-4 space-y-3">
        <div className="text-[11px] uppercase tracking-widest text-zinc-500">How this card scores</div>
        <div>
          <div className="text-sm font-semibold text-orange-400">Combined · {combinedScore}</div>
          <p className="text-xs text-zinc-400 leading-relaxed mt-0.5">
            The headline rank, 0–100. We multiply the Player signal by the Scarcity multiplier and
            normalize — it blends “how strong is the player bet” with “how rare is this card.” The
            Scout tab sorts by this number.
          </p>
        </div>
        <div>
          <div className="text-sm font-semibold text-zinc-200">Player · {playerSignal}</div>
          <p className="text-xs text-zinc-400 leading-relaxed mt-0.5">
            How closely {card.player}’s seven-trait profile matches the historical premium-card
            archetypes (a weighted similarity, 0–100). Closest match here is {comp.archetype.name} at{' '}
            {Math.round(comp.similarity * 100)}%. Higher means a stronger resemblance to players whose
            cards became premium.
          </p>
        </div>
        <div>
          <div className="text-sm font-semibold text-zinc-200">Scarcity · {scarcity.multiplier.toFixed(2)}×</div>
          <p className="text-xs text-zinc-400 leading-relaxed mt-0.5">
            Starts from this parallel’s base rarity ({variant?.label}) and{' '}
            {scarcity.hasRealData
              ? scarcity.popVelocity != null
                ? `adjusts for PSA-10 pop velocity (${scarcity.popVelocity >= 0 ? '+' : ''}${scarcity.popVelocity}% over 30 days — slower growth = scarcer).`
                : 'will adjust for PSA-10 pop velocity once ~30 days of pop snapshots accumulate (base rarity for now).'
              : 'would adjust for PSA-10 pop velocity once pop data is entered (none yet, so base rarity only).'}
          </p>
        </div>
      </section>

      {/* Recent market price — the raw card you'd buy */}
      {card.price && card.price.raw != null && (
        <section className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
          <div className="text-[11px] uppercase tracking-widest text-orange-400/80 mb-2">
            Recent market price
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Raw</span>
            <span className="text-2xl font-bold tabular-nums">${card.price.raw.toLocaleString()}</span>
            {card.price.change30dRaw != null && (
              <span className={`text-sm font-medium ${card.price.change30dRaw >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {card.price.change30dRaw >= 0 ? '▲' : '▼'} {Math.abs(card.price.change30dRaw)}% · 30d
              </span>
            )}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1.5">
            {card.price.source === 'mock' ? 'Sample data (not live)' : 'SportsCardsPro'}
            {card.price.sampleSize ? ` · ${card.price.sampleSize} recent sales` : ''} · as of {card.price.asOf}
          </div>
        </section>
      )}

      {/* Target sell price — sell price + net profit at every grade */}
      {flip && (
        <section className="border border-emerald-500/30 bg-emerald-500/5 rounded-lg p-4">
          <div className="text-[11px] uppercase tracking-widest text-emerald-400 mb-2">Target sell price</div>
          <div className="space-y-1.5 text-xs mb-3">
            <div className="flex justify-between">
              <span className="text-zinc-400">Target buy · raw −{Math.round(CONFIG.BUY_DISCOUNT * 100)}%</span>
              <span className="tabular-nums">${flip.targetBuy.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">TAG grading (Basic)</span>
              <span className="tabular-nums">${flip.gradingCost}</span>
            </div>
            <div className="flex justify-between border-t border-zinc-800 pt-1.5 font-medium">
              <span className="text-zinc-300">Cost basis</span>
              <span className="tabular-nums">${flip.costBasis.toLocaleString()}</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-xs items-baseline">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Grade</div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 text-right">Sells for</div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 text-right">Net (after fees)</div>
            {GRADE_ROWS.map(([label, key]) => {
              const g = flip.grades[key];
              const isBest = label === flip.bestLabel;
              return (
                <React.Fragment key={label}>
                  <div className={isBest ? 'text-emerald-300 font-semibold' : 'text-zinc-400'}>
                    {label}{isBest && <span className="ml-1 text-[9px] uppercase tracking-wider text-emerald-400">★ best</span>}
                  </div>
                  <div className={`text-right tabular-nums ${isBest ? 'text-emerald-300' : ''}`}>{g ? '$' + g.sell.toLocaleString() : '—'}</div>
                  <div className="text-right tabular-nums">
                    {g ? (
                      <span className={`${isBest ? 'font-semibold ' : ''}${g.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {g.net >= 0 ? '+' : ''}${g.net.toLocaleString()} ({g.pct}%)
                      </span>
                    ) : (
                      <span className="text-zinc-600">{label === 'TAG 10' ? 'enter price' : '—'}</span>
                    )}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
          <p className="text-[11px] text-zinc-500 mt-3 leading-relaxed">
            Net = sale price − {Math.round(CONFIG.EBAY_FEE_RATE * 100)}% eBay fee − ${CONFIG.EBAY_PER_ORDER_FEE.toFixed(2)} −
            cost basis. Low grades (PSA 7/8) can sell below raw — often not worth grading. You grade with TAG;
            TAG resale isn’t tracked by our source, so enter real TAG comps in the admin panel. Assumes the card
            earns that grade. Not financial advice.
          </p>
        </section>
      )}

      {/* Archetype match */}
      <section className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
        <div className="text-[11px] uppercase tracking-widest text-orange-400/80 mb-2">
          Archetype match · {Math.round(comp.similarity * 100)}% similar
        </div>
        <div className="text-base font-semibold">{comp.archetype.name}</div>
        <div className="text-xs text-zinc-400 mb-3">{comp.archetype.era}</div>
        <div className="text-xs text-zinc-300 leading-relaxed">
          The strongest historical pattern this card maps to. Comp is not a prediction —
          it's a framework: if {card.player}'s career continues to resemble {comp.archetype.name}'s
          development on the traits below, the card has a credible path to premium status.
        </div>
        <div className="mt-3 space-y-2">
          {comp.drivers.map((d) => (
            <div key={d.key} className="flex items-center gap-3 text-xs">
              <div className="w-24 text-zinc-500 capitalize">{d.key}</div>
              <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-orange-500"
                  style={{ width: `${Math.min(d.cardVal, d.archVal)}%` }}
                />
              </div>
              <div className="w-16 text-right text-zinc-400 tabular-nums">
                {d.cardVal} / {d.archVal}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Scarcity context */}
      <section className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
        <div className="text-[11px] uppercase tracking-widest text-orange-400/80 mb-2">
          Scarcity context
        </div>
        {scarcity.hasRealData ? (
          <div className="space-y-1.5 text-xs">
            {card.pop.total != null && (
              <div className="flex justify-between"><span className="text-zinc-400">Total PSA graded</span><span className="tabular-nums">{card.pop.total.toLocaleString()}</span></div>
            )}
            <div className="flex justify-between"><span className="text-zinc-400">PSA 10</span><span className="tabular-nums">{card.pop.psa10 != null ? card.pop.psa10.toLocaleString() : '—'}</span></div>
            {card.pop.gemRate != null && (
              <div className="flex justify-between">
                <span className="text-zinc-400">PSA 10 rate (real gem rate)</span>
                <span className="tabular-nums text-orange-400">{(card.pop.gemRate * 100).toFixed(1)}%</span>
              </div>
            )}
            {(card.pop.psa9 != null || card.pop.psa8 != null || card.pop.psa7 != null) && (
              <div className="flex justify-between"><span className="text-zinc-400">PSA 9 / 8 / 7</span><span className="tabular-nums">{card.pop.psa9 ?? '—'} / {card.pop.psa8 ?? '—'} / {card.pop.psa7 ?? '—'}</span></div>
            )}
            {card.pop.lower != null && (
              <div className="flex justify-between"><span className="text-zinc-400">Lower / other</span><span className="tabular-nums">{card.pop.lower.toLocaleString()}</span></div>
            )}
            <div className="flex justify-between">
              <span className="text-zinc-400">PSA 10 growth · 30d</span>
              <span className="tabular-nums text-zinc-300">
                {scarcity.popVelocity != null ? `${scarcity.popVelocity >= 0 ? '+' : ''}${scarcity.popVelocity}%` : 'tracking…'}
              </span>
            </div>
            {card.pop.listingsActive != null && (
              <div className="flex justify-between"><span className="text-zinc-400">Active eBay listings</span><span className="tabular-nums">{card.pop.listingsActive}</span></div>
            )}
            <div className="mt-3 text-zinc-300 leading-relaxed">
              {scarcity.popVelocity == null
                ? `Pop captured ${card.pop.asOf}. The 30-day velocity fills in once we have a snapshot ~30 days old — re-enter the pop periodically to build it.`
                : scarcity.popVelocity < 5
                ? 'PSA 10 pop is barely growing — limited new supply, scarcity premium is real and durable.'
                : scarcity.popVelocity < 20
                ? 'Moderate PSA 10 pop growth — supply rising at a manageable pace; scarcity edge intact.'
                : 'PSA 10 pop is growing fast — new supply flooding in, scarcity premium compressing. Wait for it to stabilize or look to a higher tier.'}
            </div>
          </div>
        ) : (
          <div className="text-xs text-zinc-400 leading-relaxed">
            No pop data yet for this card — scoring is based on player signal and base
            parallel rarity only. Combined score is a lower-confidence estimate. Enter the
            PSA pop report via the admin panel to refine this.
          </div>
        )}
      </section>

      {/* Bear case */}
      <section className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-4">
        <div className="text-[11px] uppercase tracking-widest text-amber-400 mb-2">
          What invalidates this thesis
        </div>
        <div className="text-xs text-zinc-200 leading-relaxed">{card.bearCase}</div>
      </section>

      {/* Actions */}
      <div className="space-y-2">
        <a
          href={ebayUrl}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="block w-full text-center bg-orange-500 hover:bg-orange-400 text-zinc-950 font-semibold rounded-lg py-3"
        >
          Find on eBay →
        </a>
        <div className="text-[10px] text-zinc-500 text-center">
          Affiliate link — we earn a commission on qualifying purchases.
        </div>
        <div className="grid grid-cols-2 gap-2 pt-2">
          <button
            onClick={() => onToggleWatch(card.id)}
            className="bg-zinc-800 hover:bg-zinc-700 rounded-lg py-2.5 text-sm font-medium"
          >
            {isWatched ? '★ Watching' : '☆ Watch'}
          </button>
          <button
            onClick={() => onAddToPortfolio(card.id)}
            className="bg-zinc-800 hover:bg-zinc-700 rounded-lg py-2.5 text-sm font-medium"
          >
            + Portfolio
          </button>
        </div>
      </div>
    </div>
  );
}

function LearnTab({ sport }) {
  const playbook = PLAYBOOKS[sport] || [];
  const weights = TRAIT_WEIGHTS[sport] || TRAIT_WEIGHTS.baseball;
  return (
    <div className="px-4 py-4 pb-8 space-y-6">
      <section>
        <div className="text-[11px] uppercase tracking-widest text-orange-400/80 mb-2">
          The Framework
        </div>
        <h2 className="text-lg font-bold mb-2">How premium cards get made</h2>
        <p className="text-sm text-zinc-300 leading-relaxed">
          Premium card values aren't random. Looking back at the cards that compounded the
          hardest — Mantle, Jeter, Griffey, Trout — they share a measurable profile across
          seven traits. CardProspector scores current players against these archetypes and
          combines that with real scarcity data to surface cards with credible upside.
        </p>
        <p className="text-sm text-zinc-300 leading-relaxed mt-2">
          The match isn't a prediction. It's a hypothesis with a measurable bear case.
          Every dossier names what would invalidate the comp so you can monitor it.
        </p>
      </section>

      <section>
        <div className="text-[11px] uppercase tracking-widest text-orange-400/80 mb-2">
          The seven traits
        </div>
        <div className="space-y-2">
          {Object.entries(weights).map(([key, w]) => (
            <div key={key} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
              <div className="flex items-baseline justify-between">
                <div className="font-medium capitalize">{key}</div>
                <div className="text-xs text-zinc-500">Weight {(w * 100).toFixed(0)}%</div>
              </div>
              <div className="text-xs text-zinc-400 mt-1 leading-relaxed">
                {TRAIT_BLURBS[key]}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="text-[11px] uppercase tracking-widest text-orange-400/80 mb-2">
          The Playbook · {sport}
        </div>
        <div className="space-y-2">
          {playbook.map((arch) => (
            <div key={arch.id} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
              <div className="font-medium">{arch.name}</div>
              <div className="text-xs text-zinc-400">{arch.era}</div>
              <div className="grid grid-cols-7 gap-1 mt-2">
                {Object.entries(arch.traits).map(([k, v]) => (
                  <div key={k} className="text-center">
                    <div className="text-[9px] text-zinc-500 capitalize">{k.slice(0, 3)}</div>
                    <div className="text-xs tabular-nums">{v}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const TRAIT_BLURBS = {
  hof:       'Probability the player ends up in the Hall of Fame. The single strongest long-term card value driver.',
  peak:      'Intensity of the player\'s best seasons. MVP-tier peaks generate cultural moments that anchor card demand for decades.',
  market:    'Whether the player is on a national-spotlight team. Yankees / Dodgers / Lakers context amplifies every other trait.',
  position:  'Premium positions (C, SS, CF in baseball) carry historical price premiums even at equal production.',
  narrative: 'Story resonance — international background, comeback arc, generational hype, dynasty role. Pure cultural premium.',
  unique:    'A defining skill no one else has. Trout\'s 5-tool perfection, Ohtani\'s two-way, Curry\'s gravity. Rare = remembered.',
  longevity: 'How long the player stays elite. Long careers compound narrative and rebuild scarcity through multiple grading waves.',
};

function PortfolioTab({ portfolio, allCards, onRemove }) {
  const [certNumber, setCertNumber] = useState('');
  const [certResult, setCertResult] = useState(null);
  const [verifying, setVerifying] = useState(false);

  const handleVerify = async () => {
    if (!certNumber.trim()) return;
    setVerifying(true);
    setCertResult(null);
    const result = await verifyPSACert(certNumber.trim());
    setCertResult(result);
    setVerifying(false);
  };

  const owned = portfolio.map((entry) => {
    const card = allCards.find((c) => c.id === entry.cardId);
    if (!card) return null;
    const { combinedScore } = computeCombinedScore(card);
    const pnl = combinedScore >= 70 ? entry.purchasePrice * 0.15 : -entry.purchasePrice * 0.05;
    return { entry, card, combinedScore, pnl };
  }).filter(Boolean);

  const totalCost = owned.reduce((s, o) => s + o.entry.purchasePrice, 0);
  const totalPnL = owned.reduce((s, o) => s + o.pnl, 0);

  return (
    <div className="px-4 py-4 pb-8 space-y-5">
      <section>
        <div className="text-[11px] uppercase tracking-widest text-zinc-500 mb-2">Holdings</div>
        {owned.length === 0 ? (
          <div className="text-sm text-zinc-400 bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
            No cards yet. Add prospects from the Scout tab to start tracking.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">Cost basis</div>
                <div className="text-lg font-semibold tabular-nums">${totalCost.toLocaleString()}</div>
              </div>
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">Est. P&L</div>
                <div className={`text-lg font-semibold tabular-nums ${totalPnL >= 0 ? 'text-orange-400' : 'text-zinc-400'}`}>
                  {totalPnL >= 0 ? '+' : ''}${Math.round(totalPnL).toLocaleString()}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              {owned.map(({ entry, card, combinedScore, pnl }) => (
                <div key={entry.cardId} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{card.player}</div>
                      <div className="text-xs text-zinc-400 truncate">
                        Bought ${entry.purchasePrice.toLocaleString()}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <ScoreBadge value={combinedScore} label="Now" />
                      <button
                        onClick={() => onRemove(entry.cardId)}
                        className="text-[10px] text-zinc-500 hover:text-zinc-300"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section>
        <div className="text-[11px] uppercase tracking-widest text-zinc-500 mb-2">
          Verify a PSA cert
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4 space-y-3">
          <div className="text-xs text-zinc-400">
            Enter a PSA certification number to confirm the slab is real and matches what
            the seller claims. Useful before any expensive purchase.
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              placeholder="Cert number"
              value={certNumber}
              onChange={(e) => setCertNumber(e.target.value)}
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm"
            />
            <button
              onClick={handleVerify}
              disabled={verifying}
              className="bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-zinc-950 font-medium rounded px-4 text-sm"
            >
              {verifying ? '...' : 'Verify'}
            </button>
          </div>
          {certResult && (
            <div className={`text-xs rounded p-3 ${certResult.ok ? 'bg-orange-500/10 border border-orange-500/30' : 'bg-zinc-800 border border-zinc-700'}`}>
              {certResult.mock && <div className="text-amber-400 mb-1">⚠ Mock response</div>}
              {certResult.message && <div className="text-zinc-300">{certResult.message}</div>}
              {certResult.data && (
                <pre className="text-zinc-300 whitespace-pre-wrap text-[10px] mt-1">
                  {JSON.stringify(certResult.data, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function AdminPanel({ cards, adminToken, onSaved, onClose }) {
  const [selectedCardId, setSelectedCardId] = useState(cards[0]?.id || '');
  const [total, setTotal] = useState('');
  const [psa10, setPsa10] = useState('');
  const [psa9, setPsa9] = useState('');
  const [psa8, setPsa8] = useState('');
  const [psa7, setPsa7] = useState('');
  const [listings, setListings] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [tagPrice, setTagPriceInput] = useState('');
  const [tagSaving, setTagSaving] = useState(false);
  const [tagMsg, setTagMsg] = useState(null);

  const save = async () => {
    if (!selectedCardId) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/pop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
        body: JSON.stringify({
          id: selectedCardId,
          total,
          psa10,
          psa9,
          psa8,
          psa7,
          listings_active: listings,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ ok: false, text: data.error || `Save failed (${res.status})` });
      } else {
        setMsg({ ok: true, text: 'Pop snapshot saved.' });
        onSaved(); // refetch re-prefills the fields with the saved values
      }
    } catch {
      setMsg({ ok: false, text: 'Could not reach the server.' });
    } finally {
      setSaving(false);
    }
  };

  // Prefill the pop + TAG inputs with the selected card's current values.
  useEffect(() => {
    const c = cards.find((x) => x.id === selectedCardId);
    const p = c?.pop;
    const s = (v) => (v != null ? String(v) : '');
    setTotal(s(p?.total));
    setPsa10(s(p?.psa10));
    setPsa9(s(p?.psa9));
    setPsa8(s(p?.psa8));
    setPsa7(s(p?.psa7));
    setListings(s(p?.listingsActive));
    setMsg(null);
    setTagPriceInput(c?.price?.tag10 != null ? String(c.price.tag10) : '');
    setTagMsg(null);
  }, [selectedCardId, cards]);

  const saveTag = async () => {
    if (!selectedCardId) return;
    setTagSaving(true);
    setTagMsg(null);
    try {
      const res = await fetch('/api/admin/tag-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
        body: JSON.stringify({ id: selectedCardId, tag10: tagPrice }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setTagMsg({ ok: false, text: data.error || `Failed (${res.status})` });
      else { setTagMsg({ ok: true, text: tagPrice === '' ? 'TAG price cleared.' : 'TAG price saved.' }); onSaved(); }
    } catch {
      setTagMsg({ ok: false, text: 'Could not reach the server.' });
    } finally {
      setTagSaving(false);
    }
  };

  const withPop = cards.filter((c) => c.pop);
  const gradedSum = [psa10, psa9, psa8, psa7].reduce((s, v) => s + (parseInt(v, 10) || 0), 0);
  const totalNum = parseInt(total, 10) || 0;
  const totalMismatch = total !== '' && gradedSum > totalNum;

  return (
    <div className="fixed inset-0 bg-zinc-950 z-50 overflow-y-auto">
      <div className="px-4 py-5 max-w-md mx-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold">Admin · Pop entry</h2>
          <button onClick={onClose} className="text-zinc-400">Close</button>
        </div>
        <div className="space-y-3">
          <select
            value={selectedCardId}
            onChange={(e) => setSelectedCardId(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm"
          >
            {cards.map((c) => (
              <option key={c.id} value={c.id}>{c.player} · {c.set}</option>
            ))}
          </select>
          <input type="number" inputMode="numeric" placeholder="Total PSA population (from pop report)" value={total} onChange={(e)=>setTotal(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <input type="number" inputMode="numeric" placeholder="PSA 10" value={psa10} onChange={(e)=>setPsa10(e.target.value)} className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm" />
            <input type="number" inputMode="numeric" placeholder="PSA 9" value={psa9} onChange={(e)=>setPsa9(e.target.value)} className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm" />
            <input type="number" inputMode="numeric" placeholder="PSA 8" value={psa8} onChange={(e)=>setPsa8(e.target.value)} className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm" />
            <input type="number" inputMode="numeric" placeholder="PSA 7" value={psa7} onChange={(e)=>setPsa7(e.target.value)} className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm" />
          </div>
          <input type="number" inputMode="numeric" placeholder="Active eBay listings (optional)" value={listings} onChange={(e)=>setListings(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm" />
          {total !== '' && (
            <div className={`text-[11px] ${totalMismatch ? 'text-red-400' : 'text-zinc-500'}`}>
              {totalMismatch
                ? `⚠ Entered grades (${gradedSum}) exceed the total (${totalNum}).`
                : `Grades entered: ${gradedSum} · Lower / other (derived): ${Math.max(0, totalNum - gradedSum)} · PSA 10 rate: ${totalNum > 0 && psa10 !== '' ? ((parseInt(psa10,10)||0) / totalNum * 100).toFixed(1) + '%' : '—'}`}
            </div>
          )}
          <button onClick={save} disabled={saving || totalMismatch} className="w-full bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-zinc-950 font-semibold rounded py-2.5">
            {saving ? 'Saving…' : 'Save pop snapshot'}
          </button>
          {msg && (
            <div className={`text-xs rounded p-2 ${msg.ok ? 'bg-orange-500/10 border border-orange-500/30 text-orange-300' : 'bg-zinc-800 border border-zinc-700 text-zinc-300'}`}>
              {msg.text}
            </div>
          )}
          <div className="text-[10px] text-zinc-500 leading-relaxed">
            Enter today’s PSA pop report numbers — the 30-day velocity builds automatically from
            saved snapshots, so there’s no “30 days ago” to source. Leave all blank and save to clear.
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-zinc-800 space-y-3">
          <div className="text-[11px] uppercase tracking-widest text-zinc-500">TAG 10 price · manual</div>
          <div className="text-[11px] text-zinc-400 leading-relaxed">
            SportsCardsPro doesn’t track TAG. Enter a real TAG 10 sold price for the selected card to
            drive its TAG number on the dossier. Leave blank and save to clear it.
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              inputMode="decimal"
              placeholder="TAG 10 sold price ($)"
              value={tagPrice}
              onChange={(e) => setTagPriceInput(e.target.value)}
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm"
            />
            <button onClick={saveTag} disabled={tagSaving} className="bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-zinc-950 font-medium rounded px-4 text-sm">
              {tagSaving ? '…' : 'Save'}
            </button>
          </div>
          {tagMsg && (
            <div className={`text-xs rounded p-2 ${tagMsg.ok ? 'bg-orange-500/10 border border-orange-500/30 text-orange-300' : 'bg-zinc-800 border border-zinc-700 text-zinc-300'}`}>
              {tagMsg.text}
            </div>
          )}
        </div>

        <div className="mt-6">
          <div className="text-[11px] uppercase tracking-widest text-zinc-500 mb-2">Current pop data</div>
          <div className="space-y-1.5">
            {withPop.length === 0 && (
              <div className="text-xs text-zinc-500">No cards have pop data yet.</div>
            )}
            {withPop.map((c) => (
              <div key={c.id} className="text-xs bg-zinc-900/60 border border-zinc-800 rounded p-2">
                <div className="font-medium">{c.player}</div>
                <div className="text-zinc-500">
                  Total {c.pop.total ?? '—'} · PSA 10 {c.pop.psa10 ?? '—'}
                  {c.pop.gemRate != null ? ` (${(c.pop.gemRate * 100).toFixed(1)}% gem)` : ''}
                  {c.pop.change30dPsa10 != null ? ` · ${c.pop.change30dPsa10 >= 0 ? '+' : ''}${c.pop.change30dPsa10}% 30d` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SiteFooter() {
  const feedbackHref = `mailto:${CONFIG.CONTACT_EMAIL}?subject=${encodeURIComponent('CardProspector feedback')}`;
  const subscribeExternal = Boolean(CONFIG.NEWSLETTER_URL);
  const subscribeHref = subscribeExternal
    ? CONFIG.NEWSLETTER_URL
    : `mailto:${CONFIG.CONTACT_EMAIL}?subject=${encodeURIComponent('Subscribe me to CardProspector updates')}`;

  return (
    <footer className="px-4 pt-4 pb-8 mt-4 border-t border-zinc-900 space-y-4">
      {/* Email signup CTA */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4 text-center">
        <div className="text-sm font-semibold">This is just the start.</div>
        <div className="text-xs text-zinc-400 mt-1 mb-3">
          Get an email when CardProspector gets better — new players, live pricing, alerts.
        </div>
        <a
          href={subscribeHref}
          {...(subscribeExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          className="inline-block bg-orange-500 hover:bg-orange-400 text-zinc-950 font-semibold rounded-lg px-4 py-2 text-sm"
        >
          Email me when this gets better
        </a>
      </div>

      {/* Disclaimer + feedback */}
      <div className="text-[11px] leading-relaxed text-zinc-500 text-center space-y-2">
        <p>
          <span className="text-zinc-400 font-medium">Not financial or investment advice.</span>{' '}
          CardProspector is intended for entertainment purposes only. It surfaces pattern-based
          hypotheses, not predictions. Card values are volatile and you can lose money. Always do
          your own research before buying.
        </p>
        <p>
          <a href={feedbackHref} className="text-orange-400/80 hover:text-orange-400 underline">
            Send feedback
          </a>
          <span className="mx-1.5">·</span>
          <span>CardProspector · Beta</span>
        </p>
      </div>
    </footer>
  );
}

function BottomNav({ tab, onTabChange, onOpenAdmin }) {
  const tabs = [
    { id: 'scout',     label: 'Scout' },
    { id: 'learn',     label: 'Learn' },
    { id: 'portfolio', label: 'Portfolio' },
  ];
  return (
    <nav className="sticky bottom-0 bg-zinc-950/95 backdrop-blur border-t border-zinc-800">
      <div className="flex">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            className={`flex-1 py-3 text-xs uppercase tracking-widest ${tab === t.id ? 'text-orange-400' : 'text-zinc-500'}`}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={onOpenAdmin}
          className="px-4 py-3 text-zinc-600 hover:text-zinc-300"
          aria-label="Admin"
        >
          ⚙
        </button>
      </div>
    </nav>
  );
}

/* ============================================================================
   APP ROOT
   ============================================================================ */

export default function CardProspector() {
  const [state, setState] = useState(loadState);
  const [sport, setSport] = useState('baseball');
  const [tab, setTab] = useState('scout');
  const [selectedCardId, setSelectedCardId] = useState(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminToken, setAdminToken] = useState('');

  // Card data comes from the API (MySQL). Until it loads — or if the API is
  // unreachable — we fall back to the bundled seed so the app still renders.
  const [allCards, setAllCards] = useState(FEATURED_CARDS_SEED);

  const refetchCards = useCallback(async () => {
    try {
      const res = await fetch('/api/cards');
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data.cards) && data.cards.length) setAllCards(data.cards);
    } catch {
      // keep the bundled fallback seed
    }
  }, []);

  useEffect(() => { saveState(state); }, [state]);
  useEffect(() => { refetchCards(); }, [refetchCards]);

  const cards = useMemo(
    () => allCards.filter((c) => c.sport === sport),
    [allCards, sport]
  );

  const selectedCard = useMemo(() => {
    if (!selectedCardId) return null;
    return cards.find((c) => c.id === selectedCardId) || null;
  }, [selectedCardId, cards]);

  const toggleWatch = useCallback((id) => {
    setState((s) => ({
      ...s,
      watchlist: s.watchlist.includes(id) ? s.watchlist.filter((x) => x !== id) : [...s.watchlist, id],
    }));
  }, []);

  const addToPortfolio = useCallback((id) => {
    setState((s) => {
      if (s.portfolio.some((p) => p.cardId === id)) return s;
      const card = allCards.find((c) => c.id === id);
      return {
        ...s,
        portfolio: [...s.portfolio, { cardId: id, purchasePrice: card?.askPrice || 0, addedAt: Date.now() }],
      };
    });
  }, [allCards]);

  const removeFromPortfolio = useCallback((id) => {
    setState((s) => ({ ...s, portfolio: s.portfolio.filter((p) => p.cardId !== id) }));
  }, []);

  // Unlock the admin panel by verifying the passphrase against the server
  // (ADMIN_TOKEN in the server .env). The token is kept in memory for writes.
  const openAdmin = async () => {
    const entered = window.prompt('Admin passphrase');
    if (entered == null) return;
    try {
      const res = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: { 'x-admin-token': entered },
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok) {
        setAdminToken(entered);
        setAdminOpen(true);
      } else {
        window.alert('Incorrect passphrase.');
      }
    } catch {
      window.alert('Could not reach the server.');
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <Header sport={sport} onSportChange={setSport} />

      <main className="flex-1 overflow-y-auto">
        {selectedCard ? (
          <DossierView
            card={selectedCard}
            onBack={() => setSelectedCardId(null)}
            isWatched={state.watchlist.includes(selectedCard.id)}
            onToggleWatch={toggleWatch}
            onAddToPortfolio={addToPortfolio}
          />
        ) : tab === 'scout' ? (
          <ScoutTab
            cards={cards}
            onSelectCard={setSelectedCardId}
            watchlist={state.watchlist}
            onToggleWatch={toggleWatch}
          />
        ) : tab === 'learn' ? (
          <LearnTab sport={sport} />
        ) : (
          <PortfolioTab
            portfolio={state.portfolio}
            allCards={allCards}
            onRemove={removeFromPortfolio}
          />
        )}

        {!selectedCard && (tab === 'scout' || tab === 'learn') && <SiteFooter />}
      </main>

      <BottomNav
        tab={tab}
        onTabChange={(t) => { setTab(t); setSelectedCardId(null); }}
        onOpenAdmin={openAdmin}
      />

      {adminOpen && (
        <AdminPanel
          cards={allCards}
          adminToken={adminToken}
          onSaved={refetchCards}
          onClose={() => setAdminOpen(false)}
        />
      )}
    </div>
  );
}
