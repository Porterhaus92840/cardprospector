/**
 * Baseball Savant (Statcast) data source — MLB's official public Statcast data,
 * pulled via the documented CSV leaderboard downloads (no scraping). Grounds AI
 * trait suggestions in batted-ball QUALITY, which raw slash lines miss:
 *   hitters  → xBA / xSLG / xwOBA + barrel% & hard-hit% (with league percentiles)
 *   pitchers → xERA + xwOBA-against + xBA/xSLG allowed
 * Percentiles are computed here across the whole leaderboard, so the AI sees
 * "94th-pct xwOBA" rather than a bare number.
 *
 * Statcast is MLB-only — minor leaguers simply won't appear, and we degrade
 * gracefully to MLB Stats API + Lahman. Cached 24h in data_cache (source
 * 'savant'), keyed by board+type+year, so one fetch serves every player lookup.
 */
import { getCache, setCache } from './db.js';

const BASE = 'https://baseballsavant.mlb.com/leaderboard';
const DAY = 24 * 60 * 60 * 1000;

// Split one CSV line, honoring double-quoted fields that contain commas
// (e.g. "Judge, Aaron"). Quotes are stripped by the caller.
function splitCsv(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// Keep only the columns we need, as a small array of plain objects.
function parseLeaderboard(board, text) {
  if (!text) return [];
  const lines = text.replace(/^﻿/, '').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = splitCsv(lines[0]).map((h) => h.trim());
  const col = Object.fromEntries(header.map((h, i) => [h, i]));
  const pick = board === 'exp'
    ? { id: 'player_id', est_ba: 'est_ba', est_slg: 'est_slg', est_woba: 'est_woba', xera: 'xera' }
    : { id: 'player_id', brl_percent: 'brl_percent', ev95percent: 'ev95percent', avg_hit_speed: 'avg_hit_speed' };
  return lines.slice(1).map((line) => {
    const f = splitCsv(line);
    const o = {};
    for (const [k, src] of Object.entries(pick)) {
      const i = col[src];
      o[k] = i == null ? null : (f[i] ?? '').trim();
    }
    return o;
  }).filter((o) => o.id);
}

async function leaderboard(board, playerType, year) {
  const key = `${board}-${playerType}-${year}`;
  const cached = await getCache('savant', key, DAY).catch(() => null);
  if (cached) return cached;
  const url = board === 'exp'
    ? `${BASE}/expected_statistics?type=${playerType}&year=${year}&position=&team=&min=1&csv=true`
    : `${BASE}/statcast?type=${playerType}&year=${year}&position=&team=&min=1&csv=true`;
  let rows = [];
  try {
    const text = await fetch(url).then((r) => (r.ok ? r.text() : ''));
    rows = parseLeaderboard(board, text);
  } catch { rows = []; }
  await setCache('savant', key, rows).catch(() => {});
  return rows;
}

// Percentile of `v` within `values`. higherBetter=false inverts (for xERA etc.).
function pct(values, v, higherBetter = true) {
  const arr = values.map(Number).filter(Number.isFinite);
  const val = Number(v);
  if (!arr.length || !Number.isFinite(val)) return null;
  const n = arr.filter((x) => (higherBetter ? x <= val : x >= val)).length;
  return Math.round((n / arr.length) * 100);
}

/**
 * Statcast profile for one player. Tries the current season, then last season.
 * Returns { found, year, statsText } — statsText is the AI-prompt line, or
 * { found:false } if the player has no MLB Statcast footprint.
 */
export async function getStatcast({ mlbId, isPitcher } = {}) {
  if (!mlbId) return { found: false };
  const id = String(mlbId);
  const playerType = isPitcher ? 'pitcher' : 'batter';
  const thisYear = new Date().getFullYear();
  for (const year of [thisYear, thisYear - 1]) {
    const exp = await leaderboard('exp', playerType, year);
    const row = exp.find((r) => r.id === id);
    if (!row) continue;

    if (isPitcher) {
      const xeraPct = pct(exp.map((r) => r.xera), row.xera, false);
      const wobaPct = pct(exp.map((r) => r.est_woba), row.est_woba, false);
      return {
        found: true,
        year,
        statsText: `Baseball Savant (Statcast, ${year}): ${row.xera} xERA` +
          (xeraPct != null ? ` (${xeraPct}th pct of MLB)` : '') +
          `, ${row.est_woba} xwOBA-against` + (wobaPct != null ? ` (${wobaPct}th pct)` : '') +
          `. Allowed ${row.est_ba} xBA / ${row.est_slg} xSLG.`,
      };
    }

    const ev = await leaderboard('ev', playerType, year);
    const evRow = ev.find((r) => r.id === id) || {};
    const wobaPct = pct(exp.map((r) => r.est_woba), row.est_woba, true);
    const parts = [`${row.est_ba} xBA, ${row.est_slg} xSLG, ${row.est_woba} xwOBA` +
      (wobaPct != null ? ` (${wobaPct}th pct of MLB)` : '')];
    if (evRow.brl_percent) {
      const brlPct = pct(ev.map((r) => r.brl_percent), evRow.brl_percent, true);
      parts.push(`${evRow.brl_percent}% barrels` + (brlPct != null ? ` (${brlPct}th pct)` : '') +
        `, ${evRow.ev95percent}% hard-hit, ${evRow.avg_hit_speed} mph avg exit velo`);
    }
    return { found: true, year, statsText: `Baseball Savant (Statcast, ${year}): ${parts.join('. ')}.` };
  }
  return { found: false };
}
