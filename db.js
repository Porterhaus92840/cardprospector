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
    variant_id           VARCHAR(48),
    ask_price            INT,
    sportscardspro_id    VARCHAR(16)  NULL,
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
    price_psa10  DECIMAL(12,2) NULL,
    currency     CHAR(3)      NOT NULL DEFAULT 'USD',
    sample_size  INT          NULL,
    observed_on  DATE         NOT NULL,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_card_day_source (card_id, observed_on, source),
    KEY idx_card_observed (card_id, observed_on),
    CONSTRAINT fk_price_card FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
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
    variantId: row.variant_id,
    askPrice: row.ask_price,
    sportscardsproId: row.sportscardspro_id,
    traits,
    pop: row.has_pop
      ? {
          psa10: row.pop_psa10,
          psa10_30d_prior: row.pop_psa10_30d_prior,
          listings_active: row.pop_listings_active,
        }
      : null,
    bearCase: row.bear_case,
  };
}

/** Create the schema and seed from JSON if the table is empty. Idempotent. */
export async function initDb() {
  await pool.query(CREATE_TABLE_SQL);
  await pool.query(CREATE_PRICE_TABLE_SQL);

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
          (id, sport, player, team, position, card_set, variant_id, ask_price,
           sportscardspro_id, traits, bear_case, pop_psa10, pop_psa10_30d_prior,
           pop_listings_active, has_pop, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          c.id, c.sport, c.player, c.team, c.position, c.set, c.variantId, c.askPrice,
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
    SELECT ph.card_id, ph.price_raw, ph.price_psa10, ph.currency, ph.source, ph.sample_size, ph.observed_on
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
    const raw = r.price_raw != null ? Number(r.price_raw) : null;
    const psa10 = r.price_psa10 != null ? Number(r.price_psa10) : null;
    const p30 = priorMap[r.card_id];
    const asOf = r.observed_on instanceof Date
      ? r.observed_on.toISOString().slice(0, 10)
      : String(r.observed_on);
    out[r.card_id] = {
      raw,
      psa10,
      currency: r.currency,
      source: r.source,
      sampleSize: r.sample_size,
      asOf,
      change30dRaw: raw != null && p30 ? Math.round(((raw - p30) / p30) * 1000) / 10 : null,
    };
  }
  return out;
}

/** All cards, in display order, mapped to the frontend card shape (+ price). */
export async function getCards() {
  const [rows] = await pool.query('SELECT * FROM cards ORDER BY sort_order ASC, player ASC');
  const prices = await getPriceSummaries();
  return rows.map((r) => ({ ...rowToCard(r), price: prices[r.id] || null }));
}

/** Record (upsert) one daily price snapshot for a card (raw + PSA 10). */
export async function recordPrice(cardId, { source, priceRaw = null, pricePsa10 = null, currency = 'USD', sampleSize = null, observedOn }) {
  await pool.query(
    `INSERT INTO price_history (card_id, source, price_raw, price_psa10, currency, sample_size, observed_on)
     VALUES (?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE price_raw=VALUES(price_raw), price_psa10=VALUES(price_psa10), currency=VALUES(currency), sample_size=VALUES(sample_size)`,
    [cardId, source, priceRaw, pricePsa10, currency, sampleSize, observedOn]
  );
}

/**
 * Upsert pop data for one card. Returns true if a card matched.
 * Pass nulls to clear pop (reverts the card to "Player signal only").
 */
export async function setPop(id, { psa10, psa10_30d_prior, listings_active }) {
  const hasPop = psa10 == null && psa10_30d_prior == null && listings_active == null ? 0 : 1;
  const [result] = await pool.query(
    `UPDATE cards
        SET pop_psa10 = ?, pop_psa10_30d_prior = ?, pop_listings_active = ?, has_pop = ?
      WHERE id = ?`,
    [psa10 ?? null, psa10_30d_prior ?? null, listings_active ?? null, hasPop, id]
  );
  return result.affectedRows > 0;
}

export { pool };
