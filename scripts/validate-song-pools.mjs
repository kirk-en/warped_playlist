// Checks the outputs of scripts/build-song-pools.mjs. Makes no network requests.
// Run: node scripts/validate-song-pools.mjs [--complete <YYYY> ...]
//   --complete <YYYY>  also fail if any band in that year is still pending (use after a full year run;
//                      repeatable). Year files from the pilot hold only the pilot bands, so they are not checked.
// Exits 1 on any error and prints counts of bands, pools and report entries.
// The secret scan reads LASTFM_API_KEY and MB_CONTACT from the environment or the .env file at
// SONG_POOLS_ENV (default ./.env), and searches every file under data/ and src/data/songs/ for them.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PARAMS, computePool, loadBands, bandKey, titleKey } from './build-song-pools.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SONGS_DIR = path.join(ROOT, 'src/data/songs');
const DATA = path.join(ROOT, 'data');
const REPORTS = path.join(DATA, 'reports');
const ROLES = new Set(['classic', 'era', 'both', 'filler']);
const SONG_KEYS = new Set(['title', 'artist', 'year', 'role', 'weight']);

const complete = new Set();
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] !== '--complete') continue;
  const y = Number(process.argv[i + 1]);
  if (!(y >= 1995 && y <= 2018)) {
    console.error('--complete needs a year, e.g. --complete 2008');
    process.exit(1);
  }
  complete.add(y);
}
const errors = [];
const warnings = [];
const err = (msg) => errors.push(msg);

const readJson = async (file, fallback) => (existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : fallback);

async function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const groups = await loadBands();
const groupOf = new Map();
for (const g of groups.values()) for (const n of g.names) groupOf.set(n, g);
const registry = await readJson(path.join(DATA, 'bands.json'), null);
if (!registry) {
  console.error('data/bands.json is missing; run the build first');
  process.exit(1);
}
const overrides = await readJson(path.join(DATA, 'overrides.json'), { artists: {}, songs: {} });
const noData = await readJson(path.join(REPORTS, 'no-data-bands.json'), []);
const lowConf = await readJson(path.join(REPORTS, 'low-confidence-bands.json'), []);
const ambiguous = await readJson(path.join(REPORTS, 'ambiguous-bands.json'), []);
const noDataKey = new Set(noData.map((e) => `${e.year}|${e.band}`));
const statusOfName = (name) => registry.bands[groupOf.get(name)?.name]?.status;

// ---------- year files ----------
const yearFiles = existsSync(SONGS_DIR) ? (await readdir(SONGS_DIR)).filter((f) => /^\d{4}\.json$/.test(f)).sort() : [];
const pools = new Map();
let poolCount = 0;
let fullPools = 0;
const factsCache = new Map();
const getFacts = async (name) => {
  if (!factsCache.has(name)) factsCache.set(name, await readJson(path.join(DATA, 'cache/facts', `${bandKey(name)}.json`), null));
  return factsCache.get(name);
};

for (const f of yearFiles) {
  const year = Number(f.slice(0, 4));
  const raw = await readFile(path.join(SONGS_DIR, f), 'utf8');
  // The build writes LF; with core.autocrlf=true a checkout turns it into CRLF, which git undoes on commit.
  if (raw.includes('\r')) warnings.push(`${f}: has CR line endings in the working copy (fine if core.autocrlf is on)`);
  const doc = JSON.parse(raw);
  if (doc.schemaVersion !== 1) err(`${f}: schemaVersion is ${doc.schemaVersion}`);
  if (doc.year !== year) err(`${f}: year field is ${doc.year}`);
  pools.set(year, doc.bands);
  for (const [band, entry] of Object.entries(doc.bands)) {
    const where = `${year} ${band}`;
    const g = groupOf.get(band);
    if (!g || !g.yearsByName[band].includes(year)) err(`${where}: not a band in the ${year} schedules`);
    const pool = entry.pool ?? [];
    poolCount++;
    if (pool.length === PARAMS.poolSize) fullPools++;
    if (!pool.length || pool.length > PARAMS.poolSize) err(`${where}: pool has ${pool.length} songs`);
    const flags = entry.flags ?? [];
    for (const fl of flags) if (fl !== 'released-after-tour') err(`${where}: unknown flag ${fl}`);
    const after = flags.includes('released-after-tour');
    if (after && entry.confidence !== 'low') err(`${where}: released-after-tour pool is not low confidence`);
    // Pools flagged released-after-tour may hold songs up to PARAMS.releasedAfterTourYears after the tour.
    const latestAllowed = year + (after ? PARAMS.releasedAfterTourYears : 0);
    const keys = new Set();
    for (const s of pool) {
      for (const k of Object.keys(s)) if (!SONG_KEYS.has(k)) err(`${where}: song "${s.title}" has extra field ${k}`);
      if (typeof s.title !== 'string' || !s.title) err(`${where}: song without a title`);
      if (keys.has(titleKey(s.title))) err(`${where}: duplicate title "${s.title}"`);
      keys.add(titleKey(s.title));
      if (!(Number.isInteger(s.year) && s.year <= latestAllowed)) err(`${where}: "${s.title}" year ${s.year} is after ${latestAllowed}`);
      if (after && s.year <= year) err(`${where}: flagged released-after-tour but "${s.title}" is from ${s.year}`);
      if (!(typeof s.weight === 'number' && Number.isFinite(s.weight) && s.weight > 0)) err(`${where}: "${s.title}" weight ${s.weight}`);
      if (!ROLES.has(s.role)) err(`${where}: "${s.title}" role ${s.role}`);
    }
    if (!['high', 'low'].includes(entry.confidence)) err(`${where}: confidence ${entry.confidence}`);
    if (noDataKey.has(`${year}|${band}`)) err(`${where}: has a pool and a no-data entry`);

    // Against the cached facts: classics present, small pools only when songs ran out, file matches PARAMS.
    const facts = g ? await getFacts(g.name) : null;
    if (!facts) {
      err(`${where}: no facts file`);
      continue;
    }
    const songOv = overrides.songs?.[g.name] ?? {};
    const expected = computePool(facts, year, g.years.filter((y) => y < year).length, PARAMS, songOv);
    const asOf = expected?.asOf ?? year;
    const eligible = facts.songs
      .map((s) => (songOv[s.title]?.year ? { ...s, year: songOv[s.title].year } : s))
      .filter((s) => !songOv[s.title]?.exclude && s.year != null && s.year <= asOf);
    for (const top of eligible.slice(0, 3)) if (!keys.has(top.key)) err(`${where}: classic "${top.title}" missing from pool`);
    if (pool.length < PARAMS.poolSize && eligible.length !== pool.length) err(`${where}: pool of ${pool.length} but ${eligible.length} eligible songs`);
    const same = expected && expected.pool.length === pool.length && expected.pool.every((s, i) => s.title === pool[i].title && s.weight === pool[i].weight && s.role === pool[i].role);
    if (!same) err(`${where}: pool differs from a recompute with current PARAMS (stale file?)`);
  }
}

// ---------- coverage: every tried band-year has a pool or a no-data entry ----------
const pendingByYear = new Map();
for (const entry of Object.values(registry.bands)) {
  const g = groups.get(bandKey(entry.name) || entry.name);
  if (!g) {
    err(`registry band "${entry.name}" is not in the schedules`);
    continue;
  }
  for (const year of entry.computeYears ?? []) {
    for (const name of g.names.filter((n) => g.yearsByName[n].includes(year))) {
      if (entry.status === 'pending') {
        pendingByYear.set(year, (pendingByYear.get(year) ?? 0) + 1);
        continue;
      }
      const has = pools.get(year)?.[name];
      if (!has && !noDataKey.has(`${year}|${name}`)) err(`${year} ${name}: tried (${entry.status}) but has neither a pool nor a no-data entry`);
    }
  }
}
// Bands in a written year that were never selected for it count as pending too.
for (const [year, bands] of pools) {
  let untried = 0;
  for (const g of groups.values()) {
    if (!g.years.includes(year)) continue;
    const e = registry.bands[g.name];
    if (!e || !(e.computeYears ?? []).includes(year)) untried += g.names.filter((n) => g.yearsByName[n].includes(year)).length;
  }
  if (untried) pendingByYear.set(year, (pendingByYear.get(year) ?? 0) + untried);
  if (complete.has(year) && pendingByYear.get(year)) err(`${year}: ${pendingByYear.get(year)} band names still pending (--complete)`);
  void bands;
}
for (const e of noData) {
  const st = statusOfName(e.band);
  if (!st || st === 'pending') err(`no-data entry for ${e.year} ${e.band}, which has not been tried (status ${st})`);
}
for (const e of lowConf) if (!pools.get(e.year)?.[e.band]) err(`low-confidence entry ${e.year} ${e.band} has no pool`);
for (const e of ambiguous) if (registry.bands[e.band]?.status !== 'ambiguous') err(`ambiguous entry ${e.band} has status ${registry.bands[e.band]?.status}`);

// ---------- secrets ----------
const envFile = process.env.SONG_POOLS_ENV ?? path.join(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const secrets = [process.env.LASTFM_API_KEY, process.env.MB_CONTACT].filter((s) => s && s.length >= 6);
let scanned = 0;
if (secrets.length < 2) warnings.push('LASTFM_API_KEY or MB_CONTACT not set; secret scan incomplete');
for (const dir of [DATA, SONGS_DIR]) {
  for await (const file of walk(dir)) {
    scanned++;
    const text = await readFile(file, 'utf8');
    if (secrets.some((s) => text.includes(s))) err(`secret found in ${path.relative(ROOT, file)}`);
  }
}

// ---------- summary ----------
const statuses = {};
for (const e of Object.values(registry.bands)) statuses[e.status] = (statuses[e.status] ?? 0) + 1;
console.log(`bands in registry: ${Object.values(registry.bands).length} (${Object.entries(statuses).map(([k, v]) => `${k} ${v}`).join(', ')})`);
console.log(`year files: ${yearFiles.length}; pools: ${poolCount} (${fullPools} with ${PARAMS.poolSize} songs, ${poolCount - fullPools} smaller)`);
for (const [year, bands] of [...pools].sort(([a], [b]) => a - b)) {
  const nd = noData.filter((e) => e.year === year).length;
  console.log(`  ${year}: ${Object.keys(bands).length} pools, ${nd} no-data, ${pendingByYear.get(year) ?? 0} pending`);
}
console.log(`reports: no-data ${noData.length}, low-confidence ${lowConf.length}, ambiguous ${ambiguous.length}`);
console.log(`secret scan: ${scanned} files checked`);
for (const w of warnings) console.log(`warning: ${w}`);
if (errors.length) {
  console.log(`\n${errors.length} error(s):`);
  for (const e of errors.slice(0, 50)) console.log(`  ${e}`);
  process.exit(1);
}
console.log('OK');
