# Afterlife Lease: independent security review (2026-11-05)

- **Scope:** branch `ship/final-phase`. Review started at `f277fde` and was re-checked at `dd76fa8`. Every commit between the two touches only docs, the feature ledger (`scripts/lib/featureLedger.mjs`) and tests, so none of them changes a finding.
- **Reviewer:** independent reviewer (Claude). No repository source was modified. The proof-of-concept scripts were throwaway files under `/tmp/claude-0/secreview/`, and the text below reproduces them.
- **Method:** I read all of `electron/*.ts`, `src/economy/**`, `src/packs/**`, the relevant parts of `src/persistence/**`, the CI workflow, the build config and the security docs. I bundled the real source modules with esbuild and attacked them under Node 22.23.4. I ran `npm audit` both ways. I ran the project's own security suites (`tests/unit/{persistence,electron,economy,packs}`), and all 549 tests pass.
- **Labels:** **CONFIRMED** means I reproduced the issue against the real code. **PLAUSIBLE** means the exploit path is reasoned from the code but was not executed end to end.
- **Docs that diverge from code:** any doc claim the code does not implement carries the tag **P0 (docs)**, as the brief requires. MONETIZATION.md's own rule says the same: "code that diverges from it is a P0 bug".

---

## 0. Executive summary

The **Electron shell is in very good shape**:
- context isolation, sandbox, fuses, a custom protocol, a strict CSP and validated IPC are all implemented and match the docs;
- I found no Electron finding above Low.

The **save import pipeline is hardened as well**, and the pack verifier fails closed.

The real problems are in **economy integrity and child-safety gating**, plus several **doc claims the code does not back up**:
1. A forged or shared `.alsave` can mint any amount of Bones without dev tools. MONETIZATION.md says this cannot happen. (CONFIRMED)
2. The local Bones ledger can be forged outright: 500,000 Bones plus every Bones-sold item for free. This is expected for a client-only ledger, but it means **the future server must never import or trust the local ledger**. (CONFIRMED)
3. The "the age bracket can only move younger" guarantee can be bypassed by wiping or editing the profile record. (CONFIRMED)
4. Grave Gold cannot be minted, and server-only entitlements are filtered correctly. (CONFIRMED that this holds)
5. The installer is unsigned and there is no update channel, so players stay on whatever Chromium they installed.

**Counts:** Critical 0 · High 3 · Medium 7 · Low 10 · Info 8.

---

## 1. Electron shell (`electron/*.ts`)

### What I verified as implemented

| Control | Evidence |
|---|---|
| `contextIsolation:true`, `sandbox:true`, `nodeIntegration*:false`, `webSecurity:true`, `webviewTag:false`, `navigateOnDragDrop:false`, devtools only when unpackaged | `electron/main.ts:374-392`, `app.enableSandbox()` at `main.ts:103` |
| The preload exposes exactly `afterlifeNative`, with no generic `ipcRenderer` passthrough, fixed channel names and type-checked args | `electron/preload.ts:13-100` |
| IPC sender validation: main window `webContents`, top frame only, URL `app://game` (or the loopback dev origin when unpackaged) | `main.ts:137-142`, `ipcHandlers.ts:139-150`; every invoke goes through it (`main.ts:252-256`), quit too (`main.ts:268-271`) |
| Argument validation: exact argc, byte payloads only, 64 MiB cap, strict key grammar | `ipcHandlers.ts:40-128`, `storageKeys.ts:17-46` |
| `app://` traversal: refuses percent-encoded `..`, `\`, `:`, NUL, dot-files and Windows device names, then re-checks `path.relative` | `appProtocol.ts:22-50` |
| CSP header on every `app://` document (`responseHeaders`), and dev-server CSP replaced | `appProtocol.ts:94-106`, `main.ts:203-210`, `csp.ts:135-157` |
| `window.open` denied, `will-navigate`/`will-redirect`/sub-frame navigation guarded, `<webview>` blocked, Bluetooth picker cancelled, registered for *every* webContents | `main.ts:144-170`, `main.ts:494` |
| Permission request and check handlers allow only `clipboard-sanitized-write` from our origin; device, HID, serial, USB and display-capture requests are denied | `main.ts:32`, `main.ts:172-184` |
| Downloads: only `data:` or our own `blob:` URLs; the file name is sanitized | `main.ts:66-73`, `main.ts:187-201` |
| Fuses: `runAsNode` off, `NODE_OPTIONS` off, inspect args off, `onlyLoadAppFromAsar`, ASAR integrity, cookie encryption | `electron/electron-builder.json` (`electronFuses`) |
| Auto-update: none (`publish: null`) | `electron-builder.json` |
| File store: atomic write, key→filename mapping that cannot traverse, paths scrubbed from error messages | `fileStore.ts:276-335`, `storageKeys.ts`, `ipcHandlers.ts:61-67` |

I attempted traversal through `resolveAppRequest`, key grammar bypasses and sender spoofing, reading the code and the existing tests (`tests/unit/electron/protocol.test.ts`, `ipc.test.ts`, `storageKeys.test.ts`). I found no bypass. The Electron findings are **M-3, L-5, I-4 and I-7**, and **D-6** covers the renderer claim in SECURITY.md.

---

## 2. Findings

### HIGH

#### H-1: A forged or shared save mints unlimited Bones by re-keying `quests.worldId`. CONFIRMED.

**Where:**
- `src/economy/grants.ts:31-38`: `worldKey()` trusts `state.quests.worldId` from the save.
- `grants.ts:40-42`: `worldCheated()` trusts `flags.cheated` from the save.
- `grants.ts:131-153`: `reconcileGrants()` pays the quest *definition's* reward for every well-formed grant record.
- `src/economy/service.ts:510-519`: runs once per loaded world.
- `src/persistence/validation/questsSchema.ts:46,50`: keeps any non-empty `worldId` and up to 256 grant records.

**Exploit:**
1. Export a save.
2. Set `payload.quests.worldId` to a fresh string, write one grant record per one-off quest (`grantId = <worldId>:<questId>:1`), and set `flags.cheated` to `false`.
3. Recompute `payloadSha256` and `headerSha256`; SHA-256 has no key.
4. Import the file. The ledger idempotency key embeds the attacker-chosen `worldId`, so each new id pays again.

Repeatable quests yield more if `tick` is raised, because `inst ≤ day/cooldown + 1` (`grants.ts:145`). The file can be shared ("free Bones save"), so no dev tools are needed.

**Reproduction:** this runs the real `SaveManagerImpl.importFile` and then `reconcileGrants`.

```
import #0: ok, worldId kept=true, grants reconciled=10, bones=490
import #1: ok, worldId kept=true, grants reconciled=10, bones=490
import #2: ok, worldId kept=true, grants reconciled=10, bones=490
```

At the reconcile level, 10 forged worlds that include repeatables produced **29,650 Bones** plus the quest entitlement `cosmetic:frame_bone_gilded`.

```ts
// /tmp/claude-0/secreview/import.ts (core)
const wid = `farm-${n}`;
env.payload.quests = { version: 1, worldId: wid, active: [], completions: {}, lastEndedDay: {}, pinned: null,
  grants: ALL_QUESTS.filter(q => !q.repeat).map(q => ({ grantId: `${wid}:${q.id}:1`, questId: q.id, instance: 1, tick: 0, bones: 0, entitlements: [] })) };
const r = await mgr().importFile(await reseal(env));   // reseal = recompute both SHA-256s
reconcileGrants(r.world);                              // -> 10 grants / 490 Bones, every time
```

**Not verified:** I did not run the full engine load, so I have not shown whether the quests system would also re-derive grants. The reconcile path alone is enough.

**Impact:**
- Bones unlock premium catalogue items and cosmetics, and some of those items are also sold inside paid bundles such as the Starter Pack (`entitlements.ts:1-8`).
- Bones are the monetization lever ("one premium item per ~45 min", MONETIZATION.md §2).
- If Phase 4 imports local Bones, the minted Bones carry over.

**Fix:**
- Record each world's identity in the **profile** when this install creates it (a new-game registry in ProfileStore).
- Run `reconcileGrants` only for registered worlds. Mark imported worlds `imported` and never reconcile them.
- Treat `flags.cheated` and `worldId` from an import as untrusted, and on import either keep cheated = true or assign a new unregistered id.
- Add a profile-wide Bones/day cap.
- Online: the server pays only for completions it can verify (§8).

#### D-1, P0 (docs): "copying a save can never farm a grant" is false. CONFIRMED. Severity High.

**Claim:** `docs/MONETIZATION.md:25` says worldId is "derived once from the world and stored — copies of a save share it, so copying a save can never farm a grant". `grants.ts:5` makes a similar claim.

**What happens:** a copy with an edited `worldId` farms grants (H-1).

**Fix:** fix the code (H-1), or reword the doc to say "an unmodified copy".

#### D-2, P0 (docs) + child safety: the age bracket "can only move younger" is false. CONFIRMED. Severity High.

**Claims:**
- `src/economy/age.ts:6-8`: "moving older … is refused … Junk or tampered stored values read back as 'unknown' (gate shown again) or are clamped down, never up."
- `docs/MONETIZATION.md:20`: "Age gate is neutral (year-of-birth asked once …)".

**What happens:**
- Any missing, corrupt or deleted age record reads back as `unknown` (`age.ts:80-86`, `service.ts:128`). The gate is then shown again and **any** bracket can be chosen. "Clear site data" in a browser, or deleting `profile.economy-age*.dat` on desktop, is enough.
- A hand-edited record `{bracket:'adult', decidedAt:<any ISO>}` passes `sanitizeAgeProfile` unchanged. The ProfileStore checksum is unkeyed SHA-256, so it can be recomputed.

**Reproduction** (`/tmp/claude-0/secreview/econ.ts`, real `age.ts`):

```
u13 then adult answer -> locked                        (the in-session lock works)
hand-edited profile {adult, decidedAt} -> adult
after wiping profile, answer 1990 -> adult
```

**Impact today:** low. The offline build has no checkout (every path ends in `signIn`), no ads SDK and a no-op analytics sink. It becomes **High/Critical** once Phase 4 adds purchases or ads, if the client bracket is trusted.

**Fix:**
- Fail closed: if any other profile or ledger data exists but the age record is missing or corrupt, default to `under13`, not `unknown`.
- Never let the client bracket authorize real money. Put the bracket on the account with verified parental consent (see §8).

### MEDIUM

#### M-1: The local Bones ledger can be forged outright. CONFIRMED.

**Where:**
- `src/economy/ledger.ts:37-50`: unkeyed `entryHash`.
- `ledger.ts:129-153`: `verifyChain` checks structure only.
- `src/economy/ledgerStore.ts:274-279`: unkeyed record SHA.
- `ledgerStore.ts:390-401`: the high-water mark lives in the same writable ProfileStore.

**Reproduction:** build a chain with `planAppend` itself (5 grants of `MAX_ENTRY_AMOUNT`, the first one carrying every Bones-sold entitlement):

```
[2] forged chain verifies=true, bones=500000, bones-sold entitlements granted free=23
```

Writing it plus a matching HWM to `afterlife-lease:economy:ledger:primary` (localStorage/IndexedDB) or `economy.ledger.primary.dat` is accepted as `ok`.

**What still holds:** a chain that grants *server-only* entitlements also passes `verifyChain`, but the wallet drops them (`service.ts:209`, `entitlements.ts:21-26`). Output: `[2b] … verifies=true; wallet keeps=0`. **Grave Gold cannot be minted:** `planAppend` refuses `gg` (`ledger.ts:179`), `verifyChain` rejects `gg` entries (`ledger.ts:142`), and `ServerWallet` has no credit method (`wallet.ts:28-40`).

**Status:** this is acknowledged by design (`ledger.ts:14-15`, SECURITY.md §5).

**Fix:**
- Keep it, but make it a hard backend requirement that the server **never imports the local ledger balance or entitlements** (§8).
- For defence in depth and clarity, make `verifyChain` reject server-only entitlements too, so a tampered chain is flagged as `corrupt`.

#### M-2: Age and purchase gating is client-only and resettable. CONFIRMED (same mechanics as D-2).

**Where:**
- `realMoneyBlock` and `bonesBlock` (`age.ts:109-125`) read `this.ageProfile`.
- The teen cap uses `spentThisMonthCents`, which is client-stored and resets to 0 on any edit (`age.ts:87`).
- `setSpendCap` (`service.ts:239-243`) has no parental authentication. "The UI puts this behind the settings screen", meaning any user can raise the cap to $100.

**Fix:**
- In Phase 4, the cap, the spend counter and the bracket must live on the server.
- Gate `setSpendCap` behind the parent account and server-side checks.

#### M-3: Unsigned installer and no update channel.

**Where:**
- `electron/electron-builder.json` has no signing config.
- `.github/workflows/ci.yml:93-98` sets `CSC_IDENTITY_AUTO_DISCOVERY=false` and provides no signing secrets.
- `publish: null`. Electron 44.9.3 is pinned (`package.json`).

**Impact:**
- Players get SmartScreen warnings and cannot verify the publisher. A repackaged trojan installer cannot be told apart from the real one.
- With no updater, every Chromium/V8 CVE stays open on installed copies until the player reinstalls by hand.

**Status:** this is documented (SECURITY.md §5, SHIP_CHECKLIST.md:80-95), but it remains a real risk.

**Fix:**
- Get an Authenticode (EV or OV) certificate and sign in CI from a protected environment.
- Ship a signed update channel (electron-updater with code-signature verification, or the Steam depot), and track Electron's security releases.

#### D-3, P0 (docs): "under-13 accounts: … no free-text UGC" is not implemented. CONFIRMED by reading the code.

**Claim:** `docs/MONETIZATION.md:20`.

**What happens:**
- Zombie first and last names (`src/ui/shell/screens/caz/CazLookTabs.tsx:68-78`, `CreateZombieScreen.tsx:145`), the household name and save names (`SaveLoadDialog.tsx:234`) are free text for every bracket.
- No code checks `under13` outside the store (grep: `under13` is used only in `age.ts`, `StoreDialog.tsx` and `analytics.ts`).
- The text lands in exported `.alsave` files, which can be shared.

**Fix:**
- Either reword the claim to "no *shared/online* free text", or for `under13` offer name presets plus a filtered picker.
- Online, names must go through the moderation pipeline (§8).

#### D-4, P0 (docs): "Content packs (signed)" is listed as existing, but nothing is signed or loaded.

**Claim:** `docs/ARCHITECTURE_PLATFORM.md:12`.

**What happens:**
- `PRODUCTION_PUBLISHER_KEYS` is a placeholder (`src/packs/keys.ts:21-24`).
- `verifyPack` is exported (`src/packs/index.ts:2`) but **never called** by the game, and no loader or UI exists. In practice there are no signed packs and no pack loading.
- The verifier itself is sound, and it fails closed (I-1, I-2).

**Fix:** reword to "Pack format + verifier (unit-tested); no production key; not wired to a loader".

#### D-6, P0 (docs): SECURITY.md overstates what a *fully compromised* renderer cannot do. PLAUSIBLE.

**Claim:** `docs/SECURITY.md:66-68`: "What a fully compromised renderer can do: … It cannot read other files, start processes or reach the network."

**Why it is overstated:**
- CSP is enforced *inside* the renderer process. A renderer exploit (for example a V8 bug) runs native code that ignores CSP, and it can still send requests through Chromium's network service, which the sandbox does not block.
- File access and process start do need a sandbox escape, so those two parts of the claim are fine.
- The claim *is* true for script injection (XSS-style) under the CSP.

**Fix:** say "Injected script cannot reach the network (CSP); a renderer RCE can make network requests but needs a sandbox escape for files and processes".

#### D-7, P0 (docs): SECURITY.md's threat model omits the economy, packs and age gate. CONFIRMED.

**Claim:** `docs/SECURITY.md:3-21` limits the scope to Electron, the web build and saves, and T5 says "the player editing their own save … allowed — it is their game".

**What happens:** the same saves now feed the Bones economy (H-1), and the profile store now holds the age bracket (D-2). Neither appears in the model.

**Fix:**
- Add threats such as "T9 Bones minting via saves/ledger", "T10 age-gate reset" and "T11 hostile content pack", each with its defence and residual risk.
- Narrow T5 to world-state edits, not the profile economy.

### LOW

| ID | Finding | Evidence | Status | Fix |
|---|---|---|---|---|
| L-1 | GitHub Actions are pinned to mutable major tags. Playwright is installed outside the lockfile, and `playwright install --with-deps` runs apt as root. **Good:** `permissions: contents: read` (`ci.yml:24-25`), no `pull_request_target`, no secrets referenced, PRs run with read-only tokens. | `ci.yml:51,54,104,121,132,158` (`@v5`/`@v4`), `ci.yml:146-147` | CONFIRMED | Pin actions to full commit SHAs (keep the tag as a comment, and let Dependabot bump them). Add Playwright as an exact devDependency. |
| L-2 | `npm audit`: **prod (`--omit=dev`) 0**. **Full: 9 = 2 critical + 7 moderate, 0 high, 0 low.** Critical: `vitest` 3.2.7 and `tinypool` (prototype-pollution→RCE gadget, `@vitest/mocker` path traversal / code injection). Moderate: `@vitest/mocker`, `minimatch` ReDoS through `electron-builder` 26.18.0 → `app-builder-lib`, `dmg-builder`, `@electron/universal`, `electron-builder-squirrel-windows`. All are dev or build tooling; none ships to players. CI does not run audit (`ci.yml:37` `npm_config_audit: 'false'`). | `npm audit --json` | CONFIRMED | Upgrade vitest to 5.x. Track the electron-builder fix. Add a non-blocking `npm audit` CI job (blocking on high/critical in prod). |
| L-3 | The web build ships source maps (`sourcemap: !single`). They are excluded only from the Electron package (`"!dist/**/*.map"`). `dist/assets/index-*.js.map` is present. | `vite.config.ts:49` | CONFIRMED | Leave `sourcemap: false` (or `'hidden'`) for web release uploads. Source is not secret today, but maps make it easy to tamper with economy code and will expose any future endpoint logic. |
| L-4 | On shared web origins (itch.io HTML5 serves many games from one origin), any co-hosted game can read or write `afterlife-lease:*` in localStorage and the `afterlife-lease` IndexedDB, including the age profile and the Bones ledger. T4 documents this for saves only. | `src/persistence/backends/localStorage.ts:13`, `indexedDb.ts:28` | PLAUSIBLE (browser same-origin model) | Document it under T4 for the age profile and ledger. Prefer a dedicated origin or subdomain for the web build. |
| L-5 | A compromised renderer can fill the disk: 512 keys × 64 MiB = 32 GiB in the saves folder. | `fileStore.ts:121,141,316`; `main.ts:247` | CONFIRMED (by limits) | Add a total-bytes quota (for example 1-2 GiB) in `FileStore.write`. |
| L-6 | Daily-task farming by moving the clock forward. The rollback guard only blocks *backwards* moves, so stepping the system clock forward day by day yields fresh tasks and streak days. | `src/economy/daily.ts:13-14,137-` (`rollover`) | PLAUSIBLE (by reading; needs 3 tasks completed per fake day) | Accept offline. Online: the server issues daily tasks by server date. |
| L-7 | Free text (zombie, household and save names) goes unfiltered into exported `.alsave` files. Children may type real names, which is PII in shared files. | as in D-3 | CONFIRMED | Show a hint not to use real names. On export, offer to strip names. Online: filter and moderate. |
| L-8 | The dev signing **private** key sits in the working tree: `.keys/dev-publisher.ed25519.json`, mode 0600. It is gitignored (`.gitignore:15`) and **never committed** (verified with `git log --all -- .keys`). `scripts/build-pack.mjs` silently falls back to this dev key when `--key` is omitted. Production trusts only `afterlife-first-party`, so a dev-signed release pack would be rejected; that fails closed, but quietly. | `scripts/build-pack.mjs` (`loadKey`) | CONFIRMED | Make `build-pack.mjs` refuse to sign without an explicit `--dev` or `--key`. Keep the release key in an HSM or CI environment secret with required reviewers. |
| D-5 | P0 (docs), Low. "Bones earned offline are reconciled against signed, replayable journals with caps (no minting by editing saves)." Nothing is signed; save journals are SHA-256 only (`src/persistence/journal.ts:20`). The doc labels this a *proposed* design. | `docs/ARCHITECTURE_PLATFORM.md:49` | CONFIRMED (not implemented) | Mark it explicitly as "not implemented; requires backend". Note that offline signing cannot work, because a key in the client is public. |
| D-8 | P0 (docs), Low. "`npm audit --omit=dev`: 0 vulnerabilities (there are no production dependencies)" is true but empty. `three` and `preact` ship inside the bundle yet are listed as `devDependencies` (`package.json`), so the prod audit never examines them. | `docs/SECURITY.md:185`, `:177-178` | CONFIRMED | Move `three` and `preact` to `dependencies` (electron-builder still ships no `node_modules`, because `files` excludes them), or audit them explicitly. |

### INFO

| ID | Note | Evidence |
|---|---|---|
| I-1 | The pack JSON reserved-key regex can be bypassed with a `\u` escape (`"__proto__"`). This is **CONFIRMED harmless**: the strict schema rejects the key at the manifest stage (`contents.__proto__ is not a content kind` / `unknown field "constructor"`). Prefer `sanitizeParse` from `src/persistence/sanitize.ts`, as everywhere else. | `src/packs/verify.ts:80` |
| I-2 | The zip reader does not compare local-header names with central-directory names and allows overlapping entries. The 32 MiB total, the ratio caps and the CRC bound the damage, and wide (125k-element) and deep (60k-level) manifests were rejected cleanly (CONFIRMED). Compare the names to avoid parser-differential confusion with external tools such as the Creator Kit. | `src/packs/zip.ts:296-305` |
| I-3 | The pack signature covers `canonicalJson(manifest)`, which includes every asset's SHA-256 and length, checked before the signature. The publisher key id must match the manifest and the allowlist, and verification fails closed (`verifyEd25519` returns false on any error). The dev key is only trusted in `import.meta.env.DEV`. | `verify.ts:58-70,125-163`, `keys.ts:33-40` |
| I-4 | `will-download` accepts any `data:` URL, whoever initiated it. This is acceptable because only our own page can be loaded. | `main.ts:190` |
| I-5 | Save import is well hardened: 64 MiB cap, gzip output cap, strict UTF-8, linear depth pre-scan (128), reserved keys stripped (including escaped spellings), thumbnails restricted to raster `data:` ≤ 64 KiB, structural validation. Covered by `tests/unit/persistence/untrustedImport.test.ts` and `sanitize.test.ts` (passing). I found no prototype pollution. | `src/persistence/sanitize.ts:55-103`, `loadPipeline.ts` |
| I-6 | The DevWallet and dev pack key are stripped from production bundles. The built `dist/assets/*.js` contains no `__afterlife_dev_wallet__`, `createDevWallet` or `VITE_DEV_PACK_PUBKEY` (grep, CONFIRMED). Web CSP meta is present in `dist/index.html`. There is no service worker and no remote origin. | `wallet.ts:43-49`, `dist/index.html` |
| I-7 | Renderer console warnings and errors (rate-limited, ≤ 2000 chars) are copied into `userData/logs/main.log`. They may contain player-typed names. This is local only. | `main.ts:451-461` |
| I-8 | **Creator Kit + MCP server: absent on this branch.** There is no `scripts/creator/**` and no MCP code. `docs/ARCHITECTURE_PLATFORM.md:13` says "In review (PR #14)", and no matching branch exists in `git branch -a`. Not reviewed; it needs its own review before merge (see §9). | — |

---

## 3. Untrusted input: summary

- **Saves:** robust (I-5). The weakness is semantic: worldId and grant records feed the economy (H-1).
- **Packs:** verifier robust (I-1 to I-3), not wired (D-4).
- **Profile records** (age, daily, HWM): checksummed but unkeyed, so editable (D-2, M-1).
- **Ledger record parse:** plain `JSON.parse` with an 8 MiB cap (`ledgerStore.ts:249,285`). It has no depth pre-scan, but only arrays are walked, iteratively, so I found no issue.
- **Path traversal:** none found in `app://`, the storage keys or the pack paths (`limits.ts:332-345`).

## 4. Economy integrity: what is enforced client-side only

| Rule | Enforced where | Trustworthy? |
|---|---|---|
| GG cannot be minted locally | `ledger.ts:142,179`, `wallet.ts` | Yes, as far as the client goes. Real GG does not exist yet. |
| Server-only entitlements never granted locally | `entitlements.ts`, `service.ts:209,541` | Yes (the wallet filter holds against a forged chain). |
| Bones balance and Bones entitlements | Unkeyed hash chain + HWM | **No** (M-1) |
| Quest and achievement grants pay once per world | Idempotency key with save-supplied worldId | **No** (H-1) |
| `flags.cheated` blocks Bones | Save field | **No** (editable) |
| Age bracket, teen cap, monthly spend | Profile record | **No** (D-2, M-2) |
| Daily tasks once per day | Local clock + `maxDay` | Partly (L-6) |
| Rank gates (W-057 "Afterlife Rank") | Not implemented on this branch | n/a |

## 5. Child safety and privacy

- **Data collected:** the age gate stores only the bracket plus `decidedAt`, never the birth year (`age.ts:58-71`, `AgeGate.tsx`). That is good.
- **Telemetry:** the sink is a no-op, there is no network code, and `scrub()` allows only enumerated ids (`analytics.ts:39-61`). Telemetry is disabled for `under13` and `unknown` (`analytics.ts:66-68`). A real sink is only specified (`docs/systems/telemetry.md`), not implemented.
- **Gaps:** age-gate reset (D-2), free-text names with no under-13 handling (D-3, L-7), a parent cap without authentication (M-2), and shared-origin storage (L-4).

## 6. Web build

- CSP is a meta tag with no remote origins and no `unsafe-eval` (I-6). Inline styles are allowed, and that is justified.
- There are no third-party scripts and no service worker.
- Source maps are shipped (L-3).
- Sensitive data in localStorage: the age bracket and Bones ledger (M-1, D-2, L-4). No secrets, tokens or PII are stored, apart from player-typed names.

## 7. Docs vs code: divergence list (all P0 per brief)

| ID | Doc claim | Reality |
|---|---|---|
| D-1 | `MONETIZATION.md:25`, `grants.ts:5`: copying a save can never farm grants | Edited copies farm grants (H-1) |
| D-2 | `age.ts:6-8`, `MONETIZATION.md:20`: bracket only moves younger; tampering never moves it up | Wipe or edit moves it to adult |
| D-3 | `MONETIZATION.md:20`: under-13 gets no free-text UGC | Free-text names for all brackets |
| D-4 | `ARCHITECTURE_PLATFORM.md:12`: "Content packs (signed)" | No production key, no loader |
| D-5 | `ARCHITECTURE_PLATFORM.md:49`: signed replayable journals, no minting by editing saves | Nothing signed (labelled proposed) |
| D-6 | `SECURITY.md:66-68`: a compromised renderer cannot reach the network | False for renderer RCE |
| D-7 | `SECURITY.md:3-21`: threat-model scope | Economy, packs and age gate missing; T5 out of date |
| D-8 | `SECURITY.md:177-185`: zero runtime deps, prod audit 0 | Runtime libraries hidden in devDependencies |

The Electron claims in SECURITY.md §2, §3 and §6 **do match the code**, and so do the persistence claims in §4 and §5.

## 8. Requirements for a future online backend (requirements, not findings)

1. **Authoritative ledger.**
   - Bones and GG balances and entitlements exist only server-side.
   - Never import the local ledger, `quests.grants`, `worldId` or `flags` as truth.
   - At account link, cap any one-time "offline Bones" migration, and if possible award by server-verified completion only.
2. **Grant verification.**
   - The server derives quest and daily grants from events it can check: server-issued daily task ids by server date, plus rate caps per account per day and per quest.
   - World ids are issued by the server.
3. **Payments.**
   - Server-created Stripe or Steam transactions, with webhook or Steam-callback credit only.
   - Idempotent receipt handling, refund and chargeback revocation, and fraud limits.
   - The client never credits.
4. **Identity and age.**
   - Accounts with authentication (Steam, OAuth, email plus MFA where possible).
   - The age bracket lives on the account. Under-13 needs verifiable parental consent (COPPA).
   - Parent-controlled spend cap with the spend counter on the server; the client display is advisory.
5. **Moderation.**
   - Every name, text field, photo and UGC pack goes through filters and a moderation queue; under-13 gets presets only (D-033).
   - Reporting, blocking and audit logs.
6. **Packs and UGC.**
   - Server-side gates (schema, size, malware scan, E10+ review).
   - Signing in an HSM with key rotation and revocation lists.
   - The client trusts only server-signed packs, and keeps Creator mode out of shared towns.
7. **Abuse controls.** Per-account and per-IP rate limits, request size limits, replay protection (nonces), WAF/CDN.
8. **Telemetry.**
   - Server-side consent records, deletion on request, no IP retention, retention limits.
   - Separate crash-report consent; nothing collected for under-13.
9. **Transport and ops.**
   - HTTPS only. When the CSP opens `connect-src` to API origins, list them exactly.
   - Secrets kept outside client builds.
   - Signed update channel (M-3).

## 9. What I could not check

- Running Electron itself (the binary is not usable in this container) and the NSIS installer. ASAR-integrity enforcement and fuses were checked at runtime by neither me nor CI.
- Whether Electron 44.9.3 is the latest patched 44.x as of today (I did not check upstream).
- **The Creator Kit and MCP server** (PR #14 is not on this branch).
- GitHub repository settings: branch protection, Actions fork-PR approval policy, secret scopes, environment protections.
- A full engine load of a forged save. H-1 is proven through `importFile` plus `reconcileGrants`, not through the running game UI.
- Real-browser behaviour on itch.io's shared origin (L-4) and how the web CSP behaves there.

## 10. All findings

| ID | Sev | Status | Title | Location |
|---|---|---|---|---|
| H-1 | High | CONFIRMED | Forged or shared save mints unlimited Bones (worldId re-key) | `src/economy/grants.ts:31-38,131-153`; `service.ts:510-519` |
| D-1 | High (P0 docs) | CONFIRMED | "Copying a save can never farm a grant" is false | `docs/MONETIZATION.md:25` |
| D-2 | High (P0 docs) | CONFIRMED | Age bracket "never moves up" is false (wipe or edit) | `src/economy/age.ts:6-8,80-95`; `service.ts:128` |
| M-1 | Medium | CONFIRMED | Bones ledger forgeable (500k Bones + 23 items); GG safe | `src/economy/ledger.ts:37-50,129-153`; `ledgerStore.ts:274-279` |
| M-2 | Medium | CONFIRMED | Spend cap and counter client-only; cap settable without a parent | `age.ts:87,98-117`; `service.ts:239-243` |
| M-3 | Medium | CONFIRMED | Unsigned installer, no update channel | `electron/electron-builder.json`; `ci.yml:93-98` |
| D-3 | Medium (P0 docs) | CONFIRMED | "Under-13: no free-text UGC" not implemented | `MONETIZATION.md:20`; `CazLookTabs.tsx:68-78` |
| D-4 | Medium (P0 docs) | CONFIRMED | "Content packs (signed)": no prod key, no loader | `ARCHITECTURE_PLATFORM.md:12`; `src/packs/keys.ts:21-24` |
| D-6 | Medium (P0 docs) | PLAUSIBLE | Compromised renderer "cannot reach the network" overstated | `docs/SECURITY.md:66-68` |
| D-7 | Medium (P0 docs) | CONFIRMED | Threat model omits economy, packs and age gate | `docs/SECURITY.md:3-21` |
| L-1 | Low | CONFIRMED | Actions on mutable tags; Playwright outside the lockfile | `ci.yml:51,54,104,121,132,146,158` |
| L-2 | Low | CONFIRMED | npm audit: prod 0; full 9 (2 crit, 7 mod), all dev | `package.json` (vitest, electron-builder) |
| L-3 | Low | CONFIRMED | Web build ships source maps | `vite.config.ts:49` |
| L-4 | Low | PLAUSIBLE | Shared-origin hosting exposes age profile and ledger | `backends/localStorage.ts:13`; `indexedDb.ts:28` |
| L-5 | Low | CONFIRMED | Saves-folder disk fill up to 32 GiB | `electron/fileStore.ts:121,141,316` |
| L-6 | Low | PLAUSIBLE | Daily-task farming by moving the clock forward | `src/economy/daily.ts:13-14,137` |
| L-7 | Low | CONFIRMED | Free-text names (possible PII) in shared saves | `CazLookTabs.tsx:68-78`; `SaveLoadDialog.tsx:234` |
| L-8 | Low | CONFIRMED | Dev private key in working tree; silent dev-key fallback | `.keys/` (gitignored); `scripts/build-pack.mjs` |
| D-5 | Low (P0 docs) | CONFIRMED | "Signed replayable journals" not implemented (proposed) | `ARCHITECTURE_PLATFORM.md:49` |
| D-8 | Low (P0 docs) | CONFIRMED | Prod audit vacuous; runtime libs in devDependencies | `docs/SECURITY.md:177-185`; `package.json` |
| I-1 | Info | CONFIRMED | Pack reserved-key regex bypassable but harmless | `src/packs/verify.ts:80` |
| I-2 | Info | CONFIRMED | Zip local/central name not compared; overlap allowed (bounded) | `src/packs/zip.ts:296-305` |
| I-3 | Info | CONFIRMED | Pack signature design sound, fails closed | `verify.ts:58-70,138-163` |
| I-4 | Info | CONFIRMED | `will-download` accepts any `data:` URL | `electron/main.ts:190` |
| I-5 | Info | CONFIRMED | Save import hardening holds (tests pass) | `src/persistence/sanitize.ts` |
| I-6 | Info | CONFIRMED | Dev wallet and dev key stripped; web CSP present | `dist/index.html`, `wallet.ts:43-49` |
| I-7 | Info | CONFIRMED | Renderer console lines logged locally | `electron/main.ts:451-461` |
| I-8 | Info | n/a | Creator Kit / MCP absent on this branch; not reviewed | — |

## Appendix: reproduction scripts

Bundle with esbuild against the real sources and run with Node:

```sh
npx esbuild /tmp/claude-0/secreview/econ.ts --bundle --platform=node --format=esm \
  --outfile=/tmp/claude-0/secreview/econ.mjs --define:import.meta.env='{"DEV":false}' && node /tmp/claude-0/secreview/econ.mjs
```

- `econ.ts`:
  - `reconcileGrants` over 10 forged worlds (H-1);
  - a forged ledger built with `planAppend`, then `verifyChain` (M-1);
  - a server-only entitlement chain through `localEntitlements` (M-1);
  - an `answerAgeGate` / `sanitizeAgeProfile` wipe and edit (D-2).
- `import.ts`: export → edit `quests` → reseal both SHA-256s → `SaveManagerImpl.importFile` → `reconcileGrants` (H-1).
- `packs.ts`: escaped `__proto__` / `constructor`, a 125k-wide array and a 60k-deep manifest through `verifyPack` (I-1, I-2).

Output at `dd76fa8`:

```
[1] quests=30; 10 forged worldIds -> 29650 Bones via reconcileGrants; entitlements: cosmetic:frame_bone_gilded
[2] forged chain verifies=true, bones=500000, bones-sold entitlements granted free=23
[2b] chain with server-only ents ["headstone_decor","lantern_post","rug_funeral"] verifies=true; wallet keeps=0
[3] u13 then adult answer -> locked; hand-edited profile {adult, decidedAt} -> adult; after wiping profile, answer 1990 -> adult
import #0..#2: ok, worldId kept=true, grants reconciled=10, bones=490 (each)
[a] escaped __proto__ in contents -> rejected at manifest
[b] wide -> rejected (contents.objects must be a list)   [c] deep -> rejected (nested too deeply)
```
