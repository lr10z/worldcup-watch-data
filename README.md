# worldcup-watch-data

Live match data for the World Cup 2026 Garmin watch face. The watch fetches `matches.json` from this repo (served over GitHub Pages) about every 5 minutes and lays it over its built-in schedule.

## The idea

The watch already has the full 104-game schedule built in. This file only carries **corrections** -- things that differ from that built-in schedule:

- A knockout team that's now decided (e.g. the "2A" placeholder is now Mexico).
- A game whose kickoff time changed (a reschedule).

Any game you don't list here just uses its built-in info. So most of the time this file is small, or even empty.

## Format

```json
{
  "version": 1,
  "updated": "2026-06-28T22:00:00Z",
  "matches": {
    "89": { "t1": "Mexico", "t2": "England" }
  }
}
```

- **`version`** -- leave it at `1`. It marks the file's *format*, not its contents. (The watch doesn't read it today; only bump it if the format itself ever changes.)
- **`updated`** -- a free-form note of when you last edited it. The watch ignores it; fill it in or don't.
- **`matches`** -- the corrections, keyed by **FIFA match number** (see the reference at the bottom). This is the part that matters.

### An entry

- **`t1`, `t2`** -- the two team names. **Required.** Use the exact spelling from the reference table (e.g. `South Korea`, `Bosnia`, `USA`).
- **`kickoff`** -- **optional.** A Unix epoch in seconds. Include it *only* if the game was **rescheduled**; leave it out and the watch keeps the built-in time.

### Examples

Fill in a resolved knockout game (time unchanged -- the usual case):

```json
"89": { "t1": "Mexico", "t2": "England" }
```

Reschedule a game (new time):

```json
"89": { "t1": "Mexico", "t2": "England", "kickoff": 1783200000 }
```

Need an epoch for a date? Use any online "epoch converter" (enter the time in **UTC**), or on a Mac:

```
date -u -d "2026-07-05 19:00:00" +%s
```

## How to edit

On GitHub: open `matches.json`, click the pencil to edit, make your change, and commit. The update reaches watches within ~5 minutes (plus a short GitHub Pages publish delay).

## Good to know

- It must stay **valid JSON**. If it's broken, or one entry is malformed, the watch safely ignores it and keeps the last good copy -- it never shows garbage.
- **Team names must match the reference exactly**, or the flag won't be found.
- Remove an entry and the watch reverts that game to its built-in placeholder/time on the next fetch.

## Match-number reference

The number you put as the key under `matches`. Knockout games show their bracket slot (e.g. `W74` = winner of match 74, `2A` = Group A runner-up); fill those in with the real teams once they're known.

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
