# worldcup-watch-data

Match data feeds for the World Cup 2026 Garmin watch face.

## What this repo serves

Three feeds:

- **`/matches/<id>.txt`** — one tiny text file per resolved knockout match, served via GitHub Pages (~20 bytes each). **This is what v1.0.5+ watches fetch.** The watch's background service computes the next-upcoming match ID locally and pulls just that file, so the response body stays well under the Garmin background-fetch memory budget. Larger combined files (~180 bytes) were OOM'ing on small-budget devices like the Fenix 6X Pro and Forerunner 55 — hence the per-match split.
- **`matches.json`** — the legacy combined-JSON file, kept for v1.0.4 watch faces still on the old fetch path. v1.0.5+ doesn't read it. New work should target the per-match files; `matches.json` is preserved on a "do no harm" basis.
- **`status.json`** — live match phase codes (1H/2H/HT/ET/PEN/FT) served via a Cloudflare Worker that polls api-football on a cron. Hands-off — runs itself. See [`worker/README.md`](worker/README.md) for architecture, deployment, and monitoring.

## How updates flow

In steady state, you don't edit anything by hand — the data updates itself:

```
openfootball/worldcup.json
        │
        │  every 30 min (cron)
        ▼
.github/workflows/update-matches.yml
   ├─ runs scripts/build_matches.py
   ├─ regenerates matches/<id>.txt (per-match)
   └─ updates matches.json (legacy)
        │
        │  opens PR if anything changed
        ▼
Review + merge PR
        │
        │  GitHub Pages publishes
        ▼
Watch face fetches next match's .txt (within ~5 min)
```

`build_matches.py` only writes **team names** for resolved knockout matches. Group-stage entries and kickoff times in `matches.json` are passed through untouched — anything hand-added survives every regeneration.

## Per-match file format

```
<team1>|<team2>[|<kickoffEpochSec>]
```

The match ID is implicit in the filename (e.g. `matches/89.txt`), not repeated in the body. A trailing newline is included.

Examples:

```
Mexico|England
```

```
Mexico|England|1783200000
```

Team names must use the watch face's spelling (see the reference table below). Mismatched spelling means the watch can't find the team's flag.

## Manual edits (reschedules)

The build script owns team names only. If FIFA reschedules a knockout match, add a `kickoff` field (Unix epoch in seconds, UTC) to that match's entry in `matches.json` by hand:

```json
"89": { "t1": "Mexico", "t2": "England", "kickoff": 1783200000 }
```

The build script preserves the `kickoff` field on subsequent runs, and the per-match file generator picks it up automatically. To get an epoch for a date:

```
date -u -d "2026-07-05 19:00:00" +%s
```

(On macOS: `date -j -u -f "%Y-%m-%d %H:%M:%S" "2026-07-05 19:00:00" +%s`.)

## Safety net

- `matches.json` must stay **valid JSON**. If the file is broken, or one entry is malformed, the watch safely ignores it and keeps the last good copy — it never shows garbage.
- Per-match `.txt` files are validated on the watch side too: a malformed body is rejected, and that match keeps its bracket-placeholder display until the next successful fetch.
- The `check-status.yml` GitHub Action probes `status.json` every 30 minutes and fails (which emails the repo owner) if the Worker is down, the payload is malformed, or the api-football quota gets low.

## Match-number reference

The number you'd put as a key under `matches`. Group games show the actual fixture; knockout games show their bracket slot (e.g. `W74` = winner of match 74, `2A` = Group A runner-up). The build script auto-fills knockout team names once they're resolved; the table here is mostly for hand-edit reference.

### Group stage (1-72)

| # | Group | Match |
|--:|:--|:--|
| 1 | A | Mexico v South Africa |
| 2 | A | South Korea v Czechia |
| 3 | B | Canada v Bosnia |
| 4 | D | USA v Paraguay |
| 5 | C | Haiti v Scotland |
| 6 | D | Australia v Türkiye |
| 7 | C | Brazil v Morocco |
| 8 | B | Qatar v Switzerland |
| 9 | E | Ivory Coast v Ecuador |
| 10 | E | Germany v Curaçao |
| 11 | F | Netherlands v Japan |
| 12 | F | Sweden v Tunisia |
| 13 | H | Saudi Arabia v Uruguay |
| 14 | H | Spain v Cape Verde |
| 15 | G | Iran v New Zealand |
| 16 | G | Belgium v Egypt |
| 17 | I | France v Senegal |
| 18 | I | Iraq v Norway |
| 19 | J | Argentina v Algeria |
| 20 | J | Austria v Jordan |
| 21 | L | Ghana v Panama |
| 22 | L | England v Croatia |
| 23 | K | Portugal v DR Congo |
| 24 | K | Uzbekistan v Colombia |
| 25 | A | Czechia v South Africa |
| 26 | B | Switzerland v Bosnia |
| 27 | B | Canada v Qatar |
| 28 | A | Mexico v South Korea |
| 29 | C | Brazil v Haiti |
| 30 | C | Scotland v Morocco |
| 31 | D | Türkiye v Paraguay |
| 32 | D | USA v Australia |
| 33 | E | Germany v Ivory Coast |
| 34 | E | Ecuador v Curaçao |
| 35 | F | Netherlands v Sweden |
| 36 | F | Tunisia v Japan |
| 37 | H | Uruguay v Cape Verde |
| 38 | H | Spain v Saudi Arabia |
| 39 | G | Belgium v Iran |
| 40 | G | New Zealand v Egypt |
| 41 | I | Norway v Senegal |
| 42 | I | France v Iraq |
| 43 | J | Argentina v Austria |
| 44 | J | Jordan v Algeria |
| 45 | L | England v Ghana |
| 46 | L | Panama v Croatia |
| 47 | K | Portugal v Uzbekistan |
| 48 | K | Colombia v DR Congo |
| 49 | C | Scotland v Brazil |
| 50 | C | Morocco v Haiti |
| 51 | B | Switzerland v Canada |
| 52 | B | Bosnia v Qatar |
| 53 | A | Czechia v Mexico |
| 54 | A | South Africa v South Korea |
| 55 | E | Curaçao v Ivory Coast |
| 56 | E | Ecuador v Germany |
| 57 | F | Japan v Sweden |
| 58 | F | Tunisia v Netherlands |
| 59 | D | Türkiye v USA |
| 60 | D | Paraguay v Australia |
| 61 | I | Norway v France |
| 62 | I | Senegal v Iraq |
| 63 | G | Egypt v Iran |
| 64 | G | New Zealand v Belgium |
| 65 | H | Cape Verde v Saudi Arabia |
| 66 | H | Uruguay v Spain |
| 67 | L | Panama v England |
| 68 | L | Croatia v Ghana |
| 69 | J | Algeria v Austria |
| 70 | J | Jordan v Argentina |
| 71 | K | Colombia v Portugal |
| 72 | K | DR Congo v Uzbekistan |

### Knockout stage (73-104)

| # | Round | Bracket slot |
|--:|:--|:--|
| 73 | Round of 32 | 2A v 2B |
| 74 | Round of 32 | 1E v 3A/B/C/D/F |
| 75 | Round of 32 | 1F v 2C |
| 76 | Round of 32 | 1C v 2F |
| 77 | Round of 32 | 1I v 3C/D/F/G/H |
| 78 | Round of 32 | 2E v 2I |
| 79 | Round of 32 | 1A v 3C/E/F/H/I |
| 80 | Round of 32 | 1L v 3E/H/I/J/K |
| 81 | Round of 32 | 1D v 3B/E/F/I/J |
| 82 | Round of 32 | 1G v 3A/E/H/I/J |
| 83 | Round of 32 | 2K v 2L |
| 84 | Round of 32 | 1H v 2J |
| 85 | Round of 32 | 1B v 3E/F/G/I/J |
| 86 | Round of 32 | 1J v 2H |
| 87 | Round of 32 | 1K v 3D/E/I/J/L |
| 88 | Round of 32 | 2D v 2G |
| 89 | Round of 16 | W74 v W77 |
| 90 | Round of 16 | W73 v W75 |
| 91 | Round of 16 | W76 v W78 |
| 92 | Round of 16 | W79 v W80 |
| 93 | Round of 16 | W83 v W84 |
| 94 | Round of 16 | W81 v W82 |
| 95 | Round of 16 | W86 v W88 |
| 96 | Round of 16 | W85 v W87 |
| 97 | Quarter-final | W89 v W90 |
| 98 | Quarter-final | W93 v W94 |
| 99 | Quarter-final | W91 v W92 |
| 100 | Quarter-final | W95 v W96 |
| 101 | Semi-final | W97 v W98 |
| 102 | Semi-final | W99 v W100 |
| 103 | Third Place | L101 v L102 |
| 104 | Final | W101 v W102 |
