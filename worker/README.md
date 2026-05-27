# worker/

Cloudflare Worker that serves `status.json` to the watch face. Polls
api-football on a cron during live matches, caches the result in KV, and
exposes it on a public HTTPS endpoint.

## What the watch sees

```
GET https://garmin-watchface-wc-game-status.lr10.workers.dev/status.json
```

Response shape (all timestamps in UTC seconds):

```json
{
  "lastFetchedUtc": 1781204400,
  "apiQuotaRemaining": 87,
  "matches": {
    "1": { "state": "secondHalf" },
    "2": { "state": "fulltime", "asOfUtc": 1781210000 }
  }
}
```

- `lastFetchedUtc` — when the Worker last successfully polled api-football. Used by the watch's freshness gate (20 min).
- `apiQuotaRemaining` — api-football daily quota remaining (free tier starts at 100). Only present when the most recent cron tick actually hit upstream; absent during idle periods. Used by the health-check workflow to alert.
- `matches` — keyed by FIFA match number. Each entry has a `state` from the fixed set above; `asOfUtc` is only set on `fulltime` and is preserved across cron ticks so the watch's 10-min FT-grace timer stays anchored to the original FT moment.

## Architecture

```
[api-football]            [Cloudflare]                [watch face]
     ↑                          │
     │   cron */10 min          ↓
     └────── Worker ─── writes KV ────── reads KV
                                              ↑
                                              │ GET /status.json
                                              │ every 5 min during live
                                              │
                                          BackgroundService
```

The Worker has two entry points (`src/index.js`):

- `fetch` — handles `GET /status.json`, reads from KV. Never calls api-football. Anyone can hit this without spending quota.
- `scheduled` — fires on cron. Gates on `anyMatchActive(now)` (in `transform.js`), polls api-football only inside live-match windows, writes the merged result back to KV.

Pure helpers in `src/transform.js` are unit-tested in plain Node (no Worker runtime needed) via `npm test`.

## Deploy

```bash
npx wrangler deploy
```

That uploads the bundled Worker to Cloudflare. Run after any change in `src/` or `wrangler.toml`.

For first-time setup (different machine):

```bash
npm install
npx wrangler login         # browser-based Cloudflare auth
npx wrangler secret put API_FOOTBALL_KEY    # paste the api-football key
```

The KV namespace, league-id binding, and cron schedule are all declared in `wrangler.toml`.

## Tests

```bash
npm test
```

Runs `node --test test/transform.test.js` — 29 unit tests covering `anyMatchActive`, `fixtureToMatchId`, `buildStatusEntry`, and the `mergeWithPrevious` FT-grace preservation logic.

## Monitoring

A scheduled GitHub Action in `../.github/workflows/check-status.yml` probes the live `/status.json` endpoint every 30 minutes:

- HTTP 200, valid JSON, `lastFetchedUtc` + `matches` present
- `apiQuotaRemaining < 30` → fail the workflow → GitHub emails the repo owner

Workflow failure surfaces in the standard "Actions" tab; no extra dashboard needed.

## Quota notes

api-football free tier: 100 calls/day. The Worker's 10-min cron means ~6 calls/hour during a live window, and live windows run kickoff−5min to kickoff+2.5h. Peak day estimate: ~77 calls. The alert threshold (30 remaining) gives ~10-call headroom past peak. If real usage drifts above ~70/day consistently, consider:

- Reducing cron frequency (e.g. `*/15`) — watch's freshness gate still tolerates this
- Upgrading to the paid api-football tier ($19/mo for the next tier)

## Files

- `src/index.js` — entry points (`fetch`, `scheduled`)
- `src/transform.js` — pure helpers (schedule, gate, state mapping, merge)
- `test/transform.test.js` — unit tests
- `wrangler.toml` — Cloudflare Worker config (cron, KV binding, league id)
- `package.json` — Node setup for tests
