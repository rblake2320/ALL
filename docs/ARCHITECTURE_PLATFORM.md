# Platform architecture: from offline game to a hosted, growing, player-built world (W-097 family)

Status 2026-11-05. Owner question: *where is it hosted, what backend holds the data, can it handle the players and
the activity, and how do we prove each connection works?*

## 0. The honest current state
| Layer | Exists today? | Proof |
|---|---|---|
| Game client (sim, render, UI, audio, saves) — web + Windows desktop | **Yes** | ~5,000 Node tests + real-browser e2e (`docs/verification/CHECKLIST.md`) |
| Local saves (crash-safe, journal, backups) | **Yes** — in the browser / `%APPDATA%` only | unit + e2e |
| Bones ledger, store, Grave Gold UI | **Client-side only** — fine offline, **not trustworthy for real money** | unit |
| Content packs | Format + Ed25519 signature **verifier** in client (`src/packs`). **Not yet:** production signing key provisioned, game loading packs at runtime | unit |
| Creator Kit + MCP (contributors) | In review (PR #14) | own CI |
| **Any server, account, database, cloud save, payment, moderation, hosting** | **No — none exists** | — |

Every 🌐 item in the checklist (friends, visits, parties, private homes, feed, contests, shared town, world growth,
real-money purchases, cloud saves, user content publishing) depends on the backend below. Until it exists those
features cannot be "done", and the checklist says so.

## 1. Shape of the system
```
 Players (web · Steam/Windows · Mac · iOS/Android)
        │  HTTPS (REST/JSON) + WebSocket (only for live sessions: parties, visits, chat)
        ▼
 ┌────────────── Edge: CDN + WAF + rate limits ──────────────┐   static game build, GLBs, signed packs
 └───────────────────────────┬───────────────────────────────┘
                             ▼
 API gateway (auth check, request size limits, per-account quotas)
   ├─ Identity      accounts, Steam/Apple/Google/email login, parental consent (under-15 = presets only, D-033)
   ├─ Saves         cloud saves: versioned snapshots + journal, conflict = keep both, never silent overwrite
   ├─ Economy       AUTHORITATIVE Bones + Grave Gold ledger (hash-chained, append-only), purchase receipts
   │                verified with Steam / Apple / Google / web processor server-side, refunds, fraud limits
   ├─ World         towns/cities/regions (W-046): lot ownership, snapshots of exteriors, blueprints (L7),
   │                visit permissions — interiors only to invited accounts (DESIGN_HOMES §8 privacy)
   ├─ Social        friends, invites, feed, contests, newsletter; messaging tiers + filters
   ├─ UGC           pack upload → automated gates → moderation queue → signing → CDN publish
   ├─ Sessions      WebSocket hosts for parties/visits (small rooms, host-authoritative)
   └─ Telemetry     consent-gated events, no PII (W-045)
        ▼
 PostgreSQL (accounts, ledger, world, social) · object storage (saves, packs, photos) · Redis (sessions, rate limits, queues)
 Observability: logs, metrics, traces, alerts, status page · Backups: point-in-time DB + versioned storage, tested restores
```

### Key design choices (proposed — owner to confirm; recorded as decisions when confirmed)
1. **The simulation stays on the player's device.** It is deterministic (D-012) and already crash-safe. The server
   does not run everyone's households; it stores snapshots + journals and validates what matters for fairness and
   money. This keeps server cost proportional to *saves and social actions*, not to play time.
2. **Money is server-only.** Grave Gold balances and purchases exist only on the server; the client shows them.
   *Proposed, not implemented:* Bones earned offline are reconciled by the server against replayable journals
   with caps. Offline signing cannot help (any key in the client is public), so until the server exists the client
   only closes cheap, shareable exploits (security review H-1 fix, W-106) and marks its ledger local-unverified.
3. **The shared world is asynchronous, not an MMO.** A town is a set of owned lots with published exterior
   snapshots; visiting loads a snapshot. Live presence is only for small sessions (party of ≤ 8). This is what lets
   the world grow to cities/states/countries without one huge real-time server.
4. **Sharding by town.** Each town (≈ 50–200 lots) is a unit of storage and caching; cities/states are indexes over
   towns. Hot towns get cached at the edge.
5. **User-built content goes through the same gates as ours** (schema, budgets, clipping detector, balance harness,
   malware/asset scan, E10+ review), then is signed by the service and served from the CDN. Contributors use their
   own AI tokens via the Creator Kit; the platform only pays for review + hosting.
6. **Stack:** Python FastAPI services (the owner's stack) + PostgreSQL + Redis + S3-compatible object storage + CDN,
   containerised. Steamworks for Steam login/purchases/cloud; platform IAP on mobile.

## 2. Hosting (decision needed — W-097)
Options to choose from (prices and quotas must be checked live before deciding; none are assumed here):
- **Managed cloud (AWS / Google Cloud / Azure):** managed Postgres, object storage, CDN, autoscaling containers.
  Best for scale and compliance; most setup.
- **Simpler platforms (e.g. Fly.io, Render, Railway) + a CDN (e.g. Cloudflare):** faster to stand up; fine for
  launch-scale; migrate later if needed.
- **Steam-only first:** Steam provides login, purchases and cloud saves for the Steam build, which defers part of
  the backend — but web and mobile still need it.
- The owner's RTX 5090 / DGX Sparks are **development and asset-generation machines, not production hosting**
  (home connection, no redundancy).
Recommendation: web build on a CDN now (private link, W-024); backend on a managed cloud with infrastructure-as-code
so staging and production are identical; a staging environment exists before any real user.

## 3. Capacity — targets we will test, not assume (W-103)
Planning targets (adjust after soft launch telemetry):
| Metric | Launch target | Growth target |
|---|---|---|
| Registered accounts | 100 k | 5 M |
| Peak concurrent players | 10 k | 250 k |
| API requests/s at peak (saves, social, store) | 2 k | 50 k |
| Cloud save writes/s | 500 | 10 k |
| Live sessions (parties/visits) | 1 k rooms | 25 k rooms |
| p95 API latency | < 200 ms | < 200 ms |
| Ledger correctness under load | 0 lost / 0 duplicated grants | same |
Load tests (k6 or Locust) run against staging with synthetic accounts and must meet these before each milestone;
results go into the verification ledger as `scale-loadtest` evidence.

## 4. How every connection gets verified (no more "checked on paper")
| Connection | Verification |
|---|---|
| Client ↔ API (each endpoint) | Contract tests from one OpenAPI schema, run in both client and server CI |
| Client ↔ real server | e2e in a real browser against **staging** (not mocks) for login, save/load, purchase (sandbox), visit |
| Purchases | Platform sandbox receipts (Steam/Apple/Google/web) end-to-end; replay + duplicate-receipt tests |
| Ledger | Property tests + concurrent-grant load test; nightly chain verification job; alert on any break |
| UGC pipeline | Malicious pack corpus (oversized, traversal, script injection, clipping, bad signatures) must be rejected |
| Privacy | Test that an uninvited account never receives interior data (API-level, not just UI) |
| Scale | Load-test thresholds above; failover drill (kill a node / DB failover) |
| Backups | Monthly restore drill into a scratch environment, timed and recorded |
| Everything | The **living wire map (W-091, Luna)** shows each connection with its latest evidence and freshness; stale or failed evidence is shown as such |

## 5. Security (W-106)
- First independent review is running now; report → `docs/security/`. Critical/High findings block release.
- Before any public launch: external penetration test of the backend + client, dependency audit in CI, secrets in a
  managed vault, least-privilege service accounts, WAF + rate limits, audit logs on economy and moderation actions.
- Child safety (E10+): verifiable parental consent for under-13 online features, chat presets only for under-15
  (D-033), no PII in telemetry, data deletion on request.

## 6. Order of work (AI-time estimates)
1. W-024 private hosted web build — hours.
2. Security review fixes (W-106) — hours to ~1 day depending on findings.
3. Backend skeleton in staging: identity + cloud saves + authoritative ledger + contract tests + IaC — ~2–4 days.
4. Steam integration (W-092) and sandbox purchases (W-100) — ~2–3 days, plus Valve review time (calendar, not AI).
5. World service + visits + private homes (W-025 client side first, then server) — ~3–5 days.
6. UGC pipeline (W-101) on top of the Creator Kit — ~2–3 days.
7. Load tests + observability + backups drills (W-103..W-105) — ~2 days.
8. External pen test, ratings, legal (W-095) — calendar time with outside parties.

## 7. Owner decisions needed
- Hosting provider (W-097) and monthly budget cap.
- Launch order: Steam first, or web + Steam together.
- Payment processor for web purchases.
- Whether to budget an external pen test before launch (recommended: yes).
