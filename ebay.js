/**
 * eBay Browse API — fetch a representative card image (and affiliate link) for
 * a card by searching active listings. Dormant unless EBAY_CLIENT_ID /
 * EBAY_CLIENT_SECRET are set. Uses an OAuth application token (client
 * credentials), cached until shortly before expiry.
 *
 * Env: EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_CAMPAIGN_ID (EPN, for affiliate
 * item URLs).
 */
const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const BROWSE_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';

export const ebayEnabled = () => Boolean(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);

let _token = null;
let _exp = 0;
async function getToken() {
  if (_token && Date.now() < _exp - 60_000) return _token;
  const auth = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${auth}` },
    body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope'),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('eBay token error: ' + (j.error_description || res.status));
  _token = j.access_token;
  _exp = Date.now() + (j.expires_in || 7200) * 1000;
  return _token;
}

/**
 * Top active-listing image + affiliate URL for a card query.
 * Returns { imageUrl, affiliateUrl } or null.
 */
export async function searchCardImage(query) {
  if (!ebayEnabled()) return null;
  const token = await getToken();
  const headers = { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' };
  if (process.env.EBAY_CAMPAIGN_ID) headers['X-EBAY-C-ENDUSERCTX'] = `affiliateCampaignId=${process.env.EBAY_CAMPAIGN_ID}`;

  const res = await fetch(`${BROWSE_URL}?q=${encodeURIComponent(query)}&limit=1`, { headers });
  if (!res.ok) throw new Error('eBay search HTTP ' + res.status);
  const j = await res.json();
  const it = (j.itemSummaries || [])[0];
  if (!it) return null;
  // eBay image URLs end in a size token (s-l225.jpg); request a larger render.
  const imageUrl = it.image?.imageUrl ? it.image.imageUrl.replace(/s-l\d+\.jpg/i, 's-l500.jpg') : null;
  return { imageUrl, affiliateUrl: it.itemAffiliateWebUrl || it.itemWebUrl || null };
}
