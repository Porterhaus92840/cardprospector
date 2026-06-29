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
           traits, bear_case, pop_psa10, pop_psa10_30d_prior, pop_listings_active,
           has_pop, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          c.id, c.sport, c.player, c.team, c.position, c.set, c.variantId, c.askPrice,
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

/** All cards, in display order, mapped to the frontend card shape. */
export async function getCards() {
  const [rows] = await pool.query('SELECT * FROM cards ORDER BY sort_order ASC, player ASC');
  return rows.map(rowToCard);
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
