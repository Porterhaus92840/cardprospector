# CardProspector — data pipeline & provenance

Every number in the product traces to a source. All ingestion is server-side (never
in the client bundle), cached in `data_cache` (source + key + payload + fetched_at),
and uses **licensed APIs or public datasets — no scrapers** for anything user-facing.

## Live sources

| Source | Feeds | Endpoint / dataset | Cache | Status |
|---|---|---|---|---|
| **SportsCardsPro** | Prices (raw + full graded ladder), sales-volume; catalog pulls | `api/product`, `api/products` (`SCP_TOKEN`) | nightly snapshot → `price_history` | ✅ live ([pricing.js](../pricing.js), [catalog.js](../catalog.js)) |
| **eBay Browse (EPN)** | Card images, affiliate buy links | Browse API (`EBAY_*`) | per-card `image_url`, nightly refresh | ✅ live ([ebay.js](../ebay.js)) |
| **MLB Stats API** | Player team/position + recent MLB/MiLB stats → grounds AI trait suggestions | `statsapi.mlb.com/api/v1` (free) | 24h (`data_cache` source `mlb`) | ✅ live ([mlb.js](../mlb.js)) |
| **Anthropic** | AI trait/warning-signs suggestions (admin, on-click) | `api.anthropic.com` (`ANTHROPIC_API_KEY`) | none (per-click) | ✅ live |
| **PSA population** | Scarcity multiplier (manual entry) | admin console pop entry | `pop_history` snapshots | ✅ live (manual) |

## Planned (priority order)

1. **Lahman DB** (one-time import) — clean career totals to retro-populate the 24 archetype library. Public dataset.
2. **Baseball Savant / Statcast** — advanced metrics (xwOBA, stuff+, etc.) for active players → sharper trait inputs. Public CSVs.
3. **GemRate API** — population across all four graders → biggest force-multiplier for the scarcity multiplier (replaces manual PSA entry). Evaluate.
4. **PSA Cert Verification (free tier)** — user cert lookup (nice-to-have). Already stubbed in `verifyPSACert`.
5. **FanGraphs** (subscription) — deeper sabermetrics if trait scoring needs it.
6. **Baseball America** — "consensus prospect rank" as a trait input; later, once monetized.

## How stats become traits (current: "feed the AI")

`POST /api/admin/suggest-traits` → `mlb.getPlayerContext(player)` fetches live team/
position + recent stats → injected as **authoritative LIVE DATA** into the Anthropic
prompt → Claude returns team, position, 7 trait scores (0-100) + per-trait rationale +
warning signs + confidence. Team/position prefer the MLB API value. Response carries
`statsFound` so the UI shows "📊 Grounded in live MLB stats". Falls back to model
knowledge (lower confidence) when a player isn't found. Scores are then computed by the
server engine ([scoring.js](../scoring.js)); nothing scoring-related ships to the client.

**Roadmap for stats→traits:** start = feed-the-AI (done). Later = hybrid — deterministic
formulas for objective traits (position, market, longevity) + AI for judgment traits
(hof, narrative, unique, peak), every trait stamped with its source.

## Operational notes
- **Cache aggressively** — MLB 24h; extend to game-logs-permanent as needed.
- **Provenance** — `data_cache` records source + fetched_at; scoring is reproducible from stored inputs.
- **Resilience** — each source is an isolated module; one failing source degrades gracefully (AI falls back, prices keep last snapshot).
- **Watch consolidation** — Fanatics/Topps, PSA, Card Ladder ownership is fluid; keep sources swappable behind their module interface.
