# Song pools: pilot report (2026-10-03, updated after Kirk's pilot decisions)

Run: `node scripts/build-song-pools.mjs --pilot`. Brief: `docs/briefs/2026-10-04-song-pools.md` ("Settled decisions" 1–10 are applied).
Pilot set: the 4 reference bands, 46 random 2008 bands (seed 2008; 32 of them one-year bands), and 2 off-year extras approved by Kirk: Me First and the Gimme Gimmes (cover band, 2001/2003) and Meg & Dia / Meg and Dia (`&`/`and` variant, 2006/2007/2009).

The tables below are the **working reference** (they replace the hand-made tables in `docs/briefs/reference/song-selection-algorithm.md`).

## Numbers

| Measure | Value |
|---|---|
| Bands attempted | 52 (50 matched on Last.fm, 2 did not; 5 more excluded as wrong-artist matches in `data/overrides.json`) |
| 2008 band names in the pilot | 49: **27 pools** (22 six-song, 5 smaller), **22 no-data** |
| ...of the 27 pools | 5 are `released-after-tour` (first release 2009–2010), all low confidence |
| All pilot band-years | 75: 53 pools (48 six-song, 5 smaller), 22 no-data |
| Ambiguous queue | 0 |
| Low-confidence entries | 24 |
| MusicBrainz requests per band | **5.0** average over the 41 random bands kept (max 11, Anberlin); NOFX 31, All Time Low 15, Paramore 9 |
| Time per request | about 1.1 s (measured: 731 s for 665 requests) |
| Cache | Re-running makes 0 Last.fm and 0 MusicBrainz requests |
| Params change | `cap` 3→2, rebuilt with `--offline`: All Time Low 2011 Time-Bomb went from 210 to 140, with no requests |
| Validator, lint, build | `node scripts/validate-song-pools.mjs` exits 0; `npm run lint` and `npm run build` pass |

**Projection** (no zero-hit retries; about 5 MusicBrainz plus about 1.3 Last.fm requests per band, at 1.1 s each): the rest of 2008 (409 bands) takes **about 45–50 minutes**. All years (about 5,150 remaining bands) take about 9–10 hours.

**Last.fm API vs tracks page:** All Time Low's top 50 from `artist.getTopTracks` matched the `?date_preset=ALL` tracks page exactly (same order and listener counts).

## 2008 no-data (22)

| Reason | Bands |
|---|---|
| No Last.fm match (2) | Flowington & Thievezworth, For Word Cause |
| No MusicBrainz artist (9) | Awesome And The Ass Kickers, Del Asher, Echoes of Us, Gentlemen Prefer Blondes, Last Try, Remember Tomorrow, Something for Nothing, The Recovering, Time of Plague |
| MusicBrainz artist found, but no song could be dated (5) | Bidwell, Cerebral Vortex, Ivens, One Night Band, Village Idiot |
| No release by 2010 (1) | Breva (first release 2011) |
| Excluded as wrong-artist matches (5) | Culture Shock, Dodger, Skip, Stay, The Host |

Released-after-tour pools (5): Box the Stars (2009, 1 song), Crookedhook (2009, 5 songs), Tonight the Prom (2009), Longway (2010, 1 song), The Fast Track (2010).

## Reference bands (single-pick %, our output; the hand-made reference is in brackets where it differs)

**NOFX**

| Song | 1996 | 1998 | 2000 | 2002 | 2004 | 2006 | 2009 |
|---|---|---|---|---|---|---|---|
| Linoleum (1994) | 24 | 19 | 17 (15) | 15 (14) | 14 | 14 | 19 |
| Don't Call Me White (1994) | 20 | 15 | 13 (12) | 12 (11) | 11 | 11 | 15 |
| Bob (1992) | 15 | 11 | 10 (9) | 9 (8) | 8 | 8 | 11 |
| Murder the Government (1996) | 17 | – | – | – | – | – | – |
| I'm Telling Tim (1996) | 13 | – | – | – | – | – | – |
| Leave It Alone (1994) | 11 | – | 8 (–) | 7 (–) | – | – | 8 |
| All Outta Angst (1997) | – | 23 | – | – | – | – | – |
| It's My Job to Keep Punk Rock Elite (1997) | – | 18 | – | – | – | – | – |
| Eat the Meek (1997) | – | 13 | – | – | – | – | – |
| Dinosaurs Will Die (2000) | – | – | 29 (27) | 32 (29) | – | – | 7 |
| Bottles to the Ground (2000) | – | – | 23 (21) | 25 (22) | – | – | – |
| Thank God It's Monday (2000) | – | – | – (15) | – (16) | – | – | – |
| Franco Un-American (2003) | – | – | – | – | 29 | – | – |
| The Separation of Church and Skate (2003) | – | – | – | – | 22 | – | – |
| Idiots Are Taking Over (2003) | – | – | – | – | 16 | – | – |
| Seeing Double at the Triple Rock (2006) | – | – | – | – | – | 29 | – |
| The Man I Killed (2006) | – | – | – | – | – | 22 | – |
| Leaving Jesusland (2006) | – | – | – | – | – | 16 | – |
| We Called It America (2009) | – | – | – | – | – | – | 40 |
| *current album* | Fuck the Kids EP | So Long and Thanks for All the Shoes | Bottles to the Ground EP | Bottles to the Ground EP | The War on Errorism | Wolves in Wolves' Clothing | Coaster |

**Paramore**

| Song | 2006 | 2007 | 2008 | 2009 | 2011 |
|---|---|---|---|---|---|
| Pressure (2005) | 29 | – | – | – | – |
| Emergency (2005) | 23 | – | – | – | – |
| Conspiracy (2005) | 17 | – | – | – | – |
| My Heart (2005) | 13 | – | – | – | – |
| Brighter (2005) | 10 | – | – | – | – |
| All We Know (2005) | 7 | – | – | – | – |
| Misery Business (2007) | – | 31 | 32 | 15 | 15 |
| That's What You Get (2007) | – | 24 | 25 | – | – |
| crushcrushcrush (2007) | – | 18 | 18 | – | – |
| When It Rains (2007) | – | 11 | 8 | – | – |
| Let the Flames Begin (2007) | – | 9 | 6 | – | – |
| Fences (2007) | – | 6 | – | – | – |
| Decode (2008, override) | – | – | 11 | 7 (–) | 7 (–) |
| The Only Exception (2009) | – | – | – | 31 | 31 |
| All I Wanted (2009) | – | – | – | 24 | 24 |
| Ignorance (2009) | – | – | – | 18 | 18 |
| Brick by Boring Brick (2009) | – | – | – | 5 (7) | 5 (7) |
| Playing God (2009) | – | – | – | – (5) | – (5) |
| *current album* | All We Know Is Falling | RIOT! | RIOT! | Brand New Eyes | Brand New Eyes |

**All Time Low**

| Song | 2006 | 2007 | 2008 | 2009 | 2011 | 2012 | 2018 |
|---|---|---|---|---|---|---|---|
| Coffee Shop Soundtrack (2006) | 29 | – | – | – | – | – | – |
| Jasey Rae (2006) | 23 | – | – | – | – | – | – |
| The Party Scene (2005) | 17 | – | – | – | – | – | – |
| Running from Lions (2005) | 13 | – | – | – | – | – | – |
| Lullabies (2005) | 10 | – | – | – | – | – | – |
| Break Out! Break Out! (2005) | 7 | – | – | – | – | – | – |
| Dear Maria, Count Me In (2007) | – | 31 | 34 | 14 | 15 (14) | 14 | 14 |
| Remembering Sunday (2007) | – | 24 | 27 | 9 | 9 (8) | 8 | 8 |
| Six Feet Under the Stars (2007) | – | 18 | 19 | – | 7 (–) | – | – |
| Poppin' Champagne (2007) | – | 11 | 9 | – | – | – | – |
| Shameless (2007) | – | 9 | 7 | – | – | – | – |
| The Beach (2007) | – | 6 | 5 | – | – | – | – |
| Weightless (2009) | – | – | – | 30 | 12 (11) | 11 | 11 |
| Break Your Little Heart (2009) | – | – | – | 24 | – | – | – |
| Lost in Stereo (2009) | – | – | – | 17 | – | – | – |
| Therapy (2009) | – | – | – | 6 | – | – | – |
| Time-Bomb (2011) | – | – | – | – | 32 (29) | – | – |
| I Feel Like Dancin' (2011) | – | – | – | – | 25 (22) | – | – |
| Merry Christmas, Kiss My Ass | – | – | – | – | – (16) | – | – |
| Backseat Serenade (2012) | – | – | – | – | – | 29 | – |
| Somewhere in Neverland (2012) | – | – | – | – | – | 22 | – |
| The Reckless and the Brave (2012) | – | – | – | – | – | 16 | – |
| Kids in the Dark (2015) | – | – | – | – | – | – | 29 (–) |
| Something's Gotta Give (2015) | – | – | – | – | – | – | 22 (–) |
| Missing You (2015) | – | – | – | – | – | – | 16 (–) |
| Dirty Laundry / Good Times / Drugs & Candy (2017) | – | – | – | – | – | – | – (29 / 22 / 16) |
| *current album* | Put Up or Shut Up | So Wrong, It's Right | So Wrong, It's Right | Nothing Personal | Dirty Work | Don't Panic | Future Hearts |

**Jet Lag Gemini**: 2008 is 29/23/17/13/10/7 and 2009 is 31/24/18/11/9/6, identical to the reference. Both years are low confidence.

**Acceptance checks:** all pass.
- NOFX: Linoleum leads 1996; All Outta Angst leads 1998; Dinosaurs Will Die leads 2000 and 2002; Linoleum and Don't Call Me White are in every pool.
- Paramore: Pressure leads 2006; Misery Business leads 2007 and 2008; The Only Exception leads 2009 and 2011.
- All Time Low: Dear Maria leads 2007; Weightless leads 2009; "Remembering Sunday" is dated 2007; "Painting Flowers" is in no pool; "Dear Maria" is 2007, not 2024.
- Jet Lag Gemini: both pools exist and are low confidence.

## Remaining differences from the hand-made tables (real data, not forced)

1. **NOFX 2000 and 2002:** "Thank God It's Monday" is out and "Leave It Alone" is a filler instead. The *Bottles to the Ground* EP (2000-11-21) is the latest 2000 release with Last.fm songs, so it is the current album, and "Thank God It's Monday" is only on *Pump Up the Valuum* (May 2000). Leaders are unchanged. Dinosaurs Will Die and Bottles to the Ground are 2–3 points higher.
2. **Paramore 2009 and 2011:** "Decode" (2008 by override) fills the fifth slot instead of "Playing God". Fillers take current-album songs first, and MusicBrainz lists Decode on every *Brand New Eyes* edition. The override fixes its year but not its album membership. 2 points.
3. **All Time Low 2011:** "Merry Christmas, Kiss My Ass" ranks below #50 on Last.fm. Only page 1 is read, so it is absent. "Six Feet Under the Stars" fills instead, and the era songs are 3 points higher.
4. **All Time Low 2018:** no *Last Young Renegade* (2017) song is in Last.fm's top 50, so that album is skipped and *Future Hearts* (2015) is the current album. The 2017 songs would need Last.fm page 2, which the one-page rule only reads when fewer than six songs are eligible.
5. **Reference corrections (Kirk):** Paramore 2006 no longer has "Hallelujah" (2007), and All Time Low 2012 no longer has "A Love Like War" (2013). The tables above use the real dates.

## Spot checks (reviewer sub-agent, web sources)

- **Wrong artist, now excluded:** Skip, Stay, Culture Shock (and The Host and Dodger, per Kirk).
- **Correct:** Sirah, Dr. Madd Vibe, Hunter Revenge, The Johnstones, Midnight to Twelve, Melodramus, Sick City, Callahan, Hired Geeks, Shapes of Racecars.
- Titles keep MusicBrainz punctuation (curly apostrophes, U+2010 hyphen in "Time‐Bomb"). Still open: whether to convert them to ASCII for Soundiiz.

## Lookup fixes made during the pilot (scripts only)

- Read only the album's original edition: earliest date, then fewest tracks, among editions at least half as long as the longest.
- Skip bootleg-only release groups, and splits credited to another artist (the track-list request adds `inc=artist-credits`).
- Ignore live, remix, acoustic and similar tracks.
- Search with the bare title ("A Love Like War", not "... (feat. Vic Fuentes)").
- Batch fallback searches 5 titles per artist-ID query. A zero-hit result is final.
