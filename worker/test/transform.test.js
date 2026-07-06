// Unit tests for the pure helpers in src/transform.js. Runs in plain Node
// (no Cloudflare runtime needed) via `npm test` -> `node --test test/`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SCHEDULE,
  PRE_KICKOFF_S,
  POST_KICKOFF_S,
  anyMatchActive,
  fixtureToMatchId,
  buildStatusEntry,
  mergeWithPrevious,
  filterForPayload,
  FT_GRACE_SECONDS,
  POSTPONED_WINDOW_SECONDS,
  NOTSTARTED_WINDOW_SECONDS
} from "../src/transform.js";

// ---------- anyMatchActive ----------

test("anyMatchActive: false well before any kickoff", () => {
  // 30 days before the opener
  const t = SCHEDULE[0].kickoffUtc - 30 * 86400;
  assert.equal(anyMatchActive(t), false);
});

test("anyMatchActive: true at the exact opener kickoff", () => {
  assert.equal(anyMatchActive(SCHEDULE[0].kickoffUtc), true);
});

test("anyMatchActive: true within the pre-kickoff window", () => {
  const t = SCHEDULE[0].kickoffUtc - (PRE_KICKOFF_S - 1);
  assert.equal(anyMatchActive(t), true);
});

test("anyMatchActive: true within the post-kickoff window", () => {
  const t = SCHEDULE[0].kickoffUtc + (POST_KICKOFF_S - 1);
  assert.equal(anyMatchActive(t), true);
});

test("anyMatchActive: false just after the final's window closes", () => {
  const last = SCHEDULE[SCHEDULE.length - 1];   // FIFA match #104, the Final
  // any-array-position match is fine since SCHEDULE is sorted by matchId; the
  // final has the chronologically-latest kickoff so its window-close is the
  // tournament-end boundary.
  const t = last.kickoffUtc + POST_KICKOFF_S + 1;
  assert.equal(anyMatchActive(t), false);
});


// ---------- fixtureToMatchId ----------

test("fixtureToMatchId: exact kickoff match returns the matchId", () => {
  const fx = { fixture: { timestamp: SCHEDULE[0].kickoffUtc } };
  assert.equal(fixtureToMatchId(fx), 1);
});

test("fixtureToMatchId: small drift within slack still resolves", () => {
  // 10 min after the opener kickoff — well within the ±15 min slack.
  const fx = { fixture: { timestamp: SCHEDULE[0].kickoffUtc + 10 * 60 } };
  assert.equal(fixtureToMatchId(fx), 1);
});

test("fixtureToMatchId: drift outside slack returns null", () => {
  // 20 min after the opener kickoff — outside the ±15 min slack.
  const fx = { fixture: { timestamp: SCHEDULE[0].kickoffUtc + 20 * 60 } };
  assert.equal(fixtureToMatchId(fx), null);
});

test("fixtureToMatchId: missing timestamp returns null", () => {
  assert.equal(fixtureToMatchId({ fixture: {} }), null);
  assert.equal(fixtureToMatchId({}), null);
  assert.equal(fixtureToMatchId(null), null);
});

test("fixtureToMatchId: timestamp matching the Final returns 104", () => {
  const fx = { fixture: { timestamp: 1784487600 } };
  assert.equal(fixtureToMatchId(fx), 104);
});


// ---------- buildStatusEntry ----------
// State-only contract — no minute, no asOfUtc. The face shows just the phase
// code, so the upstream elapsed value isn't needed in the payload.

const NOW = 1781208000;   // arbitrary "now"; passed in but currently unused

function fx(short, elapsed) {
  return { fixture: { status: { short, elapsed } } };
}

test("buildStatusEntry: 1H -> firstHalf", () => {
  assert.deepEqual(buildStatusEntry(fx("1H", 23), NOW), { state: "firstHalf" });
});

test("buildStatusEntry: 2H -> secondHalf", () => {
  assert.deepEqual(buildStatusEntry(fx("2H", 67), NOW), { state: "secondHalf" });
});

test("buildStatusEntry: 1H ignores elapsed", () => {
  // No minute in output regardless of input.
  assert.deepEqual(buildStatusEntry(fx("1H", null), NOW), { state: "firstHalf" });
  assert.deepEqual(buildStatusEntry(fx("1H", 47), NOW),   { state: "firstHalf" });
});

test("buildStatusEntry: HT -> halftime", () => {
  assert.deepEqual(buildStatusEntry(fx("HT", 45), NOW), { state: "halftime" });
});

test("buildStatusEntry: ET -> extratime", () => {
  assert.deepEqual(buildStatusEntry(fx("ET", 105), NOW), { state: "extratime" });
});

test("buildStatusEntry: BT (break) -> extratime", () => {
  assert.deepEqual(buildStatusEntry(fx("BT", 105), NOW), { state: "extratime" });
});

test("buildStatusEntry: P -> penalties", () => {
  assert.deepEqual(buildStatusEntry(fx("P", 120), NOW), { state: "penalties" });
});

test("buildStatusEntry: FT / AET / PEN all map to fulltime", () => {
  assert.deepEqual(buildStatusEntry(fx("FT", 90), NOW), { state: "fulltime" });
  assert.deepEqual(buildStatusEntry(fx("AET", 120), NOW), { state: "fulltime" });
  assert.deepEqual(buildStatusEntry(fx("PEN", 120), NOW), { state: "fulltime" });
});

test("buildStatusEntry: NS (not started) returns null", () => {
  assert.equal(buildStatusEntry(fx("NS", null), NOW), null);
});

test("buildStatusEntry: PST (postponed) returns postponed without asOfUtc", () => {
  // v1.0.7 change: PST used to return null (dropped) — the watch then fell
  // back to LIVE. Now we ship it as a distinct state so the watch can render
  // ·PST honestly. asOfUtc is stamped by mergeWithPrevious on first
  // detection, same pattern as FT.
  assert.deepEqual(buildStatusEntry(fx("PST", null), NOW), { state: "postponed" });
});

test("buildStatusEntry: unknown short code returns null", () => {
  assert.equal(buildStatusEntry(fx("ZZZ", 50), NOW), null);
});

test("buildStatusEntry: missing status returns null", () => {
  assert.equal(buildStatusEntry({ fixture: {} }, NOW), null);
  assert.equal(buildStatusEntry({}, NOW), null);
  assert.equal(buildStatusEntry(null, NOW), null);
});


// ---------- mergeWithPrevious (FT asOfUtc preservation) ----------

test("mergeWithPrevious: fresh FT with no prev is dropped (anti-resurrection)", () => {
  // With no prev record, we can't tell a legitimate live→FT transition from
  // a resurrection of an already-served FT (dropped by filterForPayload last
  // tick). We choose to drop rather than restamp — the resurrection loop is
  // the far more common case and produces a "stuck · FT" on the watch.
  const fresh = { "1": { state: "fulltime" } };
  const merged = mergeWithPrevious(fresh, {}, NOW);
  assert.deepEqual(merged, {});
});

test("mergeWithPrevious: FT resurrection after filterForPayload drop stays dropped", () => {
  // Regression for the 2026-07-03 field report: match 86 kept re-emerging
  // with a fresh · FT badge every ~10-20 min after grace had expired,
  // because filterForPayload dropped it and the next tick had no prev to
  // preserve. Under the fix, mergeWithPrevious sees no prev and skips the
  // entry entirely — the watch never sees the resurrected FT.
  const oldAfterFilterDrop = {};   // filterForPayload removed match 86 last tick
  const freshFromApi = { "86": { state: "fulltime" } };
  const merged = mergeWithPrevious(freshFromApi, oldAfterFilterDrop, NOW);
  assert.deepEqual(merged, {});
});

test("mergeWithPrevious: existing FT preserves original asOfUtc", () => {
  // Old payload had match 1 at FT, stamped earlier.
  const earlier = NOW - 5 * 60;
  const fresh = { "1": { state: "fulltime" } };
  const old = { "1": { state: "fulltime", asOfUtc: earlier } };
  const merged = mergeWithPrevious(fresh, old, NOW);
  assert.deepEqual(merged, { "1": { state: "fulltime", asOfUtc: earlier } });
});

test("mergeWithPrevious: transition from secondHalf to FT stamps current now", () => {
  const fresh = { "1": { state: "fulltime" } };
  const old = { "1": { state: "secondHalf" } };
  const merged = mergeWithPrevious(fresh, old, NOW);
  assert.deepEqual(merged, { "1": { state: "fulltime", asOfUtc: NOW } });
});

test("mergeWithPrevious: non-FT entries are passed through untouched", () => {
  const fresh = {
    "1": { state: "firstHalf" },
    "2": { state: "halftime" },
    "3": { state: "extratime" }
  };
  const merged = mergeWithPrevious(fresh, {}, NOW);
  assert.deepEqual(merged, fresh);
});

test("mergeWithPrevious: mixed payload — preserves FT, refreshes others", () => {
  const earlier = NOW - 3 * 60;
  const fresh = {
    "1": { state: "fulltime" },     // already FT in old → preserve
    "2": { state: "fulltime" },     // newly FT → stamp now
    "3": { state: "secondHalf" }    // live → pass through
  };
  const old = {
    "1": { state: "fulltime", asOfUtc: earlier },
    "2": { state: "secondHalf" },
    "3": { state: "firstHalf" }
  };
  const merged = mergeWithPrevious(fresh, old, NOW);
  assert.deepEqual(merged, {
    "1": { state: "fulltime", asOfUtc: earlier },
    "2": { state: "fulltime", asOfUtc: NOW },
    "3": { state: "secondHalf" }
  });
});

test("mergeWithPrevious: old asOfUtc missing or non-numeric → restamp", () => {
  const fresh = { "1": { state: "fulltime" } };
  // Defensive against corrupt prior data — should restamp rather than carry junk.
  assert.deepEqual(
    mergeWithPrevious(fresh, { "1": { state: "fulltime" } }, NOW),
    { "1": { state: "fulltime", asOfUtc: NOW } }
  );
  assert.deepEqual(
    mergeWithPrevious(fresh, { "1": { state: "fulltime", asOfUtc: "oops" } }, NOW),
    { "1": { state: "fulltime", asOfUtc: NOW } }
  );
});

test("mergeWithPrevious: null oldMatches treated as empty (FT dropped, live passed through)", () => {
  // null oldMatches is functionally the same as {} — no prev anywhere. FT
  // entries drop under the anti-resurrection rule; live states still pass
  // through so the Worker can begin tracking a fresh match cleanly.
  const merged = mergeWithPrevious(
    { "1": { state: "fulltime" }, "2": { state: "firstHalf" } },
    null,
    NOW
  );
  assert.deepEqual(merged, { "2": { state: "firstHalf" } });
});


// ---------- buildStatusEntry: FT / AET / PEN behavior ----------
// The Worker never seeds asOfUtc for fulltime entries. mergeWithPrevious
// stamps `now` on the transitional tick and preserves it thereafter, so the
// watch's 5-min FT-grace timer starts from when we NOTICED the match ended.
// A recency guard drops entries whose scheduled kickoff was so long ago that
// the Worker's polling window would have already closed — that's how we
// avoid a phantom ·FT for a match that ended hours before we ever polled.

function fxWithDate(short, dateIso, elapsed, extra) {
  const status = { short, elapsed };
  if (extra !== undefined) status.extra = extra;
  return { fixture: { date: dateIso, status } };
}

// A "now" that lines up with the fixed dates the tests use, so recency
// checks pass. Pick a time roughly at the fixture's end.
const FT_NOW = Math.floor(Date.parse("2026-07-01T18:00:00+00:00") / 1000);

test("buildStatusEntry: FT within polling window returns fulltime without asOfUtc", () => {
  // Fresh FT — kickoff was 2h ago, well within POST_KICKOFF_S.
  const fx = fxWithDate("FT", "2026-07-01T16:00:00+00:00", 90, 7);
  assert.deepEqual(buildStatusEntry(fx, FT_NOW), { state: "fulltime" });
});

test("buildStatusEntry: AET within polling window returns fulltime without asOfUtc", () => {
  // AET one hour after a 20:00 kickoff — well within window.
  const fx = fxWithDate("AET", "2026-07-01T20:00:00+00:00", 120, null);
  const nowJustAfterEnd = Math.floor(Date.parse("2026-07-01T22:15:00+00:00") / 1000);
  assert.deepEqual(buildStatusEntry(fx, nowJustAfterEnd), { state: "fulltime" });
});

test("buildStatusEntry: PEN within polling window returns fulltime without asOfUtc", () => {
  const fx = fxWithDate("PEN", "2026-07-01T20:00:00+00:00", 120, null);
  const nowJustAfterEnd = Math.floor(Date.parse("2026-07-01T22:15:00+00:00") / 1000);
  assert.deepEqual(buildStatusEntry(fx, nowJustAfterEnd), { state: "fulltime" });
});

test("buildStatusEntry: FT with kickoff older than POST_KICKOFF_S is dropped", () => {
  // Kickoff 5 hours before now — POST_KICKOFF_S is 4h → out of window.
  // Prevents phantom ·FT when the Worker's 2-day range query surfaces a
  // finished morning match while polling for an evening one.
  const fx = fxWithDate("FT", "2026-07-01T13:00:00+00:00", 90, 7);
  const nowFiveHoursLater = Math.floor(Date.parse("2026-07-01T18:00:00+00:00") / 1000);
  assert.equal(buildStatusEntry(fx, nowFiveHoursLater), null);
});

test("buildStatusEntry: AET well past window is dropped", () => {
  const fx = fxWithDate("AET", "2026-07-01T10:00:00+00:00", 120, null);
  const nowMuchLater = Math.floor(Date.parse("2026-07-01T20:00:00+00:00") / 1000);
  assert.equal(buildStatusEntry(fx, nowMuchLater), null);
});

test("buildStatusEntry: FT at exact polling-window boundary still included", () => {
  // Boundary condition — kickoff was POST_KICKOFF_S ago exactly. The guard
  // is `now - kickoff > POST_KICKOFF_S`, so an equal delta still passes.
  const kickoffSec = Math.floor(Date.parse("2026-07-01T16:00:00+00:00") / 1000);
  const nowAtBoundary = kickoffSec + POST_KICKOFF_S;
  const fx = fxWithDate("FT", "2026-07-01T16:00:00+00:00", 90, 7);
  assert.deepEqual(buildStatusEntry(fx, nowAtBoundary), { state: "fulltime" });
});

test("buildStatusEntry: FT with missing fixture.date still returned (fallback)", () => {
  // Legacy shape (test helper `fx` doesn't include date). Without a kickoff
  // reference we can't apply the recency guard — include the entry and let
  // downstream logic handle it. Same behavior as before the guard was added.
  assert.deepEqual(buildStatusEntry(fx("FT", 90), FT_NOW), { state: "fulltime" });
});

test("buildStatusEntry: FT with unparseable fixture.date still returned (fallback)", () => {
  const brokenFx = { fixture: { date: "not-a-date", status: { short: "FT", elapsed: 90 } } };
  assert.deepEqual(buildStatusEntry(brokenFx, FT_NOW), { state: "fulltime" });
});


// ---------- filterForPayload ----------
// The Worker calls this on every cron tick before writing status.json to KV.
// Only entries the watch will actually render RIGHT NOW should survive.

test("filterForPayload: live states pass through untouched", () => {
  const matches = {
    "1": { state: "firstHalf" },
    "2": { state: "halftime" },
    "3": { state: "secondHalf" },
    "4": { state: "extratime" },
    "5": { state: "penalties" }
  };
  const filtered = filterForPayload(matches, NOW);
  assert.deepEqual(filtered, matches);
});

test("filterForPayload: fresh fulltime (grace not expired) passes through", () => {
  const matches = { "1": { state: "fulltime", asOfUtc: NOW - 5 * 60 } };   // 5 min ago
  const filtered = filterForPayload(matches, NOW);
  assert.deepEqual(filtered, matches);
});

test("filterForPayload: fulltime at exact grace boundary passes through", () => {
  // (now - asOfUtc) === FT_GRACE_SECONDS: still within window (strict >).
  const matches = { "1": { state: "fulltime", asOfUtc: NOW - FT_GRACE_SECONDS } };
  const filtered = filterForPayload(matches, NOW);
  assert.deepEqual(filtered, matches);
});

test("filterForPayload: fulltime past grace is dropped", () => {
  const matches = { "1": { state: "fulltime", asOfUtc: NOW - FT_GRACE_SECONDS - 1 } };
  const filtered = filterForPayload(matches, NOW);
  assert.deepEqual(filtered, {});
});

test("filterForPayload: fulltime hours-old is dropped", () => {
  const matches = { "1": { state: "fulltime", asOfUtc: NOW - 6 * 3600 } };
  const filtered = filterForPayload(matches, NOW);
  assert.deepEqual(filtered, {});
});

test("filterForPayload: fulltime with missing asOfUtc is dropped", () => {
  // Corrupt or legacy shape — treat as unusable and drop rather than shipping.
  const matches = { "1": { state: "fulltime" } };
  const filtered = filterForPayload(matches, NOW);
  assert.deepEqual(filtered, {});
});

test("filterForPayload: fulltime with non-numeric asOfUtc is dropped", () => {
  const matches = { "1": { state: "fulltime", asOfUtc: "oops" } };
  const filtered = filterForPayload(matches, NOW);
  assert.deepEqual(filtered, {});
});

test("filterForPayload: mixed realistic payload — 1 live + 1 fresh FT + 3 old FT", () => {
  // Represents an evening tick during R32: a currently-live match, one that
  // ended a few minutes ago, and three older-day fulltime matches that came
  // back in the 2-day api-football query but are no longer useful.
  const matches = {
    "83": { state: "secondHalf" },                                          // live
    "82": { state: "fulltime", asOfUtc: NOW - 3 * 60 },                     // fresh FT
    "80": { state: "fulltime", asOfUtc: NOW - 4 * 3600 },                   // 4h ago
    "79": { state: "fulltime", asOfUtc: NOW - 8 * 3600 },                   // 8h ago
    "78": { state: "fulltime", asOfUtc: NOW - 24 * 3600 }                   // yesterday
  };
  const filtered = filterForPayload(matches, NOW);
  assert.deepEqual(filtered, {
    "83": { state: "secondHalf" },
    "82": { state: "fulltime", asOfUtc: NOW - 3 * 60 }
  });
});


// ---------- Postponed (PST) — v1.0.7 ----------
// Same asOfUtc-preservation pattern as fulltime, but a 60-min window instead
// of a 5-min grace. Watch renders these as ·PST and rolls off after the
// window closes (or when the next match kicks off, but that's a watch-side
// concern — the Worker just ships and drops on time).

test("buildStatusEntry: PST with kickoff older than POST_KICKOFF_S is dropped", () => {
  // Same phantom-guardrail as FT. An evening tick catching a morning fixture
  // still flagged PST shouldn't stamp a fresh asOfUtc — the Worker was never
  // polling for it during its live window, so any "detection" here is meaningless.
  const fx = fxWithDate("PST", "2026-07-01T13:00:00+00:00", null);
  const nowFiveHoursLater = Math.floor(Date.parse("2026-07-01T18:00:00+00:00") / 1000);
  assert.equal(buildStatusEntry(fx, nowFiveHoursLater), null);
});

test("buildStatusEntry: PST at exact polling-window boundary still included", () => {
  const kickoffSec = Math.floor(Date.parse("2026-07-01T16:00:00+00:00") / 1000);
  const nowAtBoundary = kickoffSec + POST_KICKOFF_S;
  const fx = fxWithDate("PST", "2026-07-01T16:00:00+00:00", null);
  assert.deepEqual(buildStatusEntry(fx, nowAtBoundary), { state: "postponed" });
});

test("buildStatusEntry: PST with missing fixture.date still returned (fallback)", () => {
  // No date → guard can't fire → include and let downstream decide.
  assert.deepEqual(buildStatusEntry(fx("PST", null), NOW), { state: "postponed" });
});

test("mergeWithPrevious: fresh PST with no prev stamps asOfUtc = now", () => {
  // v1.0.7 change: PST does NOT have the anti-resurrection guard that FT
  // has. Cold-start PST (before-kickoff postponement announced, no prior
  // live state) needs to enter the payload immediately so the watch can
  // render ·PST. filterForPayload never drops PST on grace expiry (only
  // FT does), so there's no drop→restamp loop to guard against.
  const fresh = { "92": { state: "postponed" } };
  const merged = mergeWithPrevious(fresh, {}, NOW);
  assert.deepEqual(merged, { "92": { state: "postponed", asOfUtc: NOW } });
});

test("mergeWithPrevious: existing PST preserves original asOfUtc", () => {
  // The 60-min window anchors to the first-detection moment. Cron ticks
  // during the window must NOT restamp — otherwise the window would extend
  // indefinitely so long as api-football keeps saying PST.
  const originalAsOf = NOW - 20 * 60;
  const prev = { "92": { state: "postponed", asOfUtc: originalAsOf } };
  const fresh = { "92": { state: "postponed" } };
  const merged = mergeWithPrevious(fresh, prev, NOW);
  assert.deepEqual(merged, { "92": { state: "postponed", asOfUtc: originalAsOf } });
});

test("mergeWithPrevious: transition live → PST stamps current now", () => {
  // Legit late-postponement (e.g. weather forces suspension mid-match). Prev
  // is a live state, fresh is PST — stamp asOfUtc = now, the moment we saw
  // the transition.
  const prev = { "92": { state: "secondHalf" } };
  const fresh = { "92": { state: "postponed" } };
  const merged = mergeWithPrevious(fresh, prev, NOW);
  assert.deepEqual(merged, { "92": { state: "postponed", asOfUtc: NOW } });
});

test("mergeWithPrevious: transition PST → live drops asOfUtc, keeps live state", () => {
  // Delayed match finally kicks off. Prev is PST, fresh is firstHalf. Live
  // states don't carry asOfUtc — the entry passes through untouched.
  const prev = { "92": { state: "postponed", asOfUtc: NOW - 30 * 60 } };
  const fresh = { "92": { state: "firstHalf" } };
  const merged = mergeWithPrevious(fresh, prev, NOW);
  assert.deepEqual(merged, { "92": { state: "firstHalf" } });
});

test("mergeWithPrevious: transition FT → PST re-stamps asOfUtc (state change)", () => {
  // Different stateful states → state change → fresh asOfUtc. (Unlikely in
  // practice — FT rarely flips back — but the merge logic should behave
  // predictably: don't inherit an FT timestamp into a PST entry.)
  const prev = { "92": { state: "fulltime", asOfUtc: NOW - 10 * 60 } };
  const fresh = { "92": { state: "postponed" } };
  const merged = mergeWithPrevious(fresh, prev, NOW);
  assert.deepEqual(merged, { "92": { state: "postponed", asOfUtc: NOW } });
});

test("filterForPayload: fresh postponed (window not expired) passes through", () => {
  const matches = { "92": { state: "postponed", asOfUtc: NOW - 20 * 60 } };   // 20 min ago
  const filtered = filterForPayload(matches, NOW);
  assert.deepEqual(filtered, matches);
});

test("filterForPayload: postponed at exact window boundary passes through", () => {
  const matches = { "92": { state: "postponed", asOfUtc: NOW - POSTPONED_WINDOW_SECONDS } };
  const filtered = filterForPayload(matches, NOW);
  assert.deepEqual(filtered, matches);
});

test("filterForPayload: postponed past window still passes through (watch enforces cap)", () => {
  // v1.0.7 change: unlike FT, PST does NOT age out at the payload layer.
  // The watch enforces the 60-min display cap against asOfUtc; the Worker
  // just keeps shipping the entry (with a valid asOfUtc) so it's available
  // whenever the watch fetches. Ancient PST entries are cleaned up upstream
  // by buildStatusEntry's phantom guard once the polling window closes.
  const matches = { "92": { state: "postponed", asOfUtc: NOW - POSTPONED_WINDOW_SECONDS - 1 } };
  const filtered = filterForPayload(matches, NOW);
  assert.deepEqual(filtered, matches);
});

test("filterForPayload: postponed with missing asOfUtc is dropped", () => {
  const matches = { "92": { state: "postponed" } };
  const filtered = filterForPayload(matches, NOW);
  assert.deepEqual(filtered, {});
});

test("filterForPayload: postponed with non-numeric asOfUtc is dropped", () => {
  const matches = { "92": { state: "postponed", asOfUtc: "oops" } };
  const filtered = filterForPayload(matches, NOW);
  assert.deepEqual(filtered, {});
});


// ---------- Not Started (NS) — v1.0.7 ----------
// NS is api-football's "not started" code. Pre-baked-kickoff NS is normal
// (countdown territory) — we drop it. Post-baked-kickoff NS means the game
// is genuinely delayed and hasn't kicked off — we ship it as notstarted so
// the watch can render ·NS with the same 60-min window as PST.

test("buildStatusEntry: NS pre-kickoff is dropped", () => {
  // 30 min before scheduled kickoff — api-football says NS. Countdown
  // handles the display. No need to bloat the payload.
  const kickoffIso = "2026-07-01T18:00:00+00:00";
  const kickoffSec = Math.floor(Date.parse(kickoffIso) / 1000);
  const nowPreKickoff = kickoffSec - 30 * 60;
  const fx = fxWithDate("NS", kickoffIso, null);
  assert.equal(buildStatusEntry(fx, nowPreKickoff), null);
});

test("buildStatusEntry: NS at exact kickoff is shipped as notstarted", () => {
  // Boundary — now == kickoffSec. Delay detection starts here.
  const kickoffIso = "2026-07-01T18:00:00+00:00";
  const kickoffSec = Math.floor(Date.parse(kickoffIso) / 1000);
  const fx = fxWithDate("NS", kickoffIso, null);
  assert.deepEqual(buildStatusEntry(fx, kickoffSec), { state: "notstarted" });
});

test("buildStatusEntry: NS post-kickoff is shipped as notstarted", () => {
  // 15 min past baked kickoff, api-football still says NS. Real delay.
  const kickoffIso = "2026-07-01T18:00:00+00:00";
  const kickoffSec = Math.floor(Date.parse(kickoffIso) / 1000);
  const nowDelayed = kickoffSec + 15 * 60;
  const fx = fxWithDate("NS", kickoffIso, null);
  assert.deepEqual(buildStatusEntry(fx, nowDelayed), { state: "notstarted" });
});

test("buildStatusEntry: NS with kickoff older than POST_KICKOFF_S is dropped", () => {
  // Phantom guard — evening tick catching a morning fixture in NS.
  const fx = fxWithDate("NS", "2026-07-01T13:00:00+00:00", null);
  const nowFiveHoursLater = Math.floor(Date.parse("2026-07-01T18:00:00+00:00") / 1000);
  assert.equal(buildStatusEntry(fx, nowFiveHoursLater), null);
});

test("buildStatusEntry: NS with missing fixture.date is dropped", () => {
  // Without a kickoff reference we can't tell pre- from post-kickoff — err
  // on the side of not shipping. A spurious ·NS on the watch is worse than
  // silently falling through to countdown / ·???.
  assert.equal(buildStatusEntry(fx("NS", null), NOW), null);
});

test("mergeWithPrevious: fresh NS with no prev stamps asOfUtc = now", () => {
  // Same simpler design as PST — no anti-resurrection guard, cold-start
  // stamps immediately so the payload has something to ship.
  const fresh = { "88": { state: "notstarted" } };
  const merged = mergeWithPrevious(fresh, {}, NOW);
  assert.deepEqual(merged, { "88": { state: "notstarted", asOfUtc: NOW } });
});

test("mergeWithPrevious: existing NS preserves original asOfUtc", () => {
  const originalAsOf = NOW - 20 * 60;
  const prev = { "88": { state: "notstarted", asOfUtc: originalAsOf } };
  const fresh = { "88": { state: "notstarted" } };
  const merged = mergeWithPrevious(fresh, prev, NOW);
  assert.deepEqual(merged, { "88": { state: "notstarted", asOfUtc: originalAsOf } });
});

test("mergeWithPrevious: transition NS → live drops asOfUtc, keeps live state", () => {
  // Delayed game finally kicks off. Prev is notstarted, fresh is firstHalf.
  const prev = { "88": { state: "notstarted", asOfUtc: NOW - 20 * 60 } };
  const fresh = { "88": { state: "firstHalf" } };
  const merged = mergeWithPrevious(fresh, prev, NOW);
  assert.deepEqual(merged, { "88": { state: "firstHalf" } });
});

test("filterForPayload: fresh notstarted (window not expired) passes through", () => {
  const matches = { "88": { state: "notstarted", asOfUtc: NOW - 20 * 60 } };
  const filtered = filterForPayload(matches, NOW);
  assert.deepEqual(filtered, matches);
});

test("filterForPayload: notstarted past window still passes through (watch enforces cap)", () => {
  // Same behavior as PST — Worker keeps shipping, watch enforces the 60-min
  // display cap. Ancient entries drop via buildStatusEntry's phantom guard.
  const matches = { "88": { state: "notstarted", asOfUtc: NOW - NOTSTARTED_WINDOW_SECONDS - 1 } };
  const filtered = filterForPayload(matches, NOW);
  assert.deepEqual(filtered, matches);
});

test("filterForPayload: notstarted with missing asOfUtc is dropped", () => {
  const matches = { "88": { state: "notstarted" } };
  const filtered = filterForPayload(matches, NOW);
  assert.deepEqual(filtered, {});
});


// ---------- Multi-tick integration: FT lifecycle end-to-end ----------
// Simulates the full Worker loop across successive cron ticks by chaining
// mergeWithPrevious → filterForPayload → (next tick's) mergeWithPrevious.
// This is the shape of test that would have caught the 2026-07-03
// resurrection bug — the unit tests above only exercise one function at a
// time, so a state that mergeWithPrevious's contract permits (restamp on
// missing prev) but filterForPayload's contract keeps producing (drop
// expired FT → empty prev next tick) slipped through unnoticed.

test("integration: live → FT → grace → drop stays dropped across ticks", () => {
  const KICKOFF = 1_000_000;
  const FT_TICK = KICKOFF + 105 * 60;          // 1h45m in — match hits FT
  const IN_GRACE = FT_TICK + 3 * 60;           // 3 min later, still in grace
  const GRACE_EXPIRED = FT_TICK + 6 * 60;      // 6 min later, grace over
  const NEXT_TICK = FT_TICK + 15 * 60;         // next cron after drop

  // Tick 1 — live: match reports secondHalf. Empty prev (first observation).
  let kv = filterForPayload(
    mergeWithPrevious({ "86": { state: "secondHalf" } }, {}, KICKOFF + 60 * 60),
    KICKOFF + 60 * 60
  );
  assert.deepEqual(kv, { "86": { state: "secondHalf" } });

  // Tick 2 — FT transition: prev is 2H, fresh is FT. Stamp asOfUtc = FT_TICK.
  kv = filterForPayload(
    mergeWithPrevious({ "86": { state: "fulltime" } }, kv, FT_TICK),
    FT_TICK
  );
  assert.deepEqual(kv, { "86": { state: "fulltime", asOfUtc: FT_TICK } });

  // Tick 3 — inside grace: preserved.
  kv = filterForPayload(
    mergeWithPrevious({ "86": { state: "fulltime" } }, kv, IN_GRACE),
    IN_GRACE
  );
  assert.deepEqual(kv, { "86": { state: "fulltime", asOfUtc: FT_TICK } });

  // Tick 4 — grace expired: filterForPayload drops the entry. KV now empty.
  kv = filterForPayload(
    mergeWithPrevious({ "86": { state: "fulltime" } }, kv, GRACE_EXPIRED),
    GRACE_EXPIRED
  );
  assert.deepEqual(kv, {});

  // Tick 5 — RESURRECTION ATTEMPT: api-football still reports FT (it will
  // for hours). Prev KV is empty (we just dropped it). The fix must keep it
  // dropped rather than restamp asOfUtc = now.
  kv = filterForPayload(
    mergeWithPrevious({ "86": { state: "fulltime" } }, kv, NEXT_TICK),
    NEXT_TICK
  );
  assert.deepEqual(kv, {},
    "FT entry must stay dropped once grace expires — restamping causes the " +
    "'stuck · FT for hours' bug reported 2026-07-03");
});

test("integration: PST cold-start ships and preserves asOfUtc across ticks", () => {
  // Mexico vs England (2026-07-05): api-football emitted PST all day, with
  // no prior live state ever seen. Under the v1.0.7 design (no anti-
  // resurrection for PST + filterForPayload doesn't drop PST on grace
  // expiry), the first tick MUST stamp asOfUtc, and every following tick
  // MUST preserve that same asOfUtc — so the watch's 60-min display cap
  // anchors to the true first-detection moment, not "whichever tick
  // happens to be running."
  const KICKOFF = 2_000_000;
  const FIRST_PST = KICKOFF - 5 * 60;                          // Worker's polling window opens 5 min pre-kickoff
  const HOUR_LATER = FIRST_PST + 60 * 60;                       // 60 min past first sighting
  const HOURS_LATER = FIRST_PST + 3 * 60 * 60;                  // deep past the display window

  // Tick 1 — first PST sighting. No prev anywhere. Cold-start stamp.
  let kv = filterForPayload(
    mergeWithPrevious({ "92": { state: "postponed" } }, {}, FIRST_PST),
    FIRST_PST
  );
  assert.deepEqual(kv, { "92": { state: "postponed", asOfUtc: FIRST_PST } },
    "cold-start PST must ship immediately with asOfUtc = first sighting");

  // Tick 2 — 1 min later, api-football still says PST. asOfUtc preserved.
  kv = filterForPayload(
    mergeWithPrevious({ "92": { state: "postponed" } }, kv, FIRST_PST + 60),
    FIRST_PST + 60
  );
  assert.deepEqual(kv, { "92": { state: "postponed", asOfUtc: FIRST_PST } });

  // Tick N — 60 min after first sighting. Worker STILL ships PST with the
  // ORIGINAL asOfUtc. Watch will cap its ·PST display at this point and
  // roll off — that's the watch's job. Payload keeps the entry so the
  // watch can compare the timestamps.
  kv = filterForPayload(
    mergeWithPrevious({ "92": { state: "postponed" } }, kv, HOUR_LATER),
    HOUR_LATER
  );
  assert.deepEqual(kv, { "92": { state: "postponed", asOfUtc: FIRST_PST } });

  // Tick M — 3 hours after first sighting, api-football still says PST.
  // Payload STILL has the entry with the ORIGINAL asOfUtc. Watch has
  // long since rolled off but Worker keeps shipping. Ancient entries drop
  // naturally when buildStatusEntry's phantom guard fires at the polling
  // window boundary; that path is covered by
  // `PST with kickoff older than POST_KICKOFF_S is dropped`.
  kv = filterForPayload(
    mergeWithPrevious({ "92": { state: "postponed" } }, kv, HOURS_LATER),
    HOURS_LATER
  );
  assert.deepEqual(kv, { "92": { state: "postponed", asOfUtc: FIRST_PST } });
});

test("integration: mid-match live → PST stamps at transition, not at kickoff", () => {
  // Weather delay: match plays first half, then flips to PST partway
  // through second half. asOfUtc anchors to the moment of transition,
  // not to first sighting of the match. That way the 60-min ·PST display
  // cap counts from the actual delay event.
  const KICKOFF = 3_000_000;
  const TRANSITION = KICKOFF + 60 * 60;    // 60 min in — weather stops play
  const FIVE_MIN_LATER = TRANSITION + 5 * 60;

  // Tick 1 — first half in play.
  let kv = filterForPayload(
    mergeWithPrevious({ "99": { state: "secondHalf" } }, {}, KICKOFF + 30 * 60),
    KICKOFF + 30 * 60
  );
  assert.deepEqual(kv, { "99": { state: "secondHalf" } });

  // Tick 2 — transition to PST. Fresh asOfUtc stamped at TRANSITION.
  kv = filterForPayload(
    mergeWithPrevious({ "99": { state: "postponed" } }, kv, TRANSITION),
    TRANSITION
  );
  assert.deepEqual(kv, { "99": { state: "postponed", asOfUtc: TRANSITION } });

  // Tick 3 — 5 min after transition. asOfUtc preserved.
  kv = filterForPayload(
    mergeWithPrevious({ "99": { state: "postponed" } }, kv, FIVE_MIN_LATER),
    FIVE_MIN_LATER
  );
  assert.deepEqual(kv, { "99": { state: "postponed", asOfUtc: TRANSITION } });
});


// ---------- status.json byte-size guard ----------
// Fails if the filtered status.json we'd write to KV grows past the size
// budget the watch's background fetch buffer can safely hold. The 6X Pro
// OOM'd fetching bodies at ~180 bytes for matchups; status.json shares the
// same fetch pipeline. Keep this guard conservative.

const STATUS_JSON_BYTE_BUDGET = 200;

test("status.json size: typical evening tick stays under the fetch-buffer budget", () => {
  // Simulates the worst realistic case during a live match day: one live
  // match plus one that just finished, plus a handful of long-finished
  // matches from the 2-day range that the filter should drop.
  const rawMerged = {
    "83": { state: "secondHalf" },
    "82": { state: "fulltime", asOfUtc: NOW - 4 * 60 },
    "80": { state: "fulltime", asOfUtc: NOW - 8 * 3600 },
    "79": { state: "fulltime", asOfUtc: NOW - 12 * 3600 },
    "78": { state: "fulltime", asOfUtc: NOW - 20 * 3600 },
    "77": { state: "fulltime", asOfUtc: NOW - 26 * 3600 }
  };
  const matches = filterForPayload(rawMerged, NOW);
  const payload = { lastFetchedUtc: NOW, matches, apiQuotaRemaining: 7398 };
  const bodyBytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  console.log(`    → filtered status.json size: ${bodyBytes} bytes (budget ${STATUS_JSON_BYTE_BUDGET})`);
  assert.ok(
    bodyBytes <= STATUS_JSON_BYTE_BUDGET,
    `status.json is ${bodyBytes} bytes, over the ${STATUS_JSON_BYTE_BUDGET}-byte budget`
  );
});

test("status.json size: idle tick (only apiQuotaRemaining) is trivially small", () => {
  const payload = { lastFetchedUtc: NOW, matches: {}, apiQuotaRemaining: 7398 };
  const bodyBytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  console.log(`    → idle status.json size: ${bodyBytes} bytes`);
  assert.ok(bodyBytes <= STATUS_JSON_BYTE_BUDGET);
});

