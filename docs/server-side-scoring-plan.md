# Server-side scoring — plan to protect the engine IP

**Status:** planned (not started). Chosen 2026-06-30 as the follow-up to softening the
Learn "Playbook" section. The Learn UI no longer prints raw archetype trait numbers, but
**the entire scoring engine still ships in the client JS bundle** and `/api/cards` still
sends each card's raw 7 traits. This doc is the plan to actually close that gap.

## The problem

CardProspector is a client-side React app. Today, everything a competitor would need to
clone the model is downloadable from any browser:

- `src/App.jsx` bundle contains `PLAYBOOKS` (24 archetypes + their trait scores +
  `outcomeValue`), `TRAIT_WEIGHTS`, `ARCHETYPE_TAU`, `traitDistance`, `findBestComp`,
  `computeCombinedScore`, `computeScarcityMultiplier`, `computeFlip`,
  `computeRecommendation`, `computeHorizon`, and the flip cost constants in `CONFIG`.
- `GET /api/cards` returns each card's raw `traits` object (see `rowToCard` in db.js).

So hiding the numbers in the Learn tab is cosmetic. Real protection = compute scores on
the server and never send the raw ingredients to the client.

## Goal

The browser receives **only computed outputs** it needs to render — never the archetypes,
weights, formulas, or per-card raw traits. A scraper of `/api/cards` should get scores and
display fields, not the recipe.

## What moves to the server

Port these from `src/App.jsx` into a new server module (e.g. `scoring.js`, plain JS, no
React), keeping the math identical:

- Data: `PLAYBOOKS`, `TRAIT_WEIGHTS`, `SCARCITY_LADDER`, `ARCHETYPE_TAU`, `GRADE_ROWS`,
  and the flip/threshold constants (`BUY_DISCOUNT`, `GRADING_COST`, `EBAY_FEE_RATE`,
  `EBAY_PER_ORDER_FEE`, `MIN_FLIP_RETURN`, `MIN_CARD_YEAR`).
- Functions: `traitDistance`, `archetypeBand`, `findBestComp`, `computePlayerSignal`,
  `computeScarcityMultiplier`, `computeCombinedScore`, `computeFlip`,
  `computeRecommendation`, `computeHorizon`.

## API changes

`GET /api/cards` computes a `score` block per card server-side and **omits `traits`** from
the payload for non-admins:

```
card.score = {
  combined, playerSignal,
  comp: { name, era, band, similarity },   // enough for the dossier "archetype match"
  drivers: [{ key, cardVal, archVal }],     // the shared-strength bars (values only)
  scarcity: { multiplier, popVelocity, hasRealData },
  horizon: { key, label, range, blurb },
  flip,                                      // already gated to entitled users
  recommendation,                            // { recommended, reason }
}
```

- Keep the existing `price` stripping for non-entitled users; `flip`/`recommendation`
  ride along with entitlement (they need prices anyway).
- Admin requests (valid `x-admin-token`) still get raw `traits` so the Control Console
  Edit-traits / Create-card screens keep working.

## Client changes

- `src/App.jsx` deletes the engine functions + `PLAYBOOKS`/weights and reads `card.score.*`
  instead of computing. Components (`ScoutTab`, `DossierView`, `PortfolioTab`) render from
  the server block. `TRAIT_BLURBS` and the seven-trait explainer can stay (they're generic
  education, not the formula).
- The admin screens keep the trait editors (admin still receives `traits`).
- `computeHoldSignal` (portfolio) becomes a thin read of `card.score` (horizon + flip
  recommendation) rather than recomputing.

## Effort / risk

- ~Medium. The math is already written; porting is mechanical. Main work is threading the
  `score` block through the components that currently call the engine directly, and keeping
  admin (raw traits) vs. public (scores only) payloads correct.
- Risk: a subtle behavior drift between the ported server math and the old client math —
  mitigate by keeping the functions byte-identical and spot-checking a few cards' scores
  against the current output before/after.
- Nightly jobs (price/image refresh) are unaffected.

## Not in scope (yet)

- Obfuscating the display fields themselves (names/eras of comps are shown in the dossier
  by design — that's user-facing value, not the formula).
- Rate-limiting / anti-scraping on `/api/cards` (separate hardening task).
