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

import express from 'express';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';

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

app.listen(PORT, () => {
  console.log(`CardProspector serving on port ${PORT}`);
  console.log(`Static files: ${DIST_DIR}`);
});
