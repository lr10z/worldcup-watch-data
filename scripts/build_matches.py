#!/usr/bin/env python3
"""
build_matches.py -- regenerate matches.json from openfootball results.

Reads the openfootball World Cup 2026 schedule, finds knockout games whose teams
have been decided, and writes them to matches.json keyed by FIFA match number.
The watch face overlays these onto its built-in bracket, turning placeholders
like "1A"/"W73" into the real teams.

Scope: knockout team resolution only. Group games and not-yet-decided knockout
games are left out (the watch keeps its built-in data). Reschedules are handled
by hand for now.

Usage:
    python3 build_matches.py                # fetch openfootball, update matches.json
    python3 build_matches.py <local.json>   # use a local openfootball file (testing)

Merges resolved knockout teams INTO the existing matches.json rather than
replacing it: hand-added entries (e.g. a kickoff reschedule typed in from a
phone) and any kickoff field are preserved, and nothing is ever deleted. Writes
only when the merged result actually changes, so a run that finds nothing new
produces no diff (and so no pull request).
"""

import datetime
import json
import sys
import urllib.request

# openfootball raw schedule. Use the "refs/heads/master" form, NOT the shorter
# ".../master/..." alias: the two are cached separately by GitHub's raw CDN, and
# on 2026-05-21 the short alias was observed serving a copy weeks out of date
# (still showing "UEFA Path D winner" after the playoffs had resolved) while this
# form was current. Grab this link from GitHub's "Raw" button rather than typing
# the short form by hand.
OPENFOOTBALL_URL = "https://raw.githubusercontent.com/openfootball/worldcup.json/refs/heads/master/2026/worldcup.json"
OUT_PATH = "matches.json"

# openfootball spelling -> the watch face's spelling (only where they differ).
# Verified complete against the 2026 group-stage rosters.
NAME_MAP = {
    "Bosnia & Herzegovina": "Bosnia",
    "Czech Republic": "Czechia",
    "Turkey": "Türkiye",
    "United States": "USA",
}

# The 48 finalists, exactly as the watch face spells them. We validate resolved
# teams against this fixed list (not openfootball's own group stage, which can
# lag — it may still show "UEFA Path D winner" where Czechia is already known).
KNOWN_TEAMS = {
    "Algeria", "Argentina", "Australia", "Austria",
    "Belgium", "Bosnia", "Brazil", "Canada",
    "Cape Verde", "Colombia", "Croatia", "Curaçao",
    "Czechia", "DR Congo", "Ecuador", "Egypt",
    "England", "France", "Germany", "Ghana",
    "Haiti", "Iran", "Iraq", "Ivory Coast",
    "Japan", "Jordan", "Mexico", "Morocco",
    "Netherlands", "New Zealand", "Norway", "Panama",
    "Paraguay", "Portugal", "Qatar", "Saudi Arabia",
    "Scotland", "Senegal", "South Africa", "South Korea",
    "Spain", "Sweden", "Switzerland", "Tunisia",
    "Türkiye", "USA", "Uruguay", "Uzbekistan",
}


def normalize(name):
    return NAME_MAP.get(name, name)


def build_matches(openfootball):
    """openfootball data -> { "<matchId>": {"t1","t2"} } for resolved knockout games."""
    out = {}
    for m in openfootball["matches"]:
        num = m.get("num")
        if num is None:
            rnd = m.get("round", "")
            if rnd == "Match for third place":
                num = 103
            elif rnd == "Final":
                num = 104
            else:
                continue  # group game -> not handled here
        t1 = normalize(m.get("team1", ""))
        t2 = normalize(m.get("team2", ""))
        if t1 in KNOWN_TEAMS and t2 in KNOWN_TEAMS:
            out[str(num)] = {"t1": t1, "t2": t2}
    return out


def load_openfootball():
    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding="utf-8") as f:
            return json.load(f)
    with urllib.request.urlopen(OPENFOOTBALL_URL) as resp:
        return json.loads(resp.read().decode("utf-8"))


def load_existing():
    """Return the whole current matches.json payload as a dict, or None if it's
    missing or unreadable. We read the full payload (not just "matches") so we
    can preserve the existing top-level "version" when we write."""
    try:
        with open(OUT_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (FileNotFoundError, ValueError):
        return None


def merge(existing, resolved):
    """Overlay resolved knockout team names onto the existing matches.

    The writer owns ONLY the team names (t1/t2) of resolved knockout games.
    Everything else in the file belongs to whoever hand-edited it (e.g. a
    kickoff reschedule typed in from a phone), so we:
      - keep every existing entry and never delete one;
      - for a resolved game, set t1/t2 but preserve any other fields already on
        that entry (notably kickoff).
    """
    merged = dict(existing)  # shallow copy keeps every hand-added entry as-is
    for mid, teams in resolved.items():
        current = merged.get(mid)
        if isinstance(current, dict):
            entry = dict(current)          # preserve kickoff & any other fields
            entry["t1"] = teams["t1"]
            entry["t2"] = teams["t2"]
            merged[mid] = entry
        else:
            merged[mid] = {"t1": teams["t1"], "t2": teams["t2"]}
    return merged


def _match_sort_key(item):
    # Numeric match ids in numeric order; anything unexpected sorts last so a
    # stray key can never crash the run.
    key = item[0]
    if isinstance(key, str) and key.isdigit():
        return (0, int(key), "")
    return (1, 0, str(key))


def main():
    resolved = build_matches(load_openfootball())

    existing = load_existing()
    have_valid_file = existing is not None and isinstance(existing.get("matches"), dict)
    existing_matches = existing["matches"] if have_valid_file else {}

    merged = dict(sorted(merge(existing_matches, resolved).items(), key=_match_sort_key))

    if have_valid_file and merged == existing_matches:
        print(f"No change ({len(resolved)} resolved knockout game(s)); matches.json left as is.")
        return

    version = existing["version"] if (existing is not None and isinstance(existing.get("version"), int)) else 1
    payload = {
        "version": version,
        "updated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "matches": merged,
    }
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"Updated matches.json: {len(resolved)} resolved knockout game(s) merged; "
          f"{len(merged)} total entr{'y' if len(merged) == 1 else 'ies'}.")


if __name__ == "__main__":
    main()
