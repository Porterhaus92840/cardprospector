# CardProspector V2 — Morning Setup

## What changed

- **Engine is sport-aware.** Baseball is active; basketball Playbook is populated but the dropdown gates it behind "coming soon" until Stage 2.
- **Combined scoring.** Every card now gets `CombinedScore = PlayerSignal × ScarcityMultiplier`, normalized to 0–100. Sort order on the Scout tab is by combined score, not player signal alone.
- **Dossier view replaces the verdict view.** Each card opens to: archetype match (with the top 3 driving traits visualized), scarcity context (pop / velocity / listings), and an explicit bear case naming what would invalidate the thesis.
- **Learn tab added.** Framework explanation, trait definitions with weights, and the full Playbook on display. This is the "sell the process" surface.
- **Portfolio tab adds PSA cert verification.** Stub returns a clear mock response until you add the token.
- **Admin panel for manual pop entry.** Tap the ⚙ icon bottom-right, enter your passphrase, fill in PSA10 counts. Overrides live in localStorage.
- **eBay affiliate links wired everywhere.** Falls back to plain search until you add your EPN campaign ID.

## Three things to fill in (top of file, `CONFIG` object)

1. `EPN_CAMPAIGN_ID` — from partnernetwork.ebay.com after approval (a numeric ID)
2. `PSA_API_TOKEN` — from psacard.com/publicapi after registration (Bearer token)
3. `ADMIN_PASSPHRASE` — change from `change-me-before-launch` to something only you know

## What to register

- **eBay Partner Network** → https://partnernetwork.ebay.com → "Sign Up" top right. Approval is usually under 24 hours. Once approved, your Campaign ID is in the dashboard under Account → Campaigns.
- **PSA Public API** → https://www.psacard.com/publicapi → "Sign in or register." 100 calls/day free tier. Note: only useful for cert verification — pop data still needs manual entry via the Admin panel.

## What I'm NOT doing yet (Stage 2 work)

- Basketball Playbook activation (data is loaded, sport selector just needs unlocking once you confirm the engine math holds for hoops)
- eBay Browse API integration for live active listings counts
- User-contributed pop data (the long-game moat)
- Beehiiv/ConvertKit newsletter wiring
- Football Playbook (Stage 3 — position weighting needs rethinking)

## Integration into your existing Vite project

This file is a drop-in replacement for `CardProspector.jsx`. Same default export, same `localStorage`-only persistence, no new dependencies beyond what V1 already had (React, Tailwind). One thing to note: the storage key changed to `cardprospector:v2`, so any test portfolio data under the old V1 key won't carry over. If you have real portfolio data to migrate, ping me and I'll write a one-time migration shim.

## Where the math lives

If you want to tune anything before launch:
- `TRAIT_WEIGHTS` — per-sport trait weighting
- `SCARCITY_LADDER` — the 15-variant rarity multipliers
- `computeScarcityMultiplier` — the pop velocity → multiplier adjustment function
- `computeCombinedScore` — the normalization factor (currently `/3.20`)
