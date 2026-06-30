/**
 * CardProspector — Database layer (MySQL 8 / Percona)
 *
 * Owns the connection pool, schema creation, one-time seed migration from
 * src/data/cards.seed.json, and the read/write queries the API uses.
 *
 * Connection settings come from environment variables (see .env on the
 * server — gitignored). If the DB is unreachable, the API surfaces the error
 * and the frontend falls back to its bundled seed, so the site stays up.
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, 'src', 'data', 'cards.seed.json');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
  charset: 'utf8mb4',
  namedPlaceholders: false,
});

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS cards (
    id                   VARCHAR(64)  PRIMARY KEY,
    sport                VARCHAR(32)  NOT NULL DEFAULT 'baseball',
    player               VARCHAR(128) NOT NULL,
    team                 VARCHAR(64),
    position             VARCHAR(16),
    card_set             VARCHAR(160),
    card_number          VARCHAR(32),
    variant_id           VARCHAR(48),
    ask_price            INT,
    sportscardspro_id    VARCHAR(16)  NULL,
    tag10_price          DECIMAL(12,2) NULL,
    image_url            VARCHAR(512) NULL,
    traits               JSON         NOT NULL,
    bear_case            TEXT,
    pop_psa10            INT          NULL,
    pop_psa10_30d_prior  INT          NULL,
    pop_listings_active  INT          NULL,
    has_pop              TINYINT(1)   NOT NULL DEFAULT 0,
    sort_order           INT          NOT NULL DEFAULT 0,
    created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

const CREATE_PRICE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS price_history (
    id           BIGINT       AUTO_INCREMENT PRIMARY KEY,
    card_id      VARCHAR(64)  NOT NULL,
    source       VARCHAR(32)  NOT NULL,
    price_raw    DECIMAL(12,2) NULL,
    price_g7     DECIMAL(12,2) NULL,
    price_g8     DECIMAL(12,2) NULL,
    price_g9     DECIMAL(12,2) NULL,
    price_g95    DECIMAL(12,2) NULL,
    price_psa10  DECIMAL(12,2) NULL,
    price_bgs10  DECIMAL(12,2) NULL,
    currency     CHAR(3)      NOT NULL DEFAULT 'USD',
    sample_size  INT          NULL,
    observed_on  DATE         NOT NULL,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_card_day_source (card_id, observed_on, source),
    KEY idx_card_observed (card_id, observed_on),
    CONSTRAINT fk_price_card FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

// PSA population snapshots — one row per card per day. The full grade breakdown
// plus the PSA-reported total; lower grades are derived (total − 10/9/8/7).
// 30-day velocity is computed from these snapshots, so admins only ever enter
// today's numbers (PSA's pop report has no historical data).
const CREATE_POP_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS pop_history (
    id               BIGINT      AUTO_INCREMENT PRIMARY KEY,
    card_id          VARCHAR(64) NOT NULL,
    observed_on      DATE        NOT NULL,
    total            INT         NULL,
    psa10            INT         NULL,
    psa9             INT         NULL,
    psa8             INT         NULL,
    psa7             INT         NULL,
    listings_active  INT         NULL,
    source           VARCHAR(32) NOT NULL DEFAULT 'admin',
    created_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_pop_card_day (card_id, observed_on),
    KEY idx_pop_card_observed (card_id, observed_on),
    CONSTRAINT fk_pop_card FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

// User accounts (self-hosted auth). Subscription columns are filled in Phase 2
// (Stripe); they default to the free tier for now.
const CREATE_USERS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id                   BIGINT       AUTO_INCREMENT PRIMARY KEY,
    email                VARCHAR(255) NOT NULL UNIQUE,
    password_hash        VARCHAR(255) NOT NULL,
    tier                 VARCHAR(16)  NOT NULL DEFAULT 'free',
    stripe_customer_id   VARCHAR(64)  NULL,
    subscription_status  VARCHAR(32)  NULL,
    trial_end            DATETIME     NULL,
    created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

// User-submitted cards. They identify the card; we enrich (trait-score +
// price-map) on review, then publish into the shared `cards` table.
const CREATE_SUBMISSIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS card_submissions (
    id                 BIGINT       AUTO_INCREMENT PRIMARY KEY,
    user_id            BIGINT       NOT NULL,
    player             VARCHAR(128) NOT NULL,
    sport              VARCHAR(32)  NOT NULL DEFAULT 'baseball',
    team               VARCHAR(64),
    position           VARCHAR(16),
    card_set           VARCHAR(160),
    card_number        VARCHAR(32),
    variant_id         VARCHAR(48),
    sportscardspro_id  VARCHAR(16),
    note               TEXT,
    status             VARCHAR(16)  NOT NULL DEFAULT 'pending',
    review_note        TEXT,
    published_card_id  VARCHAR(64),
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sub_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

// Per-user private watchlist (replaces the old localStorage watchlist).
const CREATE_WATCHLIST_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS watchlists (
    user_id     BIGINT      NOT NULL,
    card_id     VARCHAR(64) NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, card_id),
    CONSTRAINT fk_watch_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_watch_card FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

/** Map a DB row to the shape the frontend already expects. */
function rowToCard(row) {
  const traits = typeof row.traits === 'string' ? JSON.parse(row.traits) : row.traits;
  return {
    id: row.id,
    sport: row.sport,
    player: row.player,
    team: row.team,
    position: row.position,
    set: row.card_set,
    cardNumber: row.card_number,
    variantId: row.variant_id,
    askPrice: row.ask_price,
    sportscardsproId: row.sportscardspro_id,
    image: row.image_url || null,
    traits,
    pop: null, // populated from pop_history in getCards
    bearCase: row.bear_case,
  };
}

/** Create the schema and seed from JSON if the table is empty. Idempotent. */
export async function initDb() {
  await pool.query(CREATE_TABLE_SQL);
  await pool.query(CREATE_PRICE_TABLE_SQL);
  await pool.query(CREATE_POP_TABLE_SQL);
  await pool.query(CREATE_USERS_TABLE_SQL);
  await pool.query(CREATE_WATCHLIST_TABLE_SQL);
  await pool.query(CREATE_SUBMISSIONS_TABLE_SQL);

  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM cards');
  if (n > 0) {
    console.log(`[db] cards table already has ${n} rows — skipping seed.`);
    return;
  }

  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (let i = 0; i < seed.length; i++) {
      const c = seed[i];
      const hasPop = c.pop ? 1 : 0;
      await conn.query(
        `INSERT INTO cards
          (id, sport, player, team, position, card_set, card_number, variant_id, ask_price,
           sportscardspro_id, traits, bear_case, pop_psa10, pop_psa10_30d_prior,
           pop_listings_active, has_pop, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          c.id, c.sport, c.player, c.team, c.position, c.set, c.cardNumber ?? null, c.variantId, c.askPrice,
          c.sportscardsproId ?? null,
          JSON.stringify(c.traits), c.bearCase,
          c.pop ? c.pop.psa10 : null,
          c.pop ? c.pop.psa10_30d_prior : null,
          c.pop ? c.pop.listings_active : null,
          hasPop, i,
        ]
      );
    }
    await conn.commit();
    console.log(`[db] seeded ${seed.length} cards from cards.seed.json.`);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Per-card price summary from price_history: latest snapshot + 30-day change.
 * Returns an object keyed by card_id. Empty until the refresh job has run.
 */
export async function getPriceSummaries() {
  const [latest] = await pool.query(`
    SELECT ph.card_id, ph.price_raw, ph.price_g7, ph.price_g8, ph.price_g9, ph.price_g95, ph.price_psa10, ph.price_bgs10, ph.currency, ph.source, ph.sample_size, ph.observed_on
      FROM price_history ph
      JOIN (SELECT card_id, MAX(observed_on) AS mx FROM price_history GROUP BY card_id) m
        ON ph.card_id = m.card_id AND ph.observed_on = m.mx
  `);
  const [prior] = await pool.query(`
    SELECT ph.card_id, ph.price_raw
      FROM price_history ph
      JOIN (
        SELECT card_id, MAX(observed_on) AS mx
          FROM price_history
         WHERE observed_on <= (CURRENT_DATE - INTERVAL 30 DAY)
         GROUP BY card_id
      ) m ON ph.card_id = m.card_id AND ph.observed_on = m.mx
  `);

  const priorMap = {};
  for (const r of prior) if (r.price_raw != null) priorMap[r.card_id] = Number(r.price_raw);

  const out = {};
  for (const r of latest) {
    const num = (v) => (v != null ? Number(v) : null);
    const raw = num(r.price_raw);
    const psa10 = num(r.price_psa10);
    const bgs10 = num(r.price_bgs10);
    const p30 = priorMap[r.card_id];
    const asOf = r.observed_on instanceof Date
      ? r.observed_on.toISOString().slice(0, 10)
      : String(r.observed_on);
    out[r.card_id] = {
      raw,
      g7: num(r.price_g7),
      g8: num(r.price_g8),
      g9: num(r.price_g9),
      g95: num(r.price_g95),
      psa10,
      bgs10,
      tag10: null, // overridden by cards.tag10_price in getCards (manual entry)
      currency: r.currency,
      source: r.source,
      sampleSize: r.sample_size,
      asOf,
      change30dRaw: raw != null && p30 ? Math.round(((raw - p30) / p30) * 1000) / 10 : null,
    };
  }
  return out;
}

/**
 * Per-card PSA population summary from pop_history: latest snapshot, derived
 * lower-grade count, gem rate (PSA 10 / total), and 30-day PSA-10 velocity
 * computed from our own snapshots. Keyed by card_id.
 */
export async function getPopSummaries() {
  const [latest] = await pool.query(`
    SELECT ph.card_id, ph.total, ph.psa10, ph.psa9, ph.psa8, ph.psa7, ph.listings_active, ph.observed_on
      FROM pop_history ph
      JOIN (SELECT card_id, MAX(observed_on) AS mx FROM pop_history GROUP BY card_id) m
        ON ph.card_id = m.card_id AND ph.observed_on = m.mx
  `);
  const [prior] = await pool.query(`
    SELECT ph.card_id, ph.psa10
      FROM pop_history ph
      JOIN (
        SELECT card_id, MAX(observed_on) AS mx
          FROM pop_history
         WHERE observed_on <= (CURRENT_DATE - INTERVAL 30 DAY)
         GROUP BY card_id
      ) m ON ph.card_id = m.card_id AND ph.observed_on = m.mx
  `);

  const priorMap = {};
  for (const r of prior) if (r.psa10 != null) priorMap[r.card_id] = Number(r.psa10);

  const out = {};
  for (const r of latest) {
    if (r.psa10 == null && r.total == null) continue;
    const graded = ['psa10', 'psa9', 'psa8', 'psa7'].reduce((s, k) => s + (r[k] || 0), 0);
    const total = r.total != null ? Number(r.total) : null;
    const psa10 = r.psa10 != null ? Number(r.psa10) : null;
    const p30 = priorMap[r.card_id];
    const asOf = r.observed_on instanceof Date ? r.observed_on.toISOString().slice(0, 10) : String(r.observed_on);
    out[r.card_id] = {
      total,
      psa10,
      psa9: r.psa9 != null ? Number(r.psa9) : null,
      psa8: r.psa8 != null ? Number(r.psa8) : null,
      psa7: r.psa7 != null ? Number(r.psa7) : null,
      lower: total != null ? Math.max(0, total - graded) : null,
      listingsActive: r.listings_active != null ? Number(r.listings_active) : null,
      gemRate: total > 0 && psa10 != null ? psa10 / total : null,
      change30dPsa10: psa10 != null && p30 ? Math.round(((psa10 - p30) / p30) * 1000) / 10 : null,
      asOf,
    };
  }
  return out;
}

/** All cards, in display order, mapped to the frontend card shape (+ price, pop). */
export async function getCards() {
  const [rows] = await pool.query('SELECT * FROM cards ORDER BY sort_order ASC, player ASC');
  const [prices, pops] = await Promise.all([getPriceSummaries(), getPopSummaries()]);
  return rows.map((r) => {
    const card = rowToCard(r);
    const tag = r.tag10_price != null ? Number(r.tag10_price) : null;
    let price = prices[r.id] || null;
    if (price) {
      price.tag10 = tag; // manual TAG price from the cards table
    } else if (tag != null) {
      price = { raw: null, g7: null, g8: null, g9: null, g95: null, psa10: null, bgs10: null, tag10: tag, currency: 'USD', source: 'manual', sampleSize: null, asOf: null, change30dRaw: null };
    }
    return { ...card, price, pop: pops[r.id] || null };
  });
}

/** Record (upsert) one daily price snapshot for a card (raw + graded ladder). */
export async function recordPrice(cardId, { source, priceRaw = null, priceG7 = null, priceG8 = null, priceG9 = null, priceG95 = null, pricePsa10 = null, priceBgs10 = null, currency = 'USD', sampleSize = null, observedOn }) {
  await pool.query(
    `INSERT INTO price_history (card_id, source, price_raw, price_g7, price_g8, price_g9, price_g95, price_psa10, price_bgs10, currency, sample_size, observed_on)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE price_raw=VALUES(price_raw), price_g7=VALUES(price_g7), price_g8=VALUES(price_g8), price_g9=VALUES(price_g9), price_g95=VALUES(price_g95), price_psa10=VALUES(price_psa10), price_bgs10=VALUES(price_bgs10), currency=VALUES(currency), sample_size=VALUES(sample_size)`,
    [cardId, source, priceRaw, priceG7, priceG8, priceG9, priceG95, pricePsa10, priceBgs10, currency, sampleSize, observedOn]
  );
}

/** Set (or clear, with null) the manually-entered TAG 10 price for a card. */
export async function setTagPrice(cardId, price) {
  const [result] = await pool.query('UPDATE cards SET tag10_price = ? WHERE id = ?', [price, cardId]);
  return result.affectedRows > 0;
}

/** Cache a card's image URL (from the eBay Browse API). */
export async function setCardImage(cardId, imageUrl) {
  await pool.query('UPDATE cards SET image_url = ? WHERE id = ?', [imageUrl, cardId]);
}

/* ============================================================================
   USERS + WATCHLIST
   ============================================================================ */

/** Create a user. Throws on duplicate email (caught by the route as 409). */
export async function createUser(email, passwordHash) {
  const [res] = await pool.query(
    'INSERT INTO users (email, password_hash) VALUES (?, ?)',
    [email.toLowerCase(), passwordHash]
  );
  return getUserById(res.insertId);
}

export async function getUserByEmail(email) {
  const [[row]] = await pool.query('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
  return row || null;
}

export async function getUserById(id) {
  const [[row]] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  return row || null;
}

/** Card ids on a user's watchlist. */
export async function getWatchlist(userId) {
  const [rows] = await pool.query('SELECT card_id FROM watchlists WHERE user_id = ?', [userId]);
  return rows.map((r) => r.card_id);
}

/** Add or remove a card from a user's watchlist. Returns the new state. */
export async function setWatch(userId, cardId, watched) {
  if (watched) {
    await pool.query('INSERT IGNORE INTO watchlists (user_id, card_id) VALUES (?, ?)', [userId, cardId]);
  } else {
    await pool.query('DELETE FROM watchlists WHERE user_id = ? AND card_id = ?', [userId, cardId]);
  }
  return watched;
}

/** Link a user to their Stripe customer. */
export async function setStripeCustomer(userId, customerId) {
  await pool.query('UPDATE users SET stripe_customer_id = ? WHERE id = ?', [customerId, userId]);
}

/** Update a user's tier/status from a Stripe subscription event (by customer). */
export async function setSubscription(stripeCustomerId, { tier, status, trialEnd }) {
  await pool.query(
    'UPDATE users SET tier = ?, subscription_status = ?, trial_end = ? WHERE stripe_customer_id = ?',
    [tier, status, trialEnd ?? null, stripeCustomerId]
  );
}

/* ============================================================================
   CARD SUBMISSIONS (submit → review → publish)
   ============================================================================ */

const slugify = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export async function createSubmission(userId, f) {
  const [res] = await pool.query(
    `INSERT INTO card_submissions
      (user_id, player, sport, team, position, card_set, card_number, variant_id, sportscardspro_id, note)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [userId, f.player, f.sport || 'baseball', f.team || null, f.position || null, f.card_set || null,
     f.card_number || null, f.variant_id || null, f.sportscardspro_id || null, f.note || null]
  );
  return getSubmissionById(res.insertId);
}

export async function getSubmissionById(id) {
  const [[row]] = await pool.query('SELECT * FROM card_submissions WHERE id = ?', [id]);
  return row || null;
}

export async function getMySubmissions(userId) {
  const [rows] = await pool.query(
    'SELECT id, player, card_set, card_number, status, review_note, published_card_id, created_at FROM card_submissions WHERE user_id = ? ORDER BY created_at DESC',
    [userId]
  );
  return rows;
}

export async function getPendingSubmissions() {
  const [rows] = await pool.query(
    `SELECT s.*, u.email AS submitter_email
       FROM card_submissions s JOIN users u ON u.id = s.user_id
      WHERE s.status = 'pending' ORDER BY s.created_at ASC`
  );
  return rows;
}

/** Publish a submission into the shared cards table (with enriched data). */
export async function publishSubmission(id, enriched) {
  const sub = await getSubmissionById(id);
  if (!sub) return null;
  const cardId = `${slugify(enriched.player || sub.player)}-s${id}`;
  await pool.query(
    `INSERT INTO cards
      (id, sport, player, team, position, card_set, card_number, variant_id, ask_price,
       sportscardspro_id, traits, bear_case, sort_order)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      cardId, enriched.sport || sub.sport, enriched.player || sub.player, enriched.team || sub.team,
      enriched.position || sub.position, enriched.card_set || sub.card_set, enriched.card_number || sub.card_number,
      enriched.variant_id || sub.variant_id, 0, enriched.sportscardspro_id || sub.sportscardspro_id || null,
      JSON.stringify(enriched.traits), enriched.bear_case || null, 1000 + Number(id),
    ]
  );
  await pool.query(
    "UPDATE card_submissions SET status = 'published', published_card_id = ? WHERE id = ?",
    [cardId, id]
  );
  return cardId;
}

export async function rejectSubmission(id, reviewNote) {
  const [r] = await pool.query(
    "UPDATE card_submissions SET status = 'rejected', review_note = ? WHERE id = ? AND status = 'pending'",
    [reviewNote || null, id]
  );
  return r.affectedRows > 0;
}

/**
 * Record (upsert) today's PSA population snapshot for a card. The admin enters
 * only current numbers; 30-day velocity is derived from accumulated snapshots.
 * Returns true if the card exists.
 */
export async function recordPop(cardId, { total = null, psa10 = null, psa9 = null, psa8 = null, psa7 = null, listings_active = null, observedOn }) {
  const [[card]] = await pool.query('SELECT id FROM cards WHERE id = ?', [cardId]);
  if (!card) return false;
  await pool.query(
    `INSERT INTO pop_history (card_id, observed_on, total, psa10, psa9, psa8, psa7, listings_active)
     VALUES (?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE total=VALUES(total), psa10=VALUES(psa10), psa9=VALUES(psa9), psa8=VALUES(psa8), psa7=VALUES(psa7), listings_active=VALUES(listings_active)`,
    [cardId, observedOn, total, psa10, psa9, psa8, psa7, listings_active]
  );
  return true;
}

export { pool };
