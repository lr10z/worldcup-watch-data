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
  mergeWithPrevious
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

test("buildStatusEntry: PST (postponed) returns null", () => {
  assert.equal(buildStatusEntry(fx("PST", null), NOW), null);
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

test("mergeWithPrevious: new FT entry gets asOfUtc = now", () => {
  const fresh = { "1": { state: "fulltime" } };
  const merged = mergeWithPrevious(fresh, {}, NOW);
  assert.deepEqual(merged, { "1": { state: "fulltime", asOfUtc: NOW } });
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

test("mergeWithPrevious: null oldMatches treated as empty", () => {
  const fresh = { "1": { state: "fulltime" } };
  const merged = mergeWithPrevious(fresh, null, NOW);
  assert.deepEqual(merged, { "1": { state: "fulltime", asOfUtc: NOW } });
});
