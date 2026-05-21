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

Writes matches.json only when the resolved set actually changes, so a scheduled
run that finds nothing new produces no diff (and so no pull request).
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


def existing_matches():
    try:
        with open(OUT_PATH, encoding="utf-8") as f:
            return json.load(f).get("matches", {})
    except (FileNotFoundError, ValueError):
        return None


def main():
    resolved = build_matches(load_openfootball())
    resolved = dict(sorted(resolved.items(), key=lambda kv: int(kv[0])))

    if resolved == existing_matches():
        print(f"No change ({len(resolved)} resolved knockout game(s)); matches.json left as is.")
        return

    payload = {
        "version": 1,
        "updated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "matches": resolved,
    }
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"Updated matches.json: {len(resolved)} resolved knockout game(s).")


if __name__ == "__main__":
    main()
