// Live-status pipeline for the World Cup watch face.
//
// Two entry points:
//   - fetch(request, env)   : GET /status.json -> read latest payload from KV.
//   - scheduled(event, env) : cron tick -> if any match is currently in its
//     live window, call api-football and refresh the KV payload.
//
// Output payload (consumed by the watch face's Status module):
//   { lastFetchedUtc: <int>,
//     matches: {
//       "<matchId>": { state: "firstHalf"|"secondHalf"|"halftime"|"extratime"|"penalties"|"fulltime",
//                      asOfUtc?: <int>   // only on fulltime — first-FT timestamp for the 10-min grace
//                    }
//     } }
//
// State-driven — no minute, no scores, no winner. The face shows the phase
// code (1H / 2H / HT / ET / PEN / FT). `asOfUtc` is only set on fulltime
// entries and is preserved across cron ticks (see mergeWithPrevious) so the
// watch can roll to the next match exactly 10 min after the original FT.
//
// The pure helpers (SCHEDULE, anyMatchActive, fixtureToMatchId, buildStatusEntry)
// live in transform.js so they can be unit-tested in plain Node.

import {
  anyMatchActive,
  fixtureToMatchId,
  buildStatusEntry,
  mergeWithPrevious
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

    const url = `https://v3.football.api-sports.io/fixtures?live=all&league=${env.WC_LEAGUE_ID}`;
    let data;
    try {
      const resp = await fetch(url, {
        headers: { "x-apisports-key": env.API_FOOTBALL_KEY }
      });
      if (!resp.ok) {
        console.log(`api-football returned HTTP ${resp.status} — skipping write`);
        return;
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
    // watch's 10-minute FT-grace rollover and must NOT advance on each cron.
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

    const matches = mergeWithPrevious(fresh, oldMatches, now);
    const payload = { lastFetchedUtc: now, matches };
    await env.GARMIN_WC_GAME_STATUS_KV.put(STATUS_KEY, JSON.stringify(payload));
  }
};
