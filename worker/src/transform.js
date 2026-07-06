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
// Stop polling 4h after kickoff. Was 2.5h before 2026-07-03 — that was tight
// enough to cover regulation matches but silenced the Worker before ET+PK
// endings for matches that went past 90 min. Confirmed via match 88 tonight:
// api-football DOES emit `P` (Penalty in progress) during a live shootout, but
// the Worker had already stopped polling by then, so we never wrote it to KV
// and the watch never rendered ·PEN. 4h gives comfortable margin for regulation
// + ET (up to 2h 30m) + PK (5-15 min) + rate-limit-delayed detection, with
// minor overlap on the tightest remaining pair (86→87, ~35 min overlap) that
// the filterForPayload step handles cleanly (payload stays under the fetch-
// buffer cliff since we drop grace-expired FT entries before writing to KV).
export const POST_KICKOFF_S = 240 * 60;  // stop polling 4 h after kickoff
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
// what powers the watch face's 5-minute FT-grace timer: we need to remember
// when each match FIRST entered FT, not just that it's still in FT now.
//
// Pure (no I/O); the Worker's scheduled handler is responsible for actually
// reading + writing KV.
export function mergeWithPrevious(newMatches, oldMatches, now) {
  const merged = {};
  const old = oldMatches || {};
  for (const matchId in newMatches) {
    const entry = newMatches[matchId];
    if (STATES_WITH_ASOFUTC.has(entry.state)) {
      const prev = old[matchId];
      // Preserve asOfUtc if we've been in this same state on a prior tick.
      // That timestamp is the anchor for the watch's per-state display
      // window (5 min for FT, 60 min for PST / NS).
      if (prev && prev.state === entry.state && typeof prev.asOfUtc === "number") {
        merged[matchId] = { state: entry.state, asOfUtc: prev.asOfUtc };
        continue;
      }
      // Anti-resurrection guard — only for FT. Without a prev record at
      // all, stamping `asOfUtc = now` would let a dropped-then-still-seen
      // FT re-enter the payload every tick after grace expired, showing
      // the badge for another 5 min each cycle up to POST_KICKOFF_S (4 h).
      // That's the "stuck · FT for hours" bug seen 2026-07-03. FT's grace
      // is short enough that the loop actually forms; PST / NS have 60-min
      // windows that don't loop the same way (and are kept in the payload
      // continuously — see filterForPayload — so `prev` is always
      // populated once we've seen them).
      if (STATES_WITH_ANTI_RESURRECTION.has(entry.state) && !prev) {
        continue;
      }
      // First observation, or a legitimate transition from another state
      // (live→FT, live→PST, 1H→NS, PST→FT, etc.). Stamp `now` as the
      // first-detection anchor.
      merged[matchId] = { state: entry.state, asOfUtc: now };
    } else {
      merged[matchId] = entry;
    }
  }
  return merged;
}

// States that carry a first-detection timestamp (`asOfUtc`) preserved across
// cron ticks. Each anchors a display window on the watch. Adding a new one
// requires: (a) add it here, (b) map its api-football code in
// buildStatusEntry, (c) decide whether it needs anti-resurrection (see
// STATES_WITH_ANTI_RESURRECTION), (d) decide whether it should drop out of
// the payload on grace expiry (see filterForPayload).
const STATES_WITH_ASOFUTC = new Set(["fulltime", "postponed", "notstarted"]);

// States that need the anti-resurrection guard in mergeWithPrevious. Only FT
// qualifies: short grace (5 min) + api-football keeps saying FT for hours
// after the match ends creates the drop→restamp loop. PST / NS have 60-min
// windows AND are kept in the payload continuously, so `prev` is always
// populated once first seen and the guard would only harm cold-start cases.
const STATES_WITH_ANTI_RESURRECTION = new Set(["fulltime"]);

// Translate api-football's short status code into our state machine entry.
// The set of codes we render is below; anything else (CANC / SUSP / INT /
// TBD / unknown) returns null. Watch handles unknown / missing data via its
// ·??? fallback (either "fresh but unrecognized state" or "no data at all"
// depending on whether Status.lookup finds an entry).
//
// State-only — no minute, no asOfUtc seed. The face shows just the phase
// code (1H / 2H / HT / ET / PEN / FT / PST / NS) so we don't need minute-
// level freshness from the upstream API. Keeps quota usage low and removes
// minute-extrapolation logic on the watch. `now` arg drives the phantom
// guard for stateful codes (FT / PST / NS).
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
      // Return fulltime WITHOUT seeding asOfUtc. mergeWithPrevious stamps
      // asOfUtc = now on the first tick this match transitions to fulltime
      // and preserves that value on subsequent ticks. See mergeWithPrevious
      // for why (avoids api-football's under-reported elapsed minutes and
      // gives the watch's 5-min FT grace timer a clean anchor).
      if (isStalePostKickoff(fx, now)) return null;
      return { state: "fulltime" };
    case "PST":
      // Postponed. mergeWithPrevious stamps asOfUtc = now on first
      // detection (no anti-resurrection guard — see mergeWithPrevious for
      // why FT and PST diverge here). Phantom guard drops entries whose
      // scheduled kickoff was more than POST_KICKOFF_S ago — an evening
      // tick catching a morning fixture in PST shouldn't stamp a fresh
      // asOfUtc for a game long past its polling window.
      if (isStalePostKickoff(fx, now)) return null;
      return { state: "postponed" };
    case "NS":
      // Not started. Two very different cases collapse into this same
      // short code from api-football:
      //   (a) PRE-KICKOFF NS — expected and normal. The watch is in
      //       countdown mode, not "match current" mode, so the display
      //       doesn't consult Status data anyway. Return null; no need
      //       to bloat the payload.
      //   (b) POST-KICKOFF NS — genuine delay. The scheduled kickoff has
      //       passed but api-football still reports the fixture as not
      //       started. Ship as notstarted so the watch can render ·NS.
      // We use fixture.date to tell them apart. If the date is missing /
      // unparseable, err on the side of not shipping — a spurious ·NS
      // would only reach the watch if it's genuinely past the scheduled
      // time, so a missing date means we can't confirm that.
      {
        const dateStr = fx && fx.fixture && fx.fixture.date;
        const kickoffMs = typeof dateStr === "string" ? Date.parse(dateStr) : NaN;
        if (!Number.isFinite(kickoffMs)) return null;
        const kickoffSec = Math.floor(kickoffMs / 1000);
        if (now < kickoffSec) return null;                         // pre-kickoff
        if ((now - kickoffSec) > POST_KICKOFF_S) return null;      // phantom guard
        return { state: "notstarted" };
      }
    default:
      return null;
  }
}

// Guardrail against phantom entries for a match whose polling window has
// already closed. Returns true when the fixture's scheduled kickoff was more
// than POST_KICKOFF_S ago — signals buildStatusEntry to drop the entry so we
// never stamp a fresh asOfUtc for a game the Worker never actually polled
// during its live window. Fixtures with missing / unparseable `fixture.date`
// pass through (the safer default — we'd rather ship potentially-stale data
// than drop a legitimately-live match on a corrupt date field).
function isStalePostKickoff(fx, now) {
  const dateStr = fx && fx.fixture && fx.fixture.date;
  const kickoffMs = typeof dateStr === "string" ? Date.parse(dateStr) : NaN;
  if (!Number.isFinite(kickoffMs)) return false;
  const kickoffSec = Math.floor(kickoffMs / 1000);
  return (now - kickoffSec) > POST_KICKOFF_S;
}

// Per-state display windows that the watch runs against asOfUtc.
//   - FT_GRACE_SECONDS         → ·FT stays on-screen briefly after the match
//                                ends. Filter drops FT past this grace so it
//                                stops re-shipping (paired with the anti-
//                                resurrection guard in mergeWithPrevious).
//   - POSTPONED_WINDOW_SECONDS → ·PST stays on-screen for this long from
//                                first detection. Watch enforces the cap;
//                                the Worker keeps shipping until the polling
//                                window closes (see filterForPayload).
//   - NOTSTARTED_WINDOW_SECONDS → same shape as POSTPONED_WINDOW_SECONDS
//                                but for the "delayed past kickoff, still
//                                NS" case (·NS badge).
// Exported so the watch can import matching values — if they drift, entries
// could slip through Worker-side but be rejected on the watch, or vice versa.
export const FT_GRACE_SECONDS = 5 * 60;
export const POSTPONED_WINDOW_SECONDS = 60 * 60;
export const NOTSTARTED_WINDOW_SECONDS = 60 * 60;

// Filter the merged matches map down to just the entries the watch will
// actually use RIGHT NOW. Called on every cron tick before writing to KV.
//
// Kept in transform.js so it's unit-testable in plain Node. The Worker's
// scheduled handler is responsible for actually calling this.
//
// What survives the filter:
//   - Any live state (firstHalf/secondHalf/halftime/extratime/penalties) —
//     watch renders these directly as ·1H / ·HT / ·2H / ·ET / ·PEN. Live
//     phases never age out at the payload layer; the watch's clock-window
//     fallback handles their rolloff.
//   - Any fulltime entry whose asOfUtc is within FT_GRACE_SECONDS of now.
//     Watch shows briefly as ·FT before rolling.
//   - Any postponed / notstarted entry with a valid asOfUtc, regardless of
//     how long ago that was. The watch enforces the 60-min display cap
//     against asOfUtc — the Worker just keeps shipping so the watch has
//     something to render if the user checks near the window boundary. The
//     entry naturally drops from the payload once buildStatusEntry's
//     phantom guard rejects it (kickoff > POST_KICKOFF_S ago).
//
// What gets dropped:
//   - Fulltime past its grace. Historical noise — watch would ignore.
//   - Stateful entries with a missing / non-numeric asOfUtc (corrupt data).
//   - NS pre-kickoff / CANC / SUSP / INT / TBD etc. never make it into the
//     merged map in the first place — buildStatusEntry returns null for
//     them, so no explicit filter is needed here.
//
// Why this matters: since v1.0.6 we switched the api-football query to a
// 2-day date range, so the raw response can include many finished-hours-ago
// fixtures. Without this filter, they'd all land in status.json and blow
// past the ~180-byte fetch-buffer ceiling on the 6X Pro's background
// process. With the filter, the payload holds at most a handful of entries
// (typically 0-2 — a currently-live match, plus maybe one that just
// finished / is postponed / is delayed), which fits comfortably.
export function filterForPayload(matches, now) {
  const filtered = {};
  for (const matchId in matches) {
    const entry = matches[matchId];
    // States with asOfUtc need at minimum a valid asOfUtc to be useful.
    if (STATES_WITH_ASOFUTC.has(entry.state)) {
      const asOfUtc = entry.asOfUtc;
      if (typeof asOfUtc !== "number") continue;      // corrupt, drop
      // Only FT drops on grace expiry. PST / NS keep shipping — the watch
      // enforces its own display window against asOfUtc.
      if (entry.state === "fulltime" && (now - asOfUtc) > FT_GRACE_SECONDS) {
        continue;
      }
    }
    filtered[matchId] = entry;
  }
  return filtered;
}

