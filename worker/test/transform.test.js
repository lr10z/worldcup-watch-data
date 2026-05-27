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
  buildStatusEntry
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

const NOW = 1781208000;   // arbitrary "now" inside the opener window for asOfUtc

function fx(short, elapsed) {
  return { fixture: { status: { short, elapsed } } };
}

test("buildStatusEntry: 1H -> firstHalf with elapsed minute", () => {
  assert.deepEqual(buildStatusEntry(fx("1H", 23), NOW),
                   { state: "firstHalf", minute: 23, asOfUtc: NOW });
});

test("buildStatusEntry: 2H -> secondHalf with elapsed minute", () => {
  assert.deepEqual(buildStatusEntry(fx("2H", 67), NOW),
                   { state: "secondHalf", minute: 67, asOfUtc: NOW });
});

test("buildStatusEntry: 1H with missing elapsed defaults to 0", () => {
  assert.deepEqual(buildStatusEntry(fx("1H", null), NOW),
                   { state: "firstHalf", minute: 0, asOfUtc: NOW });
});

test("buildStatusEntry: 2H with missing elapsed defaults to 46", () => {
  assert.deepEqual(buildStatusEntry(fx("2H", null), NOW),
                   { state: "secondHalf", minute: 46, asOfUtc: NOW });
});

test("buildStatusEntry: HT -> halftime, no minute, no asOfUtc", () => {
  assert.deepEqual(buildStatusEntry(fx("HT", 45), NOW),
                   { state: "halftime" });
});

test("buildStatusEntry: ET -> extratime with elapsed minute", () => {
  assert.deepEqual(buildStatusEntry(fx("ET", 105), NOW),
                   { state: "extratime", minute: 105, asOfUtc: NOW });
});

test("buildStatusEntry: BT (break) -> extratime", () => {
  assert.deepEqual(buildStatusEntry(fx("BT", 105), NOW),
                   { state: "extratime", minute: 105, asOfUtc: NOW });
});

test("buildStatusEntry: ET with missing elapsed defaults to 90", () => {
  assert.deepEqual(buildStatusEntry(fx("ET", null), NOW),
                   { state: "extratime", minute: 90, asOfUtc: NOW });
});

test("buildStatusEntry: P -> penalties, no minute", () => {
  assert.deepEqual(buildStatusEntry(fx("P", 120), NOW),
                   { state: "penalties" });
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
