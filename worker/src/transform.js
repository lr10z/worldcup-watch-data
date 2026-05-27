// Pure helpers for the live-status pipeline: the baked-in match schedule, the
// gate that decides whether to call api-football this tick, and the two
// transforms that convert an api-football fixture into our state-machine entry
// (state + minute + asOfUtc) and into the FIFA matchId we key everything by.
//
// Pure (no `fetch`, no Worker bindings, no globals) so it can be unit-tested in
// plain Node — see ../test/transform.test.js.

// matchId -> kickoff seconds (UTC). Copied from watch-face-mvp/source/Schedule.mc;
// sync this list after any reschedule.
export const SCHEDULE = [
  { matchId: 1, kickoffUtc: 1781204400 },
  { matchId: 2, kickoffUtc: 1781229600 },
  { matchId: 3, kickoffUtc: 1781290800 },
  { matchId: 4, kickoffUtc: 1781312400 },
  { matchId: 5, kickoffUtc: 1781398800 },
  { matchId: 6, kickoffUtc: 1781409600 },
  { matchId: 7, kickoffUtc: 1781388000 },
  { matchId: 8, kickoffUtc: 1781377200 },
  { matchId: 9, kickoffUtc: 1781478000 },
  { matchId: 10, kickoffUtc: 1781456400 },
  { matchId: 11, kickoffUtc: 1781467200 },
  { matchId: 12, kickoffUtc: 1781488800 },
  { matchId: 13, kickoffUtc: 1781560800 },
  { matchId: 14, kickoffUtc: 1781539200 },
  { matchId: 15, kickoffUtc: 1781571600 },
  { matchId: 16, kickoffUtc: 1781550000 },
  { matchId: 17, kickoffUtc: 1781636400 },
  { matchId: 18, kickoffUtc: 1781647200 },
  { matchId: 19, kickoffUtc: 1781658000 },
  { matchId: 20, kickoffUtc: 1781668800 },
  { matchId: 21, kickoffUtc: 1781737200 },
  { matchId: 22, kickoffUtc: 1781726400 },
  { matchId: 23, kickoffUtc: 1781715600 },
  { matchId: 24, kickoffUtc: 1781748000 },
  { matchId: 25, kickoffUtc: 1781798400 },
  { matchId: 26, kickoffUtc: 1781809200 },
  { matchId: 27, kickoffUtc: 1781820000 },
  { matchId: 28, kickoffUtc: 1781830800 },
  { matchId: 29, kickoffUtc: 1781915400 },
  { matchId: 30, kickoffUtc: 1781906400 },
  { matchId: 31, kickoffUtc: 1781924400 },
  { matchId: 32, kickoffUtc: 1781895600 },
  { matchId: 33, kickoffUtc: 1781985600 },
  { matchId: 34, kickoffUtc: 1782000000 },
  { matchId: 35, kickoffUtc: 1781974800 },
  { matchId: 36, kickoffUtc: 1782014400 },
  { matchId: 37, kickoffUtc: 1782079200 },
  { matchId: 38, kickoffUtc: 1782057600 },
  { matchId: 39, kickoffUtc: 1782068400 },
  { matchId: 40, kickoffUtc: 1782090000 },
  { matchId: 41, kickoffUtc: 1782172800 },
  { matchId: 42, kickoffUtc: 1782162000 },
  { matchId: 43, kickoffUtc: 1782147600 },
  { matchId: 44, kickoffUtc: 1782183600 },
  { matchId: 45, kickoffUtc: 1782244800 },
  { matchId: 46, kickoffUtc: 1782255600 },
  { matchId: 47, kickoffUtc: 1782234000 },
  { matchId: 48, kickoffUtc: 1782266400 },
  { matchId: 49, kickoffUtc: 1782338400 },
  { matchId: 50, kickoffUtc: 1782338400 },
  { matchId: 51, kickoffUtc: 1782327600 },
  { matchId: 52, kickoffUtc: 1782327600 },
  { matchId: 53, kickoffUtc: 1782349200 },
  { matchId: 54, kickoffUtc: 1782349200 },
  { matchId: 55, kickoffUtc: 1782417600 },
  { matchId: 56, kickoffUtc: 1782417600 },
  { matchId: 57, kickoffUtc: 1782428400 },
  { matchId: 58, kickoffUtc: 1782428400 },
  { matchId: 59, kickoffUtc: 1782439200 },
  { matchId: 60, kickoffUtc: 1782439200 },
  { matchId: 61, kickoffUtc: 1782500400 },
  { matchId: 62, kickoffUtc: 1782500400 },
  { matchId: 63, kickoffUtc: 1782529200 },
  { matchId: 64, kickoffUtc: 1782529200 },
  { matchId: 65, kickoffUtc: 1782518400 },
  { matchId: 66, kickoffUtc: 1782518400 },
  { matchId: 67, kickoffUtc: 1782594000 },
  { matchId: 68, kickoffUtc: 1782594000 },
  { matchId: 69, kickoffUtc: 1782612000 },
  { matchId: 70, kickoffUtc: 1782612000 },
  { matchId: 71, kickoffUtc: 1782603000 },
  { matchId: 72, kickoffUtc: 1782603000 },
  { matchId: 73, kickoffUtc: 1782673200 },
  { matchId: 74, kickoffUtc: 1782765000 },
  { matchId: 75, kickoffUtc: 1782781200 },
  { matchId: 76, kickoffUtc: 1782752400 },
  { matchId: 77, kickoffUtc: 1782853200 },
  { matchId: 78, kickoffUtc: 1782838800 },
  { matchId: 79, kickoffUtc: 1782867600 },
  { matchId: 80, kickoffUtc: 1782921600 },
  { matchId: 81, kickoffUtc: 1782950400 },
  { matchId: 82, kickoffUtc: 1782936000 },
  { matchId: 83, kickoffUtc: 1783033200 },
  { matchId: 84, kickoffUtc: 1783018800 },
  { matchId: 85, kickoffUtc: 1783047600 },
  { matchId: 86, kickoffUtc: 1783116000 },
  { matchId: 87, kickoffUtc: 1783128600 },
  { matchId: 88, kickoffUtc: 1783101600 },
  { matchId: 89, kickoffUtc: 1783198800 },
  { matchId: 90, kickoffUtc: 1783184400 },
  { matchId: 91, kickoffUtc: 1783281600 },
  { matchId: 92, kickoffUtc: 1783296000 },
  { matchId: 93, kickoffUtc: 1783364400 },
  { matchId: 94, kickoffUtc: 1783382400 },
  { matchId: 95, kickoffUtc: 1783440000 },
  { matchId: 96, kickoffUtc: 1783454400 },
  { matchId: 97, kickoffUtc: 1783627200 },
  { matchId: 98, kickoffUtc: 1783710000 },
  { matchId: 99, kickoffUtc: 1783803600 },
  { matchId: 100, kickoffUtc: 1783818000 },
  { matchId: 101, kickoffUtc: 1784055600 },
  { matchId: 102, kickoffUtc: 1784142000 },
  { matchId: 103, kickoffUtc: 1784408400 },
  { matchId: 104, kickoffUtc: 1784487600 },
];

export const PRE_KICKOFF_S = 5 * 60;     // start polling 5 min before kickoff
export const POST_KICKOFF_S = 150 * 60;  // stop polling 2.5 h after kickoff
const FIXTURE_MATCH_SLACK_S = 15 * 60;   // allowed kickoff drift between feed and SCHEDULE

// True when the current wall-clock falls inside any match's live window.
// Outside this window the Worker skips its API call, protecting quota.
export function anyMatchActive(now) {
  return SCHEDULE.some(m =>
    now >= m.kickoffUtc - PRE_KICKOFF_S &&
    now <= m.kickoffUtc + POST_KICKOFF_S
  );
}

// Map an api-football fixture to our FIFA matchId by matching its kickoff
// timestamp against SCHEDULE. ±15 min slack so a small reschedule in the
// upstream feed still resolves to the right game.
export function fixtureToMatchId(fx) {
  const t = fx && fx.fixture && fx.fixture.timestamp;
  if (typeof t !== "number") return null;
  for (const m of SCHEDULE) {
    if (Math.abs(m.kickoffUtc - t) <= FIXTURE_MATCH_SLACK_S) return m.matchId;
  }
  return null;
}

// Merge a fresh map of `matchId -> entry` with the previously-stored map,
// preserving `asOfUtc` on matches that were already in `fulltime`. This is
// what powers the watch face's 10-minute FT-grace timer: we need to remember
// when each match FIRST entered FT, not just that it's still in FT now.
//
// Pure (no I/O); the Worker's scheduled handler is responsible for actually
// reading + writing KV.
export function mergeWithPrevious(newMatches, oldMatches, now) {
  const merged = {};
  const old = oldMatches || {};
  for (const matchId in newMatches) {
    const entry = newMatches[matchId];
    if (entry.state === "fulltime") {
      const prev = old[matchId];
      const preservedAt = prev && prev.state === "fulltime" && typeof prev.asOfUtc === "number"
        ? prev.asOfUtc
        : now;
      merged[matchId] = { state: "fulltime", asOfUtc: preservedAt };
    } else {
      merged[matchId] = entry;
    }
  }
  return merged;
}

// Translate api-football's short status code into our state machine entry.
// The set of codes that matter for the live UI is below; anything else (NS
// pre-kickoff, PST/CANC, unknown) returns null so it's dropped from the
// payload and the watch falls back to its 2-hour-window LIVE logic.
//
// State-only — no minute, no asOfUtc. The face shows just the phase code
// (1H / 2H / HT / ET / PEN / FT) so we don't need minute-level freshness from
// the upstream API. Keeps quota usage low and removes minute-extrapolation
// logic on the watch entirely. `now` arg kept on the signature for future
// flexibility but currently unused.
export function buildStatusEntry(fx, now) {
  const status = fx && fx.fixture && fx.fixture.status;
  if (!status) return null;
  switch (status.short) {
    case "1H":   // first half
      return { state: "firstHalf" };
    case "2H":   // second half
      return { state: "secondHalf" };
    case "HT":   // halftime
      return { state: "halftime" };
    case "ET":   // extra time playing
    case "BT":   // break between extra-time halves
      return { state: "extratime" };
    case "P":    // penalty shootout in progress
      return { state: "penalties" };
    case "FT":   // full time
    case "AET":  // ended after extra time
    case "PEN":  // ended after penalty shootout
      return { state: "fulltime" };
    default:
      return null;
  }
}
