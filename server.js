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
import path from 'path';
import { fileURLToPath } from 'url';
import {
  initDb, getCards, recordPop, setTagPrice,
  createUser, getUserByEmail, getUserById, getWatchlist, setWatch,
} from './db.js';
import {
  hashPassword, verifyPassword, signToken, verifyToken,
  cookieOptions, validCredentials, publicUser, SESSION_COOKIE,
} from './auth.js';

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

// All cards (player data + pop), straight from MySQL.
app.get('/api/cards', async (req, res) => {
  try {
    res.json({ cards: await getCards() });
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
