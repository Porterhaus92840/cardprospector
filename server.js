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
  initDb, getCards, recordPop, setTagPrice, recordPrice, setCardImage,
  createUser, getUserByEmail, getUserById, getWatchlist, setWatch,
  setStripeCustomer, setSubscription,
  createSubmission, getMySubmissions, getPendingSubmissions, publishSubmission, rejectSubmission,
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
  return getUserById(payload.uid);
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

// Entitled = on a paid tier (trialing counts, since the webhook sets the tier).
function isEntitled(user) {
  return Boolean(user) && (user.tier === 'pro' || user.tier === 'elite');
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
  const pop = {
    total: toIntOrNull(req.body.total),
    psa10: toIntOrNull(req.body.psa10),
    psa9: toIntOrNull(req.body.psa9),
    psa8: toIntOrNull(req.body.psa8),
    psa7: toIntOrNull(req.body.psa7),
    listings_active: toIntOrNull(req.body.listings_active),
    observedOn: new Date().toISOString().slice(0, 10),
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

// Set/clear the manually-entered TAG 10 sold price for a card (SportsCardsPro
// doesn't track TAG, so this is how real TAG comps get into the model).
app.post('/api/admin/tag-price', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { id, tag10 } = req.body || {};
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing card id' });

  let val = null;
  if (tag10 !== '' && tag10 !== null && tag10 !== undefined) {
    val = Number(tag10);
    if (!Number.isFinite(val) || val < 0) return res.status(400).json({ error: 'Invalid price' });
  }
  try {
    const matched = await setTagPrice(id, val);
    if (!matched) return res.status(404).json({ error: 'Unknown card id' });
    res.json({ ok: true, id, tag10: val });
  } catch (err) {
    console.error('[api] POST /api/admin/tag-price failed:', err.message);
    res.status(500).json({ error: 'Failed to save TAG price' });
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
      subscription_data: { trial_period_days: TRIAL_DAYS },
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
    app.listen(PORT, () => {
      console.log(`CardProspector serving on port ${PORT}`);
      console.log(`Static files: ${DIST_DIR}`);
    });
  });
