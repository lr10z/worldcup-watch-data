// Live-status pipeline for the World Cup watch face.
//
// Two entry points:
//   - fetch(request, env)   : GET /status.json -> read latest payload from KV.
//   - scheduled(event, env) : cron tick -> if any match is currently in its
//     live window, call api-football and refresh the KV payload.
//
// Output payload (consumed by the watch face's Status module):
//   { lastFetchedUtc: <int>,
//     apiQuotaRemaining?: <int>,         // api-football daily-quota remaining,
//                                        // populated on cron ticks that hit
//                                        // the upstream; absent otherwise.
//                                        // Read by the health-check workflow.
//     matches: {
//       "<matchId>": { state: "firstHalf"|"secondHalf"|"halftime"|"extratime"|
//                             "penalties"|"fulltime"|"postponed"|"notstarted",
//                      asOfUtc?: <int>   // first-detection timestamp; present on
//                                        // fulltime / postponed / notstarted so
//                                        // the watch can anchor its display window
//                    }
//     } }
//
// State-driven — no minute, no scores, no winner. The face shows the phase
// code (1H / 2H / HT / ET / PEN / FT / PST / NS). `asOfUtc` is set on the
// three stateful states and preserved across cron ticks (see mergeWithPrevious)
// so the watch can anchor: 5-min FT grace, 60-min ·PST window, 60-min ·NS
// window.
//
// The pure helpers (SCHEDULE, anyMatchActive, fixtureToMatchId, buildStatusEntry)
// live in transform.js so they can be unit-tested in plain Node.

import {
  anyMatchActive,
  fixtureToMatchId,
  buildStatusEntry,
  mergeWithPrevious,
  filterForPayload
} from "./transform.js";

const STATUS_KEY = "status.json";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/status.json" || url.pathname === "/") {
      const json = await env.GARMIN_WC_GAME_STATUS_KV.get(STATUS_KEY);
      return new Response(json || '{"lastFetchedUtc":0,"matches":{}}', {
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store, max-age=0"
        }
      });
    }
    return new Response("not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    const now = Math.floor(Date.now() / 1000);
    if (!anyMatchActive(now)) {
      return;   // Idle outside live windows — protects api-football quota.
    }

    // Query all fixtures across a 2-day UTC range (yesterday + today) rather
    // than a single ?date=<today>. Two reasons:
    //
    //  1. Single-date misses matches that kick off before midnight UTC and
    //     stay live past it. Observed 2026-07-02: match 83 kicked off at 23:00
    //     UTC July 2, was still in the second half at 00:26 UTC July 3, but our
    //     Worker was querying date=2026-07-03 and api-football groups the
    //     fixture under its kickoff date (2026-07-02), so it fell off the list
    //     entirely. Query the 2-day window and we catch it.
    //
    //  2. The original endpoint switch away from ?live=all was to catch the
    //     FT / AET / PEN transitions (which the live endpoint filtered out).
    //     Both today and yesterday cover that intent — a match that kicked off
    //     yesterday UTC and just ended will still be in the range.
    //
    // The bigger api-football response is Cloudflare-side only. The status.json
    // payload we write to KV (and the watch fetches) is kept small by the
    // filterForPayload step below — we only include entries the watch actually
    // uses right now (live states + fresh fulltime), so it stays well under the
    // ~180-byte fetch-buffer cliff on smaller-memory devices.
    const today = new Date(now * 1000).toISOString().slice(0, 10);
    const yesterday = new Date((now - 86400) * 1000).toISOString().slice(0, 10);
    const url = `https://v3.football.api-sports.io/fixtures?from=${yesterday}&to=${today}&league=${env.WC_LEAGUE_ID}&season=2026`;
    let data;
    let apiQuotaRemaining = null;
    try {
      const resp = await fetch(url, {
        headers: { "x-apisports-key": env.API_FOOTBALL_KEY }
      });
      if (!resp.ok) {
        console.log(`api-football returned HTTP ${resp.status} — skipping write`);
        return;
      }
      // api-football returns the daily remaining-quota in this header on every
      // response (free tier: starts at 100, ticks down per request). We expose
      // it on the public payload so the health-check workflow can alert when
      // we're approaching the cap.
      const quotaHeader = resp.headers.get("x-ratelimit-requests-remaining");
      if (quotaHeader != null) {
        const parsed = parseInt(quotaHeader, 10);
        if (Number.isFinite(parsed)) {
          apiQuotaRemaining = parsed;
        }
      }
      data = await resp.json();
    } catch (e) {
      console.log(`api-football fetch failed: ${e && e.message}`);
      return;
    }

    // api-football signals problems (rate-limit exhaustion, bad key, etc.) by
    // returning HTTP 200 with a non-empty `errors` field — which can be either
    // an array of strings or an object keyed by error type. We must NOT proceed
    // to write {matches:{}} on such a response, because that would overwrite
    // good prior data with an empty payload. Bail early instead.
    const errs = data && data.errors;
    const hasErrors =
      (Array.isArray(errs) && errs.length > 0) ||
      (errs && typeof errs === "object" && !Array.isArray(errs) && Object.keys(errs).length > 0);
    if (hasErrors) {
      console.log(`api-football returned errors — skipping write: ${JSON.stringify(errs)}`);
      return;
    }

    if (!data || !Array.isArray(data.response)) {
      console.log("api-football response missing 'response' array — skipping write");
      return;
    }

    // Each api-football fixture is mapped to a FIFA matchId by kickoff time
    // and to our state machine entry. Unknown fixtures or unrecognised states
    // are silently dropped so the watch only ever sees well-formed entries.
    const fresh = {};
    for (const fx of data.response) {
      const matchId = fixtureToMatchId(fx);
      if (matchId == null) continue;
      const entry = buildStatusEntry(fx, now);
      if (entry == null) continue;
      fresh[String(matchId)] = entry;
    }

    // Read the previous payload so we can preserve the original `asOfUtc` on
    // matches that were already in fulltime — that timestamp drives the
    // watch's 5-minute FT-grace rollover and must NOT advance on each cron.
    let oldMatches = {};
    try {
      const prev = await env.GARMIN_WC_GAME_STATUS_KV.get(STATUS_KEY);
      if (prev) {
        const parsed = JSON.parse(prev);
        if (parsed && parsed.matches) {
          oldMatches = parsed.matches;
        }
      }
    } catch (e) {
      // Corrupt prior payload — treat as empty so we start fresh. The new
      // write will replace it cleanly.
      oldMatches = {};
    }

    // Merge preserves FT asOfUtc across ticks (so the grace timer doesn't
    // restart on every write). Then filter down to only entries the watch
    // will actually render right now — keeps status.json small enough to fit
    // under the smaller-memory devices' background fetch buffer ceiling.
    const merged = mergeWithPrevious(fresh, oldMatches, now);
    const matches = filterForPayload(merged, now);
    const payload = { lastFetchedUtc: now, matches };
    // Only include the quota field when we actually have a fresh reading from
    // this cron tick — never carry over a stale value from the prior payload.
    if (apiQuotaRemaining != null) {
      payload.apiQuotaRemaining = apiQuotaRemaining;
    }
    await env.GARMIN_WC_GAME_STATUS_KV.put(STATUS_KEY, JSON.stringify(payload));
  }
};
