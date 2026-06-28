# CardProspector

Pattern-matched flip predictions for baseball cards.

Live at: https://cardprospector.app

## What this is

A React + Vite single-page app that reverse-engineers premium-card patterns from historical winners (Mantle, Jeter, Trout, Ohtani, Acuña, Soto) and applies them to current cheap cards to surface flip candidates. Includes a 15-variant scarcity ladder (raw → Superfractor 1/1), a portfolio tracker with P&L, and 90-day price-trend charts per player.

## Running locally

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Building for production

```bash
npm run build
```

Output goes to `dist/`. Vercel auto-detects and serves this.

## Project structure

```
cardprospector/
├── src/
│   ├── App.jsx        — the full app (single component file by design)
│   ├── main.jsx       — React entry point
│   └── index.css      — Tailwind + base styles
├── public/
│   ├── favicon.svg
│   └── robots.txt
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
└── postcss.config.js
```

## Where data comes from

Currently: hand-curated player profiles + deterministically-generated price history (seeded by player ID, shaped by trajectory).

Production: eBay Marketplace Insights API + MLB Stats API via a Node backend. See `CardProspector-Architecture.md` for the full plan.

## Deployment

Vercel: connect this repo, accept defaults, set `cardprospector.app` as a custom domain in Project Settings → Domains. Build command is auto-detected as `npm run build`.

## License

All rights reserved.
