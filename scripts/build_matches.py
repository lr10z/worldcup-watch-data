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

# Compact pipe-delimited mirror of matches.json. The watch face's background
# fetch parses this with HTTP_RESPONSE_CONTENT_TYPE_TEXT_PLAIN instead of JSON
# to avoid Garmin's JSON parser blowing the background memory budget (-403
# NETWORK_RESPONSE_OUT_OF_MEMORY) on memory-constrained devices.
# Format: one match per line, "<matchId>|<t1>|<t2>[|<kickoffEpochSec>]".
TEXT_OUT_PATH = "matches.txt"

# openfootball spelling -> the watch face's spelling (only where they differ).
# Verified complete against the 2026 group-stage rosters.
NAME_MAP = {
    "Bosnia & Herzegovina": "Bosnia",
    "Czech Republic": "Czechia",
    "Turkey": "Türkiye",
    "United States": "USA",
}

# Watch face team name -> FIFA 3-letter country code. matches.txt emits the
# codes (10-12 bytes/line) instead of full names (20-30 bytes/line) so the
# Garmin background fetch buffer fits within the tight memory budget on
# small-budget devices (Fenix 6X Pro: 313-byte matches.txt was returning
# -403 NETWORK_RESPONSE_OUT_OF_MEMORY; the codes-only version is ~180 bytes).
# The watch face's MatchupsCodeMap maps codes back to full names at parse
# time, in MAIN where memory is plentiful.
TEAM_CODE = {
    "Algeria": "ALG", "Argentina": "ARG", "Australia": "AUS", "Austria": "AUT",
    "Belgium": "BEL", "Bosnia": "BIH", "Brazil": "BRA", "Canada": "CAN",
    "Cape Verde": "CPV", "Colombia": "COL", "Croatia": "CRO", "Curaçao": "CUW",
    "Czechia": "CZE", "DR Congo": "COD", "Ecuador": "ECU", "Egypt": "EGY",
    "England": "ENG", "France": "FRA", "Germany": "GER", "Ghana": "GHA",
    "Haiti": "HAI", "Iran": "IRN", "Iraq": "IRQ", "Ivory Coast": "CIV",
    "Japan": "JPN", "Jordan": "JOR", "Mexico": "MEX", "Morocco": "MAR",
    "Netherlands": "NED", "New Zealand": "NZL", "Norway": "NOR", "Panama": "PAN",
    "Paraguay": "PAR", "Portugal": "POR", "Qatar": "QAT", "Saudi Arabia": "KSA",
    "Scotland": "SCO", "Senegal": "SEN", "South Africa": "RSA", "South Korea": "KOR",
    "Spain": "ESP", "Sweden": "SWE", "Switzerland": "SUI", "Tunisia": "TUN",
    "Türkiye": "TUR", "USA": "USA", "Uruguay": "URU", "Uzbekistan": "UZB",
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
        # matches.json is unchanged, but always regenerate matches.txt — its
        # FORMAT can change (e.g. switching from full team names to FIFA codes)
        # while the underlying data stays the same. If the regenerated bytes
        # match the existing matches.txt, git will see no diff and no PR will
        # open. If the format changed, the diff appears here and the PR fires.
        write_text(merged, TEXT_OUT_PATH)
        print(f"No data change ({len(resolved)} resolved knockout game(s)); matches.json untouched, matches.txt regenerated.")
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

    # Mirror the same payload to a compact pipe-delimited file for the watch
    # face's memory-constrained background fetch (see TEXT_OUT_PATH note above).
    write_text(merged, TEXT_OUT_PATH)

    print(f"Updated matches.json + matches.txt: {len(resolved)} resolved knockout game(s) merged; "
          f"{len(merged)} total entr{'y' if len(merged) == 1 else 'ies'}.")


def write_text(merged, path):
    """Emit one match per line as <id>|<code1>|<code2>[|<kickoff>] (UTF-8, LF).

    Sorted by numeric match id so the file is diff-stable. Entries missing t1
    or t2 (full team names) are skipped — the watch face has no use for a
    partial line. Team names are converted to FIFA 3-letter codes via TEAM_CODE
    to keep the file small enough for the Garmin BG fetch buffer on tight-
    memory devices (Fenix 6X Pro). An unknown team name (a bug in NAME_MAP or
    a new entrant) is also skipped — better to leave that row as the bracket
    placeholder on the watch than to ship a code the watch doesn't recognise.
    Optional kickoff is appended only when present and an int.
    """
    lines = []
    skipped_unknown = []
    for mid, entry in sorted(merged.items(), key=_match_sort_key):
        if not isinstance(entry, dict):
            continue
        t1 = entry.get("t1")
        t2 = entry.get("t2")
        if not isinstance(t1, str) or not isinstance(t2, str):
            continue
        c1 = TEAM_CODE.get(t1)
        c2 = TEAM_CODE.get(t2)
        if c1 is None or c2 is None:
            skipped_unknown.append(f"{mid}: {t1!r} / {t2!r}")
            continue
        line = f"{mid}|{c1}|{c2}"
        kickoff = entry.get("kickoff")
        if isinstance(kickoff, int):
            line += f"|{kickoff}"
        lines.append(line)
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
        if lines:
            f.write("\n")
    if skipped_unknown:
        # Surface in the workflow log so a missing TEAM_CODE entry is loud.
        print("WARNING: matches.txt skipped rows without a FIFA code mapping:")
        for s in skipped_unknown:
            print("  " + s)


if __name__ == "__main__":
    main()
