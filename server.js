/**
 * CardProspector — Production Server
 * 
 * Serves the Vite build output (dist/) over HTTP on the port assigned
 * by CloudPanel (default 3850). CloudPanel's Nginx layer terminates SSL
 * at port 443 for cardprospector.app and reverse-proxies traffic here.
 * 
 * In production: started by CloudPanel's process manager (PM2 under the
 * hood) via `npm start`. To run locally: `npm run build && npm start`.
 */

import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  initDb, getCards, recordPop, recordPrice, setCardImage,
  createUser, getUserByEmail, getUserById, getWatchlist, setWatch,
  getPortfolio, setPortfolioEntry, removePortfolioEntry,
  setStripeCustomer, setSubscription, setUserTierByEmail,
  createSubmission, getMySubmissions, getPendingSubmissions, publishSubmission, rejectSubmission,
  getUsers, setUserBanned, setUserTierById, getAdminStats, createCard, updateCardTraits, expireBetas,
} from './db.js';
import { getProvider } from './pricing.js';
import { searchCardImage } from './ebay.js';
import {
  hashPassword, verifyPassword, signToken, verifyToken,
  cookieOptions, validCredentials, publicUser, SESSION_COOKIE,
} from './auth.js';
import {
  getStripe, billingEnabled, APP_URL, planToPrice, priceToTier, TRIAL_DAYS,
} from './billing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3850;
const DIST_DIR = path.join(__dirname, 'dist');
// Owner account — can never be banned/locked (enforced below). Override via .env.
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'daleporter2009@yahoo.com').toLowerCase();

// Health check — useful for uptime monitoring and CloudPanel diagnostics
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Gzip responses
app.use(compression());

// Stripe webhook — MUST come before express.json(): signature verification
// needs the raw request body. Source of truth for subscription entitlement.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).end();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  try {
    if (event.type.startsWith('customer.subscription.')) {
      const sub = event.data.object;
      const priceId = sub.items?.data?.[0]?.price?.id;
      const deleted = event.type === 'customer.subscription.deleted';
      const entitled = !deleted && (sub.status === 'active' || sub.status === 'trialing');
      await setSubscription(sub.customer, {
        tier: entitled ? priceToTier(priceId) : 'free',
        status: deleted ? 'canceled' : sub.status,
        trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      });
    }
    res.json({ received: true });
  } catch (err) {
    console.error('[stripe] webhook handler failed:', err.message);
    res.status(500).end();
  }
});

// Parse JSON request bodies + cookies (for auth sessions)
app.use(express.json());
app.use(cookieParser());

// Resolve the logged-in user from the session cookie (or null).
async function getSessionUser(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload?.uid) return null;
  const user = await getUserById(payload.uid);
  if (!user) return null;
  if (user.banned) return null; // locked accounts are treated as signed out
  // Auto-revert an expired beta grant on access.
  if (user.tier === 'beta' && user.tier_expires_at && new Date(user.tier_expires_at) <= new Date()) {
    await setUserTierById(user.id, 'free', null);
    user.tier = 'free';
    user.tier_expires_at = null;
  }
  return user;
}
function requireAuth(handler) {
  return async (req, res) => {
    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    return handler(req, res, user);
  };
}

/* ============================================================================
   API — must be registered BEFORE the static + SPA-fallback handlers below,
   or the '*' route would swallow these paths.
   ============================================================================ */

// Entitled = on a paid tier or a comped/beta tier (trialing counts too, since
// the webhook sets the tier).
function isEntitled(user) {
  return Boolean(user) && (user.tier === 'pro' || user.tier === 'elite' || user.tier === 'beta');
}

// All cards (player data + pop). Pricing (and therefore the flip targets the
// client computes from it) is a paid feature — strip `price` for non-subscribers
// so the paywall is enforced server-side, not just hidden in the UI.
app.get('/api/cards', async (req, res) => {
  try {
    const entitled = isEntitled(await getSessionUser(req));
    let cards = await getCards();
    if (!entitled) cards = cards.map((c) => ({ ...c, price: null }));
    res.json({ cards, entitled });
  } catch (err) {
    console.error('[api] GET /api/cards failed:', err.message);
    res.status(500).json({ error: 'Failed to load cards' });
  }
});

// Server-side admin gate. ADMIN_TOKEN lives only in the server .env, never
// in the client bundle — so this is a real check, not the cosmetic one.
function checkAdmin(req) {
  const token = req.get('x-admin-token');
  return Boolean(process.env.ADMIN_TOKEN) && token === process.env.ADMIN_TOKEN;
}

// Verify a passphrase (used to unlock the admin panel in the UI).
app.post('/api/admin/verify', (req, res) => {
  res.json({ ok: checkAdmin(req) });
});

// Record today's PSA population snapshot for a card (full grade breakdown +
// total). 30-day velocity is derived from snapshots, so no historical input.
// Persists to MySQL — shared across all visitors, survives deploys.
app.post('/api/admin/pop', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.body || {};
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing card id' });
  }

  const toIntOrNull = (v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  // Snapshot day: use the admin's local date (sent by the client) so the daily
  // pop-tracking resets at the operator's midnight, not UTC. Fall back to UTC.
  const clientDay = typeof req.body.observedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.observedOn)
    ? req.body.observedOn
    : new Date().toISOString().slice(0, 10);
  const pop = {
    total: toIntOrNull(req.body.total),
    psa10: toIntOrNull(req.body.psa10),
    psa9: toIntOrNull(req.body.psa9),
    psa8: toIntOrNull(req.body.psa8),
    psa7: toIntOrNull(req.body.psa7),
    listings_active: toIntOrNull(req.body.listings_active),
    observedOn: clientDay,
  };

  // Sanity: the entered grades can't exceed the PSA total.
  const graded = (pop.psa10 || 0) + (pop.psa9 || 0) + (pop.psa8 || 0) + (pop.psa7 || 0);
  if (pop.total != null && graded > pop.total) {
    return res.status(400).json({ error: `Entered grades (${graded}) exceed total (${pop.total}).` });
  }

  try {
    const matched = await recordPop(id, pop);
    if (!matched) return res.status(404).json({ error: 'Unknown card id' });
    res.json({ ok: true, id, pop });
  } catch (err) {
    console.error('[api] POST /api/admin/pop failed:', err.message);
    res.status(500).json({ error: 'Failed to save pop data' });
  }
});

/* ============================================================================
   AUTH — self-hosted email/password (session in an httpOnly cookie)
   ============================================================================ */

app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = req.body || {};
  const invalid = validCredentials(email, password);
  if (invalid) return res.status(400).json({ error: invalid });
  try {
    if (await getUserByEmail(email)) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }
    const user = await createUser(email, await hashPassword(password));
    res.cookie(SESSION_COOKIE, signToken(user.id), cookieOptions());
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('[api] signup failed:', err.message);
    res.status(500).json({ error: 'Could not create account' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password required.' });
  }
  try {
    const user = await getUserByEmail(email);
    // Generic message either way — don't reveal whether the email exists.
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }
    if (user.banned) return res.status(403).json({ error: 'This account has been suspended.' });
    res.cookie(SESSION_COOKIE, signToken(user.id), cookieOptions());
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('[api] login failed:', err.message);
    res.status(500).json({ error: 'Could not sign in' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
  const user = await getSessionUser(req);
  res.json({ user: publicUser(user) });
});

/* ============================================================================
   WATCHLIST — per-user, requires a session
   ============================================================================ */

app.get('/api/watchlist', requireAuth(async (req, res, user) => {
  res.json({ cardIds: await getWatchlist(user.id) });
}));

app.post('/api/watchlist', requireAuth(async (req, res, user) => {
  const { cardId, watched } = req.body || {};
  if (!cardId || typeof cardId !== 'string') return res.status(400).json({ error: 'Missing cardId' });
  try {
    await setWatch(user.id, cardId, Boolean(watched));
    res.json({ ok: true, cardId, watched: Boolean(watched) });
  } catch (err) {
    console.error('[api] watchlist update failed:', err.message);
    res.status(500).json({ error: 'Could not update watchlist' });
  }
}));

// Per-account portfolio (holdings sync across devices).
app.get('/api/portfolio', requireAuth(async (req, res, user) => {
  res.json({ portfolio: await getPortfolio(user.id) });
}));

app.post('/api/portfolio', requireAuth(async (req, res, user) => {
  const { cardId, condition, purchasePrice } = req.body || {};
  if (!cardId || typeof cardId !== 'string') return res.status(400).json({ error: 'Missing cardId' });
  try {
    await setPortfolioEntry(user.id, cardId, condition, purchasePrice);
    res.json({ ok: true });
  } catch (err) {
    console.error('[api] portfolio update failed:', err.message);
    res.status(500).json({ error: 'Could not update portfolio' });
  }
}));

app.post('/api/portfolio/remove', requireAuth(async (req, res, user) => {
  const { cardId } = req.body || {};
  if (!cardId || typeof cardId !== 'string') return res.status(400).json({ error: 'Missing cardId' });
  try {
    await removePortfolioEntry(user.id, cardId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[api] portfolio remove failed:', err.message);
    res.status(500).json({ error: 'Could not update portfolio' });
  }
}));

/* ============================================================================
   CARD SUBMISSIONS — users submit (Pro), staff review/enrich/publish
   ============================================================================ */

const MIN_CARD_YEAR = 2010; // engine scope — modern prospects/rookies only

app.post('/api/submissions', requireAuth(async (req, res, user) => {
  if (!isEntitled(user)) return res.status(403).json({ error: 'Adding cards is a Pro feature.' });
  const f = req.body || {};
  if (!f.player || typeof f.player !== 'string') return res.status(400).json({ error: 'Player name is required.' });
  const yr = parseInt(f.card_year, 10);
  if (!yr || yr < MIN_CARD_YEAR) {
    return res.status(400).json({ error: `CardProspector covers modern cards (${MIN_CARD_YEAR}–present). Older/vintage cards aren't supported.` });
  }
  try {
    const sub = await createSubmission(user.id, f);
    res.json({ ok: true, submission: { id: sub.id, status: sub.status } });
  } catch (err) {
    console.error('[api] submission failed:', err.message);
    res.status(500).json({ error: 'Could not submit card' });
  }
}));

app.get('/api/submissions/mine', requireAuth(async (req, res, user) => {
  res.json({ submissions: await getMySubmissions(user.id) });
}));

app.get('/api/admin/submissions', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ submissions: await getPendingSubmissions() });
});

// Publish a submission into the shared cards table (with enriched traits +
// SportsCardsPro id), then best-effort fetch its price immediately.
app.post('/api/admin/submissions/publish', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { id, ...enriched } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing id' });
  if (!enriched.traits || typeof enriched.traits !== 'object') return res.status(400).json({ error: 'Traits are required to publish.' });
  try {
    const cardId = await publishSubmission(id, enriched);
    if (!cardId) return res.status(404).json({ error: 'Submission not found' });
    const provider = getProvider();
    if (provider && enriched.sportscardspro_id) {
      try {
        const r = await provider.fetchPrice({ id: cardId, sportscardsproId: enriched.sportscardspro_id, askPrice: 0 });
        if (r) await recordPrice(cardId, { ...r, observedOn: new Date().toISOString().slice(0, 10) });
      } catch (e) { console.error('[submissions] price fetch failed:', e.message); }
    }
    try {
      const q = `${enriched.player || ''} ${enriched.card_set || ''} ${enriched.card_number || ''}`.replace(/·/g, ' ').replace(/\s+/g, ' ').trim();
      const img = await searchCardImage(q);
      if (img?.imageUrl) await setCardImage(cardId, img.imageUrl);
    } catch (e) { console.error('[submissions] image fetch failed:', e.message); }
    res.json({ ok: true, cardId });
  } catch (err) {
    console.error('[api] publish submission failed:', err.message);
    res.status(500).json({ error: 'Could not publish' });
  }
});

app.post('/api/admin/submissions/reject', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { id, reviewNote } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing id' });
  res.json({ ok: await rejectSubmission(id, reviewNote) });
});

// Set a user's tier by email — comp/beta/grant or reset. 'beta' = free full access.
app.post('/api/admin/set-tier', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { email, tier } = req.body || {};
  if (!email || !['free', 'beta', 'pro', 'elite'].includes(tier)) {
    return res.status(400).json({ error: 'email and a valid tier (free/beta/pro/elite) required' });
  }
  try {
    const updated = await setUserTierByEmail(email, tier);
    res.json({ ok: true, updated });
  } catch (err) {
    console.error('[api] set-tier failed:', err.message);
    res.status(500).json({ error: 'Could not set tier' });
  }
});

/* ============================================================================
   ADMIN CONSOLE — stats, users, account actions, direct card creation
   ============================================================================ */

app.get('/api/admin/stats', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try { res.json(await getAdminStats()); }
  catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/admin/users', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try { res.json({ users: await getUsers((req.query.search || '').toString().trim()) }); }
  catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// Set a user's tier by id, with an optional beta duration (days) → expiry date.
app.post('/api/admin/users/tier', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { id, tier, betaDays } = req.body || {};
  if (!id || !['free', 'beta', 'pro', 'elite'].includes(tier)) {
    return res.status(400).json({ error: 'id and a valid tier required' });
  }
  let expiresAt = null;
  if (tier === 'beta' && betaDays && Number(betaDays) > 0) {
    expiresAt = new Date(Date.now() + Number(betaDays) * 86400000);
  }
  try {
    const updated = await setUserTierById(id, tier, expiresAt);
    res.json({ ok: true, updated, expiresAt });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/admin/users/ban', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { id, banned } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    // The owner account can never be locked/banned.
    if (banned) {
      const target = await getUserById(id);
      if (target && (target.email || '').toLowerCase() === OWNER_EMAIL) {
        return res.status(403).json({ error: 'The owner account cannot be locked.' });
      }
    }
    const updated = await setUserBanned(id, Boolean(banned));
    res.json({ ok: true, updated });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// Create a card directly in the shared catalog (then best-effort price + image).
app.post('/api/admin/cards', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const c = req.body || {};
  if (!c.player || !c.traits || typeof c.traits !== 'object') {
    return res.status(400).json({ error: 'player and traits are required' });
  }
  try {
    const cardId = await createCard(c);
    const provider = getProvider();
    if (provider && c.sportscardspro_id) {
      try {
        const r = await provider.fetchPrice({ id: cardId, sportscardsproId: c.sportscardspro_id, askPrice: 0 });
        if (r) await recordPrice(cardId, { ...r, observedOn: new Date().toISOString().slice(0, 10) });
      } catch (e) { console.error('[admin] card price fetch failed:', e.message); }
    }
    try {
      const q = `${c.player} ${c.card_set || ''} ${c.card_number || ''}`.replace(/·/g, ' ').replace(/\s+/g, ' ').trim();
      const img = await searchCardImage(q);
      if (img?.imageUrl) await setCardImage(cardId, img.imageUrl);
    } catch (e) { console.error('[admin] card image fetch failed:', e.message); }
    res.json({ ok: true, cardId });
  } catch (err) {
    console.error('[api] create card failed:', err.message);
    res.status(500).json({ error: 'Could not create card' });
  }
});

// Update an existing card's trait scores (and optionally warning signs).
app.post('/api/admin/cards/traits', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { id, traits, bear_case } = req.body || {};
  if (!id || !traits || typeof traits !== 'object') {
    return res.status(400).json({ error: 'id and traits are required' });
  }
  try {
    const updated = await updateCardTraits(id, traits, bear_case);
    res.json({ ok: true, updated });
  } catch (err) {
    console.error('[api] update traits failed:', err.message);
    res.status(500).json({ error: 'Could not update traits' });
  }
});

/* ----------------------------------------------------------------------------
   AI-assisted trait + warning-signs suggestion (admin-only).
   Uses the Anthropic API (ANTHROPIC_API_KEY in .env). At admin volume the cost
   is a few cents per card. Returns 503 (gracefully) when no key is configured.
   ---------------------------------------------------------------------------- */
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const TRAIT_KEYS = ['hof', 'peak', 'market', 'position', 'narrative', 'unique', 'longevity'];
const TRAIT_SCALE = `Score each trait 0-100 on this shared scale:
- hof (Hall-of-Fame probability): 20=fringe MLB, 50=solid regular no HOF case, 80=multiple All-Star seasons likely, 95=inner-circle/generational.
- peak (best-season intensity): 20=role-player ceiling, 50=above-average regular, 80=perennial All-Star peak, 95=MVP-tier/historic.
- market (team national spotlight): 20=small-market, 50=mid-market, 80=large national-spotlight team, 95=Yankees/Dodgers/Lakers-tier marquee.
- position (positional value premium): 20=low (1B/DH/corner), 50=average (corner OF/2B), 80=premium (C/SS/CF), 95=elite-scarcity premium.
- narrative (story/cultural resonance): 20=no distinct story, 50=mild hype, 80=strong narrative (intl./comeback/dynasty), 95=generational phenomenon.
- unique (defining rare skill): 20=ordinary profile, 50=one plus-skill, 80=rare standout tool, 95=singular never-seen skill.
- longevity (elite-window durability): 20=injury-prone/short runway, 50=average outlook, 80=durable long elite window, 95=iron-man longevity.`;

app.get('/api/admin/ai-config', (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ enabled: Boolean(ANTHROPIC_API_KEY) });
});

app.post('/api/admin/suggest-traits', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'AI suggestions are not configured (set ANTHROPIC_API_KEY in the server .env).' });
  }
  const { player, card_set, card_number, team, position, variant } = req.body || {};
  if (!player) return res.status(400).json({ error: 'player required' });
  const ctx = [
    `Player: ${player}`,
    card_set ? `Set: ${card_set}` : '',
    card_number ? `Card #: ${card_number}` : '',
    team ? `Team: ${team}` : '',
    position ? `Position: ${position}` : '',
    variant ? `Parallel/variant: ${variant}` : '',
  ].filter(Boolean).join('\n');
  const traitProps = Object.fromEntries(TRAIT_KEYS.map((k) => [k, { type: 'integer', minimum: 0, maximum: 100 }]));
  const rationaleProps = Object.fromEntries(TRAIT_KEYS.map((k) => [k, { type: 'string' }]));
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        tool_choice: { type: 'tool', name: 'record_traits' },
        tools: [{
          name: 'record_traits',
          description: 'Record estimated long-term value traits and warning signs for a sports card.',
          input_schema: {
            type: 'object',
            properties: {
              traits: { type: 'object', properties: traitProps, required: TRAIT_KEYS },
              rationales: { type: 'object', properties: rationaleProps, required: TRAIT_KEYS },
              warningSigns: { type: 'string' },
              confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
            },
            required: ['traits', 'rationales', 'warningSigns', 'confidence'],
          },
        }],
        system: `You are a sports-card analyst for CardProspector, which flags modern baseball prospects/rookies (year >= ${MIN_CARD_YEAR}) to buy raw, grade, and flip. Estimate 7 long-term card-value traits for the given player/card as integers 0-100, grounded in real, current player knowledge. Be honest and conservative: if the player is obscure or you are unsure, score moderately, set confidence "low", and say so in the rationale. Each rationale is ONE short sentence. warningSigns is a 1-2 sentence plain-English note of risks that would cap the grading-flip upside. ${TRAIT_SCALE}`,
        messages: [{ role: 'user', content: `Estimate traits for this card:\n${ctx}` }],
      }),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      console.error('[ai] suggest-traits failed:', resp.status, t.slice(0, 200));
      return res.status(502).json({ error: `AI request failed (${resp.status})` });
    }
    const data = await resp.json();
    const toolUse = (data.content || []).find((b) => b.type === 'tool_use');
    if (!toolUse?.input) return res.status(502).json({ error: 'AI returned no suggestion' });
    res.json({ ok: true, ...toolUse.input });
  } catch (err) {
    console.error('[ai] suggest-traits error:', err.message);
    res.status(500).json({ error: 'Could not reach the AI service.' });
  }
});

/* ============================================================================
   BILLING — Stripe Checkout + Customer Portal
   ============================================================================ */

// Whether billing is configured (so the client only shows upgrade UI when live).
app.get('/api/billing/config', (req, res) => {
  res.json({ enabled: billingEnabled(), trialDays: TRIAL_DAYS });
});

// Start a subscription checkout (with the 7-day trial). Returns a redirect URL.
app.post('/api/billing/checkout', requireAuth(async (req, res, user) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Billing is not configured yet.' });
  const price = planToPrice((req.body || {}).plan);
  if (!price) return res.status(400).json({ error: 'Unknown plan' });
  try {
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, metadata: { userId: String(user.id) } });
      customerId = customer.id;
      await setStripeCustomer(user.id, customerId);
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        // No card up front: if they never add one, the trial just ends (no charge).
        trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
      },
      payment_method_collection: 'if_required',
      allow_promotion_codes: true,
      success_url: `${APP_URL()}/?upgraded=1`,
      cancel_url: `${APP_URL()}/?checkout=cancelled`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('[stripe] checkout failed:', err.message);
    res.status(500).json({ error: 'Could not start checkout' });
  }
}));

// Open the Stripe Customer Portal (manage/cancel subscription, update card).
app.post('/api/billing/portal', requireAuth(async (req, res, user) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Billing is not configured yet.' });
  if (!user.stripe_customer_id) return res.status(400).json({ error: 'No subscription to manage yet.' });
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: APP_URL(),
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('[stripe] portal failed:', err.message);
    res.status(500).json({ error: 'Could not open billing portal' });
  }
}));

/* ============================================================================
   EBAY — marketplace account deletion / closure notifications
   ----------------------------------------------------------------------------
   Required by eBay before it will enable a production keyset. We store NO eBay
   user data, so the POST simply acknowledges (nothing to delete). The GET
   answers eBay's one-time validation challenge:
     challengeResponse = SHA256(challengeCode + verificationToken + endpointURL)
   ============================================================================ */
app.get('/api/ebay/marketplace-deletion', (req, res) => {
  const challengeCode = req.query.challenge_code;
  const token = process.env.EBAY_VERIFICATION_TOKEN;
  const endpoint = process.env.EBAY_DELETION_ENDPOINT;
  if (!challengeCode || !token || !endpoint) {
    return res.status(500).json({ error: 'eBay deletion endpoint not configured' });
  }
  const challengeResponse = crypto.createHash('sha256')
    .update(challengeCode).update(token).update(endpoint).digest('hex');
  res.status(200).json({ challengeResponse });
});
app.post('/api/ebay/marketplace-deletion', (req, res) => {
  console.log('[ebay] account-deletion notification received');
  res.status(200).send();
});

// Serve built static assets with aggressive caching.
// Vite hashes filenames (e.g. index-CtVBhsIM.js), so cached versions
// are safe to keep for a year — a new build means new filenames.
// The only exception is index.html, which we never cache so users
// always pick up the latest deployment.
app.use(express.static(DIST_DIR, {
  maxAge: '1y',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// SPA fallback — any unmatched route returns index.html so client-side
// routing works for URLs like /portfolio or /player/123 once we add them.
app.get('*', (req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'), (err) => {
    if (err) {
      res.status(500).send(
        'CardProspector backend is up, but the build artifacts are missing. ' +
        'On the server: `cd ~/htdocs/cardprospector.app && npm run build`'
      );
    }
  });
});

// Initialize the database (create schema + seed if empty), then start serving.
// If the DB can't be reached we still listen — static serving stays up and the
// frontend falls back to its bundled seed rather than the whole site going down.
initDb()
  .then(() => console.log('[db] ready'))
  .catch((err) => console.error('[db] init failed (serving static only):', err.message))
  .finally(() => {
    // Sweep expired beta grants back to free on boot, then hourly.
    const sweepBetas = () =>
      expireBetas()
        .then((n) => { if (n) console.log(`[beta] reverted ${n} expired grant(s) to free`); })
        .catch((err) => console.error('[beta] sweep failed:', err.message));
    sweepBetas();
    setInterval(sweepBetas, 60 * 60 * 1000).unref();

    app.listen(PORT, () => {
      console.log(`CardProspector serving on port ${PORT}`);
      console.log(`Static files: ${DIST_DIR}`);
    });
  });
