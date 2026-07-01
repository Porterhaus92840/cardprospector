import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { LegalPage, LEGAL_DOC_FOR_PATH } from './Legal.jsx';

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
  //  - PSA basic (Value) grading — $/card (set GRADING_COST to your PSA tier).
  //  - eBay trading-card final value fee is 13.6% + $0.40/order (2026).
  // (Cards sold $1,000+ may qualify for a 50% FVF discount promo — not modeled.)
  BUY_DISCOUNT: 0.10,        // target buy = raw price minus this
  GRADING_COST: 25,          // PSA basic grading, $/card (placeholder — confirm)
  EBAY_FEE_RATE: 0.136,      // eBay final value fee
  EBAY_PER_ORDER_FEE: 0.40,
  // Below this best-case graded net return (%), the framework flags a card as
  // "not recommended" — even the optimal grade is too thin after real costs.
  MIN_FLIP_RETURN: 15,
  // Scope: the engine targets modern prospects/rookies (realistic PSA-10 gem
  // rates + room to grow). Older/vintage breaks the flip + growth model.
  MIN_CARD_YEAR: 2010,
  // NOTE: the admin gate now lives server-side (ADMIN_TOKEN in the server .env),
  // verified via POST /api/admin/verify — not in this public bundle.
  // Where the footer "Send feedback" link points. Consider a dedicated
  // address (e.g. hello@cardprospector.app) instead of a personal inbox.
  CONTACT_EMAIL: 'daleporter2009@yahoo.com',
  // Owner account — protected from ban/lock in the Control Console (also enforced
  // server-side via OWNER_EMAIL in the server .env).
  OWNER_EMAIL: 'daleporter2009@yahoo.com',
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

/* The archetype PLAYBOOKS + TRAIT_WEIGHTS (the model) now live SERVER-SIDE in
   scoring.js and never ship to the browser. The Learn tab fetches a display-only
   roster (names/eras/tier) from GET /api/archetypes. */

/* ============================================================================
   SCARCITY LADDER — 15 parallel variants from base RC raw to Superfractor 1/1
   ----------------------------------------------------------------------------
   `rarity` is the multiplier applied to the player signal. Higher = more
   scarce. Values are calibrated to roughly track historical market premiums
   on Topps Chrome / Bowman Chrome RCs.
   ============================================================================ */

// Parallel variants — display labels only. The scarcity RARITY multipliers that
// these feed live server-side in scoring.js (never shipped to the browser).
const SCARCITY_LADDER = [
  { id: 'base_raw',         label: 'Base RC (Raw)' },
  { id: 'base_psa9',        label: 'Base RC PSA 9' },
  { id: 'base_psa10',       label: 'Base RC PSA 10' },
  { id: 'refractor',        label: 'Refractor' },
  { id: 'refractor_psa10',  label: 'Refractor PSA 10' },
  { id: 'xfractor',         label: 'X-Fractor / Mosaic' },
  { id: 'blue',             label: 'Blue Refractor /150' },
  { id: 'green',            label: 'Green Refractor /99' },
  { id: 'gold',             label: 'Gold Refractor /50' },
  { id: 'orange',           label: 'Orange Refractor /25' },
  { id: 'red',              label: 'Red Refractor /5' },
  { id: 'auto_base',        label: 'Base Auto' },
  { id: 'auto_refractor',   label: 'Refractor Auto /499' },
  { id: 'auto_gold',        label: 'Gold Auto /50' },
  { id: 'superfractor',     label: 'Superfractor 1/1' },
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

// Scoring runs SERVER-SIDE now (scoring.js). Each card from /api/cards carries a
// `score` block; these thin readers keep the existing components working without
// shipping the archetypes, weights, or formulas to the browser.
function computeCombinedScore(card) {
  const s = card.score || {};
  return {
    combinedScore: s.combined ?? 0,
    playerSignal: s.playerSignal ?? 0,
    scarcity: s.scarcity || { multiplier: 1, hasRealData: false, popVelocity: null },
  };
}

// Sell-ladder order, lowest grade → highest. Shared by the flip math and the
// dossier table so "best grade" highlighting stays in sync.
const GRADE_ROWS = [
  ['PSA 7', 'g7'], ['PSA 8', 'g8'], ['PSA 9', 'g9'], ['Grade 9.5', 'g95'],
  ['PSA 10', 'psa10'], ['BGS 10', 'bgs10'],
];

// The grading-flip block is computed server-side (scoring.js) and attached to
// each entitled card as `score.flip`; here we just read it.
function computeFlip(card) {
  return card.score?.flip ?? null;
}

// The recommendation verdict is computed server-side; read it off the card.
function computeRecommendation(card) {
  return card?.score?.recommendation ?? null;
}

const NOT_REC_STYLE = 'bg-red-500/10 text-red-400 border-red-500/40';

/* ----------------------------------------------------------------------------
   HOLD HORIZON — how long to hold for the card's value to play out. A heuristic
   (tunable), separate from the grading-flip %:
   - longevity + still-rising ceiling (peak) → value compounds over years (long)
   - a low current price has room to run; a high price is nearer its ceiling
   - fast PSA-10 pop growth (when known) means supply is flooding → sell sooner
   Returns short / mid / long with a colour and a one-line rationale.
   ---------------------------------------------------------------------------- */
const HORIZON_STYLE = {
  short: {
    label: 'Short-term hold', range: 'under ~1 year', cls: 'bg-sky-500/15 text-sky-400 border-sky-500/40',
    desc: 'Value is largely realizable now — the card is already priced up or carries durability risk (e.g., pitchers). Plan to capture the move and move on, not to sit on it for years.',
  },
  mid: {
    label: 'Mid-term hold', range: '~1–3 years', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/40',
    desc: 'Real upside, but not a multi-year compounder. Hold through the next catalyst — a breakout, a call-up, a deep playoff run — then reassess.',
  },
  long: {
    label: 'Long-term hold', range: '~3+ years', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40',
    desc: 'Durable profile, a still-rising ceiling, and room left in the price. Value compounds as the player’s career plays out — buy and sit on it.',
  },
};
// Hold horizon (key + blurb) is computed server-side; merge in the display style.
function computeHorizon(card) {
  const h = card.score?.horizon || { key: 'mid', blurb: '' };
  return { ...h, ...(HORIZON_STYLE[h.key] || HORIZON_STYLE.mid) };
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
        Reverse-engineering modern premium cards into flip frameworks.
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

function ScoutTab({ cards, onSelectCard, watchlist, onToggleWatch, isPro, onSubmit }) {
  const [sortBy, setSortBy] = useState('flip');
  const [maxBuy, setMaxBuy] = useState(0); // 0 = any
  const [showLegend, setShowLegend] = useState(false);
  const [query, setQuery] = useState('');
  const [pageSize, setPageSize] = useState(25); // 0 = all
  const [page, setPage] = useState(0);
  const topRef = useRef(null);

  const rank = { short: 0, mid: 1, long: 2 };
  const comparators = {
    flip:   (a, b) => (b.flip?.flipScore ?? b.combinedScore) - (a.flip?.flipScore ?? a.combinedScore),
    short:  (a, b) => rank[a.horizon.key] - rank[b.horizon.key] || (b.flip?.flipScore ?? 0) - (a.flip?.flipScore ?? 0),
    long:   (a, b) => rank[b.horizon.key] - rank[a.horizon.key] || (b.flip?.flipScore ?? 0) - (a.flip?.flipScore ?? 0),
    buylow: (a, b) => (a.flip?.targetBuy ?? Infinity) - (b.flip?.targetBuy ?? Infinity),
    ret:    (a, b) => (b.flip?.returnPct ?? -Infinity) - (a.flip?.returnPct ?? -Infinity),
  };

  let scored = cards.map((c) => {
    const cs = computeCombinedScore(c);
    return { card: c, ...cs, flip: computeFlip(c, cs.combinedScore), horizon: computeHorizon(c) };
  });
  if (maxBuy > 0) scored = scored.filter((s) => s.flip && s.flip.targetBuy <= maxBuy);
  const q = query.trim().toLowerCase();
  if (q) {
    scored = scored.filter(({ card }) =>
      [card.player, card.set, card.cardNumber, card.team]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }
  scored = scored.sort(comparators[sortBy] || comparators.flip);

  // Pagination — let the user cap how many cards render at once.
  const total = scored.length;
  const perPage = pageSize === 0 ? Math.max(1, total) : pageSize;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const curPage = Math.min(page, pageCount - 1);
  const start = curPage * perPage;
  const visible = pageSize === 0 ? scored : scored.slice(start, start + perPage);
  const go = (p) => setPage(Math.max(0, Math.min(pageCount - 1, p)));

  // Reset to page 1 when the result set changes; scroll to top on page change.
  useEffect(() => { setPage(0); }, [query, maxBuy, sortBy, pageSize]);
  useEffect(() => { topRef.current?.scrollIntoView({ block: 'nearest' }); }, [curPage]);

  const pager = () => (
    pageCount > 1 ? (
      <div className="flex items-center justify-center gap-3 text-xs">
        <button onClick={() => go(curPage - 1)} disabled={curPage === 0} className="px-3 py-1 rounded border border-zinc-700 text-zinc-300 disabled:opacity-40 hover:border-zinc-500">← Prev</button>
        <span className="text-zinc-500">Page {curPage + 1} of {pageCount}</span>
        <button onClick={() => go(curPage + 1)} disabled={curPage >= pageCount - 1} className="px-3 py-1 rounded border border-zinc-700 text-zinc-300 disabled:opacity-40 hover:border-zinc-500">Next →</button>
      </div>
    ) : null
  );

  return (
    <div className="px-4 py-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-widest text-zinc-500">
          Today's prospects · raw → graded flip
        </div>
        <button onClick={onSubmit} className="text-[11px] text-orange-400 hover:text-orange-300 whitespace-nowrap">+ Submit a card</button>
      </div>

      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search cards — player, set, #, team…"
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-8 pr-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-orange-500/50"
        />
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 text-sm pointer-events-none">⌕</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {isPro && (
          <>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300">
              <option value="flip">Sort: Best opportunity</option>
              <option value="short">Sort: Shortest hold first</option>
              <option value="long">Sort: Longest hold first</option>
              <option value="buylow">Sort: Lowest buy price</option>
              <option value="ret">Sort: Highest return</option>
            </select>
            <select value={maxBuy} onChange={(e) => setMaxBuy(Number(e.target.value))} className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300">
              <option value={0}>Buy price: Any</option>
              <option value={10}>Buy ≤ $10</option>
              <option value={25}>Buy ≤ $25</option>
              <option value={50}>Buy ≤ $50</option>
              <option value={100}>Buy ≤ $100</option>
              <option value={250}>Buy ≤ $250</option>
              <option value={500}>Buy ≤ $500</option>
            </select>
          </>
        )}
        <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300" title="Cards per page">
          <option value={25}>Show: 25</option>
          <option value={50}>Show: 50</option>
          <option value={100}>Show: 100</option>
          <option value={0}>Show: All</option>
        </select>
        <button onClick={() => setShowLegend((v) => !v)} className="text-xs text-zinc-400 hover:text-zinc-200 ml-auto">ⓘ Hold horizons</button>
      </div>

      {showLegend && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 space-y-2.5">
          {['short', 'mid', 'long'].map((k) => (
            <div key={k} className="text-xs">
              <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-wider ${HORIZON_STYLE[k].cls}`}>{HORIZON_STYLE[k].label}</span>
              <span className="text-zinc-500 ml-1.5">{HORIZON_STYLE[k].range}</span>
              <p className="text-zinc-400 mt-1 leading-relaxed">{HORIZON_STYLE[k].desc}</p>
            </div>
          ))}
          <div className="text-xs pt-1 border-t border-zinc-800">
            <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-wider ${NOT_REC_STYLE}`}>⚠ Not recommended</span>
            <p className="text-zinc-400 mt-1 leading-relaxed">Grading to a PSA 10 returns under {CONFIG.MIN_FLIP_RETURN}% after grading + selling fees at today’s prices — too thin to recommend right now.</p>
          </div>
          <p className="text-[10px] text-zinc-500">Time ranges are guidelines from the player + price profile — not guarantees. Not financial advice.</p>
        </div>
      )}

      {total === 0 && (
        <div className="text-xs text-zinc-500 text-center py-6">
          {q ? `No cards match “${query.trim()}”.` : 'No cards match this filter.'}
        </div>
      )}
      {total > 0 && (
        <div ref={topRef} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs scroll-mt-2">
          <span className="text-zinc-500">Showing {start + 1}–{Math.min(start + perPage, total)} of {total}</span>
          {pager()}
        </div>
      )}
      {visible.map(({ card, combinedScore, flip, horizon }) => {
        const variant = SCARCITY_LADDER.find((v) => v.id === card.variantId);
        const isWatched = watchlist.includes(card.id);
        const rec = computeRecommendation(card);
        const notRec = rec && !rec.recommended;
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
              <div className="flex gap-2.5 min-w-0">
                {card.image && <img src={card.image} alt="" loading="lazy" className="w-11 h-[3.9rem] object-cover rounded border border-zinc-800 shrink-0" />}
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
                ) : !isPro ? (
                  <div className="text-xs text-orange-400/80 mt-1.5">🔒 Buy / sell targets with Pro</div>
                ) : (
                  <div className="text-xs text-zinc-500 mt-1.5">
                    Ask ${card.askPrice.toLocaleString()} · price pending
                  </div>
                )}
                {isPro && (
                  notRec ? (
                    <div className={`inline-block mt-1.5 px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-wider ${NOT_REC_STYLE}`}>
                      ⚠ Not recommended
                    </div>
                  ) : (
                    <div className={`inline-block mt-1.5 px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-wider ${horizon.cls}`}>
                      {horizon.label}
                    </div>
                  )
                )}
                </div>
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
      {total > 0 && (
        <div className="pt-2">
          {pager()}
        </div>
      )}
    </div>
  );
}

function DossierView({ card, onBack, isWatched, onToggleWatch, onAddToPortfolio, isPro, onUpgrade }) {
  const { playerSignal, scarcity, combinedScore } = computeCombinedScore(card);
  const comp = card.score?.comp || null;
  const band = comp?.band || null;
  const variant = SCARCITY_LADDER.find((v) => v.id === card.variantId);
  const ebayUrl = buildEbayLink(
    `${card.player} ${card.set} ${card.cardNumber || ''}`.replace(/·/g, ' ').replace(/\s+/g, ' ').trim()
  );
  const flip = computeFlip(card, combinedScore);
  const horizon = computeHorizon(card);
  const rec = computeRecommendation(card);
  const notRec = rec && !rec.recommended;

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

      <p className="text-xs text-zinc-400 italic leading-relaxed border-l-2 border-orange-500/40 pl-3">
        Our card hypothesis is as follows — a data-driven framework for thinking about this card,
        not financial or investment advice.
      </p>

      {card.image && (
        <div className="flex justify-center">
          <img src={card.image} alt={`${card.player} ${card.cardNumber || ''}`.trim()} loading="lazy" className="rounded-lg max-h-56 max-w-full border border-zinc-800" />
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <ScoreBadge value={combinedScore} label="Combined" />
        <ScoreBadge value={playerSignal} label="Player" />
        <div className="inline-flex items-baseline gap-1.5 px-2 py-1 rounded border bg-zinc-800/60 border-zinc-700 text-zinc-300">
          <span className="text-lg font-bold tabular-nums">{scarcity.multiplier.toFixed(2)}×</span>
          <span className="text-[10px] uppercase tracking-wider opacity-80">Scarcity</span>
        </div>
      </div>

      {/* Recommendation verdict / Hold horizon (Pro) — or the paywall for free users */}
      {isPro ? (
        notRec ? (
          <section className={`border rounded-lg p-4 ${NOT_REC_STYLE}`}>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="text-[11px] uppercase tracking-widest opacity-90">⚠ Recommendation</span>
              <span className={`px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider ${NOT_REC_STYLE}`}>Not recommended</span>
            </div>
            <p className="text-xs leading-relaxed text-red-200/90">{rec.reason}</p>
            <p className="text-[10px] text-red-300/60 mt-1.5">A signal, not advice — your call. Numbers update as prices move.</p>
          </section>
        ) : (
          <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="text-[11px] uppercase tracking-widest text-zinc-500">Hold horizon</span>
              <span className={`px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider ${horizon.cls}`}>{horizon.label}</span>
              <span className="text-[11px] text-zinc-500">{horizon.range}</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">{horizon.blurb}</p>
          </section>
        )
      ) : (
        <section className="border border-orange-500/40 bg-orange-500/5 rounded-lg p-4 text-center">
          <div className="text-sm font-semibold text-orange-300">Unlock the full play</div>
          <p className="text-xs text-zinc-300 mt-1 mb-3 leading-relaxed">
            See live raw + graded prices, buy/sell targets, net-after-fees returns by grade, the
            hold horizon, and your private watchlist. Start a 7-day free trial.
          </p>
          <button onClick={onUpgrade} className="bg-orange-500 hover:bg-orange-400 text-zinc-950 font-semibold rounded-lg px-4 py-2 text-sm">
            Start free trial
          </button>
        </section>
      )}

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
            We match {card.player}’s seven-trait profile against a roster of historical archetypes —
            not just legends, but hyped names who stalled or busted — and weight each match by how
            that player’s cards actually turned out.{comp ? ` Closest here is ${comp.name} (${Math.round(comp.similarity * 100)}% similar, a ${band ? band.label.toLowerCase() : '—'} outcome).` : ''}
            {' '}So resembling a bust drags this down; resembling a star lifts it.
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
            <div className="flex justify-between bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1">
              <span className="text-amber-200/90">Target buy · raw −{Math.round(CONFIG.BUY_DISCOUNT * 100)}%</span>
              <span className="tabular-nums text-amber-100">${flip.targetBuy.toLocaleString()}</span>
            </div>
            <div className="flex justify-between px-2">
              <span className="text-zinc-400">PSA grading</span>
              <span className="tabular-nums">${flip.gradingCost}</span>
            </div>
            <div className="flex justify-between border-t border-zinc-800 pt-1.5 font-medium px-2">
              <span className="text-zinc-300">Cost basis</span>
              <span className="tabular-nums">${flip.costBasis.toLocaleString()}</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-x-2 text-[10px] uppercase tracking-wider text-sky-300 bg-sky-500/10 border border-sky-500/20 rounded px-2 py-1 mb-1">
            <div>Grade</div>
            <div className="text-right">Sells for</div>
            <div className="text-right">Net (after fees)</div>
          </div>
          <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-xs items-baseline px-2">
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
                      <span className="text-zinc-600">—</span>
                    )}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
          <p className="text-[11px] text-zinc-500 mt-3 leading-relaxed">
            Net = sale price − {Math.round(CONFIG.EBAY_FEE_RATE * 100)}% eBay fee − ${CONFIG.EBAY_PER_ORDER_FEE.toFixed(2)} −
            cost basis. Low grades (PSA 7/8) can sell below raw — often not worth grading. Assumes the card
            earns that grade. For educational and informational purposes only — not financial or investment advice.
          </p>
        </section>
      )}

      {/* Archetype match */}
      {comp && (
      <section className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
        <div className="text-[11px] uppercase tracking-widest text-orange-400/80 mb-2">
          Archetype match · {Math.round(comp.similarity * 100)}% similar
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-base font-semibold">{comp.name}</div>
          {band && (
            <span className={`px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider ${band.cls}`}>{band.label}</span>
          )}
        </div>
        <div className="text-xs text-zinc-400 mb-3">{comp.era}</div>
        <div className="text-xs text-zinc-300 leading-relaxed">
          The closest historical profile this card maps to — not a prediction, a framework.{' '}
          {band?.stance === 'bull'
            ? `If ${card.player}'s career resembles ${comp.name}'s on the traits below, the card has a credible path to premium status.`
            : band?.stance === 'neutral'
            ? `${comp.name} settled in as a solid regular — real value, but card returns historically stayed capped here. Temper the upside.`
            : `This is a cautionary comp: players matching ${comp.name}'s profile have historically stalled or busted. Treat the upside with real skepticism.`}
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
      )}

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
          Warning signs to watch
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
  // Display-only archetype roster comes from the server (no model in the bundle).
  const [archetypes, setArchetypes] = useState([]);
  useEffect(() => {
    fetch(`/api/archetypes?sport=${encodeURIComponent(sport)}`)
      .then((r) => r.json())
      .then((d) => setArchetypes(Array.isArray(d.archetypes) ? d.archetypes : []))
      .catch(() => setArchetypes([]));
  }, [sport]);
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
          seven traits. But the hyped names who stalled or busted — the Brandon Woods and Matt
          Wieterses — share a profile too. CardProspector scores current players against a roster
          of both, weighting each match by how that player's cards actually turned out, then
          combines it with real scarcity data — to surface genuine upside and flag what to avoid.
        </p>
        <p className="text-xs text-zinc-400 leading-relaxed mt-2">
          Scope: this is built for <span className="text-zinc-300">modern prospects & rookies ({CONFIG.MIN_CARD_YEAR}–present)</span> —
          recent cards with realistic grading upside and room to grow, not finished vintage.
        </p>
        <p className="text-sm text-zinc-300 leading-relaxed mt-2">
          The match isn't a prediction — it's an educated theory. And for every card we spell out
          exactly what would have to go wrong for it to miss, so you know what to watch for.
        </p>
      </section>

      <section>
        <div className="text-[11px] uppercase tracking-widest text-orange-400/80 mb-2">
          The seven traits
        </div>
        <div className="space-y-2">
          {SUB_TRAITS.map((key) => (
            <div key={key} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
              <div className="font-medium capitalize">{key}</div>
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
        <p className="text-xs text-zinc-400 leading-relaxed mb-3">
          Every card is benchmarked against a roster of historical profiles — from generational
          icons to the hyped names that stalled or busted — weighted by how each one’s cards
          actually turned out. The blend across the whole roster, not any single comp, drives the
          score.
        </p>
        <div className="space-y-1.5">
          {archetypes.map((arch, i) => (
            <div key={i} className="flex items-center justify-between gap-2 bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{arch.name}</div>
                <div className="text-[11px] text-zinc-500">{arch.era}</div>
              </div>
              <span className={`px-2 py-0.5 rounded border text-[9px] uppercase tracking-wider whitespace-nowrap ${arch.band?.cls || ''}`}>{arch.band?.label}</span>
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

// Conditions a card can be bought in, mapped to the matching price field.
const PORTFOLIO_CONDITIONS = [
  { id: 'raw',   label: 'Raw (ungraded)', key: 'raw' },
  { id: 'g7',    label: 'PSA 7',          key: 'g7' },
  { id: 'g8',    label: 'PSA 8',          key: 'g8' },
  { id: 'g9',    label: 'PSA 9',          key: 'g9' },
  { id: 'g95',   label: 'Grade 9.5',      key: 'g95' },
  { id: 'psa10', label: 'PSA 10',         key: 'psa10' },
  { id: 'bgs10', label: 'BGS 10',         key: 'bgs10' },
];
const CONDITION_META = Object.fromEntries(PORTFOLIO_CONDITIONS.map((c) => [c.id, c]));

// Hold / sell guidance for a card the user already owns.
function computeHoldSignal(card, entry) {
  const condition = entry.condition || 'raw';
  const { combinedScore } = computeCombinedScore(card);
  const horizon = computeHorizon(card);
  const flip = computeFlip(card, combinedScore);
  const rec = computeRecommendation(card);
  if (condition === 'raw' && flip && rec?.recommended) {
    return {
      action: 'Hold & grade',
      cls: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
      why: `Grading to a PSA 10 projects about +${flip.returnPct}% after fees — worth grading, then flipping.`,
    };
  }
  if (horizon.key === 'short') {
    return {
      action: 'Consider selling',
      cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
      why: 'Value is largely realized near-term — a good window to take the gain rather than sit on it.',
    };
  }
  return {
    action: 'Hold',
    cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    why: horizon.key === 'long'
      ? 'Durable profile with room left — value should keep compounding. Sit tight.'
      : 'Real upside ahead — hold through the next catalyst, then reassess.',
  };
}

// Modal to capture purchase condition + price when adding a card to the portfolio.
function PortfolioAddModal({ card, existing, onClose, onConfirm }) {
  const priceFor = (key) => (card.price?.[key] != null ? String(Math.round(card.price[key])) : '');
  const [condition, setCondition] = useState(existing?.condition || 'raw');
  const [price, setPrice] = useState(
    existing?.purchasePrice != null ? String(existing.purchasePrice) : priceFor(CONDITION_META[existing?.condition || 'raw'].key)
  );
  const onCond = (c) => { setCondition(c); setPrice(priceFor(CONDITION_META[c].key)); };
  const mkt = card.price?.[CONDITION_META[condition].key];
  return (
    <div className="fixed inset-0 bg-zinc-950/90 z-50 overflow-y-auto p-4" onClick={onClose}>
      <div className="max-w-sm mx-auto mt-16 bg-zinc-900 border border-zinc-700 rounded-xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold">{existing ? 'Edit holding' : 'Add to portfolio'}</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200 text-sm">✕</button>
        </div>
        <div>
          <div className="font-medium text-sm">{card.player}</div>
          <div className="text-xs text-zinc-400">{card.set}{card.cardNumber ? ` · #${card.cardNumber}` : ''}</div>
        </div>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wider text-zinc-500">Condition when purchased</span>
          <select value={condition} onChange={(e) => onCond(e.target.value)} className={`${INPUT_CLS} mt-1`}>
            {PORTFOLIO_CONDITIONS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wider text-zinc-500">What you actually paid ($)</span>
          <input type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Purchase price" className={`${INPUT_CLS} mt-1`} />
          {mkt != null && (
            <span className="text-[10px] text-zinc-500">Current market for {CONDITION_META[condition].label} ≈ ${Math.round(mkt).toLocaleString()}</span>
          )}
        </label>
        <button
          onClick={() => onConfirm(card.id, { condition, purchasePrice: Math.max(0, Number(price) || 0) })}
          className="w-full bg-orange-500 hover:bg-orange-400 text-zinc-950 font-semibold rounded-lg py-2.5"
        >
          {existing ? 'Update holding' : 'Add to portfolio'}
        </button>
      </div>
    </div>
  );
}

function PortfolioTab({ portfolio, allCards, onRemove, onEdit, signedIn }) {
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
    const condition = entry.condition || 'raw';
    const meta = CONDITION_META[condition] || CONDITION_META.raw;
    const currentValue = card.price?.[meta.key] ?? null;
    const pnl = currentValue != null ? currentValue - (entry.purchasePrice || 0) : null;
    const signal = computeHoldSignal(card, entry);
    return { entry, card, meta, currentValue, pnl, signal };
  }).filter(Boolean);

  const totalCost = owned.reduce((s, o) => s + (o.entry.purchasePrice || 0), 0);
  const totalPnL = owned.reduce((s, o) => s + (o.pnl || 0), 0);
  const anyUnpriced = owned.some((o) => o.pnl == null);

  return (
    <div className="px-4 py-4 pb-8 space-y-5">
      <section>
        <div className="text-[11px] uppercase tracking-widest text-zinc-500 mb-2">Holdings</div>
        {owned.length === 0 ? (
          <div className="text-sm text-zinc-400 bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
            {signedIn
              ? 'No cards yet. Open a card and tap “+ Portfolio” to start tracking — your holdings sync across all your devices.'
              : 'Sign in to build your portfolio. Holdings are saved to your account and sync across every device.'}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">Cost basis</div>
                <div className="text-lg font-semibold tabular-nums">${totalCost.toLocaleString()}</div>
              </div>
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">P&L vs market</div>
                <div className={`text-lg font-semibold tabular-nums ${totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {totalPnL >= 0 ? '+' : ''}${Math.round(totalPnL).toLocaleString()}
                </div>
                {anyUnpriced && <div className="text-[9px] text-zinc-600 leading-tight mt-0.5">excludes cards without live prices</div>}
              </div>
            </div>
            <div className="space-y-2">
              {owned.map(({ entry, card, meta, currentValue, pnl, signal }) => {
                const pct = entry.purchasePrice > 0 && pnl != null ? Math.round((pnl / entry.purchasePrice) * 100) : null;
                return (
                  <div key={entry.cardId} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{card.player}</div>
                        <div className="text-xs text-zinc-400 truncate">
                          {card.set}{card.cardNumber ? ` · #${card.cardNumber}` : ''}
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-0.5">
                          {meta.label} · bought ${entry.purchasePrice.toLocaleString()}
                          {currentValue != null ? ` · now $${Math.round(currentValue).toLocaleString()}` : ''}
                        </div>
                        {pnl != null && (
                          <div className={`text-xs mt-0.5 font-medium ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {pnl >= 0 ? '+' : ''}${Math.round(pnl).toLocaleString()}{pct != null ? ` (${pct >= 0 ? '+' : ''}${pct}%)` : ''}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <span className={`px-2 py-0.5 rounded border text-[9px] uppercase tracking-wider whitespace-nowrap ${signal.cls}`}>{signal.action}</span>
                        <div className="flex gap-2">
                          <button onClick={() => onEdit(entry.cardId)} className="text-[10px] text-zinc-500 hover:text-zinc-300">Edit</button>
                          <button onClick={() => onRemove(entry.cardId)} className="text-[10px] text-zinc-500 hover:text-zinc-300">Remove</button>
                        </div>
                      </div>
                    </div>
                    <p className="text-[10px] text-zinc-500 mt-2 leading-relaxed">{signal.why}</p>
                  </div>
                );
              })}
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

function AdminPopEntry({ cards, adminToken, onSaved }) {
  const [selectedCardId, setSelectedCardId] = useState(cards[0]?.id || '');
  const [total, setTotal] = useState('');
  const [psa10, setPsa10] = useState('');
  const [psa9, setPsa9] = useState('');
  const [psa8, setPsa8] = useState('');
  const [psa7, setPsa7] = useState('');
  const [listings, setListings] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  // The operator's LOCAL date (YYYY-MM-DD) — the pop-tracking day resets at
  // their local midnight, and the snapshot is keyed to this same day.
  const today = (() => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();

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
          observedOn: today,
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

  // Prefill the pop inputs with the selected card's current values.
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
  }, [selectedCardId, cards]);

  const withPop = cards.filter((c) => c.pop);
  const gradedSum = [psa10, psa9, psa8, psa7].reduce((s, v) => s + (parseInt(v, 10) || 0), 0);
  const totalNum = parseInt(total, 10) || 0;
  const totalMismatch = total !== '' && gradedSum > totalNum;

  const enteredToday = (c) => c?.pop?.asOf === today;
  const sortedCards = [...cards].sort((a, b) => (enteredToday(a) === enteredToday(b) ? 0 : enteredToday(a) ? 1 : -1));
  const doneCount = cards.filter(enteredToday).length;
  const selCard = cards.find((c) => c.id === selectedCardId);

  return (
    <div className="space-y-5">
        <div className="space-y-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-zinc-400">
              <span className="text-emerald-400 font-medium">{doneCount}</span> of {cards.length} updated today
            </span>
            <span className="text-zinc-600">✓ done today · ○ needs update</span>
          </div>
          <select
            value={selectedCardId}
            onChange={(e) => setSelectedCardId(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm"
          >
            {sortedCards.map((c) => (
              <option key={c.id} value={c.id}>{enteredToday(c) ? '✓' : '○'} {c.player} · {c.set}</option>
            ))}
          </select>
          <div className="text-[11px]">
            {enteredToday(selCard)
              ? <span className="text-emerald-400/80">✓ Updated today</span>
              : <span className="text-amber-400/90">○ Needs today’s update{selCard?.pop?.asOf ? ` · last entered ${selCard.pop.asOf}` : ''}</span>}
          </div>
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
  );
}

function AdminDashboard({ adminToken, onGo }) {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    fetch('/api/admin/stats', { headers: { 'x-admin-token': adminToken } })
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, [adminToken]);
  const Tile = ({ label, value, go }) => (
    <button
      onClick={() => go && onGo(go)}
      className={`text-left bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 ${go ? 'hover:border-orange-500/50' : 'cursor-default'}`}
    >
      <div className="text-2xl font-bold tabular-nums text-zinc-100">{value ?? '—'}</div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-0.5">{label}</div>
    </button>
  );
  return (
    <div className="space-y-3">
      <div className="text-[11px] uppercase tracking-widest text-zinc-500">System status</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <Tile label="Users" value={stats?.users} go="users" />
        <Tile label="Subscribers" value={stats?.subscribers} />
        <Tile label="Beta testers" value={stats?.beta} go="users" />
        <Tile label="Banned" value={stats?.banned} go="users" />
        <Tile label="Pending subs" value={stats?.pendingSubmissions} go="submissions" />
        <Tile label="Cards live" value={stats?.cards} go="cards" />
      </div>
    </div>
  );
}

function AdminUsers({ adminToken }) {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState([]);
  const [sel, setSel] = useState(null);
  const [betaDays, setBetaDays] = useState('14');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/users?search=' + encodeURIComponent(search), {
        headers: { 'x-admin-token': adminToken },
      });
      const d = await r.json();
      setUsers(d.users || []);
    } catch {
      /* ignore */
    }
  }, [adminToken, search]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (path, body, label) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/admin/' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMsg({ ok: false, text: d.error || `Failed (${r.status})` });
      else {
        setMsg({ ok: true, text: label });
        load();
      }
    } catch {
      setMsg({ ok: false, text: 'Could not reach the server.' });
    } finally {
      setBusy(false);
    }
  };
  const setTier = (u, tier) =>
    act('users/tier', { id: u.id, tier, betaDays: tier === 'beta' ? Number(betaDays) || 0 : 0 }, `${u.email} → ${tier}`);
  const ban = (u, banned) => act('users/ban', { id: u.id, banned }, `${u.email} ${banned ? 'locked' : 'unlocked'}`);
  const fmtDate = (d) => { try { return new Date(d).toLocaleDateString(); } catch { return d; } };

  return (
    <div className="space-y-3">
      <input
        className={INPUT_CLS}
        placeholder="Search accounts by email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {msg && (
        <div className={`text-xs rounded p-2 ${msg.ok ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' : 'bg-zinc-800 border border-zinc-700 text-zinc-300'}`}>
          {msg.text}
        </div>
      )}
      <div className="space-y-1.5">
        {users.length === 0 && <div className="text-xs text-zinc-500">No accounts found.</div>}
        {users.map((u) => (
          <div key={u.id} className="bg-zinc-900/60 border border-zinc-800 rounded p-2.5 text-xs">
            <button onClick={() => setSel(sel === u.id ? null : u.id)} className="text-left w-full">
              <div className="font-medium truncate flex items-center gap-1.5 text-zinc-100">
                {u.banned ? <span className="text-red-400">⛔</span> : null}
                {u.email}
              </div>
              <div className="text-zinc-500 mt-0.5">
                <span className="uppercase tracking-wider">{u.tier}</span>
                {u.tier_expires_at ? ` · beta until ${fmtDate(u.tier_expires_at)}` : ''}
                {u.subscription_status ? ` · ${u.subscription_status}` : ''}
                {` · ${u.submissions ?? 0} subs · ${u.watchlist ?? 0} watch`}
              </div>
            </button>
            {sel === u.id && (
              <div className="mt-2 pt-2 border-t border-zinc-800 space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {['free', 'beta', 'pro', 'elite'].map((t) => (
                    <button
                      key={t}
                      disabled={busy}
                      onClick={() => setTier(u, t)}
                      className={`px-2 py-1 rounded border uppercase tracking-wider text-[10px] disabled:opacity-50 ${u.tier === t ? 'border-orange-500/60 text-orange-300 bg-orange-500/10' : 'border-zinc-700 text-zinc-300 hover:border-orange-500/50'}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                  Beta length:
                  <input
                    type="number"
                    inputMode="numeric"
                    value={betaDays}
                    onChange={(e) => setBetaDays(e.target.value)}
                    className="w-14 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-100"
                  />
                  days — applied when you grant <span className="uppercase">beta</span> (blank/0 = no end date)
                </div>
                {u.email?.toLowerCase() === CONFIG.OWNER_EMAIL.toLowerCase() ? (
                  <div className="text-[10px] uppercase tracking-wider text-sky-400 border border-sky-500/30 rounded px-2 py-1 inline-block">
                    ★ Owner account · protected
                  </div>
                ) : (
                  <button
                    disabled={busy}
                    onClick={() => ban(u, !u.banned)}
                    className={`px-2 py-1 rounded border text-[10px] uppercase tracking-wider disabled:opacity-50 ${u.banned ? 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10' : 'border-red-500/40 text-red-400 hover:bg-red-500/10'}`}
                  >
                    {u.banned ? 'Unlock account' : 'Ban / lock account'}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="pt-3 border-t border-zinc-800">
        <AdminUserAccess adminToken={adminToken} />
      </div>
    </div>
  );
}

function AdminCreateCard({ adminToken, onCreated }) {
  const blank = {
    player: '',
    card_set: '',
    card_number: '',
    team: '',
    position: '',
    variant_id: SCARCITY_LADDER[0]?.id || '',
    sportscardspro_id: '',
    bear_case: '',
  };
  const freshTraits = () => Object.fromEntries(SUB_TRAITS.map((t) => [t, 70]));
  const [f, setF] = useState(blank);
  const [traits, setTraits] = useState(freshTraits);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  // AI-assist state
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState(null);
  const [rationales, setRationales] = useState({});
  const [confidence, setConfidence] = useState('');
  const [aiWarning, setAiWarning] = useState('');
  const [showGuide, setShowGuide] = useState(false);
  const upd = (k, v) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    fetch('/api/admin/ai-config', { headers: { 'x-admin-token': adminToken } })
      .then((r) => r.json())
      .then((d) => setAiEnabled(Boolean(d.enabled)))
      .catch(() => {});
  }, [adminToken]);

  const suggest = async () => {
    if (!f.player.trim()) { setAiMsg({ ok: false, text: 'Enter the player first.' }); return; }
    setAiBusy(true);
    setAiMsg(null);
    try {
      const r = await fetch('/api/admin/suggest-traits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
        body: JSON.stringify({
          player: f.player, card_set: f.card_set, card_number: f.card_number,
          team: f.team, position: f.position, variant: f.variant_id,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setAiMsg({ ok: false, text: d.error || `Failed (${r.status})` });
      } else {
        if (d.traits) setTraits((s) => ({ ...s, ...d.traits }));
        setRationales(d.rationales || {});
        setConfidence(d.confidence || '');
        setAiWarning(d.warningSigns || '');
        if (d.warningSigns && !f.bear_case.trim()) upd('bear_case', d.warningSigns);
        setAiMsg({ ok: true, text: 'Suggestions filled in — review and edit before saving.' });
      }
    } catch {
      setAiMsg({ ok: false, text: 'Could not reach the server.' });
    } finally {
      setAiBusy(false);
    }
  };

  const create = async () => {
    if (!f.player.trim()) {
      setMsg({ ok: false, text: 'Player name is required.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/admin/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
        body: JSON.stringify({ ...f, traits }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMsg({ ok: false, text: d.error || `Failed (${r.status})` });
      else {
        setMsg({ ok: true, text: `Card created (${d.cardId || 'ok'}). Price + image fetch attempted.` });
        setF(blank);
        setTraits(freshTraits());
        setRationales({});
        setConfidence('');
        setAiWarning('');
        setAiMsg(null);
        onCreated && onCreated();
      }
    } catch {
      setMsg({ ok: false, text: 'Could not reach the server.' });
    } finally {
      setBusy(false);
    }
  };

  const confColor = { low: 'text-amber-400', medium: 'text-sky-400', high: 'text-emerald-400' }[confidence] || 'text-zinc-400';

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-zinc-400 leading-relaxed">
        Add a card straight to the shared catalog. Give it a SportsCardsPro product ID and we’ll pull
        its price + image automatically. Modern only (year ≥ {CONFIG.MIN_CARD_YEAR}).
      </div>
      <input className={INPUT_CLS} placeholder="Player *" value={f.player} onChange={(e) => upd('player', e.target.value)} />
      <input className={INPUT_CLS} placeholder="Set (e.g. 2023 Bowman Chrome Prospect Auto)" value={f.card_set} onChange={(e) => upd('card_set', e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <input className={INPUT_CLS} placeholder="Card #" value={f.card_number} onChange={(e) => upd('card_number', e.target.value)} />
        <select className={INPUT_CLS} value={f.variant_id} onChange={(e) => upd('variant_id', e.target.value)}>
          {SCARCITY_LADDER.map((v) => (
            <option key={v.id} value={v.id}>{v.label}</option>
          ))}
        </select>
        <input className={INPUT_CLS} placeholder="Team" value={f.team} onChange={(e) => upd('team', e.target.value)} />
        <input className={INPUT_CLS} placeholder="Position" value={f.position} onChange={(e) => upd('position', e.target.value)} />
      </div>
      <input className={INPUT_CLS} placeholder="SportsCardsPro product ID (price + image)" value={f.sportscardspro_id} onChange={(e) => upd('sportscardspro_id', e.target.value)} />

      {/* Traits — anchored rubric + optional AI assist */}
      <div className="flex items-center justify-between pt-1">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">Traits (0–100)</div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowGuide((v) => !v)} className="text-[10px] text-zinc-400 hover:text-zinc-200">
            ⓘ Scoring guide
          </button>
          <button
            type="button"
            onClick={suggest}
            disabled={aiBusy || !aiEnabled || !f.player.trim()}
            title={aiEnabled ? 'Estimate traits + warning signs with AI' : 'Set ANTHROPIC_API_KEY in the server .env to enable'}
            className="text-[10px] px-2 py-1 rounded border border-sky-500/40 text-sky-300 hover:bg-sky-500/10 disabled:opacity-40"
          >
            {aiBusy ? 'Thinking…' : '✦ Suggest with AI'}
          </button>
        </div>
      </div>
      {!aiEnabled && (
        <div className="text-[10px] text-zinc-500">
          AI suggest is off — add <span className="text-zinc-300">ANTHROPIC_API_KEY</span> to the server .env to enable it. The scoring guide below works without it.
        </div>
      )}
      {confidence && (
        <div className="text-[10px] text-zinc-500">AI confidence: <span className={`uppercase ${confColor}`}>{confidence}</span> — review every value before saving.</div>
      )}
      {showGuide && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded p-2 space-y-1.5 text-[10px] text-zinc-400">
          {SUB_TRAITS.map((t) => (
            <div key={t}>
              <span className="text-zinc-200">{TRAIT_RUBRIC[t].label}</span>
              <div className="text-zinc-500">{TRAIT_RUBRIC[t].anchors.join('  ·  ')}</div>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-1.5">
        {SUB_TRAITS.map((t) => (
          <div key={t} className="flex items-start gap-2">
            <div className="w-28 shrink-0 pt-1.5">
              <div className="text-[11px] text-zinc-300" title={TRAIT_RUBRIC[t].anchors.join('  |  ')}>
                {TRAIT_RUBRIC[t].label}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <input
                type="number"
                inputMode="numeric"
                className="w-16 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-xs text-zinc-100"
                value={traits[t]}
                onChange={(e) => setTraits((s) => ({ ...s, [t]: parseInt(e.target.value, 10) || 0 }))}
              />
              {rationales[t] && (
                <div className="text-[10px] text-sky-300/80 mt-0.5 leading-snug">{rationales[t]}</div>
              )}
            </div>
          </div>
        ))}
      </div>
      {aiMsg && (
        <div className={`text-xs rounded p-2 ${aiMsg.ok ? 'bg-sky-500/10 border border-sky-500/30 text-sky-300' : 'bg-zinc-800 border border-zinc-700 text-zinc-300'}`}>
          {aiMsg.text}
        </div>
      )}

      <div className="text-[10px] uppercase tracking-wider text-zinc-500 pt-1">Warning signs to watch</div>
      <textarea
        className={INPUT_CLS}
        rows={3}
        placeholder="Risks that would cap the upside (optional)"
        value={f.bear_case}
        onChange={(e) => upd('bear_case', e.target.value)}
      />
      {aiWarning && aiWarning !== f.bear_case && (
        <div className="text-[10px] bg-sky-500/5 border border-sky-500/20 rounded p-2 text-zinc-300 leading-snug">
          <span className="text-sky-300/80">AI draft: </span>{aiWarning}
          <button type="button" onClick={() => upd('bear_case', aiWarning)} className="ml-1 underline text-sky-300 hover:text-sky-200">Use this</button>
        </div>
      )}

      <button onClick={create} disabled={busy} className="w-full bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-zinc-950 font-semibold rounded py-2.5">
        {busy ? 'Creating…' : 'Create card'}
      </button>
      {msg && (
        <div className={`text-xs rounded p-2 ${msg.ok ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' : 'bg-zinc-800 border border-zinc-700 text-zinc-300'}`}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

function AdminEditTraits({ cards, adminToken, onSaved }) {
  const [selectedCardId, setSelectedCardId] = useState(cards[0]?.id || '');
  const [traits, setTraits] = useState(Object.fromEntries(SUB_TRAITS.map((t) => [t, 70])));
  const [bearCase, setBearCase] = useState('');
  const [showGuide, setShowGuide] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [details, setDetails] = useState({ team: '', position: '', card_set: '', card_number: '', variant_id: '' });
  const updDetail = (k, v) => setDetails((s) => ({ ...s, [k]: v }));

  // Prefill from the selected card's current traits + details + warning signs.
  useEffect(() => {
    const c = cards.find((x) => x.id === selectedCardId);
    const base = Object.fromEntries(SUB_TRAITS.map((t) => [t, Number(c?.traits?.[t]) || 0]));
    setTraits(base);
    setBearCase(c?.bearCase || '');
    setDetails({
      team: c?.team || '',
      position: c?.position || '',
      card_set: c?.set || '',
      card_number: c?.cardNumber || '',
      variant_id: c?.variantId || (SCARCITY_LADDER[0]?.id || ''),
    });
    setMsg(null);
  }, [selectedCardId, cards]);

  // One save writes everything: card details (team/position/set/#/variant) AND
  // the traits + warning signs.
  const save = async () => {
    if (!selectedCardId) return;
    setSaving(true);
    setMsg(null);
    try {
      const rd = await fetch('/api/admin/cards/details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
        body: JSON.stringify({ id: selectedCardId, ...details }),
      });
      const rt = await fetch('/api/admin/cards/traits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
        body: JSON.stringify({ id: selectedCardId, traits, bear_case: bearCase }),
      });
      const dt = await rt.json().catch(() => ({}));
      if (!rt.ok || !rd.ok) setMsg({ ok: false, text: dt.error || `Save failed (${rt.status})` });
      else { setMsg({ ok: true, text: 'Card saved (details + traits).' }); onSaved(); }
    } catch {
      setMsg({ ok: false, text: 'Could not reach the server.' });
    } finally {
      setSaving(false);
    }
  };

  const reviewed = (c) => Boolean(c.traitsUpdatedAt);
  const sortedCards = [...cards].sort((a, b) => (reviewed(a) === reviewed(b) ? 0 : reviewed(a) ? 1 : -1));
  const doneCount = cards.filter(reviewed).length;
  const selCard = cards.find((c) => c.id === selectedCardId);
  const fmtDate = (d) => { try { return new Date(d).toLocaleDateString(); } catch { return d; } };

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-zinc-400 leading-relaxed">
        Edit a card already in the catalog — details (team / position / set / # / variant), trait
        scores, and warning signs. One <span className="text-zinc-200">Save card</span> at the bottom
        writes all of it; saved scores immediately drive the Combined score, ranking, and dossier.
      </div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-zinc-400">
          <span className="text-emerald-400 font-medium">{doneCount}</span> of {cards.length} cards updated
        </span>
        <span className="text-zinc-600">✓ updated · ○ pending</span>
      </div>
      <select
        value={selectedCardId}
        onChange={(e) => setSelectedCardId(e.target.value)}
        className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm"
      >
        {sortedCards.map((c) => (
          <option key={c.id} value={c.id}>{reviewed(c) ? '✓' : '○'} {c.player} · {c.set}</option>
        ))}
      </select>
      <div className="text-[11px]">
        {reviewed(selCard)
          ? <span className="text-emerald-400/80">✓ Traits last updated {fmtDate(selCard.traitsUpdatedAt)}</span>
          : <span className="text-amber-400/90">○ Not updated yet — this card still has its seeded/default traits.</span>}
      </div>

      {/* Card details — team/position/set/#/variant (esp. for auto-pulled cards) */}
      <div className="pt-2 border-t border-zinc-800 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">Card details</div>
        <div className="grid grid-cols-2 gap-2">
          <input className={INPUT_CLS} placeholder="Team" value={details.team} onChange={(e) => updDetail('team', e.target.value)} />
          <input className={INPUT_CLS} placeholder="Position" value={details.position} onChange={(e) => updDetail('position', e.target.value)} />
        </div>
        <input className={INPUT_CLS} placeholder="Set" value={details.card_set} onChange={(e) => updDetail('card_set', e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <input className={INPUT_CLS} placeholder="Card #" value={details.card_number} onChange={(e) => updDetail('card_number', e.target.value)} />
          <select className={INPUT_CLS} value={details.variant_id} onChange={(e) => updDetail('variant_id', e.target.value)}>
            {SCARCITY_LADDER.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between pt-1">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">Traits (0–100)</div>
        <button type="button" onClick={() => setShowGuide((v) => !v)} className="text-[10px] text-zinc-400 hover:text-zinc-200">
          ⓘ Scoring guide
        </button>
      </div>
      {showGuide && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded p-2 space-y-1.5 text-[10px] text-zinc-400">
          {SUB_TRAITS.map((t) => (
            <div key={t}>
              <span className="text-zinc-200">{TRAIT_RUBRIC[t].label}</span>
              <div className="text-zinc-500">{TRAIT_RUBRIC[t].anchors.join('  ·  ')}</div>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-1.5">
        {SUB_TRAITS.map((t) => (
          <div key={t} className="flex items-center gap-2">
            <div className="w-28 shrink-0 text-[11px] text-zinc-300" title={TRAIT_RUBRIC[t].anchors.join('  |  ')}>
              {TRAIT_RUBRIC[t].label}
            </div>
            <input
              type="number"
              inputMode="numeric"
              className="w-16 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-xs text-zinc-100"
              value={traits[t]}
              onChange={(e) => setTraits((s) => ({ ...s, [t]: parseInt(e.target.value, 10) || 0 }))}
            />
          </div>
        ))}
      </div>

      <div className="text-[10px] uppercase tracking-wider text-zinc-500 pt-1">Warning signs to watch</div>
      <textarea
        className={INPUT_CLS}
        rows={3}
        placeholder="Risks that would cap the upside (optional)"
        value={bearCase}
        onChange={(e) => setBearCase(e.target.value)}
      />

      <button onClick={save} disabled={saving || !selectedCardId} className="w-full bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-zinc-950 font-semibold rounded py-2.5">
        {saving ? 'Saving…' : 'Save card'}
      </button>
      {msg && (
        <div className={`text-xs rounded p-2 ${msg.ok ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' : 'bg-zinc-800 border border-zinc-700 text-zinc-300'}`}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

function AdminPullCards({ adminToken, onDone }) {
  const [sports, setSports] = useState([{ id: 'baseball', label: 'Baseball' }]);
  const [sport, setSport] = useState('baseball');
  const [count, setCount] = useState('10');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    fetch('/api/admin/pull-sports', { headers: { 'x-admin-token': adminToken } })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.sports) && d.sports.length) setSports(d.sports); })
      .catch(() => {});
  }, [adminToken]);

  const pull = async () => {
    const n = Math.max(1, Math.min(200, parseInt(count, 10) || 0));
    setBusy(true);
    setMsg(null);
    setResult(null);
    try {
      const r = await fetch('/api/admin/pull-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
        body: JSON.stringify({ sport, count: n }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMsg({ ok: false, text: d.error || `Failed (${r.status})` });
      else { setResult(d); onDone && onDone(); }
    } catch {
      setMsg({ ok: false, text: 'Could not reach the server.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-zinc-400 leading-relaxed">
        Pull new cards straight from SportsCardsPro — real prices, distinct players, no duplicates of
        what’s already in the catalog. New cards arrive with placeholder traits (○ pending) and no
        pop; curate them on the Edit-traits and Pop/price screens.
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">How many</span>
          <input type="number" inputMode="numeric" min="1" max="200" value={count} onChange={(e) => setCount(e.target.value)} className={`${INPUT_CLS} mt-1`} />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Sport</span>
          <select value={sport} onChange={(e) => setSport(e.target.value)} className={`${INPUT_CLS} mt-1`}>
            {sports.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      </div>
      <button onClick={pull} disabled={busy} className="w-full bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-zinc-950 font-semibold rounded py-2.5">
        {busy ? 'Pulling… (takes ~15s)' : 'Pull cards'}
      </button>
      {msg && <div className="text-xs rounded p-2 bg-zinc-800 border border-zinc-700 text-zinc-300">{msg.text}</div>}
      {result && (
        <div className="space-y-2">
          <div className="text-xs rounded p-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
            Pulled {result.inserted} new {result.sport} card{result.inserted === 1 ? '' : 's'}
            {result.inserted < result.requested ? ` (requested ${result.requested}; only ${result.available} new distinct players were available)` : ''}.
          </div>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {(result.added || []).map((a, i) => (
              <div key={i} className="text-[11px] bg-zinc-900/60 border border-zinc-800 rounded px-2 py-1 flex justify-between gap-2">
                <span className="truncate">{a.player}<span className="text-zinc-500"> · {a.set}</span></span>
                <span className="text-zinc-400 tabular-nums shrink-0">${Math.round(a.rawPrice).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const ADMIN_NAV = [
  { id: 'dashboard', icon: '▦', label: 'Dashboard' },
  { id: 'users', icon: '◉', label: 'Accounts' },
  { id: 'submissions', icon: '⇄', label: 'Submissions' },
  { id: 'cards', icon: '＋', label: 'New card' },
  { id: 'pull', icon: '⇩', label: 'Pull cards' },
  { id: 'traits', icon: '✎', label: 'Edit traits' },
  { id: 'pricing', icon: '＄', label: 'Pop / price' },
];

function AdminConsole({ cards, adminToken, onSaved, onClose, onLock }) {
  const [screen, setScreen] = useState('dashboard');
  return (
    <div className="fixed inset-0 bg-zinc-950 z-50 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-orange-500 font-mono text-sm">▌</span>
            <h2 className="text-lg font-bold tracking-tight">Control Console</h2>
          </div>
          <div className="flex items-center gap-3">
            {onLock && (
              <button onClick={onLock} className="text-zinc-500 hover:text-red-400 text-xs" title="Sign out of admin (clears the saved passphrase)">🔒 Lock</button>
            )}
            <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200 text-sm">Close ✕</button>
          </div>
        </div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-600 mb-4 font-mono">
          CardProspector · operator terminal
        </div>
        <div className="flex gap-2 flex-wrap mb-5">
          {ADMIN_NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setScreen(n.id)}
              className={`flex flex-col items-center justify-center w-[4.5rem] h-16 rounded-lg border transition ${
                screen === n.id
                  ? 'bg-orange-500/15 border-orange-500/50 text-orange-300'
                  : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:border-zinc-600'
              }`}
            >
              <span className="text-xl leading-none mb-1">{n.icon}</span>
              <span className="text-[9px] uppercase tracking-wider">{n.label}</span>
            </button>
          ))}
        </div>
        <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4">
          {screen === 'dashboard' && <AdminDashboard adminToken={adminToken} onGo={setScreen} />}
          {screen === 'users' && <AdminUsers adminToken={adminToken} />}
          {screen === 'submissions' && <AdminSubmissions adminToken={adminToken} onPublished={onSaved} />}
          {screen === 'cards' && <AdminCreateCard adminToken={adminToken} onCreated={onSaved} />}
          {screen === 'pull' && <AdminPullCards adminToken={adminToken} onDone={onSaved} />}
          {screen === 'traits' && <AdminEditTraits cards={cards} adminToken={adminToken} onSaved={onSaved} />}
          {screen === 'pricing' && <AdminPopEntry cards={cards} adminToken={adminToken} onSaved={onSaved} />}
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
          CardProspector is for educational and informational purposes only. It surfaces pattern-based
          hypotheses, not predictions or recommendations. Card values are volatile and you can lose
          money. Always do your own research before buying.
        </p>
        <p>
          <a href={feedbackHref} className="text-orange-400/80 hover:text-orange-400 underline">
            Send feedback
          </a>
          <span className="mx-1.5">·</span>
          <span>CardProspector · Beta</span>
        </p>
        <p>
          <a href="/terms" className="hover:text-zinc-400 underline">Terms</a>
          <span className="mx-1.5">·</span>
          <a href="/privacy" className="hover:text-zinc-400 underline">Privacy</a>
          <span className="mx-1.5">·</span>
          <a href="/refunds" className="hover:text-zinc-400 underline">Refunds</a>
        </p>
      </div>
    </footer>
  );
}

function BottomNav({ tab, onTabChange, onOpenAdmin, showAdmin }) {
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
        {showAdmin && (
          <button
            onClick={onOpenAdmin}
            className="px-4 py-3 text-zinc-600 hover:text-zinc-300"
            aria-label="Admin"
          >
            ⚙
          </button>
        )}
      </div>
    </nav>
  );
}

function AuthModal({ onClose, onAuthed }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [sent, setSent] = useState(false); // forgot-password confirmation

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (mode === 'forgot') {
        await fetch('/api/auth/forgot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim() }),
        });
        setSent(true);
        return;
      }
      const res = await fetch(`/api/auth/${mode === 'signup' ? 'signup' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setErr(data.error || 'Something went wrong.');
      else onAuthed(data.user);
    } catch {
      setErr('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-zinc-950/90 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Reset password' : 'Sign in'}</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200">✕</button>
        </div>

        {mode === 'forgot' && sent ? (
          <div className="space-y-3">
            <p className="text-sm text-zinc-300 leading-relaxed">
              If an account exists for <span className="text-zinc-100">{email.trim()}</span>, we’ve emailed a
              password-reset link. Check your inbox (and spam) — it expires in 1 hour.
            </p>
            <button onClick={() => { setMode('login'); setSent(false); setErr(null); }} className="w-full bg-zinc-800 hover:bg-zinc-700 rounded-lg py-2.5 text-sm font-medium">
              Back to sign in
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-3">
              {mode === 'forgot' && (
                <p className="text-xs text-zinc-400 leading-relaxed">Enter your email and we’ll send a link to reset your password.</p>
              )}
              <input
                type="email" autoComplete="email" placeholder="Email" value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm"
              />
              {mode !== 'forgot' && (
                <input
                  type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  placeholder="Password (8+ characters)" value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm"
                />
              )}
              {err && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2">{err}</div>}
              <button type="submit" disabled={busy} className="w-full bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-zinc-950 font-semibold rounded-lg py-2.5">
                {busy ? '…' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Sign in'}
              </button>
            </form>
            {mode === 'login' && (
              <div className="text-xs text-center mt-2">
                <button onClick={() => { setMode('forgot'); setErr(null); }} className="text-zinc-400 hover:text-zinc-200">Forgot password?</button>
              </div>
            )}
            <div className="text-xs text-zinc-400 text-center mt-3">
              {mode === 'signup' ? 'Already have an account?' : mode === 'forgot' ? 'Remembered it?' : "Don't have an account?"}{' '}
              <button onClick={() => { setMode(mode === 'signup' ? 'login' : mode === 'forgot' ? 'login' : 'signup'); setErr(null); }} className="text-orange-400 hover:text-orange-300">
                {mode === 'signup' ? 'Sign in' : mode === 'forgot' ? 'Sign in' : 'Create one'}
              </button>
            </div>
            <p className="text-[10px] text-zinc-500 text-center mt-3 leading-relaxed">
              For educational and informational purposes only — not financial or investment advice. By continuing you agree to our{' '}
              <a href="/terms" className="text-zinc-400 underline">Terms</a> and{' '}
              <a href="/privacy" className="text-zinc-400 underline">Privacy Policy</a>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function UpgradeModal({ onClose }) {
  const [busy, setBusy] = useState(null);
  const go = async (plan) => {
    setBusy(plan);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.url) window.location.href = data.url;
      else { setBusy(null); window.alert(data.error || 'Could not start checkout.'); }
    } catch { setBusy(null); window.alert('Could not reach the server.'); }
  };

  const Tier = ({ name, monthly, annual, planKey, features, accent }) => (
    <div className={`border rounded-xl p-4 ${accent}`}>
      <div className="flex items-baseline justify-between">
        <div className="font-bold">{name}</div>
        <div><span className="text-xl font-bold">${monthly}</span><span className="text-zinc-400 text-sm">/mo</span></div>
      </div>
      <ul className="mt-2 space-y-1 text-xs text-zinc-300">
        {features.map((f, i) => <li key={i}>• {f}</li>)}
      </ul>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <button onClick={() => go(`${planKey}_monthly`)} disabled={busy} className="bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-zinc-950 font-semibold rounded py-2 text-sm">
          {busy === `${planKey}_monthly` ? '…' : 'Start trial'}
        </button>
        <button onClick={() => go(`${planKey}_annual`)} disabled={busy} className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded py-2 text-sm">
          {busy === `${planKey}_annual` ? '…' : `$${annual}/yr`}
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-zinc-950/90 z-50 overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 w-full max-w-md mx-auto my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold">Start your 7-day free trial</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200">✕</button>
        </div>
        <p className="text-xs text-zinc-400 mb-2">Free for 7 days, then billed monthly (or yearly — ~2 months free). Cancel anytime.</p>
        <p className="text-[11px] text-orange-300/90 bg-orange-500/5 border border-orange-500/30 rounded p-2 mb-4 leading-relaxed">
          Built for <span className="font-medium">modern prospects & rookies ({CONFIG.MIN_CARD_YEAR}–present)</span> — the engine predicts which recent cards will grow. Vintage/older cards aren't supported.
        </p>
        <div className="space-y-3">
          <Tier name="Prospector Pro" monthly="7.99" annual="79" planKey="pro" accent="border-emerald-500/40 bg-emerald-500/5"
            features={['Full dossiers + buy/sell targets', 'Hold horizon', 'Private watchlist', 'Add your own cards']} />
          <Tier name="Elite" monthly="19.99" annual="199" planKey="elite" accent="border-orange-500/40 bg-orange-500/5"
            features={['Everything in Pro', 'Price & pop alerts', 'Portfolio P&L', 'Priority on your submitted cards', 'Early access']} />
        </div>
        <p className="text-[10px] text-zinc-500 text-center mt-4 leading-relaxed">
          Secure checkout by Stripe. 7-day free trial, then auto-renews; cancel anytime. By subscribing you
          agree to our <a href="/terms" className="underline">Terms</a> &{' '}
          <a href="/refunds" className="underline">Refund Policy</a>.
        </p>
      </div>
    </div>
  );
}

const INPUT_CLS = 'w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm';

function SubmissionModal({ onClose }) {
  const blank = { player: '', card_year: '', card_set: '', card_number: '', team: '', position: '', variant_id: 'auto_base', sportscardspro_id: '', note: '' };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [mine, setMine] = useState([]);
  const upd = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const loadMine = useCallback(async () => {
    try { const r = await fetch('/api/submissions/mine'); const d = await r.json(); setMine(d.submissions || []); } catch {}
  }, []);
  useEffect(() => { loadMine(); }, [loadMine]);

  const submit = async () => {
    const required = { Player: f.player, Year: f.card_year, 'Card #': f.card_number, Team: f.team, Position: f.position };
    const missing = Object.entries(required).filter(([, v]) => !String(v).trim()).map(([k]) => k);
    if (missing.length) { setMsg({ ok: false, text: `Please fill in the required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.` }); return; }
    const yr = parseInt(f.card_year, 10);
    if (!yr || yr < CONFIG.MIN_CARD_YEAR) {
      setMsg({ ok: false, text: `CardProspector covers modern cards (${CONFIG.MIN_CARD_YEAR}–present). Older/vintage cards aren't supported — the grading-flip and growth model is built for recent prospects.` });
      return;
    }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/submissions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setMsg({ ok: false, text: d.error || 'Could not submit.' });
      else { setMsg({ ok: true, text: 'Submitted! We review and price each card before it joins the shared database.' }); setF(blank); loadMine(); }
    } catch { setMsg({ ok: false, text: 'Could not reach the server.' }); }
    finally { setBusy(false); }
  };

  const statusCls = (s) => s === 'published' ? 'text-emerald-400' : s === 'rejected' ? 'text-red-400' : 'text-amber-400';

  return (
    <div className="fixed inset-0 bg-zinc-950/90 z-50 overflow-y-auto p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 w-full max-w-md mx-auto my-8">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold">Submit a card</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200">✕</button>
        </div>
        <p className="text-xs text-zinc-400 mb-2">Tell us about a card and we'll trait-score + price it, then add it to the shared database for everyone.</p>
        <div className="text-[11px] text-orange-300/90 bg-orange-500/5 border border-orange-500/30 rounded p-2 mb-3 leading-relaxed">
          Modern cards only — <span className="font-medium">{CONFIG.MIN_CARD_YEAR} to present</span>. The engine predicts which recent prospect/rookie cards will grow; vintage isn't supported.
        </div>
        <div className="space-y-2">
          <input className={INPUT_CLS} placeholder="Player *" value={f.player} onChange={(e) => upd('player', e.target.value)} />
          <div className="grid grid-cols-3 gap-2">
            <input className={INPUT_CLS} type="number" inputMode="numeric" placeholder="Year *" value={f.card_year} onChange={(e) => upd('card_year', e.target.value)} />
            <input className={`${INPUT_CLS} col-span-2`} placeholder="Set" value={f.card_set} onChange={(e) => upd('card_set', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input className={INPUT_CLS} placeholder="Card # * (e.g. #CDA-WL)" value={f.card_number} onChange={(e) => upd('card_number', e.target.value)} />
            <select className={INPUT_CLS} value={f.variant_id} onChange={(e) => upd('variant_id', e.target.value)}>
              {SCARCITY_LADDER.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
            <input className={INPUT_CLS} placeholder="Team *" value={f.team} onChange={(e) => upd('team', e.target.value)} />
            <input className={INPUT_CLS} placeholder="Position *" value={f.position} onChange={(e) => upd('position', e.target.value)} />
          </div>
          <input className={INPUT_CLS} placeholder="SportsCardsPro product ID (optional)" value={f.sportscardspro_id} onChange={(e) => upd('sportscardspro_id', e.target.value)} />
          <textarea className={INPUT_CLS} rows={2} placeholder="Anything else? (optional)" value={f.note} onChange={(e) => upd('note', e.target.value)} />
          <div className="text-[10px] text-zinc-500">Fields marked <span className="text-zinc-300">*</span> are required.</div>
          <button onClick={submit} disabled={busy} className="w-full bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-zinc-950 font-semibold rounded-lg py-2.5">
            {busy ? '…' : 'Submit card'}
          </button>
          {msg && <div className={`text-xs rounded p-2 ${msg.ok ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' : 'bg-zinc-800 border border-zinc-700 text-zinc-300'}`}>{msg.text}</div>}
        </div>
        {mine.length > 0 && (
          <div className="mt-5">
            <div className="text-[11px] uppercase tracking-widest text-zinc-500 mb-2">Your submissions</div>
            <div className="space-y-1.5">
              {mine.map((s) => (
                <div key={s.id} className="text-xs bg-zinc-900/60 border border-zinc-800 rounded p-2 flex justify-between gap-2">
                  <span className="truncate">{s.player}{s.card_number ? ` · ${s.card_number}` : ''}</span>
                  <span className={`uppercase tracking-wider ${statusCls(s.status)}`}>{s.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const SUB_TRAITS = ['hof', 'peak', 'market', 'position', 'narrative', 'unique', 'longevity'];

// Anchored scoring guide shown in the Control Console so trait scores are
// consistent and defensible (not just opinion). Mirrors the server AI rubric.
const TRAIT_RUBRIC = {
  hof:       { label: 'HOF probability', anchors: ['20 — fringe MLB / org filler', '50 — solid regular, no HOF case', '80 — multiple All-Star seasons likely', '95 — inner-circle / generational'] },
  peak:      { label: 'Peak intensity',  anchors: ['20 — role-player ceiling', '50 — above-average regular', '80 — perennial All-Star peak', '95 — MVP-tier / historic'] },
  market:    { label: 'Market spotlight', anchors: ['20 — small-market', '50 — mid-market', '80 — large national-spotlight team', '95 — Yankees/Dodgers/Lakers-tier'] },
  position:  { label: 'Position premium', anchors: ['20 — low (1B/DH/corner)', '50 — average (corner OF/2B)', '80 — premium (C/SS/CF)', '95 — elite-scarcity premium'] },
  narrative: { label: 'Narrative / story', anchors: ['20 — no distinct story', '50 — mild hype', '80 — strong narrative (intl./comeback/dynasty)', '95 — generational phenomenon'] },
  unique:    { label: 'Unique skill',    anchors: ['20 — ordinary profile', '50 — one plus-skill', '80 — rare standout tool', '95 — singular (e.g. two-way)'] },
  longevity: { label: 'Longevity',       anchors: ['20 — injury-prone / short runway', '50 — average outlook', '80 — durable long elite window', '95 — iron-man longevity'] },
};

function SubmissionReview({ sub, adminToken, onDone }) {
  const [f, setF] = useState({
    player: sub.player, sport: sub.sport, team: sub.team || '', position: sub.position || '',
    card_set: sub.card_set || '', card_number: sub.card_number || '', variant_id: sub.variant_id || 'auto_base',
    sportscardspro_id: sub.sportscardspro_id || '', bear_case: '',
  });
  const [traits, setTraits] = useState(Object.fromEntries(SUB_TRAITS.map((t) => [t, 70])));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const upd = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const act = async (path, body) => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/admin/submissions/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken }, body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: d.error || 'Failed' }); setBusy(false); }
      else onDone();
    } catch { setMsg({ ok: false, text: 'Server error' }); setBusy(false); }
  };
  const publish = () => act('publish', { id: sub.id, ...f, traits });
  const reject = () => act('reject', { id: sub.id, reviewNote: window.prompt('Reason (optional)') ?? '' });

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded p-3 text-xs space-y-2">
      <div className="text-zinc-500">by {sub.submitter_email}{sub.note ? ` · "${sub.note}"` : ''}</div>
      <input className={INPUT_CLS} value={f.player} onChange={(e) => upd('player', e.target.value)} placeholder="Player" />
      <input className={INPUT_CLS} value={f.card_set} onChange={(e) => upd('card_set', e.target.value)} placeholder="Set" />
      <div className="grid grid-cols-2 gap-2">
        <input className={INPUT_CLS} value={f.card_number} onChange={(e) => upd('card_number', e.target.value)} placeholder="Card #" />
        <select className={INPUT_CLS} value={f.variant_id} onChange={(e) => upd('variant_id', e.target.value)}>
          {SCARCITY_LADDER.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
        <input className={INPUT_CLS} value={f.team} onChange={(e) => upd('team', e.target.value)} placeholder="Team" />
        <input className={INPUT_CLS} value={f.position} onChange={(e) => upd('position', e.target.value)} placeholder="Position" />
      </div>
      <input className={INPUT_CLS} value={f.sportscardspro_id} onChange={(e) => upd('sportscardspro_id', e.target.value)} placeholder="SportsCardsPro product ID (for pricing)" />
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 pt-1">Traits (0–100)</div>
      <div className="grid grid-cols-4 gap-1.5">
        {SUB_TRAITS.map((t) => (
          <div key={t}>
            <div className="text-[9px] text-zinc-500 capitalize">{t.slice(0, 4)}</div>
            <input type="number" className="w-full bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-xs" value={traits[t]} onChange={(e) => setTraits((s) => ({ ...s, [t]: parseInt(e.target.value, 10) || 0 }))} />
          </div>
        ))}
      </div>
      <textarea className={INPUT_CLS} rows={2} value={f.bear_case} onChange={(e) => upd('bear_case', e.target.value)} placeholder="Warning signs to watch (the bear case)" />
      <div className="flex gap-2">
        <button onClick={publish} disabled={busy} className="flex-1 bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-zinc-950 font-semibold rounded py-2">{busy ? '…' : 'Publish to shared DB'}</button>
        <button onClick={reject} disabled={busy} className="bg-zinc-800 hover:bg-zinc-700 rounded px-3">Reject</button>
      </div>
      {msg && <div className="text-red-400">{msg.text}</div>}
    </div>
  );
}

function AdminUserAccess({ adminToken }) {
  const [email, setEmail] = useState('');
  const [tier, setTier] = useState('beta');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/set-tier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
        body: JSON.stringify({ email: email.trim(), tier }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setMsg({ ok: false, text: d.error || 'Failed' });
      else setMsg({ ok: d.updated, text: d.updated ? `${email.trim()} → ${tier}` : 'No user with that email.' });
    } catch { setMsg({ ok: false, text: 'Server error' }); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-6 pt-4 border-t border-zinc-800 space-y-2">
      <div className="text-[11px] uppercase tracking-widest text-zinc-500">User access · beta / comp</div>
      <div className="text-[11px] text-zinc-400 leading-relaxed">
        Grant a user free full access: <span className="text-zinc-300">beta</span> (free during the beta) or comp them
        pro/elite. Set to <span className="text-zinc-300">free</span> to revoke. By email.
      </div>
      <div className="flex gap-2">
        <input className={INPUT_CLS} placeholder="user@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select className="bg-zinc-900 border border-zinc-700 rounded px-2 text-sm" value={tier} onChange={(e) => setTier(e.target.value)}>
          <option value="beta">beta</option>
          <option value="pro">pro</option>
          <option value="elite">elite</option>
          <option value="free">free</option>
        </select>
        <button onClick={set} disabled={busy} className="bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-zinc-950 font-medium rounded px-3 text-sm">{busy ? '…' : 'Set'}</button>
      </div>
      {msg && <div className={`text-xs rounded p-2 ${msg.ok ? 'bg-orange-500/10 border border-orange-500/30 text-orange-300' : 'bg-zinc-800 border border-zinc-700 text-zinc-300'}`}>{msg.text}</div>}
    </div>
  );
}

function AdminSubmissions({ adminToken, onPublished }) {
  const [subs, setSubs] = useState([]);
  const load = useCallback(async () => {
    try { const r = await fetch('/api/admin/submissions', { headers: { 'x-admin-token': adminToken } }); const d = await r.json(); setSubs(d.submissions || []); } catch {}
  }, [adminToken]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="mt-6 pt-4 border-t border-zinc-800">
      <div className="text-[11px] uppercase tracking-widest text-zinc-500 mb-2">Pending submissions ({subs.length})</div>
      {subs.length === 0 ? (
        <div className="text-xs text-zinc-500">None pending.</div>
      ) : (
        <div className="space-y-3">
          {subs.map((s) => <SubmissionReview key={s.id} sub={s} adminToken={adminToken} onDone={() => { load(); onPublished && onPublished(); }} />)}
        </div>
      )}
    </div>
  );
}

/* Standalone password-reset page (opened from the emailed link at /reset?token=). */
function ResetPasswordPage() {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) { setErr('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setErr('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setErr(d.error || 'Could not reset password.');
      else setDone(true);
    } catch {
      setErr('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-[100dvh] w-full overflow-y-auto overflow-x-hidden bg-zinc-950 text-zinc-100 flex items-center justify-center p-4" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="text-2xl font-bold tracking-tight mb-4">Card<span className="text-orange-500">Prospector</span></div>
        {!token ? (
          <div className="text-sm text-zinc-300 leading-relaxed">This reset link is missing its token. Request a new one from the sign-in screen.</div>
        ) : done ? (
          <div className="space-y-3">
            <div className="text-sm text-emerald-300">Your password has been reset and you’re signed in.</div>
            <a href="/" className="block text-center w-full bg-orange-500 hover:bg-orange-400 text-zinc-950 font-semibold rounded-lg py-2.5">Go to CardProspector</a>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <h2 className="text-lg font-bold">Choose a new password</h2>
            <input type="password" autoComplete="new-password" placeholder="New password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm" />
            <input type="password" autoComplete="new-password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm" />
            {err && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2">{err}</div>}
            <button type="submit" disabled={busy} className="w-full bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-zinc-950 font-semibold rounded-lg py-2.5">{busy ? '…' : 'Reset password'}</button>
          </form>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
   APP ROOT
   ============================================================================ */

export default function CardProspector() {
  // Standalone pages routed by pathname (fixed per load — links do full navigations).
  const legalDoc = LEGAL_DOC_FOR_PATH(window.location.pathname);
  if (legalDoc) return <LegalPage doc={legalDoc} />;
  if (window.location.pathname === '/reset') return <ResetPasswordPage />;

  const [state, setState] = useState(loadState);
  const [sport, setSport] = useState('baseball');
  const [tab, setTab] = useState('scout');
  const [selectedCardId, setSelectedCardId] = useState(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminToken, setAdminToken] = useState(() => {
    try { return localStorage.getItem('cp_admin_token') || ''; } catch { return ''; }
  });

  // Card data comes from the API (MySQL). Until it loads — or if the API is
  // unreachable — we fall back to the bundled seed so the app still renders.
  const [allCards, setAllCards] = useState([]); // filled from /api/cards (scored server-side)

  // Auth + per-user watchlist (server-backed).
  const [user, setUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [watchlist, setWatchlist] = useState([]);
  const [portfolio, setPortfolio] = useState([]); // server-backed, per account
  const portfolioMigrated = useRef(false);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);

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

  const refetchWatchlist = useCallback(async () => {
    try {
      const res = await fetch('/api/watchlist');
      if (!res.ok) { setWatchlist([]); return; }
      const data = await res.json();
      setWatchlist(Array.isArray(data.cardIds) ? data.cardIds : []);
    } catch { setWatchlist([]); }
  }, []);

  const refetchPortfolio = useCallback(async () => {
    try {
      const res = await fetch('/api/portfolio');
      if (!res.ok) { setPortfolio([]); return; }
      const data = await res.json();
      setPortfolio(Array.isArray(data.portfolio) ? data.portfolio : []);
    } catch { setPortfolio([]); }
  }, []);

  // One-time: migrate any legacy localStorage holdings to the server, then clear
  // them locally. Runs once per session when a user is present.
  const migrateLocalPortfolio = useCallback(async () => {
    if (portfolioMigrated.current) return;
    portfolioMigrated.current = true;
    const local = (loadState().portfolio) || [];
    if (!local.length) return;
    for (const e of local) {
      await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: e.cardId, condition: e.condition || 'raw', purchasePrice: e.purchasePrice || 0 }),
      }).catch(() => {});
    }
    setState((s) => ({ ...s, portfolio: [] })); // clear the local copy after migrating
  }, []);

  const refetchUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      setUser(data.user || null);
    } catch { setUser(null); }
  }, []);

  useEffect(() => { saveState(state); }, [state]);
  // Refetch cards when the signed-in user changes — entitlement controls
  // whether the server includes pricing, so logging in/out/upgrading refreshes it.
  useEffect(() => { refetchCards(); }, [refetchCards, user]);
  useEffect(() => { refetchUser(); }, [refetchUser]);
  useEffect(() => { if (user) refetchWatchlist(); else setWatchlist([]); }, [user, refetchWatchlist]);
  useEffect(() => {
    if (!user) { setPortfolio([]); return; }
    (async () => { await migrateLocalPortfolio(); await refetchPortfolio(); })();
  }, [user, migrateLocalPortfolio, refetchPortfolio]);
  useEffect(() => {
    fetch('/api/billing/config').then((r) => r.json()).then((d) => setBillingEnabled(Boolean(d.enabled))).catch(() => {});
  }, []);
  // Returning from Stripe Checkout: refresh entitlement (the webhook may lag a moment).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgraded') === '1') {
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(refetchUser, 1500);
      setTimeout(refetchUser, 5000);
    }
  }, [refetchUser]);

  const cards = useMemo(
    () => allCards.filter((c) => c.sport === sport),
    [allCards, sport]
  );

  const selectedCard = useMemo(() => {
    if (!selectedCardId) return null;
    return cards.find((c) => c.id === selectedCardId) || null;
  }, [selectedCardId, cards]);

  // Reset the scroll position when switching tabs or opening/closing a dossier.
  const mainRef = useRef(null);
  useEffect(() => { mainRef.current?.scrollTo(0, 0); }, [selectedCardId, tab]);

  const isPro = Boolean(user) && (user.tier === 'pro' || user.tier === 'elite' || user.tier === 'beta');
  const isOwner = Boolean(user) && (user.email || '').toLowerCase() === CONFIG.OWNER_EMAIL.toLowerCase();
  const promptUpgrade = useCallback(() => {
    if (!user) setAuthOpen(true);
    else setUpgradeOpen(true);
  }, [user]);
  const onSubmitCard = useCallback(() => {
    if (!user) setAuthOpen(true);
    else if (!isPro) setUpgradeOpen(true);
    else setSubmitOpen(true);
  }, [user, isPro]);

  // Watchlist is a paid feature. Signed out → auth; free tier → upgrade.
  const toggleWatch = useCallback((id) => {
    if (!user) { setAuthOpen(true); return; }
    if (!isPro) { setUpgradeOpen(true); return; }
    setWatchlist((w) => {
      const has = w.includes(id);
      fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: id, watched: !has }),
      }).catch(() => {});
      return has ? w.filter((x) => x !== id) : [...w, id];
    });
  }, [user, isPro]);

  // Opening the portfolio-add modal (collects condition + price before saving).
  // Portfolio is per-account now, so adding requires sign-in (like the watchlist).
  const [portfolioModalId, setPortfolioModalId] = useState(null);
  const openAddToPortfolio = useCallback((id) => {
    if (!user) { setAuthOpen(true); return; }
    setPortfolioModalId(id);
  }, [user]);
  const confirmAddToPortfolio = useCallback((id, details) => {
    setPortfolio((list) => {
      const exists = list.some((p) => p.cardId === id);
      return exists
        ? list.map((p) => (p.cardId === id ? { ...p, ...details } : p))
        : [...list, { cardId: id, ...details }];
    });
    fetch('/api/portfolio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: id, condition: details.condition, purchasePrice: details.purchasePrice }),
    }).catch(() => {});
    setPortfolioModalId(null);
  }, []);

  const removeFromPortfolio = useCallback((id) => {
    setPortfolio((list) => list.filter((p) => p.cardId !== id));
    fetch('/api/portfolio/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: id }),
    }).catch(() => {});
  }, []);

  // Unlock the admin panel by verifying the passphrase against the server
  // (ADMIN_TOKEN in the server .env). The verified token is persisted to
  // localStorage so the owner stays signed in as admin across refreshes.
  const persistAdminToken = useCallback((token) => {
    setAdminToken(token);
    try {
      if (token) localStorage.setItem('cp_admin_token', token);
      else localStorage.removeItem('cp_admin_token');
    } catch { /* ignore */ }
  }, []);

  const openAdmin = async () => {
    // Already signed in as admin (persisted token) — open straight to the console.
    if (adminToken) { setAdminOpen(true); return; }
    const entered = window.prompt('Admin passphrase');
    if (entered == null) return;
    try {
      const res = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: { 'x-admin-token': entered },
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok) {
        persistAdminToken(entered);
        setAdminOpen(true);
      } else {
        window.alert('Incorrect passphrase.');
      }
    } catch {
      window.alert('Could not reach the server.');
    }
  };

  const lockAdmin = useCallback(() => {
    persistAdminToken('');
    setAdminOpen(false);
  }, [persistAdminToken]);

  // Self-heal a persisted admin token: verify it once on load, clear if stale.
  useEffect(() => {
    if (!adminToken) return;
    fetch('/api/admin/verify', { method: 'POST', headers: { 'x-admin-token': adminToken } })
      .then((r) => r.json()).catch(() => ({ ok: false }))
      .then((d) => { if (!d.ok) persistAdminToken(''); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onAuthed = (u) => { setUser(u); setAuthOpen(false); };
  const signOut = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    setUser(null);
    setWatchlist([]);
    lockAdmin(); // admin access is tied to being signed in as the owner
  };
  const manageBilling = async () => {
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else window.alert(data.error || 'Could not open billing.');
    } catch { window.alert('Could not reach the server.'); }
  };

  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-zinc-950 text-zinc-100 flex flex-col" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Account bar */}
      <div className="px-4 py-1.5 bg-zinc-900/50 border-b border-zinc-800 flex justify-end items-center text-xs">
        {user ? (
          <div className="flex items-center gap-2 text-zinc-400">
            <span className="truncate max-w-[120px]">{user.email}</span>
            <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider border ${user.tier === 'elite' ? 'bg-orange-500/20 text-orange-300 border-orange-500/40' : user.tier === 'pro' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40' : user.tier === 'beta' ? 'bg-sky-500/15 text-sky-400 border-sky-500/40' : 'bg-zinc-700/40 text-zinc-400 border-zinc-600/40'}`}>
              {user.tier}
            </span>
            {billingEnabled && (
              user.tier === 'free'
                ? <button onClick={() => setUpgradeOpen(true)} className="text-orange-400 hover:text-orange-300 font-medium">Upgrade</button>
                : (user.tier === 'pro' || user.tier === 'elite')
                  ? <button onClick={manageBilling} className="text-zinc-300 hover:text-white">Manage</button>
                  : null
            )}
            <span className="text-zinc-600">·</span>
            <button onClick={signOut} className="text-zinc-400 hover:text-zinc-200">Sign out</button>
          </div>
        ) : (
          <button onClick={() => setAuthOpen(true)} className="text-orange-400 hover:text-orange-300 font-medium">
            Sign in / Create account
          </button>
        )}
      </div>

      <Header sport={sport} onSportChange={setSport} />

      <main ref={mainRef} className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
        {selectedCard ? (
          <DossierView
            card={selectedCard}
            onBack={() => setSelectedCardId(null)}
            isWatched={watchlist.includes(selectedCard.id)}
            onToggleWatch={toggleWatch}
            onAddToPortfolio={openAddToPortfolio}
            isPro={isPro}
            onUpgrade={promptUpgrade}
          />
        ) : tab === 'scout' ? (
          <ScoutTab
            cards={cards}
            onSelectCard={setSelectedCardId}
            watchlist={watchlist}
            onToggleWatch={toggleWatch}
            isPro={isPro}
            onUpgrade={promptUpgrade}
            onSubmit={onSubmitCard}
          />
        ) : tab === 'learn' ? (
          <LearnTab sport={sport} />
        ) : (
          <PortfolioTab
            portfolio={portfolio}
            allCards={allCards}
            onRemove={removeFromPortfolio}
            onEdit={openAddToPortfolio}
            signedIn={Boolean(user)}
          />
        )}

        {!selectedCard && (tab === 'scout' || tab === 'learn') && <SiteFooter />}
      </main>

      <BottomNav
        tab={tab}
        onTabChange={(t) => { setTab(t); setSelectedCardId(null); }}
        onOpenAdmin={openAdmin}
        showAdmin={isOwner}
      />

      {adminOpen && (
        <AdminConsole
          cards={allCards}
          adminToken={adminToken}
          onSaved={refetchCards}
          onClose={() => setAdminOpen(false)}
          onLock={lockAdmin}
        />
      )}

      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} onAuthed={onAuthed} />}
      {upgradeOpen && <UpgradeModal onClose={() => setUpgradeOpen(false)} />}
      {submitOpen && <SubmissionModal onClose={() => setSubmitOpen(false)} />}
      {portfolioModalId && allCards.find((c) => c.id === portfolioModalId) && (
        <PortfolioAddModal
          card={allCards.find((c) => c.id === portfolioModalId)}
          existing={portfolio.find((p) => p.cardId === portfolioModalId)}
          onClose={() => setPortfolioModalId(null)}
          onConfirm={confirmAddToPortfolio}
        />
      )}
    </div>
  );
}
