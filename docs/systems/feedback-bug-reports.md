# W-110 Player bug reports & feedback → fixes — owner direction (2026-11-06)

"We need a way for users to report bugs or give feedback that we then use to make things better." Today there is
none (the diagnostics text in `src/game/diagnostics.ts` exists but is only copyable from the crash screen).
Goal: one-click reporting in game, safe for E10+, works offline, and a pipeline that turns reports into tracked
work and tells the player when it is fixed.

## 1. In-game: "Report a bug / Send feedback"
- **Where:** pause menu, Settings → Help, the crash screen, and **F8** (controller: Select + Y; phone: menu item).
  Opening it pauses the game and takes a screenshot *before* the dialog appears.
- **Form:**
  - Type: 🐞 Bug · 💡 Idea · ❤️ Something I liked · 🚩 Report content/player (online only, goes to moderation W-102).
  - Area: auto-filled from the current mode (Live / Buy / Build / CAZ / Store / Menu), editable.
  - "What happened?" — **15+**: free text (≤ 2,000 chars, filtered); **under-15**: preset chips only ("I couldn't
    place an item", "Something looked wrong", "The game got stuck", "I lost progress", "I love this!", …) — D-033.
  - Screenshot: on by default, shown as a thumbnail; player can remove it; UI names/free text blurred for under-15.
  - "Attach my save" (15+ only, off by default) so we can reproduce.
- **Auto-attached diagnostics (no personal data):** game version + build SHA, platform/browser/GPU tier and quality
  setting (W-039), current mode/tool and the last 50 UI/sim events, recent errors and faults (`buildDiagnostics`),
  feature-checklist version, FPS summary. Never: real names, emails, IP stored with the report, other players' data.
- **Feedback ID** shown after sending ("Thanks! Your report is FB-7Q3K"), so players can reference it.

## 2. Delivery (works before and after the backend exists)
- **Outbox first:** every report is written to a crash-safe local outbox (same atomic-write store as saves), so a
  report is never lost even if the game crashes or is offline.
- **With the backend (W-097):** the outbox uploads to `POST /feedback` (rate-limited per account/device, size-capped,
  server re-sanitises, screenshots virus/content scanned).
- **Before the backend:** "Export report" writes a `.alreport` file (desktop: opens the folder; web: download) that
  testers send us; `npm run feedback:ingest <file>` validates and files it (§3). Nothing is sent anywhere silently.
- **Automatic crash reports:** opt-in on first crash ("Send crash reports automatically?"), never default-on for
  under-15.

## 3. Turning reports into fixes (the loop)
1. **Ingest:** server (or `feedback:ingest` locally) validates the schema, strips anything personal, computes a
   **dedupe key** (error signature + area + version) and groups duplicates with a count.
2. **Triage:** each new group becomes a GitHub issue in the private repo via a server-side bot (token only on the
   server, never in the client), labelled `bug|idea|praise`, area, version, count, with diagnostics + screenshot
   attached. Safety reports go to moderation (W-102), never to public issues.
3. **Plan:** triaged bugs get a WORKBOARD row (W-number) and, once fixed, a regression test that reproduces the
   report; the feature-checklist entry for that area lists it (W-090) so the same bug cannot silently return.
4. **Close the loop:** when the fix ships, everyone who reported it gets a notice ("Fixed in 1.0.3 — thanks!") in the
   feed/newsletter (W-069/W-044); ideas that ship credit "suggested by players".
5. **Measure:** weekly digest — top issues by count, time-to-fix, reopen rate; feeds roadmap decisions.

## 4. Safety & privacy
E10+: under-15 presets only, no free text, no save attachment; screenshots of other players' content follow privacy
rules (W-066) — interiors of others' homes are never captured; reports are retained ≤ 180 days, deletable on request;
consent text is plain-language and localized.

## 5. Acceptance (each is a test)
1. Unit: form validation (length caps, filter, under-15 preset-only), diagnostics contain no PII (property test with
   planted names/emails), outbox survives a simulated crash mid-write and de-duplicates resends (idempotent IDs).
2. Unit: `.alreport` schema round-trip; `feedback:ingest` rejects malformed/oversized/forged files.
3. e2e: open from pause menu and F8, submit a bug with screenshot, see the feedback ID, outbox entry present with
   diagnostics; under-15 profile shows chips only.
4. Server (with W-097): contract test for `POST /feedback`, rate limit, dedupe grouping, issue creation in a test repo.
