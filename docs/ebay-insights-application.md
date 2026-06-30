# eBay Marketplace Insights API — Application Draft

Reference for when we apply for the **Marketplace Insights API** (real sold/completed
price data). This is a restricted "Limited Release" API, applied for via the
**Application Growth Check** form.

- Apply at: https://developer.ebay.com/grow/application-growth-check
- Docs: https://developer.ebay.com/api-docs/buy/static/api-insights.html
- Endpoint we'd use: `buy/marketplace_insights/v1_beta/item_sales/search`
- OAuth scope needed: `https://api.ebay.com/oauth/api_scope/buy.marketplace.insights`

## eBay's requirements vs. our status
| Requirement | Status |
|---|---|
| App **live** with usage approaching the 5,000/day default limit | ⚠️ Live, but usage tiny (~14 Browse calls/night). **This is the blocker — wait until we have real traffic.** |
| Subscribed to **Marketplace Account Deletion** notifications | ✅ Done — `GET/POST /api/ebay/marketplace-deletion`, validated |
| EPN affiliation + **publisher ID** | ✅ EPN member. Form wants the account-level **Publisher ID** (Network ID) from the EPN portal → Account/Profile — NOT the campaign id (`5339158521` is a campaign). |
| Accurate **forecasted** daily call volume | Draft below |

## Field-by-field draft

**1. Application purpose & flow + which calls it uses:**
> CardProspector (https://cardprospector.app) is a paid analytics platform for modern
> sports-card collectors. Today we use the Browse API
> (`buy/browse/v1/item_summary/search`) to show a representative image for each card and
> to generate affiliate-tracked "Find on eBay" links via our EPN campaign, driving
> qualified buyers to eBay. We're requesting the Marketplace Insights API
> (`buy/marketplace_insights/v1_beta/item_sales/search`) to display recent SOLD price
> comps for specific cards, so our price-history and flip-return analytics reflect real
> eBay sales. Read-only, server-side cached nightly, limited to the trading-card category.

**2. EPN publisher ID:** `<from EPN portal → Account/Profile>` (also reference campaign `5339158521`).

**3. Application URL:** `https://cardprospector.app`

**4. Forecasted daily volume:**
> Currently low (early launch, ~tens of calls/day). 6-month forecast ~1,000–3,000
> calls/day as the catalog grows to a few hundred cards and we add per-user sold-comp lookups.

## Recommendation / timing
**Don't apply yet.** We don't meet the usage bar, SportsCardsPro already provides solid
pricing (itself derived from eBay sold data), and a premature request just sits in eBay's
backlog. Sequence: launch → grow real Browse-API usage with subscribers → then apply with
the content above. The integration would slot into the existing nightly-cache pattern
(like prices/images); we can build it against the **sandbox** (open to all) any time to be
ready.
