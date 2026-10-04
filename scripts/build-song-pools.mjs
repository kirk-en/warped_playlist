// Builds a weighted pool of six songs for every band at every Warped Tour year it played.
// Brief: docs/briefs/2026-10-04-song-pools.md. Algorithm: docs/briefs/reference/song-selection-algorithm.md.
//
// Run:
//   node scripts/build-song-pools.mjs --pilot        # ~50-band pilot (see pickPilot)
//   node scripts/build-song-pools.mjs --year 2008    # every band in 2008; --year is repeatable
//
// Flags:
//   --year <YYYY>   only process bands that played that year, and only write that year's pools (repeatable)
//   --pilot         the 4 reference bands + 46 random 2008 bands + 2 off-year extras (cover band, &/and
//                   variant); computes 2008 plus every year the reference and extra bands appear
//   --band <name>   only this schedule band name (repeatable; for debugging; needs --year or --pilot years)
//   --offline       never touch the network; a cache miss fails that band (use to retune params)
//   --batch <n>     bands per batch between registry/year-file/report writes (default 10)
//   --sample <n>    with --year: only a seeded random draw of n still-pending bands per year (seed = the year),
//                   to measure cost and no-data share before a full run; re-running draws n new bands
//
// Env (from the environment, or the .env file at SONG_POOLS_ENV, default ./.env; never written anywhere):
//   LASTFM_API_KEY  Last.fm API key
//   MB_CONTACT      contact string for the MusicBrainz User-Agent
//
// Every Last.fm and MusicBrainz response is cached under data/cache/ (without the key), so a re-run makes
// no requests and pools can be recomputed after changing PARAMS. Requests are strictly sequential, at most
// one per second per service. Outputs: src/data/songs/<year>.json, data/bands.json, data/reports/*.json.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Provisional weights (reference rule 4). Changing these and re-running recomputes pools offline.
export const PARAMS = {
  classic: [100, 80, 60],
  era: [70, 55, 40],
  filler: [45, 35, 25],
  step: 0.75,
  cap: 3,
  poolSize: 6,
  // Low confidence (Kirk, 2026-10-04): any one of these flags a band-year.
  lowConfidence: { minTopListeners: 25000, minTop20Dated: 0.7, classicFallbackYear: true, idMismatch: true },
  // A band with no song out by the tour year uses its earliest release if it came at most this many years
  // later; the pool is flagged released-after-tour and low confidence (Kirk, 2026-10-03).
  releasedAfterTourYears: 2,
};

const ROOT = path.resolve(import.meta.dirname, '..');
const SCHEDULES = path.join(ROOT, 'src/data/schedules');
const SONGS_DIR = path.join(ROOT, 'src/data/songs');
const DATA = path.join(ROOT, 'data');
const CACHE = path.join(DATA, 'cache');
const FACTS = path.join(CACHE, 'facts');
const REPORTS = path.join(DATA, 'reports');
const REGISTRY = path.join(DATA, 'bands.json');
const OVERRIDES = path.join(DATA, 'overrides.json');

export const REFERENCE_BANDS = ['All Time Low', 'NOFX', 'Paramore', 'Jet Lag Gemini'];
const PILOT_EXTRAS = ['Me First and the Gimme Gimmes', 'Meg & Dia'];
const PILOT_YEAR = 2008;
const PILOT_RANDOM = 46;
const PILOT_MIN_ONE_YEAR = 15;
const PILOT_SEED = 2008;
const LASTFM_PAGE = 50;
const SEARCH_TOP = 20;
const SEARCH_CHUNK = 5;
const MIN_GAP_MS = 1100;

// ---------- names and titles ----------

export function bandKey(name) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '');
}

const VERSION_WORDS =
  'feat|ft|featuring|live|remaster|remastered|version|acoustic|demo|edit|mix|remix|radio|album|bonus|explicit|clean|mono|stereo|single|instrumental|recorded|re-recorded|unplugged|reprise';

export function titleKey(title) {
  let s = title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s.replace(/[‘’ʼ`´]/g, "'").replace(/[“”]/g, '"');
  s = s.replace(new RegExp(`\\s*[([][^)\\]]*\\b(${VERSION_WORDS})\\b[^)\\]]*[)\\]]`, 'g'), ' ');
  s = s.replace(new RegExp(`\\s+-\\s+.*\\b(${VERSION_WORDS})\\b.*$`), '');
  s = s.replace(/&/g, ' and ').replace(/'/g, '').replace(/[^a-z0-9]+/g, ' ');
  // Dropped g's ("Hangin" beside "Hanging") are a common Last.fm duplicate.
  s = s.replace(/\b([a-z]{3,})in\b/g, '$1ing');
  return s.replace(/\s+/g, '');
}

// The brief: DJ sets, "w/", "/", animation festivals and similar go to the no-data report unguessed.
const NON_BAND = [/\bdj\b/i, /\bw\//i, /\//, /animation/i, /festival/i, /\bjam session\b/i, /fashion show/i, /\bfeaturing\b/i, /largest amp/i];
export const looksLikeNonBand = (name) => NON_BAND.some((re) => re.test(name));

// ---------- io helpers ----------

const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw e;
  }
};
const writeJson = async (file, value, pretty = true) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, (pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)) + '\n');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (name) => bandKey(name) || createHash('sha1').update(name).digest('hex').slice(0, 12);
const today = () => new Date().toISOString().slice(0, 10);

// ---------- schedules ----------

export async function loadBands() {
  const byName = new Map();
  for (const y of (await readdir(SCHEDULES)).sort()) {
    if (!/^\d{4}$/.test(y)) continue;
    for (const f of await readdir(path.join(SCHEDULES, y))) {
      if (f === 'index.json' || !f.endsWith('.json')) continue;
      const day = JSON.parse(await readFile(path.join(SCHEDULES, y, f), 'utf8'));
      for (const set of day.sets ?? []) {
        if (!set.band) continue;
        if (!byName.has(set.band)) byName.set(set.band, new Set());
        byName.get(set.band).add(Number(y));
      }
    }
  }
  // Merge names that differ only by &/and, case or punctuation; each exact string stays a year-file key.
  const groups = new Map();
  for (const [name, years] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
    const key = bandKey(name) || name;
    if (!groups.has(key)) groups.set(key, { key, names: [], yearsByName: {}, years: new Set() });
    const g = groups.get(key);
    g.names.push(name);
    g.yearsByName[name] = [...years].sort();
    for (const y of years) g.years.add(y);
  }
  for (const g of groups.values()) {
    // Primary name: the variant used in the most years, then the first alphabetically.
    g.name = [...g.names].sort((a, b) => g.yearsByName[b].length - g.yearsByName[a].length)[0];
    g.years = [...g.years].sort();
  }
  return groups;
}

// ---------- fetching with cache and rate limit ----------

const net = { lastfm: 0, mb: 0, retries: 0, cacheHits: 0, mbMs: 0 };
const lastAt = { lastfm: 0, mb: 0 };
let bandCounter = null;
let OFFLINE = false;

function cacheFile(service, key) {
  const h = createHash('sha1').update(key).digest('hex');
  return path.join(CACHE, service, h.slice(0, 2), `${h}.json`);
}

// classify(res, body) -> 'ok' | 'notfound' | 'retry' | 'fatal' | 'fail'
// trim(body) shrinks what is stored (the Last.fm cache keeps only the fields this script reads).
async function cachedFetch(service, key, url, headers, classify, trim = (b) => b) {
  const file = cacheFile(service, key);
  // Per band: distinct requests needed from a cold cache (hits included), and those actually sent now.
  if (bandCounter) bandCounter.keys[service].add(key);
  if (existsSync(file)) {
    net.cacheHits++;
    return (await readJson(file)).body;
  }
  if (OFFLINE) throw new Error(`cache miss in --offline mode (${service} ${key})`);
  let pause = 2000;
  for (let attempt = 0; ; attempt++) {
    const wait = lastAt[service] + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt[service] = Date.now();
    net[service]++;
    if (bandCounter) bandCounter.sent[service]++;
    let res = null;
    let body = null;
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
      body = await res.json().catch(() => null);
    } catch {
      res = null;
    }
    if (service === 'mb') net.mbMs += Date.now() - lastAt[service];
    const verdict = res ? classify(res, body) : 'retry';
    if (verdict === 'ok' || verdict === 'notfound') {
      const stored = verdict === 'ok' ? trim(body) : null;
      await writeJson(file, { key, status: res.status, fetchedAt: new Date().toISOString(), body: stored }, false);
      return stored;
    }
    // Error messages carry the cache key, never the URL (the Last.fm URL holds the API key).
    if (verdict === 'fatal') throw Object.assign(new Error(`${service} refused the request (HTTP ${res.status}): ${key}`), { fatal: true });
    if (verdict === 'fail' || attempt >= 3) throw new Error(`${service} failed (HTTP ${res?.status ?? 'network'}) after ${attempt + 1} tries: ${key}`);
    net.retries++;
    await sleep(pause);
    pause *= 2;
  }
}

// Last.fm's terms cap stored API data at 100 MB; raw responses are mostly image and page URLs.
export function trimTopTracks(body) {
  if (!body?.toptracks) return body;
  const { artist, page, perPage, totalPages, total } = body.toptracks['@attr'] ?? {};
  return {
    toptracks: {
      '@attr': { artist, page, perPage, totalPages, total },
      track: [].concat(body.toptracks.track ?? []).map((t) => ({
        name: t.name,
        listeners: t.listeners,
        playcount: t.playcount,
        '@attr': { rank: t['@attr']?.rank },
        artist: { name: t.artist?.name, mbid: t.artist?.mbid },
      })),
    },
  };
}

function lastfm(params) {
  const key = 'lastfm?' + new URLSearchParams(params).toString();
  const url = 'https://ws.audioscrobbler.com/2.0/?' + new URLSearchParams({ ...params, api_key: process.env.LASTFM_API_KEY, format: 'json' });
  return cachedFetch('lastfm', key, url, { 'User-Agent': 'warped-playlist-song-pools/1.0', Accept: 'application/json' }, (res, body) => {
    if (body?.error === 6) return 'notfound';
    if (body?.error === 10 || body?.error === 26 || body?.error === 4) return 'fatal';
    if (res.status === 429 || res.status >= 500 || [8, 11, 16, 29].includes(body?.error)) return 'retry';
    if (!res.ok || !body || body.error) return 'fail';
    return 'ok';
  }, trimTopTracks);
}

function mb(pathAndQuery) {
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  const url = `https://musicbrainz.org/ws/2/${pathAndQuery}${sep}fmt=json`;
  const ua = `warped-playlist-song-pools/1.0 ( ${process.env.MB_CONTACT} )`;
  return cachedFetch('mb', pathAndQuery, url, { 'User-Agent': ua, Accept: 'application/json' }, (res) => {
    if (res.ok) return 'ok';
    if (res.status === 404) return 'notfound';
    if (res.status === 429 || res.status === 503 || res.status >= 500) return 'retry';
    if (res.status === 403) return 'fatal';
    return 'fail';
  });
}

// ---------- Last.fm ----------

async function lastfmPage(name, page) {
  const body = await lastfm({ method: 'artist.gettoptracks', artist: name, autocorrect: '1', limit: String(LASTFM_PAGE), page: String(page) });
  if (!body?.toptracks) return null;
  const tracks = [].concat(body.toptracks.track ?? []);
  const attr = body.toptracks['@attr'] ?? {};
  return {
    name: attr.artist ?? tracks[0]?.artist?.name ?? name,
    mbid: tracks.find((t) => t.artist?.mbid)?.artist.mbid || null,
    totalPages: Number(attr.totalPages ?? 1),
    total: Number(attr.total ?? tracks.length),
    tracks: tracks.map((t) => ({ title: t.name, listeners: Number(t.listeners ?? 0), playcount: Number(t.playcount ?? 0), rank: Number(t['@attr']?.rank ?? 0) })),
  };
}

// Merge Last.fm duplicates by normalized title, keeping the highest listener count; rank by listeners.
function mergeTracks(tracks) {
  const byKey = new Map();
  for (const t of tracks) {
    const key = titleKey(t.title);
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, { title: t.title, key, listeners: t.listeners, playcount: t.playcount, variants: [t.title] });
    else {
      if (!prev.variants.includes(t.title)) prev.variants.push(t.title);
      if (t.listeners > prev.listeners) Object.assign(prev, { title: t.title, listeners: t.listeners, playcount: t.playcount });
    }
  }
  return [...byKey.values()].sort((a, b) => b.listeners - a.listeners || a.title.localeCompare(b.title));
}

async function fetchLastfm(band, overrides) {
  const names = [overrides.artists?.[band.name]?.lastfmName, band.name, ...band.names].filter(Boolean);
  for (const name of [...new Set(names)]) {
    const p1 = await lastfmPage(name, 1);
    if (p1 && p1.tracks.length && p1.tracks.some((t) => t.listeners > 0)) return { query: name, ...p1, pages: [p1.tracks] };
  }
  return null;
}

// ---------- MusicBrainz ----------

const luceneEscape = (s) => s.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1');
const yearOf = (date) => (date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null);
const sortDate = (date) => (date ? (date + '-00-00').slice(0, 10) : '9999-99-99');
const isStudio = (rg) => ['Album', 'EP'].includes(rg['primary-type']) && !(rg['secondary-types'] ?? []).length;
const GENRE_HINT = /\b(punk|rock|emo|metal|hardcore|pop|ska|screamo|band|indie|alternative|post|grunge|hip ?hop|rap|metalcore|folk|reggae|us|american|canadian)\b/i;

async function releaseGroups(mbid) {
  const all = [];
  for (let offset = 0, count = 1; offset < count && offset < 300; offset += 100) {
    const body = await mb(`release-group?artist=${mbid}&limit=100&offset=${offset}`);
    if (!body) break;
    count = body['release-group-count'] ?? 0;
    all.push(...(body['release-groups'] ?? []));
  }
  return all;
}

async function resolveArtist(band, lf, overrides) {
  const forced = overrides.artists?.[band.name]?.mbid;
  if (forced) return { mbid: forced, how: 'override' };
  const keys = new Set([...band.names, lf.name].map(bandKey));
  const body = await mb(`artist?query=${encodeURIComponent(`artist:"${luceneEscape(lf.name)}"`)}&limit=10`);
  const cands = (body?.artists ?? []).filter(
    (a) => a.score >= 85 && (keys.has(bandKey(a.name)) || (a.aliases ?? []).some((al) => keys.has(bandKey(al.name)))),
  );
  if (!cands.length) return lf.mbid ? { mbid: lf.mbid, how: 'lastfm-mbid-only' } : null;
  if (cands.length === 1) return { mbid: cands[0].id, name: cands[0].name, how: 'single-match' };
  if (lf.mbid && cands.some((c) => c.id === lf.mbid)) return { mbid: lf.mbid, name: cands.find((c) => c.id === lf.mbid).name, how: 'lastfm-mbid' };
  // Several same-name artists: compare release counts, disambiguation text and country.
  const scored = [];
  for (const c of cands.slice(0, 3)) {
    const rgs = await releaseGroups(c.id);
    const studio = rgs.filter(isStudio).length;
    const hint = GENRE_HINT.test(c.disambiguation ?? '') ? 5 : 0;
    const country = ['US', 'CA'].includes(c.country) ? 3 : 0;
    scored.push({ id: c.id, name: c.name, disambiguation: c.disambiguation ?? '', country: c.country ?? '', releaseGroups: rgs.length, studio, score: studio + hint + country });
  }
  scored.sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  if (best.score >= 4 && best.score >= 2 * Math.max(1, next.score)) return { mbid: best.id, name: best.name, how: 'release-count', candidates: scored };
  return { ambiguous: true, candidates: scored };
}

// Live, remixed, acoustic and similar versions on an album do not make the song part of that album
// (Dirty Work ends with "Jasey Rae (live at Hot Topic)").
const ALT_VERSION = /[([][^)\]]*\b(live|remix|mix|acoustic|instrumental|karaoke|commentary|unplugged|stripped|re-?recorded)\b[^)\]]*[)\]]|\s-\s.*\b(live|remix|acoustic|instrumental)\b/i;
const isAltVersion = (t) => ALT_VERSION.test(t.title) || /\blive\b|\bremix\b|\bacoustic\b/i.test(t.recording?.disambiguation ?? '');

// Track lists: of the (up to 3) editions returned, read only the original one (earliest date, then fewest
// tracks, among editions at least half as long as the longest), to keep deluxe bonus tracks out of the album. Returns null for a release group that is not
// a studio release of this artist alone: bootleg-only "EPs", and splits credited to another artist too
// (NOFX's BYO split with Rancid lists Rancid's covers of NOFX songs).
async function trackList(rg, mbid) {
  const body = await mb(`release?release-group=${rg.id}&inc=recordings+artist-credits&limit=3`);
  const count = (r) => (r.media ?? []).reduce((n, m) => n + (m.tracks ?? []).length, 0);
  const releases = (body?.releases ?? []).filter((r) => !['Bootleg', 'Pseudo-Release'].includes(r.status) && count(r) > 0);
  if (!releases.length) return null;
  // Ignore promo/sampler editions far shorter than the album (Coaster's 2-track edition hid its other songs).
  const most = Math.max(...releases.map(count));
  const [original] = releases.filter((r) => count(r) * 2 >= most).sort((a, b) => sortDate(a.date).localeCompare(sortDate(b.date)) || count(a) - count(b));
  if ((original['artist-credit'] ?? []).some((c) => c.artist?.id && c.artist.id !== mbid)) return null;
  const tracks = new Map();
  for (const m of original.media ?? []) for (const t of m.tracks ?? []) {
    if (isAltVersion(t)) continue;
    const key = titleKey(t.title);
    if (key && !tracks.has(key)) tracks.set(key, t.title);
  }
  return [...tracks].map(([key, title]) => ({ key, title }));
}

// Fallback for top-20 songs on no studio track list: artist-ID recording search, batched a few titles per
// query. The response status is checked and retried, so a title with no hits is a real miss and is not
// searched again on its own (Kirk, 2026-10-03: those retries were 60% of requests for ~20 hits). Earliest
// non-live release wins.
// Search with the bare title: "A Love Like War (feat. Vic Fuentes)" on Last.fm is "A Love Like War" on MusicBrainz.
const searchTitle = (t) =>
  t.replace(new RegExp(`\\s*[([][^)\\]]*\\b(${VERSION_WORDS}|with)\\b[^)\\]]*[)\\]]`, 'gi'), '').replace(new RegExp(`\\s+-\\s+.*\\b(${VERSION_WORDS})\\b.*$`, 'i'), '').trim() || t;

async function searchYears(mbid, songs) {
  const found = new Map();
  const run = async (batch) => {
    const q = `arid:${mbid} AND (${batch.map((s) => `recording:"${luceneEscape(searchTitle(s.title))}"`).join(' OR ')})`;
    const recs = [];
    for (let offset = 0; offset < 200; offset += 100) {
      const body = await mb(`recording?query=${encodeURIComponent(q)}&limit=100&offset=${offset}`);
      recs.push(...(body?.recordings ?? []));
      if (!body || (body.count ?? 0) <= offset + 100) break;
    }
    for (const rec of recs) {
      const key = titleKey(rec.title);
      if (!batch.some((s) => s.key === key)) continue;
      if (isAltVersion({ title: rec.title, recording: rec })) continue;
      for (const rel of rec.releases ?? []) {
        if (rel.status === 'Bootleg') continue;
        const rg = rel['release-group'] ?? {};
        if ((rg['secondary-types'] ?? []).includes('Live')) continue;
        const y = yearOf(rel.date);
        if (!y) continue;
        const prev = found.get(key);
        const cand = { year: y, date: sortDate(rel.date), album: rel.title, studio: isStudio(rg) };
        if (!prev || cand.date < prev.date) found.set(key, cand);
      }
    }
  };
  for (let i = 0; i < songs.length; i += SEARCH_CHUNK) await run(songs.slice(i, i + SEARCH_CHUNK));
  return found;
}

// ---------- facts ----------

function dateSongs(merged, albums) {
  return merged.map((s) => {
    const album = albums.find((a) => a.keys.has(s.key));
    if (album) return { ...s, title: album.titles.get(s.key) ?? s.title, year: album.year, album: album.title, albumId: album.id, source: 'album', flagged: false };
    return { ...s, year: null, album: null, albumId: null, source: null, flagged: false };
  });
}

async function buildFacts(band, lf, overrides) {
  const facts = {
    band: band.name, names: band.names, years: band.years,
    lastfm: { query: lf.query, name: lf.name, mbid: lf.mbid, totalPages: lf.totalPages, total: lf.total, pagesRead: lf.pages.length, topListeners: Math.max(...lf.pages[0].map((t) => t.listeners)) },
  };
  const who = await resolveArtist(band, lf, overrides);
  if (!who) return { ...facts, status: 'no-data', reason: 'no MusicBrainz artist' };
  if (who.ambiguous) return { ...facts, status: 'ambiguous', candidates: who.candidates };
  facts.mbid = who.mbid;
  facts.resolvedBy = who.how;
  if (who.candidates) facts.candidates = who.candidates;

  const latest = Math.max(...band.years);
  const rgs = (await releaseGroups(who.mbid)).filter(isStudio).filter((rg) => yearOf(rg['first-release-date']) && yearOf(rg['first-release-date']) <= latest);
  rgs.sort((a, b) => sortDate(a['first-release-date']).localeCompare(sortDate(b['first-release-date'])) || (a['primary-type'] === 'Album' ? 1 : -1));
  const albums = [];
  for (const rg of rgs) {
    const tracks = await trackList(rg, who.mbid);
    if (!tracks) continue;
    albums.push({ id: rg.id, title: rg.title, type: rg['primary-type'], date: rg['first-release-date'], year: yearOf(rg['first-release-date']), keys: new Set(tracks.map((t) => t.key)), titles: new Map(tracks.map((t) => [t.key, t.title])) });
  }

  let merged = mergeTracks(lf.pages.flat());
  let songs = dateSongs(merged, albums);
  const missing = songs.slice(0, SEARCH_TOP).filter((s) => s.year == null);
  if (missing.length) {
    const found = await searchYears(who.mbid, missing);
    for (const s of songs) {
      const f = found.get(s.key);
      if (s.year == null && f) Object.assign(s, { year: f.year, album: f.album, albumId: null, source: f.studio ? 'search-studio' : 'search-other', flagged: !f.studio });
    }
  }
  // A second Last.fm page only if fewer than six songs are eligible for a year being computed.
  const eligibleIn = (y) => songs.filter((s) => s.year != null && s.year <= y).length;
  if (lf.pages.length === 1 && lf.totalPages > 1 && band.computeYears.some((y) => eligibleIn(y) < PARAMS.poolSize)) {
    const p2 = await lastfmPage(lf.query, 2);
    if (p2) {
      lf.pages.push(p2.tracks);
      facts.lastfm.pagesRead = 2;
      const searched = new Map(songs.filter((s) => s.source?.startsWith('search')).map((s) => [s.key, s]));
      merged = mergeTracks(lf.pages.flat());
      songs = dateSongs(merged, albums).map((s) => (s.year == null && searched.has(s.key) ? { ...searched.get(s.key), listeners: s.listeners, variants: s.variants } : s));
    }
  }
  const top = songs.slice(0, SEARCH_TOP);
  facts.top20Dated = top.length ? Math.round((top.filter((s) => s.year != null).length / top.length) * 100) / 100 : 0;
  facts.albums = albums.map((a) => ({ id: a.id, title: a.title, type: a.type, date: a.date, year: a.year, tracks: [...a.titles.values()], keys: [...a.keys] }));
  facts.songs = songs.map(({ title, key, listeners, year, album, albumId, source, flagged, variants }) => ({ title, key, listeners, year, album, albumId, source, flagged, ...(variants.length > 1 ? { variants } : {}) }));
  facts.status = 'done';
  return facts;
}

// ---------- pools (pure; no network) ----------

// Pool for one band-year (reference rules 1-6, with Kirk's 2026-10-03 changes):
// - the current album is the latest studio album/EP on or before the year with any song in the band's
//   Last.fm list (a later EP of unranked songs does not displace the album: NOFX's Surfer, Paramore's Singles);
// - era songs are songs on the current album whose first release year is the album's year, so a song that
//   repeats from earlier is not promoted (NOFX's "Murder the Government", 1996, is not a 1998 era song);
// - with no song out by the year, the earliest release counts if it is at most releasedAfterTourYears later.
export function computePool(facts, year, earlierYears, params, songOverrides = {}) {
  const songs = facts.songs
    .map((s) => (songOverrides[s.title]?.year ? { ...s, year: songOverrides[s.title].year, albumId: null, source: 'override', flagged: false } : s))
    .filter((s) => !songOverrides[s.title]?.exclude);
  let asOf = year;
  const flags = [];
  if (!songs.some((s) => s.year != null && s.year <= year)) {
    const first = Math.min(...songs.filter((s) => s.year != null).map((s) => s.year));
    if (!(first - year <= params.releasedAfterTourYears)) return null;
    asOf = first;
    flags.push('released-after-tour');
  }
  const eligible = songs.filter((s) => s.year != null && s.year <= asOf);
  const listed = new Set(songs.map((s) => s.key));
  const current = facts.albums.filter((a) => a.year <= asOf && a.keys.some((k) => listed.has(k))).at(-1) ?? null;
  const onCurrent = new Set(current?.keys ?? []);
  const isNew = (s) => onCurrent.has(s.key) && s.year === current.year;
  const mult = Math.min(params.cap, 1 + params.step * earlierYears);
  const pool = new Map();
  const add = (s, weight, role) => {
    const prev = pool.get(s.key);
    if (!prev) pool.set(s.key, { song: s, weight, role });
    else pool.set(s.key, { song: s, weight: Math.max(prev.weight, weight), role: prev.role === role ? role : 'both' });
  };
  eligible.slice(0, 3).forEach((s, i) => add(s, params.classic[i], 'classic'));
  eligible.filter((s) => current && isNew(s)).slice(0, 3).forEach((s, i) => add(s, params.era[i] * mult, 'era'));
  const rest = [...eligible.filter((s) => onCurrent.has(s.key)), ...eligible.filter((s) => !onCurrent.has(s.key))].filter((s) => !pool.has(s.key));
  for (let i = 0; pool.size < params.poolSize && rest.length && i < params.filler.length; i++) add(rest.shift(), params.filler[i], 'filler');

  const entries = [...pool.values()].sort((a, b) => b.weight - a.weight || b.song.listeners - a.song.listeners);
  const reasons = [];
  const lc = params.lowConfidence;
  if (flags.includes('released-after-tour')) reasons.push(`no song out by ${year}; uses its first release (${asOf})`);
  if (facts.lastfm.topListeners < lc.minTopListeners) reasons.push(`top Last.fm song has ${facts.lastfm.topListeners} listeners`);
  if (facts.top20Dated < lc.minTop20Dated) reasons.push(`only ${Math.round(facts.top20Dated * 100)}% of the Last.fm top 20 have a year`);
  if (lc.classicFallbackYear && entries.some((e) => (e.role === 'classic' || e.role === 'both') && e.song.flagged)) reasons.push('a classic is dated from a non-studio release');
  if (lc.idMismatch && facts.lastfm.mbid && facts.mbid && facts.lastfm.mbid !== facts.mbid) reasons.push('Last.fm and MusicBrainz artist IDs differ');
  return {
    confidence: reasons.length ? 'low' : 'high',
    reasons,
    flags,
    asOf,
    currentAlbum: current ? `${current.title} (${current.year})` : null,
    pool: entries.map((e) => ({ title: e.song.title, year: e.song.year, role: e.role, weight: Math.round(e.weight * 100) / 100 })),
  };
}

// ---------- pilot ----------

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickPilot(groups) {
  const special = new Set([...REFERENCE_BANDS, ...PILOT_EXTRAS].map(bandKey));
  const pool = [...groups.values()].filter((g) => g.years.includes(PILOT_YEAR) && !special.has(g.key)).sort((a, b) => a.key.localeCompare(b.key));
  const rand = mulberry32(PILOT_SEED);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked = pool.slice(0, PILOT_RANDOM);
  // Guarantee the brief's minimum of one-year bands by swapping in the next ones from the shuffle.
  const spare = pool.slice(PILOT_RANDOM).filter((g) => g.years.length === 1);
  while (picked.filter((g) => g.years.length === 1).length < PILOT_MIN_ONE_YEAR && spare.length) {
    picked.splice(picked.findLastIndex((g) => g.years.length > 1), 1, spare.shift());
  }
  const all = [...REFERENCE_BANDS, ...PILOT_EXTRAS].map((n) => groups.get(bandKey(n))).filter(Boolean);
  for (const g of all) g.computeYears = [...g.years];
  for (const g of picked) g.computeYears = [PILOT_YEAR];
  return [...all, ...picked];
}

// ---------- outputs ----------

async function loadFacts(name) {
  return readJson(path.join(FACTS, `${slug(name)}.json`), null);
}

async function writeOutputs(groups, registry, overrides, years) {
  registry.updatedAt = new Date().toISOString();
  await writeJson(REGISTRY, registry);
  const factsCache = new Map();
  const getFacts = async (name) => {
    if (!factsCache.has(name)) factsCache.set(name, await loadFacts(name));
    return factsCache.get(name);
  };
  const noData = [];
  const lowConf = [];
  const ambiguous = [];
  const pools = new Map();
  for (const entry of Object.values(registry.bands)) {
    if (entry.status === 'pending') continue;
    const g = groups.get(bandKey(entry.name) || entry.name);
    if (!g) continue;
    const facts = entry.status === 'done' || entry.status === 'ambiguous' ? await getFacts(entry.name) : null;
    if (entry.status === 'ambiguous') {
      ambiguous.push({ band: entry.name, names: entry.names, years: g.years, lastfmName: facts?.lastfm?.name ?? null, lastfmMbid: facts?.lastfm?.mbid ?? null, candidates: facts?.candidates ?? [] });
    }
    for (const year of entry.computeYears ?? []) {
      const names = g.names.filter((n) => g.yearsByName[n].includes(year));
      const result = entry.status === 'done' && facts ? computePool(facts, year, g.years.filter((y) => y < year).length, PARAMS, overrides.songs?.[entry.name]) : null;
      for (const name of names) {
        if (result) {
          if (!pools.has(year)) pools.set(year, {});
          const artist = facts.lastfm.name !== name ? facts.lastfm.name : undefined;
          pools.get(year)[name] = {
            mbid: facts.mbid,
            confidence: result.confidence,
            currentAlbum: result.currentAlbum,
            ...(result.flags.length ? { flags: result.flags } : {}),
            pool: result.pool.map((s) => (artist ? { title: s.title, artist, ...Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'title')) } : s)),
          };
          if (result.confidence === 'low') lowConf.push({ band: name, year, reasons: result.reasons, poolSize: result.pool.length });
        } else {
          const dated = facts?.songs?.some((s) => s.year != null);
          const reason = entry.status === 'done'
            ? dated ? `no release by ${year + PARAMS.releasedAfterTourYears}` : 'MusicBrainz artist found, but no song could be dated'
            : entry.status === 'ambiguous' ? 'ambiguous MusicBrainz artist (see ambiguous-bands.json)' : entry.reason;
          noData.push({ band: name, year, reason });
        }
      }
    }
  }
  const byBandYear = (a, b) => a.year - b.year || a.band.localeCompare(b.band);
  await writeJson(path.join(REPORTS, 'no-data-bands.json'), noData.sort(byBandYear));
  await writeJson(path.join(REPORTS, 'low-confidence-bands.json'), lowConf.sort(byBandYear));
  await writeJson(path.join(REPORTS, 'ambiguous-bands.json'), ambiguous.sort((a, b) => a.band.localeCompare(b.band)));
  const { lowConfidence: _lc, poolSize: _ps, ...shippedParams } = PARAMS;
  for (const year of years) {
    const bands = pools.get(year) ?? {};
    const sorted = Object.fromEntries(Object.keys(bands).sort((a, b) => a.localeCompare(b)).map((k) => [k, bands[k]]));
    await writeJson(path.join(SONGS_DIR, `${year}.json`), { schemaVersion: 1, year, generatedAt: today(), params: shippedParams, bands: sorted }, false);
  }
}

// ---------- main ----------

function parseArgs(argv) {
  const opts = { years: [], bands: [], pilot: false, offline: false, batch: 10, sample: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--year') opts.years.push(Number(argv[++i]));
    else if (a === '--band') opts.bands.push(argv[++i]);
    else if (a === '--pilot') opts.pilot = true;
    else if (a === '--offline') opts.offline = true;
    else if (a === '--batch') opts.batch = Number(argv[++i]);
    else if (a === '--sample') opts.sample = Number(argv[++i]);
    else throw new Error(`unknown flag ${a}`);
  }
  if (opts.years.some((y) => !(y >= 1995 && y <= 2018))) throw new Error('--year must be 1995 to 2018');
  if (!opts.pilot && !opts.years.length) throw new Error('pass --pilot or at least one --year');
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  OFFLINE = opts.offline;
  const envFile = process.env.SONG_POOLS_ENV ?? path.join(ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  if (!OFFLINE && (!process.env.LASTFM_API_KEY || !process.env.MB_CONTACT)) {
    throw new Error('LASTFM_API_KEY and MB_CONTACT must be set (in .env or the environment) before a networked run');
  }
  const groups = await loadBands();
  const overrides = await readJson(OVERRIDES, { artists: {}, songs: {} });
  if (!existsSync(OVERRIDES)) await writeJson(OVERRIDES, { artists: {}, songs: {} });

  let selected;
  let years;
  if (opts.pilot) {
    selected = pickPilot(groups);
    years = [...new Set([PILOT_YEAR, ...opts.years, ...selected.flatMap((g) => g.computeYears)])].sort();
  } else {
    years = [...new Set(opts.years)].sort();
    selected = [...groups.values()].filter((g) => g.years.some((y) => years.includes(y)));
    for (const g of selected) g.computeYears = g.years.filter((y) => years.includes(y));
  }
  if (opts.bands.length) {
    const keys = new Set(opts.bands.map(bandKey));
    selected = selected.filter((g) => keys.has(g.key));
  }

  // Registry: every band, keyed by its primary name; earlier runs' statuses are kept.
  const registry = await readJson(REGISTRY, { schemaVersion: 1, bands: {} });
  for (const g of groups.values()) {
    const prev = registry.bands[g.name] ?? {};
    registry.bands[g.name] = { status: 'pending', computeYears: [], ...prev, name: g.name, names: g.names, years: g.years };
  }
  if (opts.sample) {
    const picked = new Map();
    for (const y of years) {
      const pool = selected
        .filter((g) => g.years.includes(y) && registry.bands[g.name].status === 'pending' && !picked.has(g.key))
        .sort((a, b) => a.key.localeCompare(b.key));
      const rand = mulberry32(y);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      for (const g of pool.slice(0, opts.sample)) picked.set(g.key, g);
    }
    selected = [...picked.values()];
  }
  for (const g of selected) {
    const e = registry.bands[g.name];
    e.computeYears = [...new Set([...(e.computeYears ?? []), ...g.computeYears])].sort();
    g.computeYears = e.computeYears;
  }

  const started = Date.now();
  const perBand = new Map();
  const counters = (g) => {
    if (!perBand.has(g.key)) perBand.set(g.key, { keys: { lastfm: new Set(), mb: new Set() }, sent: { lastfm: 0, mb: 0 } });
    return perBand.get(g.key);
  };
  console.log(`${selected.length} bands, years ${years.join(', ')}${OFFLINE ? ' (offline)' : ''}`);

  // 1. Last.fm for every band (non-band names never reach the network).
  const lf = new Map();
  const lfOrder = [...selected].sort((a, b) => b.years.length - a.years.length || a.name.localeCompare(b.name));
  for (const g of lfOrder) {
    const e = registry.bands[g.name];
    const excluded = overrides.artists?.[g.name]?.exclude;
    if (excluded) {
      Object.assign(e, { status: 'no-data', reason: `excluded in overrides.json: ${overrides.artists[g.name].reason ?? 'wrong artist'}` });
      continue;
    }
    const force = overrides.artists?.[g.name]?.isBand;
    if (looksLikeNonBand(g.name) && !force) {
      Object.assign(e, { status: 'no-data', reason: 'name looks like a non-band (DJ, w/, /, festival); not looked up' });
      continue;
    }
    bandCounter = counters(g);
    try {
      const res = await fetchLastfm(g, overrides);
      if (!res) Object.assign(e, { status: 'no-data', reason: 'no Last.fm match', lastfmName: null });
      else {
        lf.set(g.key, res);
        e.lastfmName = res.name;
        e.topListeners = Math.max(...res.tracks.map((t) => t.listeners));
      }
    } catch (err) {
      if (err.fatal) throw err;
      e.error = err.message;
      console.warn(`  ${g.name}: ${err.message}`);
    }
  }
  bandCounter = null;
  for (const g of lfOrder) if (perBand.has(g.key)) registry.bands[g.name].requests = { lastfm: perBand.get(g.key).keys.lastfm.size, mb: 0 };
  console.log(`Last.fm: ${lf.size} matched, ${lfOrder.length - lf.size} no match / non-band / error`);

  // 2. MusicBrainz for matched bands: most tour years first, then most Last.fm listeners.
  const queue = selected.filter((g) => lf.has(g.key)).sort((a, b) => b.years.length - a.years.length || registry.bands[b.name].topListeners - registry.bands[a.name].topListeners);
  let n = 0;
  for (const g of queue) {
    const e = registry.bands[g.name];
    bandCounter = counters(g);
    const t0 = Date.now();
    try {
      const facts = await buildFacts(g, lf.get(g.key), overrides);
      facts.computeYears = e.computeYears;
      await writeJson(path.join(FACTS, `${slug(g.name)}.json`), facts);
      Object.assign(e, { status: facts.status, mbid: facts.mbid ?? null, resolvedBy: facts.resolvedBy ?? null, reason: facts.reason });
      delete e.error;
      if (facts.status !== 'no-data') delete e.reason;
    } catch (err) {
      if (err.fatal) throw err;
      e.error = err.message;
      console.warn(`  ${g.name}: ${err.message}`);
    }
    e.requests = { lastfm: bandCounter.keys.lastfm.size, mb: bandCounter.keys.mb.size };
    const sent = bandCounter.sent.mb;
    console.log(`  [${++n}/${queue.length}] ${g.name}: ${e.status}, ${e.requests.mb} MB requests (${sent} sent now${sent ? `, ${((Date.now() - t0) / 1000).toFixed(0)}s` : ''})`);
    if (n % opts.batch === 0) await writeOutputs(groups, registry, overrides, years);
  }
  bandCounter = null;
  await writeOutputs(groups, registry, overrides, years);

  const secs = (Date.now() - started) / 1000;
  console.log(`network requests: lastfm ${net.lastfm}, musicbrainz ${net.mb} (retries ${net.retries}); cache hits ${net.cacheHits}; ${secs.toFixed(0)}s`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
