# Security review: PR #14, Creator Kit + MCP server (2026-11-06)

- **Scope:** PR #14 (`desktop/sol-creator`, author Sol), head `ef2522a336305f60cd7e9eddc2f51baf3e4344d3`, base `ship/final-phase`. 83 files changed against the base: `scripts/creator/**`, `.github/workflows/creator-kit.yml`, `tests/unit/creator/**`, `docs/contributors/**` (guide plus evidence), and ledger, changelog and workboard lines. The PR does **not** change `src/packs/**`, `src/economy/brands.ts`, `src/persistence/canonicalJson.ts` or `src/shared/catalog.ts`. All of them are byte-identical to the versions covered by `SECURITY_REVIEW_2026-11-05.md` (I-1..I-3: verifier sound).
- **Reviewer:** independent reviewer (Claude). I edited no PR source and pushed nothing. The PR was checked out into a temporary worktree, which has since been removed. The PoC scripts were throwaway files under `/tmp/claude-0/pr14-poc/`.
- **Method:**
  - Read every kit file: `core.mjs`, `mcp.mjs`, `cli.mjs`, `checks.mjs`, `demo.mjs`, `build.mjs`, `engine.ts`, the package and lock files, the tests, both workflow copies, the guide and ACCEPTANCE, and the evidence tree.
  - Ran `npm ci --ignore-scripts`, `npm run build` and `npm test` in `scripts/creator` (35/35 pass) under Node 22.23.4 on Linux.
  - Attacked the real `Creator` class and the real stdio MCP server.
- **Labels:** **CONFIRMED** means reproduced against the real code at `ef2522a`. **PLAUSIBLE** means reasoned from the code but not executed end to end (mostly Windows-only paths).

## 0. Summary

**Counts:** Critical 0 · High 0 · Medium 3 · Low 5 · Info 10.

**Peer (Terra) false passes: neither is fixed at `ef2522a`.**

1. **Not fixed, and broader than reported.** `verify` and `gate` never bind the artifact directory name to its contents. Changing only `displayName` passes, and so does a full swap of manifest `id`, `version`, `author` and the artwork (with `assets` recomputed). The pass is reported under the original, hash-looking artifact name, and the receipt says `realRegistry: Worked` (M-1).
2. **Not fixed.** A pack whose only skin is `enabled:false` builds and gates with `realRegistry: Worked`, while `fridge_humming` resolves to the built-in `grave_cola_fridge` (M-2).

**What holds up well:**
- The MCP tool surface is small: 5 tools over stdio only, with no exec, network, delete, signing or arbitrary-path input.
- Strict schemas reject every traversal, absolute-path and drive-letter input I tried.
- Symlinks, junction-style links, FIFOs and upper-case or dot-file names are rejected.
- The SVG subset validator resisted every payload I tried.
- Reserved JSON keys are rejected, escaped spellings included.
- No signing keys exist in the kit, and `trustedKeys: []` is passed explicitly.
- The CI workflow is least-privilege, with no `pull_request_target` and no secrets.

**Merge recommendation: merge after fixes M-1, M-2 and M-3** (the M-3 fix can be docs-only). Low items can follow up, but L-2 (absolute user paths in committed evidence) should be scrubbed before merge because it is cheap.

---

## 1. Findings

### MEDIUM

#### M-1: The artifact identity is not bound to its contents; `verify`, `gate` and `checks` false-pass under the original name. CONFIRMED (Terra #1 not fixed)

**Where:**
- `scripts/creator/core.mjs:213` derives the name `${id}-${version}-${packSha256[0..16]}` at build time.
- `core.mjs:218-241` (`verify`) never recomputes it. It also never compares the name with `manifest.id`, `manifest.version` or `fingerprint(files)`, and never requires `pack.json` to be in canonical form.
- `core.mjs:253-262` (`gate`) and `checks.mjs:12,54-55` inherit the gap.
- The test at `test/creator.test.mjs:117` ("fingerprints bind names and bytes") checks only `fingerprint()`, not `verify`.

**Reproduction:** `/tmp/claude-0/pr14-poc/poc1_identity.mjs`, run against the real `Creator`:

```
built honest-pack-1-0-0-0d6eb372b83d49d1 0d6eb372…
(a) displayName-only edit -> verify ok, artifact honest-pack-1-0-0-0d6eb372b83d49d1,
    packSha256 1777ea45… (prefix no longer matches the name), displayName "Swapped After Review"
(b) id -> totally-other, version 9.9.9, new author, new logo.svg (assets recomputed)
    -> gate ok, receipt receipts/honest-pack-1-0-0-0d6eb372b83d49d1-<uuid>.json,
       manifest.id totally-other 9.9.9, gates.realRegistry "Worked"
```

**Impact:**
- The artifact id looks content-addressed, and the guide calls artifacts "immutable" (`CREATOR_KIT.md:138`) and receipts "bound to pack bytes" (`:93`).
- A reviewer who checks a submission by artifact id, receipt filename or the `artifact` field gets a `Worked` receipt for content that differs from what was built: other text, other art, even another pack id and version.
- The full `packSha256` inside the receipt does change, but nothing compares it with the name.

**Fix:**
- In `verify`, recompute `${m.id}-${m.version.replaceAll('.', '-')}-${fingerprint(files).slice(0, 16)}` and require it to equal `artifact`.
- Require `files.get('pack.json')` to equal `canonicalJson(manifest) + '\n'` byte for byte.
- Better still, name artifacts with the full 64-hex digest, or have `verify`, `gate` and `checks` take the expected full `packSha256` as a required input and fail on mismatch.
- Add regression tests for each case: displayName-only, id or version change, and art swap with updated `assets`.

#### M-2: Skins that never apply still yield `realRegistry: Worked`. CONFIRMED (Terra #2 not fixed)

**Where:**
- `core.mjs:231-234`: `expected` searches only `enabled` skins. When no skin is enabled, `expected` is `undefined`, so no assertion runs.
- `core.mjs:134-138` (`inspect`) does not require skins to be enabled or usable.
- `core.mjs:256` hard-codes `realRegistry: 'Worked'` whenever `verify` did not throw.

**Reproduction:** `/tmp/claude-0/pr14-poc/poc2_disabled.mjs`:

```
disabledOnly BUILD+GATE OK realRegistry= Worked
  resolved=[{"skin":"pk_disabledonly","enabled":false,"objects":[{"object":"fridge_humming","resolvedSkin":"grave_cola_fridge"}]}]
  before=[["grave_cola_fridge"]]
```

`licensed:true` and non-house brands such as "Coca-Cola" are rejected at the game's `content` stage, whether enabled or not. That part holds. The same root cause also passes any skin that is entirely shadowed by a later skin in the same pack.

**Fix:**
- In `inspect`, require every skin to have `enabled === true` (a creator draft has no reason to ship a disabled skin).
- In `verify`, assert for every advertised (skin, object) pair that `brandSkinFor(object)?.id` is that skin, or is a later skin in the same pack. Fail if any target still resolves to its `before` value.
- Derive `gates.realRegistry` from that comparison instead of a constant.

#### M-3: The "repository checks" receipt binds a pack hash to checks that never consume the pack, and the PR claims more than CI does. CONFIRMED (code reading)

**Where:**
- `checks.mjs:20-30` runs fixed repository commands (typecheck, vitest, vite build, asset verify, clip-audit, balance). The artifact is never passed to any of them: no path, env var or registry hook.
- `checks.mjs:56-58` then writes `packSha256` and `outcome: 'Worked'` into a pack-named receipt.
- `.github/workflows/creator-kit.yml` runs only the kit's own unit tests. No CI job verifies a contributor's submitted pack.

**Claims that overstate this:**
- `CHANGELOG.md:28`: "hash-bound repository check receipts".
- `docs/WORKBOARD.md:84`, W-079: "all packs pass CI/clipping/balance gates" (status moved to `review`).
- `docs/verification/features.json`: `creator-kit` is marked proven by `tests/unit/creator`, which tests only the bundled example pack.

`CREATOR_KIT.md:105-110` is honest that the clipping tests do not evaluate the pack, but the receipt format and the ledger lines are not.

**Impact:** any pack that passes `verify` gets an identical `Worked` checks receipt. Combined with M-1, the receipt can also name the wrong content.

**Fix:**
- Either rename the checks to `repositoryBaseline` and drop "pack" wording from the receipt, CHANGELOG and WORKBOARD,
- or feed the artifact into a pack-aware step (W-084), and add a CI job that runs `creator verify` on any `docs/contributors/packs/**` in a PR, so that "CI gate" is true.

### LOW

#### L-1: TOCTOU between the per-component link check and the open lets a concurrent local writer read outside the workspace. CONFIRMED

**Where:**
- `core.mjs:104-109`: `checkedPath()` lstats and realpaths every component, then `lstatSync(full)`, then `openSync(full, O_NOFOLLOW)`.
- `O_NOFOLLOW` protects only the last component. The inode check at `:112` compares against the `lstat` taken *after* `checkedPath`, so swapping a parent directory between `checkedPath` and `lstat` is not caught.

**Reproduction:** `/tmp/claude-0/pr14-poc/poc6_race.mjs` with `poc6_race_swapper.sh` repeatedly swaps `drafts/race/art` with a symlink to an outside directory. In 60 s, 285,693 `readPack` calls produced **1 read of the outside file** (`RACE-SECRET`). All the others were rejected.

`writeDirectory` (`core.mjs:189-195`, `mkdirSync` plus `writeFileSync` with `wx` under the stage directory) has the same class of issue for writes (PLAUSIBLE, not run). It only creates new files.

**Mitigating:**
- It needs a hostile process already writing inside the workspace, which the guide places out of scope (`CREATOR_KIT.md:146-148`).
- Leaked content must still pass the SVG subset check to reach an artifact.

**Fix:** open directories with `O_DIRECTORY|O_NOFOLLOW` and walk by file descriptor. Or re-run `checkedPath` after `open` and compare `fstat` with the `lstat` of the realpath. At minimum, take the `lstat` before `checkedPath` and compare both.

#### L-2: Absolute local paths and the username are in checks receipts and committed evidence. CONFIRMED

**Where:**
- `checks.mjs:48` writes `command: [process.execPath, …]` (committed as `"C:\\nvm4w\\nodejs\\node.exe"` in `evidence/baseline-a97d8cd/receipts/*-checks-1793921444951.json:1480`).
- `checks.mjs:63` prints the absolute receipt path.
- Committed evidence contains `C:\Users\<user>\…`, the contributor's local user path, in about 20 files under `docs/contributors/evidence/**`. Examples: `luna/run.ps1:2`, `luna/guide-review.md`, `final-3a25073/demo-summary.txt`, `feature-proof.txt`, and the `superseded-484595c/*` logs.
- The guide tells every contributor to commit receipts in their PRs, so this will recur.
- Gate receipts (`core.mjs:255`) are clean: provenance input keys are relative (`../../src/...`).

**Fix:**
- Record `path.basename(process.execPath)` plus `process.version`, and print workspace-relative paths.
- Redact `os.homedir()` and `repo` in captured logs before writing receipts.
- Scrub the existing evidence.

#### L-3: Windows reserved device names and trailing-dot segments pass the pack path rules. PLAUSIBLE (accepted on Linux; Windows not run)

**Where:** `src/packs/limits.ts:20` (`SEG_RE`, shared with the game) admits `con.svg`, `nul.svg`, `aux.svg` and `art.` (trailing dot).

`/tmp/claude-0/pr14-poc/poc5_fs.mjs` built artifacts containing `art/con.svg`, `art/nul.svg`, `art/aux.svg` and `art./logo.svg` on Linux.

**Windows impact:**
- If such a pack, authored on Linux/macOS and shared through git or zip, is built or extracted on Windows, `writeDirectory` may write to a device or merge `art.` into `art` (Win32 strips trailing dots).
- Possible results are incomplete artifacts or confusing `EEXIST` errors.
- The in-memory game verifier is unaffected.

**Fix:** in `checkPackPath`, reject segments whose stem (case-insensitive) is `con|prn|aux|nul|com[0-9]|lpt[0-9]`, and reject segments ending in `.`.

#### L-4: Hard links to files outside the workspace are followed. CONFIRMED

**Where:** `core.mjs:105-109`. A hard link is a regular file, so `lstat` and `realpath` cannot detect it.

`poc5_fs.mjs` copied an outside SVG (`OUTSIDE-SECRET-TOKEN-123`) into the artifact through a draft hard link.

**Mitigating:**
- Hard links cannot travel through git or zip.
- Creating one needs write access in the workspace (and file ownership under `fs.protected_hardlinks`).
- Content must be a valid SVG.

**Fix:** reject `stat.nlink > 1` for draft and artifact files.

#### L-5: Workflow actions are pinned by mutable tag. CONFIRMED (reading)

**Where:** `.github/workflows/creator-kit.yml:23-24` (and the copy at `scripts/creator/ci-workflow.yml:23-24`) use `actions/checkout@v4` and `actions/setup-node@v4`.

**What is otherwise correct:**
- Trigger is `pull_request` (not `_target`).
- `permissions: contents: read`; no secrets; `npm ci --ignore-scripts`.
- The lock file resolves all 43 packages from registry.npmjs.org with integrity hashes; `npm audit` reports 0.

**Fix:**
- Pin both actions to full commit SHAs. Consider `persist-credentials: false` on checkout.
- Drop the stray `push: desktop/sol-creator` trigger (`:7`).
- Delete the duplicated `scripts/creator/ci-workflow.yml`, which will drift.

### INFO

| ID | Note | Evidence |
|---|---|---|
| I-1 | **MCP surface CONFIRMED minimal.** It has 5 tools (`creator_contract/init/build/verify/gate`) over stdio, `openWorldHint:false`, strict zod inputs. An unknown tool fails with "not found". No tool runs commands, opens a socket, deletes, signs or takes a path; the workspace is fixed at launch. `checks.mjs`, the only process-spawning code, is CLI-only (fixed argv, `shell:false`). | `mcp.mjs:10-16`; `poc4_mcp.mjs` |
| I-2 | **Workspace and input traversal CONFIRMED blocked.** `../../etc`, `a/../../x`, `../drafts/x`, `C:\Windows`, extra fields and `<`/control characters are rejected by schema before any filesystem access. Symlinked files, symlinked directories and symlinked `drafts/` are rejected. FIFOs, upper-case and dot-file names are rejected. `:` (ADS/drive letters) and `\`/`//` (UNC) are rejected by `checkPackPath`. | `core.mjs:16-21,79-93`; `poc4`, `poc5` |
| I-3 | **SVG subset CONFIRMED sound.** Rejected: `<script>`, `on*`, `style`, `xlink:href`, `fill="url(#)"`, DOCTYPE/entities (no expansion possible), undefined entities, `<?xml-stylesheet?>`, foreign or redeclared namespaces, `xml:space`, two roots, trailing text and UTF-16. Accepted, all harmless: `<?xml?>` declaration, BOM, numeric character references in text. There is no zip handling in the kit (directory packs only). | `core.mjs:35-70`; `poc3_svg_json.mjs` |
| I-4 | **JSON CONFIRMED safe.** `__proto__`, `\u005f_proto__` and `constructor` are rejected. A 120k-deep array raises a catchable `RangeError` (from the reviver), returned as a tool error; the server stays up. Duplicate keys resolve last-wins, and the result is then canonicalised. | `core.mjs:23-30` |
| I-5 | **Keys:** the kit contains no key material. `verifyPack` always gets `trustedKeys: []`. The bundle contains no `import.meta.env`, `VITE_DEV_PACK_PUBKEY` or placeholder-key code. A `pack.sig` is refused in drafts, and signed packs are refused by `inspect`. No `.keys/` directory, `*.pem` or `*.key` file is tracked. | `core.mjs:130-132,206`; `generated/engine.mjs` grep |
| I-6 | Receipts and provenance are self-attested. Any author can hand-write a gate or checks receipt (there is no MAC). `provenance.json` hashes detect accidental drift, not an adversary. `checks` excludes ignored files such as `node_modules` from its identity, so a locally patched test runner would still yield `Worked`. Treat every receipt as a claim and re-run in CI. | `core.mjs:243-251`, `checks.mjs:13-18` |
| I-7 | `checks.mjs:42` passes the full `process.env` to the repository suites, including any AI or provider tokens the contributor has exported. Their logs are written to receipts that contributors are told to commit. I saw no leak in the evidence, but use an env allowlist (`PATH`, `CI`, `HOME`/`USERPROFILE`, `TEMP`). | `checks.mjs:41-42` |
| I-8 | Filesystem error text reaches the MCP client verbatim, for example `EEXIST: … open '/abs/ws/drafts/.leak-id.lock'`. It is local and the client already knows the workspace, but mapping errors to workspace-relative messages is cleaner. | `mcp.mjs:26` |
| I-9 | Prompt-injection surface: `verify`/`gate` return pack text fields (author ≤ 80, displayName ≤ 60, flavorText ≤ 200, no `<>`/control characters) to the host LLM. That matters only when verifying someone else's pack. This server has no dangerous tools, but the host may. | `core.mjs:237` |
| I-10 | `verify` checks that targets exist in the catalog, but not that the livery and decal slots (`Paint`, `logo`) exist on the target object, or that every SVG asset is referenced. The guide says this; mentioned so it is not later read as a render check. | `core.mjs:134-138` |

---

## 2. Peer-reported issues at `ef2522a`

| Terra report | Status | Evidence |
|---|---|---|
| Editing only the artifact `displayName` still passes `creator.verify` under the original name | **Not fixed**, and broader: id, version, author and art swaps also pass (M-1) | `poc1_identity.mjs` |
| A pack whose only skin has `enabled=false` builds, and gate reports `realRegistry=Worked` while the built-in skin resolves | **Not fixed** (M-2) | `poc2_disabled.mjs` |

Neither has a regression test in `scripts/creator/test/*.mjs`. The branch history for `scripts/creator` has three commits (`f26fd2a`, `6dc676e`, `3a25073`), and none of them touches `verify`.

## 3. What I could not check

- **Windows behaviour.** I ran nothing on Windows, so the following are reasoned only:
  - junction detection through `lstat().isSymbolicLink()`;
  - UNC or `\\?\` workspace roots;
  - case-insensitive `path.relative` across drives;
  - device names and trailing dots (L-3);
  - `O_NOFOLLOW` absence (`?? 0`) on Windows, which widens L-1 there.
- **macOS:** case-insensitive APFS and `/private/var` aliasing. The kit test for temp-directory aliases passes on Linux only.
- **Actual MCP host behaviour** (Claude Desktop, Codex): how hosts treat `readOnlyHint` and present tool output.
- **GitHub repository settings:** branch protection, fork-PR approval policy, and whether `Creator Kit` is a required check. I did not run the workflow; I only read the committed CI log.
- **The full `checks.mjs` run** (about 1 h). It was read, not executed.
- **Upstream advisories** for `@modelcontextprotocol/server@2.4.0`, `saxes@6.0.0` and `zod@4.6.7` beyond `npm audit` (0 findings).

## Appendix: reproduction scripts (`/tmp/claude-0/pr14-poc/`)

| Script | Purpose |
|---|---|
| `poc1_identity.mjs` | M-1: displayName-only edit, then full id/version/art swap, under the original artifact name |
| `poc2_disabled.mjs` | M-2: disabled-only skin passes; licensed or real-brand variants are correctly rejected |
| `poc3_svg_json.mjs` | I-3, I-4: SVG and JSON payload battery |
| `poc4_mcp.mjs` | I-1, I-2, I-8: real stdio MCP: tool list, traversal inputs, unknown tool, error text |
| `poc5_fs.mjs` | L-3, L-4, I-2: symlinks, hard links, FIFOs, case, device names, trailing dots |
| `poc6_race.mjs` + `poc6_race_swapper.sh` | L-1: parent-directory symlink swap race against `readPack` |

---

## Re-check 2026-11-06 @2872a09

**Scope:**
- The branch was force-pushed (rebased onto `7781204`). The fix commit is `ddd03e7`.
- `git diff ddd03e7 2872a09 -- scripts/creator .github src tests` is empty, which confirms Sol's statement that the commits after `ddd03e7` touch only docs and evidence.
- Sol's description of the fixes is in `docs/contributors/SECURITY_REVISION.md`.
- I rebuilt the kit (`npm ci --ignore-scripts`, `npm run build`) in a fresh worktree; `npm test` passes 47/47.
- I re-ran every original PoC from `/tmp/claude-0/pr14-poc/` against the new code, plus these new ones:
  - `poc1b_identity.mjs`: per-case copies of the artifact, a non-canonical `pack.json` and a shortened name.
  - `poc2b_shadow.mjs`: overlapping and uncovered skins.
  - `poc5b_hl_artifact.mjs`: a hard link inside a built artifact.
  - `poc7_env.mjs`: what environment a child process actually receives.
  - `poc8_logpaths.mjs`: whether a real vitest step log contains absolute paths.

### Verdicts

| Finding | Verdict | Reproduction at 2872a09 |
|---|---|---|
| **M-1**: artifact name not bound to its contents | **FIXED** | `verify` now requires canonical `pack.json` bytes (`core.mjs:234`). It also recomputes `id-version-<full 64-hex fingerprint>` through the same `artifactName()` used by build, and requires a match (`core.mjs:133-136,236`). Results from `poc1b`, each rejected with no receipt written: displayName, id, version, author, art swap with recomputed `assets`, non-canonical JSON, and the legacy 16-hex short name. The untampered control still passes. |
| **M-2**: never-applied skins and hard-coded `realRegistry` | **FIXED** | `inspect` requires at least one enabled skin, and every advertised target must be covered by an enabled skin (`core.mjs:144,148`). `verify` throws when `expected` is missing (`core.mjs:249`). `gate` derives `realRegistry` from a non-empty `targetAssertions` list (`core.mjs:273`). In `poc2`, disabledOnly is rejected ("Pack requires at least one enabled skin"); the licensed and real-brand variants are still rejected. In `poc2b`, an enabled skin plus a disabled skin on an uncovered target is rejected. |
| **M-3**: receipt and claims overstate the checks | **FIXED** | The checks receipt is now v2 (`checks.mjs:26-38`). It keeps `repositoryChecks` (scope "contributor pack is not loaded") apart from `artifactVerification`, with no overall admission outcome. CHANGELOG:10, WORKBOARD W-079 and the `features.json` `creator-kit` name now state that pack-aware CI, clipping and balance checks are deferred to W-084. Pack-aware CI itself still does not exist; that is now stated rather than claimed. |
| **L-2**: absolute paths, in receipts | **FIXED** | `command` is now `['node', ...relative argv]` (`checks.mjs:70`). The receipt path is workspace-relative (`:77`), the `runtime` entry is node/platform/arch only, and spawn errors are reduced to `e.code`. Gate receipts were already clean. |
| **L-2**: absolute paths, in committed evidence | **FIXED** | I grepped all 127 files the PR changes and the whole `docs/contributors/` tree for `C:\Users`, `C:/Users`, `/home/`, `/Users/`, `<user>`, `nvm4w`, `AppData` and any `X:\` drive path. The only hits are repo-relative `tests/unit/home/...` and `src/sim/content/home/...`. vitest `RUN` lines read `RUN v3.2.7 .`. `seal.json` reports `absoluteHostPaths: 0` with 35 redactions. |
| **L-2**: absolute paths, in *new* step logs | **NOT FIXED** (residual, Low) | `checks.mjs` still writes raw child stdout to the step `.txt` logs. `poc8` ran a real vitest step through `runRepositoryCommand`, and the log contains `RUN v3.2.7 /tmp/claude-0/pr14-review`. On Windows that would be `C:\Users\<name>\...`. The committed evidence is clean only because Sol scrubbed it by hand. The guide still asks contributors to commit receipts, so the leak will recur. **Fix:** replace `repo`, `os.homedir()` and the workspace path in the logs with fixed placeholders (both slash forms), or tell contributors to scrub logs before committing them. |
| **L-4**: hard links followed | **FIXED** | `nlink !== 1` is now rejected three times: on `lstat`, on the opened descriptor, and after the read (`core.mjs:108,113,119`). In `poc5`, a draft hard link is rejected ("Hard links are forbidden"). In `poc5b`, a hard link inside a built artifact is rejected with no receipt; after unlinking, the gate passes again. |
| **L-5**: stray push trigger and duplicate workflow | **FIXED** | `push` now covers only `[main, 'ship/**']` (`creator-kit.yml:6-7`), and `scripts/creator/ci-workflow.yml` is deleted (no tracked copy). |
| **L-5**: action SHA pinning | **NOT FIXED** (not claimed) | `actions/checkout@v4` and `actions/setup-node@v4` are still pinned by tag (`creator-kit.yml:23-24`). Low; can be a follow-up. |
| **Info I-7**: minimal child environment | **FIXED** | `minimalEnvironment()` passes only an allowlist (`checks.mjs:9-13`), and it is used for both the suites and the git probes. In `poc7`, I set synthetic `MESHY_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `NODE_OPTIONS`, `NODE_PATH` and `HTTPS_PROXY`; the child received only `CI,HOME,PATH`. |
| L-1: TOCTOU race; L-3: Windows reserved names | Deferred (agreed) | Not re-tested. L-3 still builds `con.svg`, `nul.svg`, `aux.svg` and `art./` on Linux (`poc5`). |

### Did the fixes weaken anything or add a new false pass?

- **No regression found:**
  - The MCP surface is unchanged: the same 5 tools, and an unknown tool fails.
  - The SVG and JSON payload battery gives the same 18 rejections.
  - Symlinks, FIFOs and upper-case names are still rejected.
  - Licensed and non-house brands are still rejected.
- **Fails closed:** if the artifact changes while `checks.mjs` runs, the second `verify` throws and the process exits non-zero without a summary receipt.
- **`artifactSchema` widened** from 120 to 180 characters to fit the 64-hex digest. The charset is still `[a-z0-9-]`, and any name that does not equal the recomputed name is rejected, so this widens nothing exploitable.
- **New Info (I-11):** a skin that is enabled but fully shadowed by a later skin in the same pack, or disabled but covered by another enabled skin, still passes (`poc2b`). The receipt is truthful about it: `targetAssertions` show `expected`/`actual` equal to the later skin. Its text and art ship in the pack but never render, which reviewers should know. Optional fix: reject skins that resolve nowhere.
- **Info I-8 still stands:** filesystem errors still return absolute paths to the MCP client (`EEXIST … /abs/ws/drafts/.leak-id.lock`).

### Recommendation

**Merge.** All three Mediums, L-4 and the I-7 environment note are fixed and reproduced as fixed, and no new false pass was found. Remaining Lows, suitable as follow-ups rather than blockers:

- the L-2 residual: redact host paths in newly written step logs;
- L-5 SHA pinning;
- the deferred L-1 race and L-3 Windows names.

The merge is still subject to green CI on the current head, which I did not observe.
