import React, { useState, useMemo, useEffect } from 'react';
import { ArrowRight, Zap, X, ChevronDown, ChevronUp, Target, Clock, AlertCircle, Activity, Sparkles, Eye, Plus, Briefcase, Search, Trash2, Check, TrendingUp, TrendingDown, DollarSign, Layers } from 'lucide-react';

// ============================================================
// THE PLAYBOOK — historical premium cards (unchanged from v2)
// ============================================================

const PREMIUM_CARDS = [
  { id: 'mantle52', player: 'Mickey Mantle', card: '1952 Topps #311', peakValue: 12600000,
    archetype: 'The Yankee Cornerstone',
    why: 'Generational power-hitting CF on baseball\'s biggest stage. Multiple MVPs, World Series narrative.',
    profile: { hofLock: 100, mvpPeak: 100, market: 100, position: 90, narrative: 95, unique: 70, durability: 85 },
    keyFeatures: ['Yankees market', 'Power CF', 'Multi-MVP', 'WS hero', 'Cultural icon'] },
  { id: 'griffey89', player: 'Ken Griffey Jr.', card: '1989 Upper Deck #1', peakValue: 30000,
    archetype: 'The Smooth Five-Tool',
    why: 'Iconic card #1 of a landmark set. Power, grace, flair. Defined his era.',
    profile: { hofLock: 100, mvpPeak: 95, market: 60, position: 90, narrative: 90, unique: 60, durability: 75 },
    keyFeatures: ['Five-tool OF', 'Power + grace', 'Iconic visual', 'Era-defining', 'Crossover star'] },
  { id: 'jeter93', player: 'Derek Jeter', card: '1993 SP #279', peakValue: 35000,
    archetype: 'The Captain',
    why: 'Yankees SS who became the face of a dynasty. Longevity, clutch, championships.',
    profile: { hofLock: 100, mvpPeak: 80, market: 100, position: 95, narrative: 100, unique: 50, durability: 95 },
    keyFeatures: ['Yankees SS', 'Clutch narrative', 'Dynasty core', '5 rings', 'Career captain'] },
  { id: 'trout09', player: 'Mike Trout', card: '2009 Bowman Chrome Draft Auto', peakValue: 3900000,
    archetype: 'The WAR Machine',
    why: 'Generational #1 player by advanced metrics. Years of MVP-level WAR before peers existed.',
    profile: { hofLock: 100, mvpPeak: 100, market: 50, position: 80, narrative: 70, unique: 90, durability: 60 },
    keyFeatures: ['Best player in MLB', 'Multi-MVP', 'WAR dominance', 'Sabermetric darling', 'Generational'] },
  { id: 'ohtani18', player: 'Shohei Ohtani', card: '2018 Bowman Chrome Auto', peakValue: 1110000,
    archetype: 'The Unicorn',
    why: 'Two-way player not seen since Ruth. Cultural crossover, international fanbase, MVPs.',
    profile: { hofLock: 100, mvpPeak: 100, market: 100, position: 70, narrative: 100, unique: 100, durability: 70 },
    keyFeatures: ['Two-way unique', 'International draw', 'LA market', 'MVPs', 'Babe Ruth comp'] },
  { id: 'acuna18', player: 'Ronald Acuña Jr.', card: '2018 Topps Update', peakValue: 12000,
    archetype: 'The Five-Tool Phenom',
    why: 'Pedigree, electric tools, 40-40 season, MVP at 26. Braves built around him.',
    profile: { hofLock: 85, mvpPeak: 95, market: 75, position: 80, narrative: 85, unique: 75, durability: 60 },
    keyFeatures: ['Five-tool OF', '40-40 season', 'MVP', 'Electric playstyle', 'Franchise face'] },
  { id: 'soto18', player: 'Juan Soto', card: '2018 Bowman Chrome Auto', peakValue: 75000,
    archetype: 'The Generational Eye',
    why: 'Best plate discipline of his generation at 19. WS title, $700M contract, now in NY.',
    profile: { hofLock: 95, mvpPeak: 90, market: 95, position: 75, narrative: 90, unique: 85, durability: 75 },
    keyFeatures: ['Elite plate discipline', 'WS at 19', 'NY market', 'Generational youth', 'Mega-contract'] },
  { id: 'wagner09', player: 'Honus Wagner', card: 'T206 (1909-11)', peakValue: 7250000,
    archetype: 'The Scarcity Play',
    why: 'Withdrawn from production. ~50 known copies. Plus a HOF SS. Scarcity × greatness.',
    profile: { hofLock: 100, mvpPeak: 95, market: 60, position: 95, narrative: 95, unique: 100, durability: 90 },
    keyFeatures: ['Extreme scarcity', 'Era-defining SS', 'Withdrawn from print', 'Singular', 'Inner-circle HOF'],
    scarcityDriven: true },
];

const TRAIT_LABELS = {
  hofLock: 'HOF Trajectory', mvpPeak: 'MVP-Tier Peak', market: 'Big-Market Team',
  position: 'Premium Position', narrative: 'Narrative / Story', unique: 'Unique Skill', durability: 'Career Longevity',
};

function extractPatternWeights() {
  const traits = Object.keys(TRAIT_LABELS);
  const trainingSet = PREMIUM_CARDS.filter(c => !c.scarcityDriven);
  const weights = {};
  traits.forEach(t => {
    weights[t] = Math.round(trainingSet.reduce((s, c) => s + c.profile[t], 0) / trainingSet.length);
  });
  return weights;
}
const PATTERN_WEIGHTS = extractPatternWeights();

// ============================================================
// CARD-SIDE SCARCITY MODEL
// Multipliers applied to a player's "anchor value" (typical
// Bowman Chrome 1st Auto Refractor PSA 10 or Topps Update RC PSA 10)
// Calibrated from observed market spreads.
// ============================================================

const PARALLEL_LADDER = [
  // ---- BASE TIER (high liquidity, low margin) ----
  { id: 'rc-raw',    name: 'Base RC (Raw)',                   tier: 'Common',    mult: 0.04, run: null,  auto: false, relic: false, liq: 'very high', flip: 'good' },
  { id: 'rc-psa10',  name: 'Base RC (PSA 10)',                tier: 'Common',    mult: 0.25, run: null,  auto: false, relic: false, liq: 'high',      flip: 'great' },
  
  // ---- AUTO TIER (the flipper sweet spot) ----
  { id: 'auto-raw',  name: '1st Auto (Raw)',                  tier: 'Mid',       mult: 0.55, run: null,  auto: true,  relic: false, liq: 'very high', flip: 'great' },
  { id: 'auto-psa9', name: '1st Auto (PSA 9)',                tier: 'Mid',       mult: 0.70, run: null,  auto: true,  relic: false, liq: 'high',      flip: 'great' },
  { id: 'auto-psa10',name: '1st Auto (PSA 10)',               tier: 'Mid',       mult: 1.00, run: null,  auto: true,  relic: false, liq: 'high',      flip: 'great' },
  
  // ---- NUMBERED PARALLELS (best margin per dollar) ----
  { id: 'refr-499',  name: 'Refractor Auto /499',             tier: 'Numbered',  mult: 1.4,  run: 499,   auto: true,  relic: false, liq: 'high',      flip: 'great' },
  { id: 'blue-150',  name: 'Blue Refractor Auto /150',        tier: 'Numbered',  mult: 2.5,  run: 150,   auto: true,  relic: false, liq: 'medium',    flip: 'great' },
  { id: 'green-99',  name: 'Green Refractor Auto /99',        tier: 'Short Print', mult: 4.5, run: 99,   auto: true,  relic: false, liq: 'medium',    flip: 'great' },
  { id: 'gold-50',   name: 'Gold Refractor Auto /50',         tier: 'Short Print', mult: 9,  run: 50,    auto: true,  relic: false, liq: 'medium',    flip: 'good' },
  { id: 'orange-25', name: 'Orange Refractor Auto /25',       tier: 'Rare',      mult: 18,   run: 25,    auto: true,  relic: false, liq: 'low',       flip: 'risky' },
  { id: 'red-5',     name: 'Red Refractor Auto /5',           tier: 'Trophy',    mult: 65,   run: 5,     auto: true,  relic: false, liq: 'very low',  flip: 'long hold' },
  { id: 'sf-1',      name: 'Superfractor Auto 1/1',           tier: 'One-of-One', mult: 220, run: 1,    auto: true,  relic: false, liq: 'illiquid',  flip: 'long hold' },
  
  // ---- PATCH / RELIC TIER ----
  { id: 'patch-auto-99', name: 'Patch Auto /99',              tier: 'Short Print', mult: 7, run: 99,    auto: true,  relic: true,  liq: 'medium',    flip: 'good' },
  { id: 'patch-auto-25', name: 'Patch Auto /25 (RPA)',        tier: 'Rare',      mult: 25,   run: 25,    auto: true,  relic: true,  liq: 'low',       flip: 'risky' },
  { id: 'relic-299', name: 'Relic Card /299',                 tier: 'Numbered',  mult: 0.8,  run: 299,   auto: false, relic: true,  liq: 'medium',    flip: 'good' },
];

const TIER_COLORS = {
  'Common':      '#71717a',
  'Mid':         '#ea580c',
  'Numbered':    '#0891b2',
  'Short Print': '#7c3aed',
  'Rare':        '#dc2626',
  'Trophy':      '#facc15',
  'One-of-One':  '#fb7185',
};

const FLIP_STYLE = {
  'great':     { color: '#16a34a', label: 'GREAT FLIP' },
  'good':      { color: '#0891b2', label: 'GOOD FLIP' },
  'risky':     { color: '#f59e0b', label: 'RISKY' },
  'long hold': { color: '#737373', label: 'LONG HOLD' },
};

// ============================================================
// CURRENT PLAYERS
// Each has profile + an "anchorPrice" representing their typical
// 1st Auto PSA 10 market value. Variants are generated from the ladder.
// ============================================================

const CURRENT_PLAYERS = [
  { id: 1,  name: 'Konnor Griffin',     team: 'PIT', pos: 'OF', age: 20, status: 'prospect',  anchorPrice: 220, liquidity: 'high',
    profile: { hofLock: 75, mvpPeak: 80, market: 30, position: 70, narrative: 75, unique: 70, durability: 90 },
    catalysts: ['MLB debut window', '#1 MLB prospect', 'Spring Training showcase', 'First flagship RC in 2026 Update'],
    realWorld: 'Pirates #1 prospect, 5-tool profile, late 2025 debut. Bowman 1st autos moving.',
    flipWindow: '3-6 months', riskLevel: 'medium', cardProduct: '2024 Bowman Chrome 1st' },
  { id: 2,  name: 'Kevin McGonigle',    team: 'DET', pos: 'SS', age: 21, status: 'rookie',    anchorPrice: 185, liquidity: 'high',
    profile: { hofLock: 80, mvpPeak: 75, market: 55, position: 95, narrative: 70, unique: 65, durability: 85 },
    catalysts: ['Opening Day 2026 debut', 'Best pure hitter in class', 'ROY campaign', '2026 Topps Update RC pending'],
    realWorld: '.946 MiLB OPS. Best pure hitter in class per evaluators. Tigers playing him daily.',
    flipWindow: '2-4 months', riskLevel: 'low', cardProduct: '2024 Bowman Chrome 1st' },
  { id: 3,  name: 'JJ Wetherholt',      team: 'STL', pos: '2B', age: 22, status: 'rookie',    anchorPrice: 95,  liquidity: 'medium',
    profile: { hofLock: 65, mvpPeak: 70, market: 60, position: 65, narrative: 60, unique: 50, durability: 80 },
    catalysts: ['MLB debut Opening Day', 'STL fanbase loyalty', 'Bowman 1st auto still cheap'],
    realWorld: 'Cards have legacy hobby buyers. Bat-to-ball elite. Price hasn\'t caught up to profile.',
    flipWindow: '3-6 months', riskLevel: 'medium', cardProduct: '2024 Bowman Chrome 1st' },
  { id: 4,  name: 'Sebastian Walcott',  team: 'TEX', pos: 'SS', age: 20, status: 'prospect',  anchorPrice: 140, liquidity: 'medium',
    profile: { hofLock: 70, mvpPeak: 80, market: 75, position: 95, narrative: 70, unique: 70, durability: 90 },
    catalysts: ['Texas market', 'Power-speed SS', 'MLB debut timing', 'Climbing prospect lists'],
    realWorld: 'Big-market SS with 92.8 EV. Profile screams future star. Still in prospect price range.',
    flipWindow: '6-12 months', riskLevel: 'medium', cardProduct: '2023 Bowman Chrome 1st' },
  { id: 5,  name: 'Samuel Basallo',     team: 'BAL', pos: 'C',  age: 21, status: 'rookie',    anchorPrice: 110, liquidity: 'medium',
    profile: { hofLock: 70, mvpPeak: 75, market: 60, position: 100, narrative: 65, unique: 75, durability: 70 },
    catalysts: ['8yr/$67M extension', 'C position is unicorn-rare', 'Power profile emerging'],
    realWorld: 'Hitting catchers are unicorns. 23 HR in 76 Triple-A games. Extension de-risks the bet.',
    flipWindow: '4-8 months', riskLevel: 'low', cardProduct: '2023 Bowman Chrome 1st' },
  { id: 6,  name: 'Roman Anthony',      team: 'BOS', pos: 'OF', age: 22, status: 'rookie',    anchorPrice: 380, liquidity: 'high',
    profile: { hofLock: 85, mvpPeak: 85, market: 95, position: 75, narrative: 80, unique: 70, durability: 80 },
    catalysts: ['Boston market', 'Already +51% YTD', 'All-Star lock', 'ROY race'],
    realWorld: 'Moving fast — $45 → $68 in some grades. Still under historical comps.',
    flipWindow: 'Hot now — sell into All-Star bump', riskLevel: 'low', cardProduct: '2023 Bowman Chrome 1st' },
  { id: 7,  name: 'Trey Yesavage',      team: 'TOR', pos: 'SP', age: 23, status: 'rookie',    anchorPrice: 240, liquidity: 'high',
    profile: { hofLock: 70, mvpPeak: 75, market: 70, position: 85, narrative: 90, unique: 70, durability: 65 },
    catalysts: ['MLB postseason K record', 'Three-pitch ace profile', 'Toronto market expanding'],
    realWorld: 'Postseason hero. 2.96 ERA in MLB debut stretch. Story already written.',
    flipWindow: '2-3 months', riskLevel: 'medium', cardProduct: '2024 Bowman Chrome 1st' },
  { id: 8,  name: 'Cam Schlittler',     team: 'NYY', pos: 'SP', age: 25, status: 'rookie',    anchorPrice: 165, liquidity: 'high',
    profile: { hofLock: 60, mvpPeak: 70, market: 100, position: 85, narrative: 90, unique: 60, durability: 60 },
    catalysts: ['NY MARKET PREMIUM', '101 mph FB', 'MLB postseason record (8IP, 12K, 0BB)'],
    realWorld: 'NY alone justifies premium. Postseason heroics in pinstripes = hobby gold.',
    flipWindow: '2-4 months', riskLevel: 'low', cardProduct: '2025 Bowman Chrome 1st' },
  { id: 9,  name: 'Munetaka Murakami',  team: 'NYM', pos: '3B', age: 26, status: 'rookie',    anchorPrice: 195, liquidity: 'high',
    profile: { hofLock: 75, mvpPeak: 85, market: 90, position: 75, narrative: 95, unique: 90, durability: 70 },
    catalysts: ['Japanese import premium', 'NYM market', 'First MLB HR cycle', 'WBC narrative'],
    realWorld: 'Already $8 → $22 on base. International collector base is real money.',
    flipWindow: '3-6 months', riskLevel: 'low', cardProduct: '2026 Topps Series 2' },
  { id: 10, name: 'Kazuma Okamoto',     team: 'TOR', pos: '1B', age: 29, status: 'rookie',    anchorPrice: 75,  liquidity: 'medium',
    profile: { hofLock: 50, mvpPeak: 65, market: 70, position: 30, narrative: 80, unique: 75, durability: 50 },
    catalysts: ['Japanese collector base', 'Underpriced vs Murakami', 'NPB legend'],
    realWorld: 'Cheap entry into the Japanese-import trend.',
    flipWindow: '4-6 months', riskLevel: 'medium', cardProduct: '2026 Topps Series 2' },
  { id: 11, name: 'Paul Skenes',        team: 'PIT', pos: 'SP', age: 23, status: 'established', anchorPrice: 850, liquidity: 'high',
    profile: { hofLock: 90, mvpPeak: 90, market: 30, position: 85, narrative: 85, unique: 90, durability: 60 },
    catalysts: ['Cy Young campaign', 'Trade rumor speculation', '2.05 ERA'],
    realWorld: 'Already pricey. Flip play is Cy Young announcement or trade-to-big-market rumor.',
    flipWindow: '1-3 months', riskLevel: 'medium', cardProduct: '2024 Bowman Chrome' },
  { id: 12, name: 'Roki Sasaki',        team: 'LAD', pos: 'SP', age: 24, status: 'established', anchorPrice: 420, liquidity: 'high',
    profile: { hofLock: 70, mvpPeak: 80, market: 100, position: 85, narrative: 90, unique: 80, durability: 60 },
    catalysts: ['Dodgers market', 'Japanese star factor'],
    realWorld: 'LA keeps a floor. Buy on cold streak, sell on next gem start.',
    flipWindow: '2-4 months', riskLevel: 'medium', cardProduct: '2025 Bowman Chrome' },
  { id: 13, name: 'Junior Caminero',    team: 'TB',  pos: '3B', age: 22, status: 'established', anchorPrice: 165, liquidity: 'medium',
    profile: { hofLock: 80, mvpPeak: 90, market: 30, position: 70, narrative: 70, unique: 80, durability: 80 },
    catalysts: ['Elite 94.6 EV', 'TB trade candidate', '30+ HR pace'],
    realWorld: 'Hidden by Tampa. If TB trades him to contender, cards double overnight.',
    flipWindow: '6-12 months', riskLevel: 'medium', cardProduct: '2023 Bowman Chrome 1st' },
  { id: 14, name: 'James Wood',         team: 'WSH', pos: 'OF', age: 23, status: 'established', anchorPrice: 175, liquidity: 'high',
    profile: { hofLock: 80, mvpPeak: 80, market: 55, position: 75, narrative: 75, unique: 75, durability: 85 },
    catalysts: ['6\'7" power frame', '93.8 EV', 'All-Star track'],
    realWorld: 'Body type alone makes him a hobby brand. Just needs sustained production.',
    flipWindow: '4-6 months', riskLevel: 'low', cardProduct: '2022 Bowman Chrome 1st' },
  { id: 15, name: 'Jackson Chourio',    team: 'MIL', pos: 'OF', age: 22, status: 'established', anchorPrice: 295, liquidity: 'high',
    profile: { hofLock: 85, mvpPeak: 85, market: 35, position: 75, narrative: 75, unique: 75, durability: 90 },
    catalysts: ['8yr/$82M extension', '30-30 threat', 'Locked-in long-term'],
    realWorld: 'Profile matches Acuña almost exactly. Smaller market is only headwind.',
    flipWindow: '6-12 months', riskLevel: 'low', cardProduct: '2022 Bowman Chrome 1st' },
  { id: 16, name: 'Bobby Witt Jr.',     team: 'KC',  pos: 'SS', age: 26, status: 'established', anchorPrice: 685, liquidity: 'high',
    profile: { hofLock: 95, mvpPeak: 100, market: 30, position: 95, narrative: 80, unique: 80, durability: 90 },
    catalysts: ['MVP win', '8.2 WAR season', 'Future FA: NYY pull?'],
    realWorld: 'KC suppresses price 30-40%. If he signs with NY/LA in FA, cards explode.',
    flipWindow: '12-24 months', riskLevel: 'low', cardProduct: '2020 Bowman Chrome 1st' },
  { id: 17, name: 'Elly De La Cruz',    team: 'CIN', pos: 'SS', age: 24, status: 'established', anchorPrice: 340, liquidity: 'high',
    profile: { hofLock: 75, mvpPeak: 85, market: 35, position: 95, narrative: 90, unique: 95, durability: 75 },
    catalysts: ['40-40 chase', 'Viral highlights', 'Premium SS'],
    realWorld: 'Most exciting player to watch. Social buzz alone moves cards.',
    flipWindow: '3-6 months', riskLevel: 'medium', cardProduct: '2019 Bowman Chrome 1st' },
  { id: 18, name: 'Jasson Domínguez',   team: 'NYY', pos: 'OF', age: 23, status: 'established', anchorPrice: 220, liquidity: 'high',
    profile: { hofLock: 65, mvpPeak: 70, market: 100, position: 75, narrative: 90, unique: 70, durability: 70 },
    catalysts: ['NY MARKET', '"The Martian" brand', 'Yankees press cycle'],
    realWorld: 'NYY floor + youth + brand. Buy on cold stretches.',
    flipWindow: '3-6 months', riskLevel: 'medium', cardProduct: '2020 Bowman Chrome 1st' },
  { id: 19, name: 'Dylan Crews',        team: 'WSH', pos: 'OF', age: 24, status: 'rookie',    anchorPrice: 85,  liquidity: 'high',
    profile: { hofLock: 60, mvpPeak: 70, market: 55, position: 75, narrative: 70, unique: 60, durability: 80 },
    catalysts: ['Post-hype entry', 'Power could click', '#2 overall pedigree'],
    realWorld: 'Fell from prospect peak. Profile still strong. Bounce-back flip if power arrives.',
    flipWindow: '3-6 months', riskLevel: 'high', cardProduct: '2023 Bowman Chrome 1st' },
  { id: 20, name: 'Noelvi Marte',       team: 'CIN', pos: '3B', age: 24, status: 'established', anchorPrice: 45,  liquidity: 'medium',
    profile: { hofLock: 50, mvpPeak: 65, market: 35, position: 65, narrative: 50, unique: 55, durability: 75 },
    catalysts: ['K-rate trimmed to 23.6%', '9% barrel', 'Power could translate'],
    realWorld: 'Lottery ticket. At $45 downside is small. Pieces aligning.',
    flipWindow: '6-12 months', riskLevel: 'high', cardProduct: '2019 Bowman Chrome 1st' },
  { id: 21, name: 'Coby Mayo',          team: 'BAL', pos: '3B', age: 24, status: 'rookie',    anchorPrice: 55,  liquidity: 'medium',
    profile: { hofLock: 55, mvpPeak: 70, market: 60, position: 65, narrative: 50, unique: 60, durability: 80 },
    catalysts: ['Path could open', '92.5 EV', 'Power profile'],
    realWorld: 'Blocked but cheap. 400 ABs anywhere doubles the cards.',
    flipWindow: '6-12 months', riskLevel: 'high', cardProduct: '2020 Bowman Chrome 1st' },
  { id: 22, name: 'Chase DeLauter',     team: 'CLE', pos: 'OF', age: 24, status: 'rookie',    anchorPrice: 130, liquidity: 'high',
    profile: { hofLock: 65, mvpPeak: 70, market: 50, position: 75, narrative: 70, unique: 60, durability: 75 },
    catalysts: ['Already $185→$260 on call-up', 'CLE contender', 'Plus contact'],
    realWorld: 'Momentum building. Get in before All-Star vote bump.',
    flipWindow: '2-3 months', riskLevel: 'low', cardProduct: '2022 Bowman Chrome 1st' },
  { id: 23, name: 'Wyatt Langford',     team: 'TEX', pos: 'OF', age: 24, status: 'established', anchorPrice: 145, liquidity: 'high',
    profile: { hofLock: 75, mvpPeak: 75, market: 75, position: 75, narrative: 70, unique: 65, durability: 85 },
    catalysts: ['Texas market', 'Power emerging', 'AS candidate'],
    realWorld: 'Flying under radar relative to peers. Solid across the board.',
    flipWindow: '4-6 months', riskLevel: 'low', cardProduct: '2023 Bowman Chrome 1st' },
  { id: 24, name: 'Pete Crow-Armstrong', team: 'CHC', pos: 'OF', age: 24, status: 'established', anchorPrice: 285, liquidity: 'high',
    profile: { hofLock: 80, mvpPeak: 85, market: 75, position: 80, narrative: 85, unique: 75, durability: 85 },
    catalysts: ['Cubs market', 'Gold Glove + MVP votes'],
    realWorld: 'Two-way star (defense + bat). Chicago market is real. Profile is loud.',
    flipWindow: '3-6 months', riskLevel: 'low', cardProduct: '2020 Bowman Chrome 1st' },
];

// ============================================================
// SCORING ENGINE
// ============================================================

function profileSimilarity(playerProfile, compProfile) {
  const traits = Object.keys(PATTERN_WEIGHTS);
  let dot = 0, magA = 0, magB = 0;
  traits.forEach(t => {
    const w = PATTERN_WEIGHTS[t] / 100;
    const a = (playerProfile[t] || 0) * w;
    const b = (compProfile[t] || 0) * w;
    dot += a * b;
    magA += a * a;
    magB += b * b;
  });
  if (!magA || !magB) return 0;
  return (dot / (Math.sqrt(magA) * Math.sqrt(magB))) * 100;
}

function findBestComp(player) {
  const candidates = PREMIUM_CARDS.filter(c => !c.scarcityDriven);
  let best = null, bestScore = -1;
  candidates.forEach(c => {
    const s = profileSimilarity(player.profile, c.profile);
    if (s > bestScore) { bestScore = s; best = c; }
  });
  return { comp: best, score: Math.round(bestScore) };
}

// Returns base value before card-side scarcity applied
function patternBaseTarget(player) {
  const { score } = findBestComp(player);
  const mult = score >= 88 ? 2.4 : score >= 80 ? 1.9 : score >= 72 ? 1.5 : score >= 65 ? 1.2 : 1.05;
  return Math.round(player.anchorPrice * mult);
}

// Per-variant price, derived from anchor × scarcity multiplier
function variantPrice(player, variant) {
  return Math.round(player.anchorPrice * variant.mult);
}

// Per-variant target price (pattern × scarcity)
function variantTarget(player, variant) {
  const baseTarget = patternBaseTarget(player);
  return Math.round(baseTarget * variant.mult);
}

// Flip score per variant: rewards match strength + price discount + liquidity
function variantFlipScore(player, variant) {
  const { score } = findBestComp(player);
  const price = variantPrice(player, variant);
  const liqMult = { 'very high': 1.05, 'high': 1.0, 'medium': 0.85, 'low': 0.65, 'very low': 0.40, 'illiquid': 0.15 }[variant.liq];
  const flipMult = { 'great': 1.1, 'good': 1.0, 'risky': 0.7, 'long hold': 0.5 }[variant.flip];
  const dampener = Math.log10(price + 10);
  return Math.round((score * liqMult * flipMult / dampener) * 10) / 10;
}

function playerVerdict(player) {
  const { score } = findBestComp(player);
  if (player.age >= 32 || player.status === 'veteran') return 'PASS';
  if (score >= 85 && player.anchorPrice < 500) return 'STRONG FLIP';
  if (score >= 75) return 'FLIP';
  if (score >= 65) return 'WATCH';
  return 'PASS';
}

const VERDICT_STYLES = {
  'STRONG FLIP': { bg: '#dc2626', text: '#fff' },
  'FLIP':        { bg: '#ea580c', text: '#fff' },
  'WATCH':       { bg: '#0891b2', text: '#fff' },
  'PASS':        { bg: '#404040', text: '#a3a3a3' },
};

// ============================================================
// PERSISTENT STORAGE — Portfolio
// ============================================================

const STORAGE_KEY = 'cardprospector:portfolio:v1';

function loadPortfolio() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function savePortfolio(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    return true;
  } catch (e) {
    console.error('Save failed:', e);
    return false;
  }
}

// ============================================================
// SMALL UI HELPERS
// ============================================================

function Stamp({ verdict, size = 'sm' }) {
  const s = VERDICT_STYLES[verdict];
  if (!s) return null;
  return (
    <div
      className={size === 'lg' ? 'inline-block px-3 py-1.5 text-xs font-bold tracking-wider' : 'inline-block px-2 py-1 text-[10px] font-bold tracking-wider'}
      style={{ backgroundColor: s.bg, color: s.text, borderRadius: '1px', fontFamily: 'ui-monospace, monospace' }}
    >
      {verdict}
    </div>
  );
}

function ProfileBars({ profile, compProfile, compact = false }) {
  return (
    <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
      {Object.keys(TRAIT_LABELS).map(trait => (
        <div key={trait} className="flex items-center gap-2 text-[10px]" style={{ fontFamily: 'ui-monospace, monospace' }}>
          <span className="w-20 text-stone-400 truncate">{TRAIT_LABELS[trait]}</span>
          <div className="flex-1 flex items-center gap-1.5">
            <div className="flex-1 h-1.5 bg-stone-800 rounded-sm overflow-hidden relative">
              {compProfile && <div className="absolute inset-y-0 left-0 bg-stone-600 opacity-50" style={{ width: `${compProfile[trait]}%` }} />}
              <div className="h-full bg-gradient-to-r from-orange-600 to-amber-400 relative z-10" style={{ width: `${profile[trait]}%` }} />
            </div>
            <span className="w-6 text-right tabular-nums text-stone-300">{profile[trait]}</span>
            {compProfile && <span className="w-6 text-right tabular-nums text-stone-500">{compProfile[trait]}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function TierBadge({ tier }) {
  return (
    <span className="text-[9px] px-1.5 py-0.5 font-bold tracking-widest" style={{
      backgroundColor: TIER_COLORS[tier] + '22', color: TIER_COLORS[tier],
      fontFamily: 'ui-monospace, monospace', borderRadius: '1px',
      border: `1px solid ${TIER_COLORS[tier]}55`
    }}>
      {tier.toUpperCase()}
    </span>
  );
}

// ============================================================
// PRICE HISTORY — synthesized 90-day curve per player.
// Shape derived from status / trajectory / risk so each player's
// chart tells the right visual story (rising prospect, breakout,
// bounce-back, etc.). Replace with real eBay sold-listing data
// when the backend is wired up — see backend-reference.js.
// ============================================================

function priceShape(player) {
  if (player.status === 'veteran') return 'flat-aging';
  if (player.riskLevel === 'high') return 'decline-recover';
  if (player.status === 'prospect') return 'steady-rise';
  if (/hot now|1-3/i.test(player.flipWindow || '')) return 'breakout';
  if (player.status === 'rookie') return 'volatile-up';
  return 'gentle-up';
}

function generatePriceHistory(player, days = 90) {
  const endPrice = player.anchorPrice;
  const shape = priceShape(player);
  
  // Where the curve starts, relative to current price
  const startMultiplier = {
    'flat-aging':       1.08,  // slight decline from peak
    'decline-recover':  1.55,  // big drop then partial recovery
    'steady-rise':      0.55,  // big gains over the window
    'breakout':         0.65,  // sharp recent move
    'volatile-up':      0.75,  // choppy climb
    'gentle-up':        0.88,  // small steady gains
  }[shape];
  
  const startPrice = endPrice * startMultiplier;
  const points = [];
  
  for (let i = 0; i < days; i++) {
    const t = i / (days - 1); // 0 → 1
    let basePrice;
    
    switch (shape) {
      case 'breakout':
        // Flat early, sharp rise in last third
        if (t < 0.7) {
          basePrice = startPrice * (1 + t * 0.05);
        } else {
          const t2 = (t - 0.7) / 0.3;
          const floor = startPrice * 1.035;
          basePrice = floor + (endPrice - floor) * (1 - Math.pow(1 - t2, 2));
        }
        break;
      case 'decline-recover':
        // Drop, floor, then partial recovery
        if (t < 0.4) {
          basePrice = startPrice - (startPrice - endPrice * 0.85) * (t / 0.4);
        } else if (t < 0.7) {
          basePrice = endPrice * 0.85;
        } else {
          const t2 = (t - 0.7) / 0.3;
          basePrice = endPrice * 0.85 + (endPrice - endPrice * 0.85) * t2;
        }
        break;
      case 'steady-rise':
        // Linear with slight acceleration
        basePrice = startPrice + (endPrice - startPrice) * (t * 0.7 + t * t * 0.3);
        break;
      case 'volatile-up':
      case 'gentle-up':
      case 'flat-aging':
      default:
        basePrice = startPrice + (endPrice - startPrice) * t;
    }
    
    // Deterministic noise — same seed each render, but unique per player+day
    const seed = player.id * 7919 + i * 31;
    const noiseScale = shape === 'volatile-up' ? 0.07 : shape === 'decline-recover' ? 0.05 : 0.035;
    const noise = (Math.sin(seed * 0.13) * 0.5 + Math.cos(seed * 0.71) * 0.3 + Math.sin(seed * 1.27) * 0.2) * noiseScale;
    
    points.push({ day: i, price: Math.max(basePrice * 0.5, basePrice * (1 + noise)) });
  }
  
  return points;
}

// Compact sparkline — fits inside the FlipCard stat row.
function Sparkline({ player, height = 22, width = 70 }) {
  const data = useMemo(() => generatePriceHistory(player), [player.id]);
  const prices = data.map(d => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  
  // 30-day trend (recent half of the chart)
  const recent = prices.slice(-30);
  const trend = recent[recent.length - 1] - recent[0];
  const trendPct = Math.round((trend / recent[0]) * 100);
  const trendColor = trend >= 0 ? '#16a34a' : '#dc2626';
  
  const pts = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * 100;
    const y = 100 - ((p - min) / range) * 95 - 2.5; // 2.5% padding top/bottom
    return `${x},${y}`;
  });
  const gradId = `spark-grad-${player.id}`;
  
  return (
    <div className="flex flex-col items-end">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height, width }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={trendColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={trendColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`M0,100 L${pts.join(' L')} L100,100 Z`} fill={`url(#${gradId})`} />
        <polyline
          points={pts.join(' ')}
          fill="none"
          stroke={trendColor}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-[10px] tabular-nums font-bold leading-none mt-0.5" style={{ color: trendColor, fontFamily: 'ui-monospace, monospace' }}>
        {trend >= 0 ? '+' : ''}{trendPct}%
      </span>
    </div>
  );
}

// Full chart for the player detail modal — bigger, with reference lines.
function PriceChart({ player, targetPrice }) {
  const data = useMemo(() => generatePriceHistory(player), [player.id]);
  const prices = data.map(d => d.price);
  const min = Math.min(...prices, targetPrice * 0.9);
  const max = Math.max(...prices, targetPrice * 1.05);
  const range = max - min || 1;
  
  const overallTrend = prices[prices.length - 1] - prices[0];
  const overallPct = Math.round((overallTrend / prices[0]) * 100);
  const recent30 = prices.slice(-30);
  const recentPct = Math.round(((recent30[recent30.length - 1] - recent30[0]) / recent30[0]) * 100);
  const trendColor = overallTrend >= 0 ? '#16a34a' : '#dc2626';
  
  const pts = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * 100;
    const y = 100 - ((p - min) / range) * 90 - 5;
    return `${x},${y}`;
  });
  
  // Reference line positions
  const currentY = 100 - ((prices[prices.length - 1] - min) / range) * 90 - 5;
  const targetY = 100 - ((targetPrice - min) / range) * 90 - 5;
  
  const peakIdx = prices.indexOf(max);
  const troughIdx = prices.indexOf(Math.min(...prices));
  
  return (
    <div className="bg-stone-900 p-3" style={{ borderRadius: '2px' }}>
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[10px] tracking-widest text-orange-500" style={{ fontFamily: 'ui-monospace, monospace' }}>
          90-DAY PRICE TREND
        </div>
        <div className="flex items-center gap-3 text-[10px]" style={{ fontFamily: 'ui-monospace, monospace' }}>
          <span><span className="text-stone-500">30d </span><span style={{ color: recentPct >= 0 ? '#22c55e' : '#ef4444' }} className="font-bold tabular-nums">{recentPct >= 0 ? '+' : ''}{recentPct}%</span></span>
          <span><span className="text-stone-500">90d </span><span style={{ color: overallPct >= 0 ? '#22c55e' : '#ef4444' }} className="font-bold tabular-nums">{overallPct >= 0 ? '+' : ''}{overallPct}%</span></span>
        </div>
      </div>
      
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height: 90, width: '100%' }}>
        <defs>
          <linearGradient id={`chart-grad-${player.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={trendColor} stopOpacity="0.35" />
            <stop offset="100%" stopColor={trendColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        
        {/* Grid lines */}
        <line x1="0" y1="25" x2="100" y2="25" stroke="#44403c" strokeWidth="0.3" strokeDasharray="1,2" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1="50" x2="100" y2="50" stroke="#44403c" strokeWidth="0.3" strokeDasharray="1,2" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1="75" x2="100" y2="75" stroke="#44403c" strokeWidth="0.3" strokeDasharray="1,2" vectorEffect="non-scaling-stroke" />
        
        {/* Target reference line */}
        <line x1="0" y1={targetY} x2="100" y2={targetY} stroke="#ea580c" strokeWidth="0.5" strokeDasharray="2,2" vectorEffect="non-scaling-stroke" />
        
        {/* Area fill */}
        <path d={`M0,100 L${pts.join(' L')} L100,100 Z`} fill={`url(#chart-grad-${player.id})`} />
        
        {/* Main line */}
        <polyline
          points={pts.join(' ')}
          fill="none"
          stroke={trendColor}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        {/* Current price dot */}
        <circle cx="100" cy={currentY} r="2" fill={trendColor} vectorEffect="non-scaling-stroke" />
        <circle cx="100" cy={currentY} r="4" fill={trendColor} opacity="0.2" vectorEffect="non-scaling-stroke" />
      </svg>
      
      {/* Axis labels */}
      <div className="flex justify-between text-[9px] text-stone-500 mt-1" style={{ fontFamily: 'ui-monospace, monospace' }}>
        <span>90d ago · ${Math.round(prices[0]).toLocaleString()}</span>
        <span>now · <span className="text-stone-300 font-bold">${Math.round(prices[prices.length - 1]).toLocaleString()}</span></span>
      </div>
      
      {/* Legend for reference line */}
      <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-stone-800">
        <div className="h-px w-3 border-t border-dashed border-orange-600" />
        <span className="text-[9px] text-stone-500" style={{ fontFamily: 'ui-monospace, monospace' }}>
          target ${targetPrice.toLocaleString()} · peak ${Math.round(max).toLocaleString()} · trough ${Math.round(Math.min(...prices)).toLocaleString()}
        </span>
      </div>
    </div>
  );
}

// ============================================================
// PLAYBOOK SECTION (collapsible)
// ============================================================

function PlaybookSection({ onSelectComp }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4 bg-stone-900 border border-stone-800" style={{ borderRadius: '2px' }}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between p-4 text-left">
        <div>
          <div className="text-[10px] tracking-widest text-orange-500 mb-0.5" style={{ fontFamily: 'ui-monospace, monospace' }}>
            <Sparkles size={10} className="inline mr-1" />THE PLAYBOOK
          </div>
          <div className="text-sm font-bold text-stone-100" style={{ fontFamily: 'Georgia, serif' }}>
            8 cards commanding premium prices today
          </div>
          <div className="text-[11px] text-stone-400 mt-0.5" style={{ fontFamily: 'ui-monospace, monospace' }}>
            The patterns extracted here power everything.
          </div>
        </div>
        {open ? <ChevronUp size={18} className="text-stone-400" /> : <ChevronDown size={18} className="text-stone-400" />}
      </button>
      {open && (
        <div className="border-t border-stone-800 p-4 space-y-2">
          {PREMIUM_CARDS.map(c => (
            <button key={c.id} onClick={() => onSelectComp(c)} className="w-full text-left bg-stone-950 border border-stone-800 hover:border-orange-700 p-3 transition-colors" style={{ borderRadius: '2px' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] text-stone-500 tracking-widest" style={{ fontFamily: 'ui-monospace, monospace' }}>{c.archetype.toUpperCase()}</div>
                  <div className="text-sm font-bold text-stone-100" style={{ fontFamily: 'Georgia, serif' }}>{c.player}</div>
                  <div className="text-[10px] text-stone-400" style={{ fontFamily: 'ui-monospace, monospace' }}>{c.card}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[9px] text-stone-500 tracking-widest" style={{ fontFamily: 'ui-monospace, monospace' }}>PEAK</div>
                  <div className="text-sm font-bold text-orange-500 tabular-nums" style={{ fontFamily: 'ui-monospace, monospace' }}>
                    ${c.peakValue >= 1000000 ? (c.peakValue / 1000000).toFixed(1) + 'M' : (c.peakValue / 1000).toFixed(0) + 'k'}
                  </div>
                </div>
              </div>
            </button>
          ))}
          <div className="mt-3 pt-3 border-t border-stone-800">
            <div className="text-[10px] tracking-widest text-orange-500 mb-2" style={{ fontFamily: 'ui-monospace, monospace' }}>
              <Activity size={10} className="inline mr-1" />PATTERN WEIGHTS
            </div>
            <div className="space-y-1.5">
              {Object.keys(PATTERN_WEIGHTS).sort((a, b) => PATTERN_WEIGHTS[b] - PATTERN_WEIGHTS[a]).map(t => (
                <div key={t} className="flex items-center gap-2 text-[10px]" style={{ fontFamily: 'ui-monospace, monospace' }}>
                  <span className="w-24 text-stone-300">{TRAIT_LABELS[t]}</span>
                  <div className="flex-1 h-2 bg-stone-800"><div className="h-full bg-gradient-to-r from-orange-600 to-amber-400" style={{ width: `${PATTERN_WEIGHTS[t]}%` }} /></div>
                  <span className="w-8 text-right tabular-nums text-stone-200 font-bold">{PATTERN_WEIGHTS[t]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// FLIP CARD (player summary row in Scout tab)
// ============================================================

function FlipCard({ player, onTap }) {
  const { score, comp } = findBestComp(player);
  const verdict = playerVerdict(player);
  const baseTarget = patternBaseTarget(player);
  const upside = Math.round(((baseTarget - player.anchorPrice) / player.anchorPrice) * 100);
  return (
    <button onClick={() => onTap(player)} className="w-full text-left bg-stone-50 hover:bg-white transition-colors border border-stone-300 relative overflow-hidden" style={{ borderRadius: '2px' }}>
      <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: 'linear-gradient(90deg, #fb7185, #fbbf24, #22d3ee, #a78bfa)' }} />
      <div className="px-3 py-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] tabular-nums text-stone-500" style={{ fontFamily: 'ui-monospace, monospace' }}>{String(player.id).padStart(3, '0')}</span>
              <h3 className="font-bold text-stone-900 truncate" style={{ fontFamily: 'Georgia, serif', fontSize: '16px', lineHeight: 1.1 }}>{player.name}</h3>
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-stone-600" style={{ fontFamily: 'ui-monospace, monospace' }}>
              <span className="font-bold">{player.team}</span><span>·</span><span>{player.pos}</span><span>·</span><span>{player.age}yo</span>
            </div>
          </div>
          <Stamp verdict={verdict} />
        </div>
        <div className="bg-stone-900 text-stone-100 px-3 py-2 mb-2" style={{ borderRadius: '2px' }}>
          <div className="flex items-center gap-2 text-[10px]" style={{ fontFamily: 'ui-monospace, monospace' }}>
            <span className="text-stone-400">MATCHES</span>
            <span className="text-orange-400 font-bold tabular-nums">{score}%</span>
            <ArrowRight size={10} className="text-stone-500" />
            <span className="text-amber-400 truncate">{comp.player}</span>
          </div>
          <div className="text-[9px] text-stone-500 mt-0.5 truncate" style={{ fontFamily: 'ui-monospace, monospace' }}>archetype: {comp.archetype}</div>
        </div>
        <div className="grid grid-cols-4 gap-2 pt-1">
          <div>
            <div className="text-[8px] text-stone-500 tracking-widest" style={{ fontFamily: 'ui-monospace, monospace' }}>ANCHOR</div>
            <div className="text-sm font-bold text-stone-900 tabular-nums" style={{ fontFamily: 'ui-monospace, monospace' }}>${player.anchorPrice}</div>
          </div>
          <div>
            <div className="text-[8px] text-stone-500 tracking-widest" style={{ fontFamily: 'ui-monospace, monospace' }}>TARGET</div>
            <div className="text-sm font-bold text-orange-700 tabular-nums" style={{ fontFamily: 'ui-monospace, monospace' }}>${baseTarget}</div>
          </div>
          <div>
            <div className="text-[8px] text-stone-500 tracking-widest" style={{ fontFamily: 'ui-monospace, monospace' }}>UPSIDE</div>
            <div className="text-sm font-bold tabular-nums" style={{ fontFamily: 'ui-monospace, monospace', color: upside > 50 ? '#dc2626' : '#525252' }}>+{upside}%</div>
          </div>
          <div>
            <div className="text-[8px] text-stone-500 tracking-widest mb-0.5" style={{ fontFamily: 'ui-monospace, monospace' }}>90D</div>
            <Sparkline player={player} />
          </div>
        </div>
      </div>
    </button>
  );
}

// ============================================================
// PARALLEL LADDER (in player detail)
// ============================================================

function ParallelLadder({ player, onAddToPortfolio }) {
  const [filter, setFilter] = useState('all');
  
  let ladder = PARALLEL_LADDER.map(v => ({
    ...v,
    price: variantPrice(player, v),
    target: variantTarget(player, v),
    flipScore: variantFlipScore(player, v),
  }));
  
  if (filter === 'autos') ladder = ladder.filter(v => v.auto);
  else if (filter === 'numbered') ladder = ladder.filter(v => v.run !== null);
  else if (filter === 'flippable') ladder = ladder.filter(v => v.flip === 'great' || v.flip === 'good');
  else if (filter === 'relics') ladder = ladder.filter(v => v.relic);
  
  return (
    <div>
      <div className="flex gap-1 mb-2 flex-wrap" style={{ fontFamily: 'ui-monospace, monospace' }}>
        {[
          { id: 'all', label: 'ALL' },
          { id: 'flippable', label: 'BEST FLIPS' },
          { id: 'autos', label: 'AUTOS' },
          { id: 'numbered', label: 'NUMBERED' },
          { id: 'relics', label: 'RELICS' },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} className={`px-2 py-1 text-[9px] tracking-widest border transition-colors ${filter === f.id ? 'bg-orange-600 text-white border-orange-600' : 'bg-stone-100 text-stone-600 border-stone-300'}`} style={{ borderRadius: '1px' }}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        {ladder.map(v => {
          const upside = Math.round(((v.target - v.price) / v.price) * 100);
          const flipStyle = FLIP_STYLE[v.flip];
          return (
            <div key={v.id} className="bg-stone-100 border border-stone-300 p-2.5" style={{ borderRadius: '1px' }}>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    <TierBadge tier={v.tier} />
                    {v.run && <span className="text-[9px] tabular-nums text-stone-600 font-bold" style={{ fontFamily: 'ui-monospace, monospace' }}>/{v.run}</span>}
                    {v.auto && <span className="text-[9px] px-1 bg-amber-100 text-amber-800 font-bold" style={{ fontFamily: 'ui-monospace, monospace' }}>AUTO</span>}
                    {v.relic && <span className="text-[9px] px-1 bg-purple-100 text-purple-800 font-bold" style={{ fontFamily: 'ui-monospace, monospace' }}>RELIC</span>}
                  </div>
                  <div className="text-xs font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>{v.name}</div>
                  <div className="text-[9px] text-stone-500" style={{ fontFamily: 'ui-monospace, monospace' }}>
                    liq: {v.liq} · <span style={{ color: flipStyle.color, fontWeight: 'bold' }}>{flipStyle.label}</span>
                  </div>
                </div>
                <button onClick={() => onAddToPortfolio(player, v)} className="shrink-0 bg-stone-900 hover:bg-orange-700 text-white p-1.5 transition-colors" style={{ borderRadius: '1px' }} title="Add to portfolio">
                  <Plus size={12} />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px]" style={{ fontFamily: 'ui-monospace, monospace' }}>
                <div>
                  <div className="text-stone-500">BUY</div>
                  <div className="font-bold tabular-nums text-stone-900">${v.price.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-stone-500">TARGET</div>
                  <div className="font-bold tabular-nums text-orange-700">${v.target.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-stone-500">UPSIDE</div>
                  <div className="font-bold tabular-nums" style={{ color: upside > 80 ? '#dc2626' : '#525252' }}>+{upside}%</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// ADD TO PORTFOLIO MODAL
// ============================================================

function AddToPortfolioModal({ player, variant, onSave, onClose }) {
  const suggested = variantPrice(player, variant);
  const [price, setPrice] = useState(String(suggested));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  
  if (!player || !variant) return null;
  
  return (
    <div className="fixed inset-0 z-[60] bg-stone-950/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-stone-50 w-full sm:max-w-md" style={{ borderRadius: '2px' }}>
        <div className="h-1" style={{ background: 'linear-gradient(90deg, #fb7185, #fbbf24, #22d3ee, #a78bfa)' }} />
        <div className="p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="text-[10px] tracking-widest text-stone-500 mb-1" style={{ fontFamily: 'ui-monospace, monospace' }}>ADD TO PORTFOLIO</div>
              <div className="text-lg font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>{player.name}</div>
              <div className="text-xs text-stone-600 mt-0.5" style={{ fontFamily: 'ui-monospace, monospace' }}>
                {player.cardProduct} · {variant.name}
              </div>
            </div>
            <button onClick={onClose} className="text-stone-400 hover:text-stone-900 p-1"><X size={20} /></button>
          </div>
          
          <div className="space-y-3">
            <div>
              <label className="text-[10px] tracking-widest text-stone-500 block mb-1" style={{ fontFamily: 'ui-monospace, monospace' }}>PURCHASE PRICE ($)</label>
              <input type="number" value={price} onChange={e => setPrice(e.target.value)} className="w-full bg-white border border-stone-300 px-3 py-2 text-stone-900 focus:outline-none focus:border-orange-600" style={{ borderRadius: '2px', fontFamily: 'ui-monospace, monospace' }} placeholder={String(suggested)} />
              <div className="text-[10px] text-stone-500 mt-1" style={{ fontFamily: 'ui-monospace, monospace' }}>Model suggests ${suggested.toLocaleString()}</div>
            </div>
            <div>
              <label className="text-[10px] tracking-widest text-stone-500 block mb-1" style={{ fontFamily: 'ui-monospace, monospace' }}>PURCHASE DATE</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full bg-white border border-stone-300 px-3 py-2 text-stone-900 focus:outline-none focus:border-orange-600" style={{ borderRadius: '2px', fontFamily: 'ui-monospace, monospace' }} />
            </div>
            <div>
              <label className="text-[10px] tracking-widest text-stone-500 block mb-1" style={{ fontFamily: 'ui-monospace, monospace' }}>NOTES (optional)</label>
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)} className="w-full bg-white border border-stone-300 px-3 py-2 text-stone-900 focus:outline-none focus:border-orange-600" style={{ borderRadius: '2px', fontFamily: 'ui-monospace, monospace' }} placeholder="e.g. eBay sniped, PSA pending..." />
            </div>
          </div>
          
          <button
            onClick={() => {
              const item = {
                id: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                playerId: player.id,
                playerName: player.name,
                team: player.team,
                pos: player.pos,
                cardProduct: player.cardProduct,
                variantId: variant.id,
                variantName: variant.name,
                tier: variant.tier,
                numbered: variant.run,
                auto: variant.auto,
                relic: variant.relic,
                purchasePrice: parseFloat(price) || 0,
                purchaseDate: date,
                notes: notes.trim(),
                createdAt: Date.now(),
              };
              onSave(item);
            }}
            className="w-full mt-4 bg-orange-600 hover:bg-orange-700 text-white py-3 font-bold tracking-wider text-sm transition-colors"
            style={{ borderRadius: '2px', fontFamily: 'ui-monospace, monospace' }}
          >
            <Check size={14} className="inline mr-1.5" />SAVE TO PORTFOLIO
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PLAYER DETAIL MODAL
// ============================================================

function PlayerDetailModal({ player, onClose, onAddToPortfolio }) {
  if (!player) return null;
  const { score, comp } = findBestComp(player);
  const verdict = playerVerdict(player);
  const baseTarget = patternBaseTarget(player);
  const upside = Math.round(((baseTarget - player.anchorPrice) / player.anchorPrice) * 100);
  const verdictStyle = VERDICT_STYLES[verdict];
  
  return (
    <div className="fixed inset-0 z-50 bg-stone-950/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-stone-50 w-full sm:max-w-md max-h-[92vh] overflow-y-auto" style={{ borderRadius: '2px' }}>
        <div className="h-1" style={{ background: 'linear-gradient(90deg, #fb7185, #fbbf24, #22d3ee, #a78bfa)' }} />
        <div className="p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="text-[10px] tracking-widest text-stone-500 mb-1" style={{ fontFamily: 'ui-monospace, monospace' }}>FLIP DOSSIER · {String(player.id).padStart(3, '0')}</div>
              <h2 className="font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif', fontSize: '22px', lineHeight: 1 }}>{player.name}</h2>
              <div className="text-sm text-stone-600 mt-1" style={{ fontFamily: 'ui-monospace, monospace' }}>{player.team} · {player.pos} · {player.age}yo · {player.status}</div>
              <div className="text-[11px] text-stone-500 mt-0.5" style={{ fontFamily: 'ui-monospace, monospace' }}>Product: {player.cardProduct}</div>
            </div>
            <button onClick={onClose} className="text-stone-400 hover:text-stone-900 p-1"><X size={20} /></button>
          </div>

          <div className="mb-4 p-3 text-center" style={{ backgroundColor: verdictStyle.bg, color: verdictStyle.text, borderRadius: '2px' }}>
            <div className="text-[10px] tracking-[0.3em] opacity-70" style={{ fontFamily: 'ui-monospace, monospace' }}>VERDICT</div>
            <div className="text-2xl font-bold tracking-wider mt-0.5" style={{ fontFamily: 'ui-monospace, monospace' }}>{verdict}</div>
          </div>

          {/* Price history chart */}
          <div className="mb-4">
            <PriceChart player={player} targetPrice={baseTarget} />
          </div>

          {/* Pattern match */}
          <div className="mb-4 bg-stone-900 text-stone-100 p-4" style={{ borderRadius: '2px' }}>
            <div className="text-[10px] tracking-widest text-orange-500 mb-2" style={{ fontFamily: 'ui-monospace, monospace' }}>
              <Eye size={10} className="inline mr-1" />PATTERN MATCH
            </div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-[10px] text-stone-400" style={{ fontFamily: 'ui-monospace, monospace' }}>PROFILE OF</div>
                <div className="text-sm font-bold" style={{ fontFamily: 'Georgia, serif' }}>{player.name}</div>
              </div>
              <div className="text-3xl font-bold text-orange-500 tabular-nums" style={{ fontFamily: 'ui-monospace, monospace' }}>{score}%</div>
              <div className="text-right">
                <div className="text-[10px] text-stone-400" style={{ fontFamily: 'ui-monospace, monospace' }}>MATCHES</div>
                <div className="text-sm font-bold text-amber-400" style={{ fontFamily: 'Georgia, serif' }}>{comp.player}</div>
              </div>
            </div>
            <div className="text-[10px] text-stone-400 mb-2" style={{ fontFamily: 'ui-monospace, monospace' }}><span className="text-stone-500">archetype: </span>{comp.archetype}</div>
            <div className="border-t border-stone-800 pt-2 mt-2">
              <div className="text-[9px] tracking-widest text-stone-500 mb-1.5" style={{ fontFamily: 'ui-monospace, monospace' }}>YOUR PLAYER ↑   vs   COMP ↓</div>
              <ProfileBars profile={player.profile} compProfile={comp.profile} compact />
            </div>
          </div>

          {/* Anchor price summary */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-stone-100 border border-stone-300 p-3" style={{ borderRadius: '2px' }}>
              <div className="text-[9px] text-stone-500 tracking-widest" style={{ fontFamily: 'ui-monospace, monospace' }}>ANCHOR (1st Auto PSA 10)</div>
              <div className="text-base font-bold text-stone-900 tabular-nums" style={{ fontFamily: 'ui-monospace, monospace' }}>${player.anchorPrice}</div>
            </div>
            <div className="bg-orange-700 text-white p-3" style={{ borderRadius: '2px' }}>
              <div className="text-[9px] tracking-widest opacity-80" style={{ fontFamily: 'ui-monospace, monospace' }}>TARGET</div>
              <div className="text-base font-bold tabular-nums" style={{ fontFamily: 'ui-monospace, monospace' }}>${baseTarget}</div>
            </div>
            <div className="bg-stone-900 text-stone-50 p-3" style={{ borderRadius: '2px' }}>
              <div className="text-[9px] text-stone-400 tracking-widest" style={{ fontFamily: 'ui-monospace, monospace' }}>UPSIDE</div>
              <div className="text-base font-bold tabular-nums" style={{ fontFamily: 'ui-monospace, monospace' }}>+{upside}%</div>
            </div>
          </div>

          {/* Window + risk */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            <div className="bg-stone-100 border border-stone-300 p-3" style={{ borderRadius: '2px' }}>
              <div className="text-[9px] text-stone-500 tracking-widest" style={{ fontFamily: 'ui-monospace, monospace' }}><Clock size={9} className="inline mr-1" />FLIP WINDOW</div>
              <div className="text-xs font-bold text-stone-900 mt-0.5" style={{ fontFamily: 'ui-monospace, monospace' }}>{player.flipWindow}</div>
            </div>
            <div className="bg-stone-100 border border-stone-300 p-3" style={{ borderRadius: '2px' }}>
              <div className="text-[9px] text-stone-500 tracking-widest" style={{ fontFamily: 'ui-monospace, monospace' }}><AlertCircle size={9} className="inline mr-1" />RISK / LIQ</div>
              <div className="text-xs font-bold text-stone-900 mt-0.5" style={{ fontFamily: 'ui-monospace, monospace' }}>{player.riskLevel.toUpperCase()} / {player.liquidity.toUpperCase()}</div>
            </div>
          </div>

          {/* Catalysts */}
          <div className="mb-5">
            <div className="text-[10px] tracking-widest text-stone-500 mb-2" style={{ fontFamily: 'ui-monospace, monospace' }}><Target size={10} className="inline mr-1" />CATALYSTS TO WATCH</div>
            <div className="space-y-1.5">
              {player.catalysts.map((c, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-stone-700">
                  <span className="text-orange-600 font-bold mt-0.5" style={{ fontFamily: 'ui-monospace, monospace', fontSize: '10px' }}>{String(i + 1).padStart(2, '0')}</span>
                  <span style={{ fontFamily: 'Georgia, serif', lineHeight: 1.3 }}>{c}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Scout note */}
          <div className="border-l-2 border-orange-600 pl-3 mb-5">
            <div className="text-[10px] text-stone-500 uppercase tracking-widest mb-1" style={{ fontFamily: 'ui-monospace, monospace' }}>Scout note</div>
            <p className="text-sm text-stone-700 italic" style={{ fontFamily: 'Georgia, serif' }}>{player.realWorld}</p>
          </div>

          {/* Parallel ladder — the new section */}
          <div className="mb-3">
            <div className="text-[10px] tracking-widest text-stone-500 mb-2" style={{ fontFamily: 'ui-monospace, monospace' }}>
              <Layers size={10} className="inline mr-1" />FULL CARD LADDER — {PARALLEL_LADDER.length} VARIANTS
            </div>
            <ParallelLadder player={player} onAddToPortfolio={onAddToPortfolio} />
          </div>

          <div className="text-[10px] text-stone-400 leading-relaxed mt-4 pt-4 border-t border-stone-200" style={{ fontFamily: 'ui-monospace, monospace' }}>
            Variant prices are scarcity-multiplied from the player anchor. Real market prices vary by year, condition, and current demand. Verify on eBay sold listings before buying. Not financial advice.
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// COMP DETAIL MODAL — playbook entry
// ============================================================

function CompDetailModal({ comp, onClose }) {
  if (!comp) return null;
  const matches = CURRENT_PLAYERS
    .map(p => ({ player: p, sim: profileSimilarity(p.profile, comp.profile) }))
    .filter(m => m.player.age < 32)
    .sort((a, b) => b.sim - a.sim).slice(0, 5);
  return (
    <div className="fixed inset-0 z-50 bg-stone-950/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-stone-50 w-full sm:max-w-md max-h-[90vh] overflow-y-auto" style={{ borderRadius: '2px' }}>
        <div className="h-1" style={{ background: 'linear-gradient(90deg, #fb7185, #fbbf24, #22d3ee, #a78bfa)' }} />
        <div className="p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="text-[10px] tracking-widest text-stone-500 mb-1" style={{ fontFamily: 'ui-monospace, monospace' }}>THE PLAYBOOK · {comp.archetype.toUpperCase()}</div>
              <h2 className="font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif', fontSize: '22px', lineHeight: 1 }}>{comp.player}</h2>
              <div className="text-sm text-stone-600 mt-1" style={{ fontFamily: 'ui-monospace, monospace' }}>{comp.card}</div>
            </div>
            <button onClick={onClose} className="text-stone-400 hover:text-stone-900 p-1"><X size={20} /></button>
          </div>
          <div className="bg-orange-700 text-white p-3 mb-4" style={{ borderRadius: '2px' }}>
            <div className="text-[10px] tracking-widest opacity-80" style={{ fontFamily: 'ui-monospace, monospace' }}>PEAK SOLD VALUE</div>
            <div className="text-2xl font-bold tabular-nums" style={{ fontFamily: 'ui-monospace, monospace' }}>${comp.peakValue.toLocaleString()}</div>
          </div>
          <p className="text-sm text-stone-700 italic mb-4 border-l-2 border-orange-600 pl-3" style={{ fontFamily: 'Georgia, serif' }}>{comp.why}</p>
          <div className="mb-4">
            <div className="text-[10px] tracking-widest text-stone-500 mb-2" style={{ fontFamily: 'ui-monospace, monospace' }}>ARCHETYPE PROFILE</div>
            <div className="bg-stone-900 p-3" style={{ borderRadius: '2px' }}><ProfileBars profile={comp.profile} /></div>
          </div>
          <div>
            <div className="text-[10px] tracking-widest text-stone-500 mb-2" style={{ fontFamily: 'ui-monospace, monospace' }}>CURRENT PLAYERS THAT MATCH</div>
            <div className="space-y-1.5">
              {matches.map(m => (
                <div key={m.player.id} className="flex items-center justify-between bg-stone-100 px-3 py-2 border border-stone-200" style={{ borderRadius: '1px' }}>
                  <div>
                    <div className="text-sm font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>{m.player.name}</div>
                    <div className="text-[10px] text-stone-500" style={{ fontFamily: 'ui-monospace, monospace' }}>{m.player.team} · {m.player.pos} · ${m.player.anchorPrice}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] text-stone-500 tracking-widest" style={{ fontFamily: 'ui-monospace, monospace' }}>MATCH</div>
                    <div className="text-lg font-bold text-orange-700 tabular-nums" style={{ fontFamily: 'ui-monospace, monospace' }}>{Math.round(m.sim)}%</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PORTFOLIO TAB
// ============================================================

function PortfolioItem({ item, onDelete }) {
  // Look up the player + variant to compute current value
  const player = CURRENT_PLAYERS.find(p => p.id === item.playerId);
  const variant = PARALLEL_LADDER.find(v => v.id === item.variantId);
  
  if (!player || !variant) {
    // Player/variant no longer in DB
    return (
      <div className="bg-stone-50 border border-stone-300 p-3" style={{ borderRadius: '2px' }}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>{item.playerName}</div>
            <div className="text-[10px] text-stone-500" style={{ fontFamily: 'ui-monospace, monospace' }}>{item.variantName}</div>
            <div className="text-[10px] text-stone-400 mt-1" style={{ fontFamily: 'ui-monospace, monospace' }}>Bought ${item.purchasePrice} · {item.purchaseDate}</div>
          </div>
          <button onClick={() => onDelete(item.id)} className="text-stone-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>
        </div>
      </div>
    );
  }
  
  const currentValue = variantPrice(player, variant);
  const targetValue = variantTarget(player, variant);
  const pl = currentValue - item.purchasePrice;
  const plPct = Math.round((pl / item.purchasePrice) * 100);
  const targetUpside = Math.round(((targetValue - currentValue) / currentValue) * 100);
  
  return (
    <div className="bg-stone-50 border border-stone-300 p-3 relative overflow-hidden" style={{ borderRadius: '2px' }}>
      <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: 'linear-gradient(90deg, #fb7185, #fbbf24, #22d3ee, #a78bfa)' }} />
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>{item.playerName}</div>
          <div className="flex items-center gap-1.5 flex-wrap mt-1 mb-0.5">
            <TierBadge tier={item.tier} />
            {item.numbered && <span className="text-[9px] tabular-nums text-stone-600 font-bold" style={{ fontFamily: 'ui-monospace, monospace' }}>/{item.numbered}</span>}
            {item.auto && <span className="text-[9px] px-1 bg-amber-100 text-amber-800 font-bold" style={{ fontFamily: 'ui-monospace, monospace' }}>AUTO</span>}
            {item.relic && <span className="text-[9px] px-1 bg-purple-100 text-purple-800 font-bold" style={{ fontFamily: 'ui-monospace, monospace' }}>RELIC</span>}
          </div>
          <div className="text-[10px] text-stone-500" style={{ fontFamily: 'ui-monospace, monospace' }}>{item.cardProduct} · {item.variantName}</div>
          {item.notes && <div className="text-[10px] text-stone-400 mt-1 italic" style={{ fontFamily: 'Georgia, serif' }}>"{item.notes}"</div>}
        </div>
        <button onClick={() => onDelete(item.id)} className="shrink-0 text-stone-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>
      </div>
      <div className="grid grid-cols-4 gap-2 mt-2 pt-2 border-t border-stone-200">
        <div>
          <div className="text-[8px] text-stone-500 tracking-widest" style={{ fontFamily: 'ui-monospace, monospace' }}>PAID</div>
          <div className="text-xs font-bold text-stone-900 tabular-nums" style={{ fontFamily: 'ui-monospace, monospace' }}>${item.purchasePrice}</div>
        </div>
        <div>
          <div className="text-[8px] text-stone-500 tracking-widest" style={{ fontFamily: 'ui-monospace, monospace' }}>NOW</div>
          <div className="text-xs font-bold text-stone-900 tabular-nums" style={{ fontFamily: 'ui-monospace, monospace' }}>${currentValue.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-[8px] text-stone-500 tracking-widest" style={{ fontFamily: 'ui-monospace, monospace' }}>P&amp;L</div>
          <div className="text-xs font-bold tabular-nums" style={{ fontFamily: 'ui-monospace, monospace', color: pl >= 0 ? '#16a34a' : '#dc2626' }}>
            {pl >= 0 ? '+' : ''}{plPct}%
          </div>
        </div>
        <div>
          <div className="text-[8px] text-stone-500 tracking-widest" style={{ fontFamily: 'ui-monospace, monospace' }}>TGT</div>
          <div className="text-xs font-bold text-orange-700 tabular-nums" style={{ fontFamily: 'ui-monospace, monospace' }}>${targetValue.toLocaleString()}</div>
        </div>
      </div>
    </div>
  );
}

function PortfolioView({ portfolio, onDelete, onGoToScout }) {
  const totals = useMemo(() => {
    let invested = 0, current = 0, target = 0, valid = 0;
    portfolio.forEach(item => {
      const player = CURRENT_PLAYERS.find(p => p.id === item.playerId);
      const variant = PARALLEL_LADDER.find(v => v.id === item.variantId);
      invested += item.purchasePrice;
      if (player && variant) {
        current += variantPrice(player, variant);
        target += variantTarget(player, variant);
        valid++;
      }
    });
    return { invested, current, target, count: portfolio.length, valid };
  }, [portfolio]);
  
  const totalPL = totals.current - totals.invested;
  const totalPLPct = totals.invested > 0 ? Math.round((totalPL / totals.invested) * 100) : 0;
  const targetPL = totals.target - totals.invested;
  const targetPLPct = totals.invested > 0 ? Math.round((targetPL / totals.invested) * 100) : 0;
  
  if (portfolio.length === 0) {
    return (
      <div className="text-center py-16 px-6">
        <Briefcase size={48} className="mx-auto text-stone-700 mb-4" />
        <div className="text-stone-300 font-bold mb-1" style={{ fontFamily: 'Georgia, serif' }}>Your portfolio is empty</div>
        <div className="text-xs text-stone-500 mb-6" style={{ fontFamily: 'ui-monospace, monospace' }}>
          Tap any card variant in the Scout tab to add it here.
        </div>
        <button onClick={onGoToScout} className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 text-xs font-bold tracking-wider transition-colors" style={{ borderRadius: '2px', fontFamily: 'ui-monospace, monospace' }}>
          GO TO SCOUT →
        </button>
      </div>
    );
  }
  
  return (
    <div>
      {/* Summary bar */}
      <div className="bg-stone-900 border border-stone-800 p-4 mb-4" style={{ borderRadius: '2px' }}>
        <div className="text-[10px] tracking-widest text-orange-500 mb-3" style={{ fontFamily: 'ui-monospace, monospace' }}>
          <DollarSign size={10} className="inline mr-1" />PORTFOLIO SUMMARY
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <div className="text-[9px] text-stone-500 tracking-widest" style={{ fontFamily: 'ui-monospace, monospace' }}>INVESTED</div>
            <div className="text-xl font-bold text-stone-100 tabular-nums" style={{ fontFamily: 'ui-monospace, monospace' }}>${totals.invested.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[9px] text-stone-500 tracking-widest" style={{ fontFamily: 'ui-monospace, monospace' }}>CURRENT</div>
            <div className="text-xl font-bold text-stone-100 tabular-nums" style={{ fontFamily: 'ui-monospace, monospace' }}>${totals.current.toLocaleString()}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-stone-800">
          <div>
            <div className="text-[9px] text-stone-500 tracking-widest" style={{ fontFamily: 'ui-monospace, monospace' }}>UNREALIZED P&amp;L</div>
            <div className="text-lg font-bold tabular-nums" style={{ fontFamily: 'ui-monospace, monospace', color: totalPL >= 0 ? '#22c55e' : '#ef4444' }}>
              {totalPL >= 0 ? <TrendingUp size={14} className="inline mr-1" /> : <TrendingDown size={14} className="inline mr-1" />}
              {totalPL >= 0 ? '+' : ''}${Math.abs(totalPL).toLocaleString()} ({totalPL >= 0 ? '+' : ''}{totalPLPct}%)
            </div>
          </div>
          <div>
            <div className="text-[9px] text-stone-500 tracking-widest" style={{ fontFamily: 'ui-monospace, monospace' }}>TARGET P&amp;L</div>
            <div className="text-lg font-bold text-orange-500 tabular-nums" style={{ fontFamily: 'ui-monospace, monospace' }}>
              {targetPL >= 0 ? '+' : ''}${targetPL.toLocaleString()} ({targetPL >= 0 ? '+' : ''}{targetPLPct}%)
            </div>
          </div>
        </div>
        <div className="text-[10px] text-stone-500 mt-3 pt-3 border-t border-stone-800" style={{ fontFamily: 'ui-monospace, monospace' }}>
          {totals.count} {totals.count === 1 ? 'card' : 'cards'} tracked · Catalyst alerts active
        </div>
      </div>
      
      {/* Cards */}
      <div className="space-y-2 pb-8">
        {portfolio.slice().sort((a, b) => b.createdAt - a.createdAt).map(item => (
          <PortfolioItem key={item.id} item={item} onDelete={onDelete} />
        ))}
      </div>
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================

export default function CardProspector() {
  const [tab, setTab] = useState('scout');
  const [filter, setFilter] = useState('flips');
  const [sortBy, setSortBy] = useState('match');
  const [search, setSearch] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [selectedComp, setSelectedComp] = useState(null);
  const [addingCard, setAddingCard] = useState(null); // { player, variant }
  const [portfolio, setPortfolio] = useState([]);
  const [loaded, setLoaded] = useState(false);
  
  // Load portfolio on mount
  useEffect(() => {
    setPortfolio(loadPortfolio());
    setLoaded(true);
  }, []);
  
  const handleAddToPortfolio = (player, variant) => {
    setAddingCard({ player, variant });
  };
  
  const handleSaveCard = (item) => {
    const updated = [...portfolio, item];
    setPortfolio(updated);
    savePortfolio(updated);
    setAddingCard(null);
    setSelectedPlayer(null); // close player modal after add
  };
  
  const handleDelete = (itemId) => {
    const updated = portfolio.filter(i => i.id !== itemId);
    setPortfolio(updated);
    savePortfolio(updated);
  };

  const enriched = useMemo(() => {
    return CURRENT_PLAYERS.map(p => {
      const { score, comp } = findBestComp(p);
      const verdict = playerVerdict(p);
      return { ...p, _match: score, _comp: comp, _verdict: verdict, _target: patternBaseTarget(p) };
    });
  }, []);

  const filtered = useMemo(() => {
    let list = enriched;
    if (filter === 'flips') list = list.filter(p => p._verdict === 'STRONG FLIP' || p._verdict === 'FLIP');
    else if (filter === 'cheap') list = list.filter(p => p.anchorPrice < 150);
    else if (filter === 'rookies') list = list.filter(p => p.status === 'rookie' || p.status === 'prospect');
    else if (filter === 'bigmarket') list = list.filter(p => p.profile.market >= 75);
    else if (filter === 'bounceback') list = list.filter(p => p.riskLevel === 'high');
    
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q));
    }
    
    if (sortBy === 'match') list = [...list].sort((a, b) => b._match - a._match);
    else if (sortBy === 'upside') list = [...list].sort((a, b) => ((b._target - b.anchorPrice) / b.anchorPrice) - ((a._target - a.anchorPrice) / a.anchorPrice));
    else if (sortBy === 'cheapest') list = [...list].sort((a, b) => a.anchorPrice - b.anchorPrice);
    
    return list;
  }, [enriched, filter, sortBy, search]);

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100 pb-16" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <div className="border-b border-stone-800 bg-stone-950 sticky top-0 z-30">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-baseline justify-between mb-1">
            <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Georgia, serif' }}>
              Card<span className="text-orange-500">Prospector</span>
            </h1>
            <div className="text-[10px] text-stone-500 tabular-nums" style={{ fontFamily: 'ui-monospace, monospace' }}>PATTERN ENGINE v3</div>
          </div>
          <p className="text-xs text-stone-400" style={{ fontFamily: 'ui-monospace, monospace' }}>
            {tab === 'scout' ? 'Reverse-engineering premium cards into flip predictions.' : `Tracking ${portfolio.length} ${portfolio.length === 1 ? 'card' : 'cards'} across the parallel ladder.`}
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4">
        {tab === 'scout' && (
          <>
            <PlaybookSection onSelectComp={setSelectedComp} />
            
            {/* Search */}
            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search player or team…" className="w-full bg-stone-900 border border-stone-800 text-stone-100 pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-orange-600" style={{ borderRadius: '2px', fontFamily: 'ui-monospace, monospace' }} />
            </div>
            
            {/* Filter chips */}
            <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1" style={{ fontFamily: 'ui-monospace, monospace' }}>
              {[
                { id: 'flips', label: 'FLIPS' },
                { id: 'all', label: 'ALL' },
                { id: 'cheap', label: 'UNDER $150' },
                { id: 'rookies', label: 'ROOKIES' },
                { id: 'bigmarket', label: 'BIG MARKET' },
                { id: 'bounceback', label: 'BOUNCE-BACK' },
              ].map(f => (
                <button key={f.id} onClick={() => setFilter(f.id)} className={`shrink-0 px-3 py-1.5 text-[10px] tracking-widest border transition-colors ${filter === f.id ? 'bg-orange-600 text-white border-orange-600' : 'bg-stone-900 text-stone-400 border-stone-800 hover:border-stone-600'}`} style={{ borderRadius: '2px' }}>
                  {f.label}
                </button>
              ))}
            </div>
            
            {/* Sort */}
            <div className="flex items-center gap-2 mb-4 text-[10px] tracking-widest text-stone-500" style={{ fontFamily: 'ui-monospace, monospace' }}>
              <span>SORT</span>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="bg-stone-900 border border-stone-800 text-stone-200 px-2 py-1 focus:outline-none focus:border-orange-600" style={{ borderRadius: '2px', fontFamily: 'ui-monospace, monospace', fontSize: '10px' }}>
                <option value="match">PATTERN MATCH ↓</option>
                <option value="upside">UPSIDE % ↓</option>
                <option value="cheapest">CHEAPEST ↑</option>
              </select>
              <span className="ml-auto tabular-nums">{filtered.length} RESULTS</span>
            </div>
            
            {/* List */}
            <div className="space-y-2 pb-8">
              {filtered.length === 0 ? (
                <div className="text-center py-12 text-stone-500 text-sm" style={{ fontFamily: 'ui-monospace, monospace' }}>No players match these filters.</div>
              ) : (
                filtered.map(p => <FlipCard key={p.id} player={p} onTap={setSelectedPlayer} />)
              )}
            </div>
            
            {/* How it works */}
            <div className="border-t border-stone-800 pt-4 pb-4 text-[10px] leading-relaxed text-stone-500" style={{ fontFamily: 'ui-monospace, monospace' }}>
              <div className="mb-2 text-stone-400 tracking-widest">HOW IT WORKS</div>
              <p className="mb-2">
                <span className="text-stone-300">PATTERN ENGINE.</span> Every player profile is scored against 7 historical Premium-card archetypes via weighted cosine similarity. Best match = your "comp."
              </p>
              <p className="mb-2">
                <span className="text-stone-300">SCARCITY LAYER.</span> Each player's anchor price spans a 15-variant ladder from Base RC raw all the way to Superfractor 1/1. Multipliers calibrated from observed eBay sold spreads.
              </p>
              <p>
                <span className="text-stone-300">FLIP LOGIC.</span> Best flips combine high pattern match × mid-tier scarcity (/99 to /25) × good liquidity. The 1/1s are long holds, not flips.
              </p>
            </div>
          </>
        )}
        
        {tab === 'portfolio' && (
          loaded ? (
            <PortfolioView portfolio={portfolio} onDelete={handleDelete} onGoToScout={() => setTab('scout')} />
          ) : (
            <div className="text-center py-16 text-stone-500 text-sm" style={{ fontFamily: 'ui-monospace, monospace' }}>Loading your portfolio…</div>
          )
        )}
      </div>

      {/* Bottom tab bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-stone-900 border-t border-stone-800 z-40">
        <div className="max-w-2xl mx-auto flex">
          <button onClick={() => setTab('scout')} className={`flex-1 py-3 flex flex-col items-center gap-0.5 transition-colors ${tab === 'scout' ? 'text-orange-500' : 'text-stone-500'}`}>
            <Search size={18} />
            <span className="text-[10px] tracking-widest" style={{ fontFamily: 'ui-monospace, monospace' }}>SCOUT</span>
          </button>
          <button onClick={() => setTab('portfolio')} className={`flex-1 py-3 flex flex-col items-center gap-0.5 transition-colors relative ${tab === 'portfolio' ? 'text-orange-500' : 'text-stone-500'}`}>
            <Briefcase size={18} />
            <span className="text-[10px] tracking-widest" style={{ fontFamily: 'ui-monospace, monospace' }}>PORTFOLIO</span>
            {portfolio.length > 0 && (
              <span className="absolute top-2 right-1/2 translate-x-6 bg-orange-600 text-white text-[9px] px-1.5 rounded-full font-bold tabular-nums">{portfolio.length}</span>
            )}
          </button>
        </div>
      </div>

      {/* Modals */}
      {selectedPlayer && <PlayerDetailModal player={selectedPlayer} onClose={() => setSelectedPlayer(null)} onAddToPortfolio={handleAddToPortfolio} />}
      {selectedComp && <CompDetailModal comp={selectedComp} onClose={() => setSelectedComp(null)} />}
      {addingCard && <AddToPortfolioModal player={addingCard.player} variant={addingCard.variant} onSave={handleSaveCard} onClose={() => setAddingCard(null)} />}
    </div>
  );
}
