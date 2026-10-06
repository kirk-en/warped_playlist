# Song data: what it is and how to build a playlist from it

For every band at every Warped Tour year in `src/data/schedules/` (1995–2019, 2025 and 2026), the repo holds a small,
pre-computed, **weighted pool of up to six songs** that fit that band at that moment. The site turns a
user's band picks into a playlist by drawing songs from these pools. Everything is computed offline
from Last.fm (popularity) and MusicBrainz (release years). **The site makes no live lookups.** It only
reads the JSON files described here.

If you are building a feature that uses songs, read sections 1–4. Sections 5–7 are for maintaining
or regenerating the data.

| Path | In git? | What it is | Who reads it |
|---|---|---|---|
| `src/data/songs/<year>.json` | yes | **The product.** One file per tour year (27 files: 1995–2019, 2025, 2026) with each band's song pool. | The site |
| `data/reports/*.json` | yes | Which band-years have no pool and why, which are low confidence, which are ambiguous. | People, the validator |
| `data/bands.json` | yes | Registry of every band name with its lookup status and IDs. | The build script |
| `data/overrides.json` | yes | Manual fixes: excluded wrong-artist bands, forced MusicBrainz IDs, song-year corrections. | The build script |
| `data/reports/pilot-report.md` | yes | The 2008 pilot write-up and the four reference-band tables. | People |
| `data/cache/` | **no** (gitignored) | Every raw API response, plus one derived "facts" file per band. | The build script |
| `scripts/build-song-pools.mjs` | yes | Builds everything above. | — |
| `scripts/validate-song-pools.mjs` | yes | Checks everything above. | — |

**Never edit `src/data/songs/*.json` by hand.** They are generated. Fix the data with
`data/overrides.json` or by changing `PARAMS` in the build script, then regenerate (section 6).

---

## 1. The year file: `src/data/songs/<year>.json`

One minified JSON object per tour year. Example (2008, abbreviated):

```json
{
  "schemaVersion": 1,
  "year": 2008,
  "generatedAt": "2026-10-04",
  "params": { "classic": [100,80,60], "era": [70,55,40], "filler": [45,35,25], "step": 0.75, "cap": 3, "releasedAfterTourYears": 2 },
  "bands": {
    "Jet Lag Gemini": {
      "mbid": "25a36fc1-2f68-4989-8b2c-878b4e166294",
      "confidence": "low",
      "currentAlbum": "Fire the Cannons (2007)",
      "pool": [
        { "title": "Run This City", "year": 2007, "role": "both", "weight": 100 },
        { "title": "Bittersweet", "year": 2007, "role": "both", "weight": 80 },
        { "title": "Fit to Be Tied", "year": 2007, "role": "both", "weight": 60 },
        { "title": "Doctor, Please!", "year": 2007, "role": "filler", "weight": 45 },
        { "title": "Stepping Stone", "year": 2007, "role": "filler", "weight": 35 },
        { "title": "Just Say How", "year": 2007, "role": "filler", "weight": 25 }
      ]
    },
    "A Dream of Reality": {
      "mbid": "1af013e8-…", "confidence": "low", "currentAlbum": "It's Nothing Personal (2008)",
      "pool": [ { "title": "Saying I Love You Is So Cliche", "artist": "A Dream Of Reality", "year": 2008, "role": "both", "weight": 100 } ]
    },
    "Action Item": {
      "mbid": "c3ebe23b-…", "confidence": "low", "currentAlbum": "The Stronger The Love (2010)",
      "flags": ["released-after-tour"],
      "pool": [ { "title": "Without You", "year": 2010, "role": "both", "weight": 100 } ]
    }
  }
}
```

### Top level

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | `1` | Bump if the shape changes. |
| `year` | number | The tour year; the same as the file name. |
| `generatedAt` | `YYYY-MM-DD` | When the file was last written. |
| `params` | object | The weights used to build the pools (informational; see section 3). |
| `bands` | object | Keyed by band name, exactly as written in the schedules (see below). |

### `bands[name]`

| Field | Type | Meaning |
|---|---|---|
| `mbid` | string | The band's MusicBrainz artist ID. |
| `confidence` | `"high"` \| `"low"` | `low` means a weaker match or thin data (section 3.5). The pool is still usable. |
| `currentAlbum` | string \| `null` | `"Title (year)"` of the album whose songs are promoted for this year. `null` when no album qualified (the pool is then classics and fillers only). |
| `flags` | `["released-after-tour"]`, optional | Present only for pools built from music released after the tour (section 3.6). |
| `pool` | array of 1–6 songs | Ordered by weight, highest first. |

### `pool[i]`

| Field | Type | Meaning |
|---|---|---|
| `title` | string | Song title as MusicBrainz writes it (curly apostrophes, Unicode hyphens are kept). |
| `artist` | string, optional | Present **only when it differs** from the band key: Last.fm's canonical artist name, which can differ in spelling or case (`"A Dream Of Reality"` for the key `"A Dream of Reality"`). Use `song.artist ?? bandKey`. |
| `year` | number | The song's first release year (section 3.1). |
| `role` | `"classic"` \| `"era"` \| `"both"` \| `"filler"` | Why the song is in the pool (section 3.2). Informational; the draw uses only `weight`. |
| `weight` | number > 0 | Relative chance of being drawn. Up to two decimals. Weights are only comparable **within one pool**. |

### Keys are exact schedule strings

`bands` is keyed by the exact `band` string from `src/data/schedules/<year>/<date>.json`
(`SetTime.band` in `src/data/schedule.ts`). Look songs up with that string unchanged. Spelling variants
of one band (`"Meg & Dia"` / `"Meg and Dia"`) were looked up once, and **each spelling** that appears in
that year's schedules has its own identical entry.

### A missing band means "no songs"

If `bands[set.band]` is undefined, there is no usable song data for that band in that year. This is
common: about 40% of band-years. The site must handle it (for example a "no songs found" note next to
the band). The reason is recorded in `data/reports/no-data-bands.json`, which is build-only and not
meant to be shipped (section 5). Never fall back to another year's pool or to a guess.

---

## 2. Building a playlist

The intended flow:

1. The user picks a show (a date, so a `year`) and some sets on its schedule (`SetTime[]`).
2. Load that year's song file.
3. For each distinct band picked, find `bands[set.band]`. If it is missing, record the band as "no songs".
4. Draw **N** songs from the pool by **weighted random choice without replacement** (below).
5. Emit tracks as `{ artist: song.artist ?? set.band, title: song.title }`. The playlist export (Soundiiz)
   matches on these text strings only.

**Songs per band:** the site draws 2 per band (`SONGS_PER_BAND` in `src/pages/HomePage/HomePage.jsx`).
The pools never depend on it; a pool with fewer songs simply gives fewer.

**Weighted draw without replacement.** Pick one song with probability `weight / sum of weights still in
the pool`, remove it, repeat. A song's chance of being the single pick is its weight divided by the
pool's total weight. For Jet Lag Gemini 2008 that is 100 / 345 ≈ 29% for "Run This City".

### The code: `src/data/songs.ts`

Implemented in `src/data/songs.ts` (types, a lazy per-year loader, the draw, `buildPlaylist` and a
`formatPlaylist` helper for logging). On the board page, `InflatableBoard` reports the picked sets through
its `onPicksChange` prop, and the **Generate playlist** button in `HomePage.jsx` builds a playlist and logs
it to the browser console (the Soundiiz export comes later). The core of the module:

```ts
// src/data/songs.ts (abridged)
import type { SetTime } from './schedule';

export type SongRole = 'classic' | 'era' | 'both' | 'filler';
export type PoolSong = { title: string; artist?: string; year: number; role: SongRole; weight: number };
export type BandSongs = {
  mbid: string;
  confidence: 'high' | 'low';
  currentAlbum: string | null;
  flags?: Array<'released-after-tour'>;
  pool: PoolSong[];
};
export type YearSongs = {
  schemaVersion: 1;
  year: number;
  generatedAt: string;
  params: Record<string, unknown>;
  bands: Record<string, BandSongs>;
};

// Lazy, like the schedules: a year's file is only fetched when needed.
const songLoaders = import.meta.glob<YearSongs>('./songs/*.json', { import: 'default' });

export function loadYearSongs(year: number): Promise<YearSongs> {
  const load = songLoaders[`./songs/${year}.json`];
  if (!load) return Promise.reject(new Error(`No song data for ${year}`));
  return load();
}

/** Weighted random draw without replacement. `random` is injectable for tests. */
export function drawSongs(pool: PoolSong[], n: number, random: () => number = Math.random): PoolSong[] {
  const left = [...pool];
  const picked: PoolSong[] = [];
  while (picked.length < n && left.length > 0) {
    const total = left.reduce((sum, s) => sum + s.weight, 0);
    let r = random() * total;
    let i = 0;
    for (; i < left.length - 1; i++) {
      r -= left[i].weight;
      if (r < 0) break;
    }
    picked.push(left.splice(i, 1)[0]);
  }
  return picked;
}

export type PlaylistTrack = { band: string; artist: string; title: string; year: number };

/** Draws `perBand` songs for each distinct band picked, in the order the sets start. */
export async function buildPlaylist(year: number, chosen: SetTime[], perBand: number, random = Math.random) {
  const songs = await loadYearSongs(year);
  const ordered = [...chosen].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const tracks: PlaylistTrack[] = [];
  const noSongs: string[] = [];
  for (const band of new Set(ordered.map((set) => set.band))) {
    const entry = songs.bands[band];
    if (!entry) {
      noSongs.push(band);
      continue;
    }
    for (const song of drawSongs(entry.pool, perBand, random)) {
      tracks.push({ band, artist: song.artist ?? band, title: song.title, year: song.year });
    }
  }
  return { year, tracks, noSongs };
}
```

Notes for implementers:

- **One file per show year.** A `SetTime` has no year; take it from the selected show (`ScheduleSummary.year`).
- **Determinism.** The draw is random by design (re-rolling gives a different playlist). Pass a seeded
  `random` if you need a reproducible or shareable playlist.
- **Order:** `buildPlaylist` returns tracks in set start-time order.
- **Optional, not decided:** drawing the first song for a band from `era`/`both` songs only, to guarantee a
  song from the album the band was touring. It is a product decision; ask before doing it.
- **Do not show `weight` as a percentage of anything except its own pool.**
- **Low confidence** pools are still the best available; showing a subtle hint is a product choice.

---

## 3. What the numbers mean (how pools were built)

You do not need this to *use* the data, but it explains what you see.

### 3.1 Song years

A song's `year` is the year of the **earliest studio album or EP** it appears on (MusicBrainz release
groups of type Album or EP with no secondary type). Only the album's original edition counts: deluxe
bonus tracks, live, remix and acoustic versions, bootleg-only releases and split albums are ignored. If a
song is on no studio album (a single, soundtrack or compilation), the earliest non-live release year is
used. Years are calendar years, not dates: a September album counts for that summer's tour.

### 3.2 Pool composition (per band, per tour year)

Only songs with `year <= tour year` are eligible. Songs are ranked by **Last.fm all-time unique
listeners**.

- **Classics:** the 3 most popular eligible songs. Base weights 100, 80, 60. A band's biggest songs are
  in every year's pool.
- **Current album:** the band's latest studio album or EP released on or before the tour year that has at
  least one song in the band's Last.fm list (shown as `currentAlbum`).
- **Era songs:** up to 3 of the most popular songs on the current album whose first release year is the
  album's year (songs new on that album, not repeats from earlier records). Base weights 70, 55, 40,
  multiplied by `min(cap, 1 + step × n)`, where `n` is the number of earlier years the band played Warped
  in our schedule data. This promotes the touring album's songs more in a band's later tours.
- **Both:** a song that is a classic and an era song keeps the higher of its two weights.
- **Fillers:** if the pool has fewer than 6 songs, the next most popular eligible songs, current-album
  songs first, at base weights 45, 35, 25.

Worked example, Paramore 2008: the current album is *RIOT!* (2007), and Paramore played 2006 and 2007
before, so `n = 2` and the multiplier is `1 + 0.75 × 2 = 2.5`. "Misery Business" is the top classic (100)
and the top era song (70 × 2.5 = 175), so it is `both` at 175. "That’s What You Get" is `both` at
137.5 (55 × 2.5), "crushcrushcrush" is `era` at 100 (40 × 2.5), "Decode" is the third classic at 60, and
two *RIOT!* fillers at 45 and 35 complete the six. In a band's first Warped year the multiplier is 1, so
the classic weights win (Jet Lag Gemini 2008 above: 100, 80, 60, 45, 35, 25).

### 3.3 Pool size

Six songs when the band has at least six eligible songs with data, otherwise fewer. Across all years:
4,076 pools have 6 songs, 147 have 5, 94 have 4, 78 have 3, 71 have 2, and 298 have 1.

### 3.4 Weights are relative

Only ratios within one pool matter. `params` records the weights used (the defaults above), so a future
change can be detected; the site should not need to read it.

### 3.5 Confidence

`confidence: "low"` when any of these hold (the reasons per band-year are in
`data/reports/low-confidence-bands.json`):

- the band's top Last.fm song has fewer than 25,000 listeners (most Warped bands; the main cause);
- fewer than 70% of the band's top 20 Last.fm songs could be given a year;
- a classic's year comes from a non-studio release;
- the Last.fm and MusicBrainz artist IDs disagree (a sign of a same-name mismatch; every such band was
  reviewed by hand and wrong ones excluded);
- the pool is `released-after-tour`.

About 62% of pools are low confidence, mostly from the listener threshold. It is a data-quality signal,
not an error.

### 3.6 `released-after-tour`

If a band had released nothing by the tour year (common for openers), its pool is built from its earliest
release **if that came out at most 2 years after the tour**, flagged `released-after-tour`, and marked low
confidence. These pools are the only place where `song.year > file year` (by at most 2). Later than that,
the band-year is no-data. 284 pools carry this flag.

### 3.7 Coverage

All 7,765 band-years in the schedules (5,582 band names) are accounted for: **4,764 have a pool** and
**3,001 are no-data**.

| Year | Pools | No-data | | Year | Pools | No-data |
|---|---|---|---|---|---|---|
| 1995 | 15 | 4 | | 2007 | 282 | 166 |
| 1996 | 30 | 5 | | 2008 | 258 | 200 |
| 1997 | 40 | 11 | | 2009 | 274 | 252 |
| 1998 | 81 | 11 | | 2010 | 243 | 220 |
| 1999 | 83 | 55 | | 2011 | 226 | 239 |
| 2000 | 32 | 11 | | 2012 | 259 | 262 |
| 2001 | 115 | 73 | | 2013 | 328 | 250 |
| 2002 | 137 | 52 | | 2014 | 257 | 221 |
| 2003 | 89 | 50 | | 2015 | 246 | 179 |
| 2004 | 180 | 62 | | 2016 | 125 | 54 |
| 2005 | 174 | 67 | | 2017 | 131 | 79 |
| 2006 | 260 | 133 | | 2018 | 317 | 205 |
| | | | | 2019 | 95 | 11 |
| | | | | 2025 | 236 | 66 |
| | | | | 2026 | 252 | 62 |

No-data reasons (all years): no MusicBrainz artist 1,518; MusicBrainz artist found but no song could be
dated 790; no Last.fm match 335; nothing released by 2 years after the tour 244; ambiguous MusicBrainz
artist 47; excluded as a wrong-artist match 25; name looks like a non-band (DJ set, "w/", "/", festival) 42.

---

## 4. Rules and limits for features

- Use only `title`, `artist`, `year`, `role` and `weight`. The project stores no audio, album art or lyrics,
  and must not add them.
- Last.fm's API terms allow its data for **non-commercial use only** unless Last.fm agrees otherwise, and
  Last.fm can withdraw access. Check before the site makes money.
- Titles keep MusicBrainz punctuation (`’`, `‐`). Whether to normalize to ASCII before exporting to Soundiiz
  is an open question; if you do it, do it at export time, not in the data.
- The data is a snapshot (fetched 2026-10-03 to 2026-10-05). Popularity is all-time Last.fm listeners at
  that time; it is not refreshed.

---

## 5. Build-side files (not shipped)

### `data/reports/no-data-bands.json`

`[{ "band": "Face to Face", "year": 1995, "reason": "MusicBrainz artist found, but no song could be dated" }, …]`
One entry per band name per year with no pool. Reasons are listed in section 3.7.

### `data/reports/low-confidence-bands.json`

`[{ "band": "Deftones", "year": 1995, "reasons": ["a classic is dated from a non-studio release"], "poolSize": 6 }, …]`

### `data/reports/ambiguous-bands.json`

Bands whose MusicBrainz artist could not be chosen automatically (several same-name artists), with the
candidates (`id`, `name`, `disambiguation`, `country`, release counts). 39 bands. Each is resolved by
adding its MusicBrainz ID to `overrides.json` (section 6).

### `data/bands.json`

`{ schemaVersion, updatedAt, bands: { "<primary name>": { name, names, years, status, computeYears, lastfmName, topListeners, mbid, resolvedBy, requests, reason? } } }`.
`status` is `done`, `no-data`, `ambiguous` or `pending` (never tried). `names` lists every schedule spelling
merged into the band. `resolvedBy` says how the MusicBrainz artist was chosen (`single-match`,
`lastfm-mbid`, `release-count`, `lastfm-mbid-only`, `override`).

### `data/overrides.json`

```json
{
  "artists": {
    "<primary band name>": { "exclude": true, "reason": "wrong artist: …" },
    "<primary band name>": { "mbid": "<MusicBrainz artist ID>" },
    "<primary band name>": { "lastfmName": "<name to query on Last.fm>" },
    "<primary band name>": { "isBand": true }
  },
  "songs": {
    "<primary band name>": { "<song title>": { "year": 2008, "reason": "…" } },
    "<primary band name>": { "<song title>": { "exclude": true } }
  }
}
```

- `exclude`: the band becomes no-data (used for 22 wrong-artist matches; each has a `reason`).
- `mbid`: forces the MusicBrainz artist (use this to resolve an ambiguous band or fix a wrong match).
- `lastfmName`: queries Last.fm under another name.
- `isBand`: looks the name up even though it matches the non-band pattern (for example a real band named
  with a `/`).
- `songs.<band>.<title>.year`: corrects a song's year (examples: Paramore "Decode" is forced to 2008; State
  Champs "Stay The Night" and "Stitches" keep their 2014/2017 years instead of a 2025 anniversary re-recording EP).
  Watch for this when a returning band has a recent anniversary or re-recorded release: rule 1 prefers a
  studio release over an earlier single, so a re-recording can push a song's year later.
- `songs.<band>.<title>.exclude`: removes a song from that band's pools.

Keys are the band's **primary name** in `data/bands.json` (usually the spelling used in the most years). A new
year can add a spelling that changes the primary name ("Tillie" became "tiLLie" with 2026); the build folds the
old registry entry into the new one, and the validator fails if an override key no longer matches a primary name.

### `data/cache/` (local only, gitignored)

- `mb/`: raw MusicBrainz responses (artist search, release-group list, album track lists, recording
  searches), stored as returned.
- `lastfm/`: Last.fm `artist.getTopTracks` responses, trimmed to the fields the script uses (title,
  listeners, playcount, rank, artist name and ID).
- `facts/<band>.json`: one derived summary per band (matched IDs, albums with years and tracks, every
  Last.fm song with listeners, year, album and year source). Pools are computed from these.

Each response file is `{ key, status, fetchedAt, body }`, keyed by a hash of the request (never containing
the API key). A cached request is never re-fetched. The cache is about 500 MB and took about 11.5 hours of
rate-limited requests to build. On Kirk's machine it lives in the worktree, in the main checkout at
`H:\warped_playlist\data\cache`, and as an archive at
`H:\warped_cache\warped-song-cache-2026-10-05-with-2026.tar.gz` (the newest; older archives are alongside it).
Restore with
`tar -xzf /h/warped_cache/warped-song-cache-2026-10-05-with-2026.tar.gz -C data` from the repo root (Git Bash;
GNU tar reads `H:` as a host name, so use `/h/…`). Without it, any regeneration re-fetches from the APIs.

**Back it up regularly:** after any run that fetched from the network, sync the main-checkout copy and write a
new dated, verified archive to `H:\warped_cache`. The steps are in `AGENTS.md` ("Backing up the song-data cache").

---

## 6. Regenerating and fixing the data

Requirements: Node 22, and for any run that may fetch, a `.env` with `LASTFM_API_KEY` and `MB_CONTACT`
(the contact string for the MusicBrainz User-Agent). Set `SONG_POOLS_ENV=<path to .env>` if the `.env` is
not at the repo root. Never write either value into a committed file, log or report.

```bash
# Rebuild everything from the cache, no network (fails on a cache miss):
node scripts/build-song-pools.mjs --year 1995 --year 1996 … --year 2019 --year 2025 --year 2026 --offline

# Process one year (fetches only what is not cached):
node scripts/build-song-pools.mjs --year 2008

# Check the outputs; --complete <year> fails if any band in that year is untried:
node scripts/validate-song-pools.mjs --complete 2008
```

Other flags: `--sample <n>` (a seeded sample of n untried bands per year), `--band <name>` (one band, for
debugging), `--pilot` (the original 50-band pilot), `--batch <n>`. They are documented at the top of the
script.

**Every run ends by rebuilding the year files for all computed years from the cached facts**, so a run for
one year can never leave another year's pools stale. The validator recomputes every pool and fails on any
difference ("pool differs from a recompute" means stale files).

Common tasks:

- **Retune weights:** edit `PARAMS` at the top of `scripts/build-song-pools.mjs`, rebuild offline,
  validate, commit the year files.
- **Resolve an ambiguous band:** pick the right candidate from `ambiguous-bands.json` (check by web
  search), add `"artists": { "<band>": { "mbid": "<id>" } }`, run that band's year (a few requests), validate.
- **Fix a wrong-artist band:** add `{ "exclude": true, "reason": "…" }` (or a correct `mbid`), rebuild,
  validate.
- **Fix a song's year:** add it under `songs`, rebuild offline, validate.
- **Refresh popularity or years:** delete the relevant files under `data/cache/` and re-run (the cache is
  otherwise never refreshed).

Rate limits: MusicBrainz at most 1 request per second (the script spaces requests 1.1 s apart, retries
HTTP and network errors only, and never runs fetchers in parallel). Do not run two fetching runs at once.

The full design history (the original brief, the algorithm reference and decisions made during the runs)
is in Kirk's local `docs/briefs/`, which is not in the repo. This README is the in-repo source of truth.

---

## 7. Validation guarantees

When `node scripts/validate-song-pools.mjs` passes:

- every pool has 1–6 songs, no duplicate titles, positive weights and a valid role;
- no song's `year` is later than the file's year, except in `released-after-tour` pools (at most 2 years);
- a pool smaller than 6 only when the band has fewer eligible songs;
- each band's top 3 eligible songs are in its pool (classics are never dropped);
- every pool matches a fresh recompute from the cached facts and current `PARAMS`;
- with `--complete <year>`, every band-year in that year's schedules has a pool or a no-data entry;
- no secret appears in any file under `data/` or `src/data/songs/`.

The validator needs the local cache for the recompute check.
