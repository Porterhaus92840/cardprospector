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
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, getCards, setPop } from './db.js';

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

// Parse JSON request bodies (for the admin write endpoints)
app.use(express.json());

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

// Upsert pop data for one card. Persists to MySQL — survives refresh,
// browser changes, and deploys, and is shared across all visitors.
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
    psa10: toIntOrNull(req.body.psa10),
    psa10_30d_prior: toIntOrNull(req.body.psa10_30d_prior),
    listings_active: toIntOrNull(req.body.listings_active),
  };

  try {
    const matched = await setPop(id, pop);
    if (!matched) return res.status(404).json({ error: 'Unknown card id' });
    res.json({ ok: true, id, pop });
  } catch (err) {
    console.error('[api] POST /api/admin/pop failed:', err.message);
    res.status(500).json({ error: 'Failed to save pop data' });
  }
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
