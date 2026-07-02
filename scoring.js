/**
 * Server-side scoring engine — the proprietary IP. This runs ONLY on the server;
 * the archetypes, weights, formulas, and rarity ladder are never shipped to the
 * browser. /api/cards computes a `score` block per card via scoreCard() and sends
 * only the outputs the UI needs to render (no raw traits, no model).
 *
 * The math here is a byte-for-byte port of the former client engine — keep it in
 * sync if the model changes.
 */

/* Historical premium-card archetypes. Each carries a realized 7-trait profile +
   an outcomeValue (0-100 = how premium the cards became). */
const PLAYBOOKS = {
  baseball: [
    { id: 'mantle',  name: 'Mickey Mantle',    era: '1951 Bowman',        outcomeValue: 100, traits: { hof: 100, peak: 98, market: 100, position: 95, narrative: 98, unique: 92, longevity: 85 } },
    { id: 'griffey', name: 'Ken Griffey Jr.',  era: '1989 Upper Deck',    outcomeValue: 97,  traits: { hof: 100, peak: 92, market: 70, position: 95, narrative: 90, unique: 88, longevity: 80 } },
    { id: 'trout',   name: 'Mike Trout',       era: '2011 Topps Update',  outcomeValue: 95,  traits: { hof: 98, peak: 100, market: 55, position: 95, narrative: 75, unique: 95, longevity: 75 } },
    { id: 'ohtani',  name: 'Shohei Ohtani',    era: '2018 Topps Chrome',  outcomeValue: 98,  traits: { hof: 95, peak: 100, market: 95, position: 80, narrative: 100, unique: 100, longevity: 70 } },
    { id: 'jeter',   name: 'Derek Jeter',      era: '1993 SP Foil',       outcomeValue: 92,  traits: { hof: 100, peak: 78, market: 100, position: 95, narrative: 96, unique: 70, longevity: 98 } },
    { id: 'soto',    name: 'Juan Soto',        era: '2018 Bowman Chrome', outcomeValue: 88,  traits: { hof: 92, peak: 90, market: 95, position: 65, narrative: 88, unique: 85, longevity: 80 } },
    { id: 'judge',   name: 'Aaron Judge',      era: '2013 Bowman Chrome', outcomeValue: 86,  traits: { hof: 85, peak: 95, market: 100, position: 60, narrative: 92, unique: 90, longevity: 65 } },
    { id: 'acuna',   name: 'Ronald Acuña Jr.', era: '2018 Bowman Chrome', outcomeValue: 84,  traits: { hof: 88, peak: 95, market: 65, position: 75, narrative: 85, unique: 88, longevity: 70 } },
    { id: 'harper',  name: 'Bryce Harper',     era: '2011 Bowman Chrome', outcomeValue: 85,  traits: { hof: 90, peak: 90, market: 85, position: 60, narrative: 90, unique: 82, longevity: 82 } },
    { id: 'betts',   name: 'Mookie Betts',     era: '2014 Bowman Chrome', outcomeValue: 88,  traits: { hof: 93, peak: 92, market: 90, position: 80, narrative: 80, unique: 88, longevity: 85 } },
    { id: 'votto',   name: 'Joey Votto',       era: '2007 Bowman Chrome', outcomeValue: 60,  traits: { hof: 80, peak: 82, market: 45, position: 55, narrative: 55, unique: 75, longevity: 78 } },
    { id: 'wright',  name: 'David Wright',      era: '2004 Topps Chrome',  outcomeValue: 58,  traits: { hof: 70, peak: 82, market: 90, position: 80, narrative: 78, unique: 70, longevity: 55 } },
    { id: 'pence',   name: 'Hunter Pence',     era: '2007 Topps',         outcomeValue: 45,  traits: { hof: 40, peak: 62, market: 65, position: 55, narrative: 60, unique: 55, longevity: 70 } },
    { id: 'abreu',   name: 'José Abreu',       era: '2014 Topps Chrome',  outcomeValue: 42,  traits: { hof: 45, peak: 75, market: 60, position: 45, narrative: 50, unique: 60, longevity: 60 } },
    { id: 'wieters', name: 'Matt Wieters',     era: '2009 Bowman Chrome', outcomeValue: 38,  traits: { hof: 48, peak: 60, market: 55, position: 100, narrative: 65, unique: 55, longevity: 55 } },
    { id: 'hosmer',  name: 'Eric Hosmer',      era: '2011 Bowman Chrome', outcomeValue: 40,  traits: { hof: 42, peak: 62, market: 70, position: 55, narrative: 60, unique: 50, longevity: 68 } },
    { id: 'buxton',  name: 'Byron Buxton',     era: '2013 Bowman Chrome', outcomeValue: 42,  traits: { hof: 50, peak: 80, market: 50, position: 95, narrative: 62, unique: 90, longevity: 35 } },
    { id: 'myers',   name: 'Wil Myers',        era: '2013 Bowman Chrome', outcomeValue: 38,  traits: { hof: 40, peak: 65, market: 60, position: 60, narrative: 62, unique: 58, longevity: 55 } },
    { id: 'wood',    name: 'Brandon Wood',     era: '2006 Bowman Chrome', outcomeValue: 16,  traits: { hof: 25, peak: 55, market: 55, position: 90, narrative: 55, unique: 60, longevity: 30 } },
    { id: 'delmon',  name: 'Delmon Young',     era: '2005 Bowman Chrome', outcomeValue: 22,  traits: { hof: 30, peak: 58, market: 60, position: 55, narrative: 60, unique: 55, longevity: 45 } },
    { id: 'montero', name: 'Jesús Montero',    era: '2011 Bowman Chrome', outcomeValue: 18,  traits: { hof: 28, peak: 60, market: 80, position: 60, narrative: 65, unique: 62, longevity: 30 } },
    { id: 'kershaw', name: 'Clayton Kershaw',  era: '2006 Bowman Chrome', outcomeValue: 80,  traits: { hof: 98, peak: 98, market: 90, position: 40, narrative: 80, unique: 90, longevity: 80 } },
    { id: 'verlander', name: 'Justin Verlander', era: '2005 Bowman Chrome', outcomeValue: 70, traits: { hof: 95, peak: 90, market: 75, position: 40, narrative: 72, unique: 82, longevity: 92 } },
    { id: 'strasburg', name: 'Stephen Strasburg', era: '2010 Bowman Chrome', outcomeValue: 40, traits: { hof: 45, peak: 88, market: 80, position: 40, narrative: 78, unique: 88, longevity: 30 } },
  ],
  basketball: [
    { id: 'jordan',  name: 'Michael Jordan',    era: '1986 Fleer',      outcomeValue: 100, traits: { hof: 100, peak: 100, market: 95, position: 70, narrative: 100, unique: 100, longevity: 90 } },
    { id: 'kobe',    name: 'Kobe Bryant',       era: '1996-97 Topps Chrome Refractor', outcomeValue: 98, traits: { hof: 100, peak: 95, market: 100, position: 70, narrative: 100, unique: 92, longevity: 95 } },
    { id: 'lebron',  name: 'LeBron James',      era: '2003-04 Topps Chrome', outcomeValue: 99, traits: { hof: 100, peak: 100, market: 95, position: 65, narrative: 100, unique: 95, longevity: 100 } },
    { id: 'kg',      name: 'Kevin Garnett',     era: '1995-96 Topps',   outcomeValue: 78, traits: { hof: 98, peak: 90, market: 60, position: 78, narrative: 80, unique: 88, longevity: 95 } },
    { id: 'curry',   name: 'Stephen Curry',     era: '2009-10 Topps Chrome Refractor', outcomeValue: 95, traits: { hof: 100, peak: 95, market: 85, position: 90, narrative: 95, unique: 100, longevity: 92 } },
    { id: 'giannis', name: 'Giannis Antetokounmpo', era: '2013-14 Panini Prizm', outcomeValue: 88, traits: { hof: 95, peak: 95, market: 50, position: 70, narrative: 90, unique: 95, longevity: 80 } },
    { id: 'luka',    name: 'Luka Dončić',       era: '2018-19 Panini Prizm', outcomeValue: 86, traits: { hof: 92, peak: 95, market: 80, position: 90, narrative: 90, unique: 95, longevity: 75 } },
    { id: 'wemby',   name: 'Victor Wembanyama', era: '2023-24 Panini Prizm', outcomeValue: 90, traits: { hof: 90, peak: 95, market: 60, position: 65, narrative: 100, unique: 100, longevity: 70 } },
  ],
};

const TRAIT_WEIGHTS = {
  baseball:   { hof: 0.20, peak: 0.18, market: 0.12, position: 0.10, narrative: 0.18, unique: 0.12, longevity: 0.10 },
  basketball: { hof: 0.18, peak: 0.18, market: 0.10, position: 0.08, narrative: 0.22, unique: 0.16, longevity: 0.08 },
};

// Scarcity rarity multiplier per parallel id (the client only knows the labels).
const SCARCITY_RARITY = {
  base_raw: 1.00, base_psa9: 1.15, base_psa10: 1.40, refractor: 1.30, refractor_psa10: 1.65,
  xfractor: 1.55, blue: 1.85, green: 2.10, gold: 2.40, orange: 2.65, red: 2.85,
  auto_base: 1.80, auto_refractor: 2.05, auto_gold: 2.70, superfractor: 3.00,
};

const ARCHETYPE_TAU = 0.11;
const FLIP = { BUY_DISCOUNT: 0.10, GRADING_COST: 25, EBAY_FEE_RATE: 0.136, EBAY_PER_ORDER_FEE: 0.40, MIN_FLIP_RETURN: 15 };
const GRADE_ROWS = [['PSA 7', 'g7'], ['PSA 8', 'g8'], ['PSA 9', 'g9'], ['Grade 9.5', 'g95'], ['PSA 10', 'psa10'], ['BGS 10', 'bgs10']];

function traitDistance(a, b, weights) {
  let sumSq = 0, sumW = 0;
  for (const key of Object.keys(weights)) {
    const w = weights[key];
    const d = ((a[key] ?? 0) - (b[key] ?? 0)) / 100;
    sumSq += w * d * d;
    sumW += w;
  }
  return sumW ? Math.sqrt(sumSq / sumW) : 1;
}

function archetypeBand(ov = 70) {
  if (ov >= 85) return { label: 'Generational', cls: 'text-emerald-400 border-emerald-500/40', stance: 'bull' };
  if (ov >= 70) return { label: 'Star-caliber', cls: 'text-emerald-400 border-emerald-500/40', stance: 'bull' };
  if (ov >= 55) return { label: 'Solid regular', cls: 'text-amber-400 border-amber-500/40', stance: 'neutral' };
  if (ov >= 40) return { label: 'Capped / cautionary', cls: 'text-orange-400 border-orange-500/40', stance: 'bear' };
  return { label: 'Bust risk', cls: 'text-red-400 border-red-500/40', stance: 'bear' };
}

function findBestComp(cardTraits, sport) {
  const playbook = PLAYBOOKS[sport] || [];
  const weights = TRAIT_WEIGHTS[sport] || TRAIT_WEIGHTS.baseball;
  if (!playbook.length) return { archetype: null, similarity: 0, signal: 70, drivers: [] };
  const scored = playbook
    .map((a) => {
      const dist = traitDistance(cardTraits, a.traits, weights);
      return { archetype: a, dist, weight: Math.exp(-dist / ARCHETYPE_TAU) };
    })
    .sort((x, y) => x.dist - y.dist);
  const best = scored[0];
  const totW = scored.reduce((s, x) => s + x.weight, 0);
  const signal = totW > 0
    ? scored.reduce((s, x) => s + x.weight * (x.archetype.outcomeValue ?? 70), 0) / totW
    : 70;
  const drivers = Object.keys(weights)
    .map((k) => ({
      key: k,
      weight: weights[k],
      cardVal: cardTraits[k] ?? 0,
      archVal: best.archetype.traits[k] ?? 0,
      contribution: weights[k] * Math.min(cardTraits[k] ?? 0, best.archetype.traits[k] ?? 0),
    }))
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3);
  return { archetype: best.archetype, similarity: Math.max(0, 1 - best.dist), signal: Math.round(signal), drivers };
}

function computeScarcity(card) {
  const ladderRarity = SCARCITY_RARITY[card.variantId] ?? 1.0;
  if (!card.pop) return { multiplier: ladderRarity, hasRealData: false, popVelocity: null };
  const velPct = card.pop.change30dPsa10;
  let velocityAdj = 0;
  if (velPct != null) {
    if (velPct < 5) velocityAdj = 0.15;
    else if (velPct < 10) velocityAdj = 0.05;
    else if (velPct < 20) velocityAdj = -0.05;
    else velocityAdj = -0.15;
  }
  return { multiplier: ladderRarity + velocityAdj, hasRealData: true, popVelocity: velPct };
}

function computeFlip(card, combinedScore) {
  const raw = card.price?.raw;
  if (raw == null) return null;
  const targetBuy = raw * (1 - FLIP.BUY_DISCOUNT);
  const costBasis = targetBuy + FLIP.GRADING_COST;
  const netFor = (sell) => {
    if (sell == null) return null;
    const proceeds = sell * (1 - FLIP.EBAY_FEE_RATE) - FLIP.EBAY_PER_ORDER_FEE;
    const profit = proceeds - costBasis;
    return { sell: Math.round(sell), net: Math.round(profit), pct: Math.round((profit / costBasis) * 100) };
  };
  const grades = {
    g7: netFor(card.price?.g7), g8: netFor(card.price?.g8), g9: netFor(card.price?.g9),
    g95: netFor(card.price?.g95), psa10: netFor(card.price?.psa10), bgs10: netFor(card.price?.bgs10),
  };
  const primary = grades.psa10 || grades.bgs10;
  if (!primary) return null;
  const primaryLabel = grades.psa10 ? 'PSA 10' : 'BGS 10';
  let bestLabel = null, bestNet = -Infinity, bestPct = null;
  for (const [label, key] of GRADE_ROWS) {
    const g = grades[key];
    if (g && g.net > bestNet) { bestNet = g.net; bestLabel = label; bestPct = g.pct; }
  }
  const arbScore = Math.max(0, Math.min(100, primary.pct / 3));
  const flipScore = Math.round(0.5 * combinedScore + 0.5 * arbScore);
  return {
    targetBuy: Math.round(targetBuy), gradingCost: FLIP.GRADING_COST, costBasis: Math.round(costBasis),
    grades, primary, primaryLabel, bestLabel, bestPct, returnPct: primary.pct, flipScore,
  };
}

function computeRecommendation(flip) {
  if (!flip) return null;
  const pct = flip.returnPct;
  if (pct == null) return null;
  if (pct < FLIP.MIN_FLIP_RETURN) {
    return {
      recommended: false, pct,
      reason: pct < 0
        ? `Our framework does not recommend this card right now — at today's prices, grading it and selling at a PSA 10 nets a loss (${pct}%) after grading and selling fees.`
        : `Our framework does not recommend this card right now — the PSA 10 grade-flip returns only ${pct}% after grading and selling fees, too thin for the risk and the wait.`,
    };
  }
  return { recommended: true, pct };
}

function computeHorizon(card) {
  const t = card.traits || {};
  let score = 50;
  score += ((t.longevity ?? 70) - 70) * 0.6;
  score += ((t.peak ?? 80) - 80) * 0.4;
  const raw = card.price?.raw;
  if (raw != null) {
    if (raw < 120) score += 12;
    else if (raw < 300) score += 4;
    else if (raw < 600) score -= 6;
    else score -= 14;
  }
  const vel = card.pop?.change30dPsa10;
  if (vel != null) {
    if (vel >= 20) score -= 12;
    else if (vel < 5) score += 6;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const key = score >= 62 ? 'long' : score <= 45 ? 'short' : 'mid';
  const blurb =
    key === 'long'
      ? 'Durable profile with a still-rising ceiling and room left in the price — value compounds over the player’s career. Hold for the long game.'
      : key === 'short'
      ? 'Value is largely realizable near-term (price already elevated, or durability risk) — capture it and move on rather than holding for years.'
      : 'Balanced profile — real upside but not a multi-year compounder. Hold through the next catalyst, then reassess.';
  return { key, score, blurb };
}

// Real career reference lines, derived from the Lahman Baseball Database
// (Chadwick Bureau, data through 2021) — provenance/credibility only; they do
// NOT feed the trait scores (those stay calibrated).
const ARCHETYPE_CAREER = {
  mantle: '.298/.421/.557, 536 HR over 18 seasons · HOF',
  griffey: '.284/.370/.538, 630 HR over 22 seasons · HOF',
  trout: '.305/.419/.583, 310 HR over 11 seasons',
  ohtani: '.264/.353/.537, 93 HR over 4 seasons (two-way)',
  jeter: '.310/.377/.440, 260 HR over 20 seasons · HOF',
  soto: '.301/.432/.550, 98 HR over 4 seasons',
  judge: '.276/.386/.554, 158 HR over 6 seasons',
  acuna: '.281/.376/.549, 105 HR over 4 seasons',
  harper: '.279/.392/.524, 267 HR over 10 seasons',
  betts: '.296/.373/.518, 178 HR over 8 seasons',
  votto: '.302/.416/.520, 331 HR over 15 seasons',
  wright: '.296/.376/.491, 242 HR over 14 seasons',
  pence: '.279/.334/.461, 244 HR over 14 seasons',
  abreu: '.290/.350/.515, 228 HR over 8 seasons',
  wieters: '.249/.313/.409, 146 HR over 12 seasons',
  hosmer: '.277/.336/.431, 188 HR over 11 seasons',
  buxton: '.248/.299/.461, 70 HR over 7 seasons',
  myers: '.254/.330/.446, 146 HR over 9 seasons',
  wood: '.186/.225/.289, 18 HR over 5 seasons',
  delmon: '.283/.316/.421, 109 HR over 10 seasons',
  montero: '.253/.295/.398, 28 HR over 5 seasons',
  kershaw: '185-84, 2.49 ERA, 2,670 K over 14 seasons',
  verlander: '226-129, 3.33 ERA, 3,013 K over 16 seasons',
  strasburg: '113-61, 3.21 ERA, 1,718 K over 12 seasons',
};

/**
 * Display-only archetype roster for the Learn tab — names + eras + tier band +
 * a real career line (Lahman). NO traits, NO weights, NO outcomeValue numbers.
 */
export function archetypeList(sport = 'baseball') {
  return (PLAYBOOKS[sport] || []).map((a) => {
    const b = archetypeBand(a.outcomeValue);
    return { name: a.name, era: a.era, band: { label: b.label, cls: b.cls }, career: ARCHETYPE_CAREER[a.id] || null };
  });
}

/**
 * Compute the full score block sent to the client. `withFlip` (entitlement)
 * gates the price-derived flip + recommendation, matching the paywall.
 */
export function scoreCard(card, { withFlip = true } = {}) {
  const comp = findBestComp(card.traits || {}, card.sport);
  const scarcity = computeScarcity(card);
  const playerSignal = comp.signal;
  const combined = Math.min(100, Math.round((playerSignal * scarcity.multiplier) / 3.15));
  const flip = withFlip ? computeFlip(card, combined) : null;
  const recommendation = computeRecommendation(flip);
  const horizon = computeHorizon(card);
  return {
    combined,
    playerSignal,
    scarcity: { multiplier: scarcity.multiplier, hasRealData: scarcity.hasRealData, popVelocity: scarcity.popVelocity },
    comp: comp.archetype
      ? {
          name: comp.archetype.name,
          era: comp.archetype.era,
          career: ARCHETYPE_CAREER[comp.archetype.id] || null,
          similarity: comp.similarity,
          band: archetypeBand(comp.archetype.outcomeValue),
          drivers: comp.drivers.map((d) => ({ key: d.key, cardVal: d.cardVal, archVal: d.archVal })),
        }
      : null,
    horizon: { key: horizon.key, blurb: horizon.blurb },
    flip,
    recommendation,
  };
}
