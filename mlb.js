/**
 * MLB Stats API data source (statsapi.mlb.com — free, official, covers MLB + MiLB).
 * Resolves a player name to their id, current team/position, and recent stats,
 * and returns a compact context blob for the AI trait-suggestion prompt.
 *
 * Cached 24h in data_cache (source 'mlb') so we never hammer the free endpoint.
 * Name → player disambiguation is best-effort (exact name match preferred, else
 * the top search result); the admin reviews the filled team/position/stats.
 */
import { getCache, setCache } from './db.js';

const BASE = 'https://statsapi.mlb.com/api/v1';
const DAY = 24 * 60 * 60 * 1000;
const SPORT_IDS = '1,11,12,13,14,16'; // MLB + AAA/AA/A+/A/Rookie
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z]/g, '');

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`MLB ${r.status}`);
  return r.json();
}

/**
 * Look up a player and summarize. Returns
 * { found, team, position, age, statsText } (statsText grounds the AI prompt).
 */
export async function getPlayerContext(name) {
  if (!name || !name.trim()) return { found: false };
  const key = norm(name);
  if (!key) return { found: false };

  const cached = await getCache('mlb', key, DAY).catch(() => null);
  if (cached) return cached;

  let result = { found: false };
  try {
    const search = await fetchJson(`${BASE}/people/search?names=${encodeURIComponent(name.trim())}`);
    const people = search.people || [];
    const match = people.find((p) => norm(p.fullName) === key) || people[0];
    if (match) {
      const id = match.id;
      const bio = await fetchJson(`${BASE}/people/${id}?hydrate=currentTeam`).then((d) => d.people?.[0]).catch(() => match);
      const posAbbr = bio.primaryPosition?.abbreviation || '';
      const isPitcher = posAbbr === 'P' || bio.primaryPosition?.type === 'Pitcher';
      const position = isPitcher ? (bio.pitchHand?.code === 'L' ? 'LHP' : 'RHP') : posAbbr;
      const group = isPitcher ? 'pitching' : 'hitting';

      const statsResp = await fetchJson(`${BASE}/people/${id}/stats?stats=yearByYear&group=${group}&sportIds=${SPORT_IDS}`).catch(() => ({}));
      const splits = statsResp.stats?.[0]?.splits || [];
      const recent = splits.slice(-3);
      const lines = recent.map((sp) => {
        const st = sp.stat || {};
        const where = `${sp.season} ${sp.league?.name || sp.team?.name || ''}`.trim();
        return isPitcher
          ? `${where}: ${st.era ?? '?'} ERA, ${st.strikeOuts ?? '?'} K in ${st.inningsPitched ?? '?'} IP, ${st.whip ?? '?'} WHIP`
          : `${where}: ${st.avg ?? '?'}/${st.obp ?? '?'}/${st.slg ?? '?'}, ${st.homeRuns ?? '?'} HR, ${st.stolenBases ?? '?'} SB`;
      });
      const team = bio.currentTeam?.name || recent[recent.length - 1]?.team?.name || '';

      result = {
        found: true,
        mlbId: id,
        isPitcher,
        team,
        position,
        age: bio.currentAge ?? null,
        statsText: `MLB Stats API — ${bio.fullName} (${position}${bio.currentAge ? `, age ${bio.currentAge}` : ''}${team ? `, ${team}` : ''}).` +
          (lines.length ? ` Recent seasons: ${lines.join(' | ')}.` : ' No pro stat lines on record (likely un-drafted/very new).'),
      };
    }
  } catch (e) {
    result = { found: false, error: e.message };
  }

  await setCache('mlb', key, result).catch(() => {});
  return result;
}
