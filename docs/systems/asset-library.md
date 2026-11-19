# W-040 Reusable asset library: `rblake2320/asset-bank` (cross-game packs, manifests, provenance)
> **Superseded in part (lead, 2026-11-05, D-029):** the canonical library is the EXISTING private repo
> **`rblake2320/asset-bank`** (default branch `master`, `tools/bank.py add|add-static|export|list|catalog`, rig contract
> v1, 25 ZS2 characters already banked). Read every `asset-bank` below as `asset-bank`; delivery is **git (pinned
> commit + `bank.py export` + hash-verified import)**, not npm packages. Pack/manifest/provenance schemas in this spec
> apply as extensions of the bank's card format, proposed via PR into `asset-bank` (W-040, Claude ZSM).


Status: **implementation-ready spec v1.0** (2026-11-05). Sources: DESIGN_LIVE_WORLD §1 (owner direction: a separate
private repo holding pipelines, source references, built GLBs, versioned manifests, contact sheets, licence/provenance,
a tiny loader spec; games consume pinned packs; Afterlife Lease keeps working until the switch; migration is a
parked/moved record, never a deletion), D-002 (headless Blender, reproducible builds), D-004 (cast from Zombie Smash
2), TEAM_PLAN §6 (PARKED rule), `tools/blender/**` (shipped pipelines: `common`, `characters`, `cast`, `objects`,
`pets`), `public/assets/manifest.{cast,characters,objects,pets}.json`, `scripts/verify-assets.mjs` (SHA-256 + size
check, orphan detection), `src/shared/cast.ts` (runtime contract: glTF Y-up, metres, front +Z, feet at y = 0, our bone
names), MONETIZATION §5 (content pack format and signatures), docs/IP_NOTES.md.

W-040 is **blocked on the owner creating the private repo**. This spec lets the work start the day it exists.

## 1. Answer to the owner's question

*"Do we have a build for things that is separate from the game build?"* Not yet as a separate repo: today the asset
pipelines live inside Afterlife Lease (`tools/blender/**`), are already reproducible (byte-identical GLBs and
manifests across rebuilds) and are verified by `npm run verify:assets`. This spec moves them, unchanged, into
**asset-bank** so every future game uses the same packs — the 25 Zombie Smash 2 cast bodies, the classic zombie
rig and its 45 clips, the 69 objects, the pets, and later vehicles, build pieces and level kits — by pinned version.

## 2. Repository layout

```
asset-bank/                              (private; Git LFS for binaries)
├─ README.md                             what's here, how to build, how to consume
├─ LICENSE                               LicenseRef-Proprietary-rblake2320 (all rights reserved)
├─ PROVENANCE.md                         policy: what a provenance record must contain (§5)
├─ spec/
│  ├─ LOADER.md                          runtime contract (§4): axes, units, bone names, clip names, materials, budgets
│  ├─ bones.json                         canonical skeleton (22 bones, rest rotations) — the one source
│  └─ anim-states.json                   canonical clip names (ANIM_STATES) with fallbacks
├─ schemas/
│  ├─ pack.schema.json                   §3.1
│  ├─ manifest.schema.json               §3.2
│  └─ provenance.schema.json             §5
├─ pipelines/blender/                    moved from afterlife-lease/tools/blender (history kept, §8)
│  ├─ common/  characters/  cast/  objects/  pets/
│  ├─ vehicles/  buildpieces/  levels/   (new lanes W-032, levels art kits)
│  └─ requirements.lock                  bpy version pin (5.2.3, D-002) + python deps
├─ sources/                              references to source art, not copies, unless the owner owns them
│  ├─ zombie-smash-2.json                { repo, commit: "9c79c4c…", paths: ["assets/models/*_rigged.glb"], sha256 per file }
│  └─ ai/                                prompt + tool records for AI-assisted sources (§5.2)
├─ packs/
│  ├─ characters/   pack.json  CHANGELOG.md  params/   dist/ (zombie.glb, manifest.json, contact_sheet.png)
│  ├─ cast/         pack.json  CHANGELOG.md  params/ (lib/profiles.py tuning)  dist/ (25 GLBs, thumbs, manifest.json, contact_sheet.png)
│  ├─ objects/      …  dist/ (69 GLBs + env models)
│  ├─ pets/         …
│  └─ (vehicles, buildpieces, level-l2 …)
├─ provenance/<pack>/<assetId>.json      one record per shipped asset (§5)
├─ tools/
│  ├─ build.py                           `build.py <pack> [--only ids] [--out-dir]` (wraps each pipeline; atomic publish as today)
│  ├─ verify.mjs                         = afterlife-lease scripts/verify-assets.mjs + schema + provenance checks
│  ├─ release.mjs                        version bump, CHANGELOG, tag `<pack>@x.y.z`, npm publish
│  └─ contact-sheet.py
└─ .github/workflows/ci.yml              build (headless Blender) → reproducibility diff → verify → (on tag) publish
```

## 3. Packs and versioning

- **One pack per kind**, versioned independently with semver: `characters@1.0.0`, `cast@1.0.0`, `objects@1.0.0`,
  `pets@1.0.0`, later `vehicles@`, `buildpieces@`, `level-graveyard@`.
- **Semver meaning for assets:**
  - **major** — breaks consumers: a renamed/removed asset id, a changed bone name or rest rotation, a changed clip
    name, an axis/unit change, a triangle budget raised past a spec limit, a slot/anchor moved so placements break.
  - **minor** — additive: a new asset, a new clip, a new texture variant, a new optional manifest field.
  - **patch** — same ids and contracts, improved geometry/textures/weights within budgets (hashes change).
- Tags: `cast@1.0.0`. Each pack carries `CHANGELOG.md` (Keep a Changelog). `spec/` is versioned as `loader-spec@1`.

### 3.1 `pack.json`
```jsonc
{
  "id": "cast", "version": "1.0.0", "title": "Zombie Smash 2 cast bodies",
  "loaderSpec": 1, "rigVersion": 1,
  "requires": { "characters": "^1.0.0" },          // clips come from the characters pack's zombie.glb
  "ageRating": "E10+", "license": "LicenseRef-Proprietary-rblake2320",
  "pipeline": { "tool": "blender", "bpy": "5.2.3", "entry": "pipelines/blender/cast/build_cast.py", "commit": "<sha>" },
  "sources": ["sources/zombie-smash-2.json"],
  "budgets": { "trisPerAsset": 8800, "texBase": 1024, "texOrmNormal": 512 }
}
```

### 3.2 `manifest.json` (extends today's manifests; C46)
Today's manifests (`manifest.cast.json` etc.) stay valid: every `{file, sha256, bytes}` entry is still found by the
generic walker in `verify-assets.mjs`. Added top-level fields (all optional for old readers):
```jsonc
{
  "version": 1,                         // manifest format version (unchanged meaning)
  "pack": "cast", "packVersion": "1.0.0", "loaderSpec": 1,
  "builtFrom": { "repo": "rblake2320/asset-bank", "commit": "<sha>", "reproducible": true },
  "assets": {                           // per-pack content as today (bodies[] / objects{} …), each entry gains:
    "walker": { "file": "models/characters/cast/walker.glb", "bytes": 617080, "sha256": "…", "tris": 8800,
                "bounds": { "min": [..], "max": [..] }, "provenance": "provenance/cast/walker.json", "license": "LicenseRef-Proprietary-rblake2320" }
  },
  "totalBytes": 15490120
}
```
- `provenance` is the path inside asset-bank; the published npm package ships the records too (`provenance/`).
- Games may keep their legacy manifest shape (Afterlife Lease's `bodies[]`) by a tiny adapter in the sync step; the
  hashes are identical either way.

## 4. Loader spec (`spec/LOADER.md`, the contract every game reads)

- glTF 2.0 binary (`.glb`), **Y-up, metres, front = +Z, feet on y = 0**, origin at the footprint centre (objects) or
  the pelvis x = z = 0 (characters).
- Characters: single skinned mesh named `Body`; the 22-bone skeleton in `spec/bones.json` (root pelvis spine chest
  neck head [jaw] shoulder/upperarm/forearm/hand/prop L/R, thigh/shin/foot L/R) with identical rest rotations; clip
  names from `spec/anim-states.json`; standing height per the pack manifest; < door height (2.0 m class, per game).
- Objects: one root node, named sub-nodes for interactive parts (`door`, `water`, `screen`, brand slots per
  MONETIZATION §4), footprint in tiles in the manifest; triangle budgets per ART_DIRECTION.
- Materials: metallic-roughness PBR, base ≤ 1024², ORM/normal ≤ 512², JPEG/WebP textures, no external URIs.
- Thumbnails: WebP 256², transparent background (not hashed; Cycles noise varies).
- Each game keeps its own engine-specific rules (Afterlife Lease: seat contact `SEAT_HEIGHT`, pelvis rule in
  `manifest.cast.json`); those live in the game, the generic contract lives here.

## 5. Provenance and licence records

### 5.1 Record (`provenance/<pack>/<assetId>.json`, schema `provenance.schema.json`)
```jsonc
{
  "assetId": "cast:walker", "pack": "cast", "since": "1.0.0",
  "license": "LicenseRef-Proprietary-rblake2320",
  "owner": "rblake2320",
  "sources": [
    { "type": "owner-asset", "repo": "rblake2320/zombie-smash-2", "commit": "9c79c4c", "path": "assets/models/walker_rigged.glb",
      "sha256": "b19e01fa…", "notes": "owner's own Zombie Smash 2 model (D-004)" },
    { "type": "original-script", "path": "pipelines/blender/cast/build_cast.py", "commit": "<sha>",
      "notes": "re-skin, decimate, re-pose, retarget to our rig, zombify textures" }
  ],
  "ai": null,                                   // or §5.2
  "humanAuthorship": "pipeline parameters and per-body tuning by the team (lib/profiles.py)",
  "ipReview": { "by": "Claude Cloud", "date": "2026-11-05", "checklist": "docs/IP_NOTES.md v1", "result": "pass", "notes": "no third-party marks; original designs" },
  "thirdParty": []
}
```
`type` ∈ `original-script` (generated by our code), `owner-asset` (owner's own prior work), `ai-generated`,
`ai-assisted` (AI output substantially edited by a human), `third-party` (licensed; requires `license` SPDX id and a
saved copy of the licence text under `licenses/`), `cc0`.

### 5.2 AI-generated sources (Meshy, Higgsfield or any other tool, D-002)
Required fields when `type` is `ai-generated` or `ai-assisted`:
```jsonc
"ai": {
  "tool": "meshy", "model": "<model name/version as shown by the tool>", "date": "2026-11-05",
  "account": "owner", "termsSnapshot": "licenses/meshy-terms-2026-11-05.pdf",  // the tool's terms at generation time
  "commercialUseAllowed": true,
  "promptSha256": "…", "prompt": "sources/ai/<assetId>.prompt.txt",              // stored privately in the repo
  "inputs": ["sources/ai/<assetId>.ref.png"],                                     // reference images we made or own
  "humanEdits": "retopology, rig, hand-painted texture fixes (hours: 3)",
  "disclosure": { "steam": "pre-generated", "storePage": true }
}
```
- Policy: AI output may enter a pack only through the scripted pipeline (D-002) and IP review; outputs that resemble a
  known franchise character or a real person are rejected.
- **Copyright note** (for the owner and counsel): in the US, purely AI-generated material is not protected unless a
  human determined sufficient expressive elements; our human edits are recorded (`humanEdits`) because they are what
  is protectable.
- **Store disclosure:** Steam's content survey asks about pre-generated AI content consumed by players; packs with any
  `ai-*` source set `disclosure.steam` so the release checklist can fill the survey from the manifests (a
  `tools/ai-disclosure.mjs` report).

## 6. How games consume packs

**Primary: private npm packages on GitHub Packages** — `@rblake2320/asset-bank-cast@1.0.0` etc.
- Each package contains `dist/**`, `manifest.json`, `pack.json`, `provenance/**` (no pipelines, no sources).
- Afterlife Lease `package.json` (C47): `"@rblake2320/asset-bank-cast": "1.0.0"` (exact pin, like every other
  dependency), `.npmrc` with `@rblake2320:registry=https://npm.pkg.github.com`; CI uses a read-packages token.
- `scripts/sync-assets.mjs` (new, game-side): copies each pinned pack's `dist/` into `public/assets/` at the paths the
  game expects, writes the game's legacy manifest shape if needed, then runs `verify:assets`. `npm run build` depends
  on it. The lockfile's integrity hash protects the tarball; `verify:assets` protects every file.
- **verify:assets pin check:** fails if a manifest's `packVersion` ≠ the version pinned in `package.json`, or if any
  file hash differs from the pack manifest.

**Alternative (owner's choice, Q-A1): git submodule** at `vendor/asset-bank` pinned to a tag, with the same sync and
verify scripts. Simpler auth (SSH deploy key) but heavier clones (LFS) and no per-pack versions.

## 7. Building and CI in asset-bank

- `tools/build.py <pack>` runs the pipeline into a stage dir and publishes atomically (as `build_cast.py` does today).
- CI: build every changed pack twice into temp dirs and `cmp` → **reproducibility gate** (GLBs and manifests must be
  byte-identical; thumbnails exempt); schema-validate pack/manifest/provenance; every asset has a provenance record
  with `ipReview.result = pass`; budgets checked (tris/texture sizes from the manifest); contact sheet attached as an
  artifact.
- Heavy builds (Cycles previews) may run on a DGX Spark runner (TEAM_PLAN §8).
- Release: `tools/release.mjs cast minor` → bump, CHANGELOG, tag, publish.

## 8. Migration plan for Afterlife Lease (nothing deleted; every move parked)

| Step | Action | Proof | Rollback |
|---|---|---|---|
| 0 | Owner creates private `rblake2320/asset-bank` (W-040 blocker) and a read-packages token for CI | repo exists | — |
| 1 | **Copy** `tools/blender/**` into `pipelines/blender/` with history: `git filter-repo --path tools/blender --path-rename tools/blender/:pipelines/blender/` on a clone, then push | `git log` shows history | delete the new repo |
| 2 | Add `spec/`, schemas, `sources/zombie-smash-2.json` (commit 9c79c4c + per-file SHA-256 from the current cast report), provenance records for all current assets (generated from manifests + `report.json`; IP review fields filled) | `verify.mjs` green | — |
| 3 | Build packs in asset-bank; **byte-compare** against Afterlife Lease's current `public/assets` | identical SHA-256 for every GLB and manifest entry | fix pipeline drift before going on |
| 4 | Publish `characters@1.0.0`, `cast@1.0.0`, `objects@1.0.0`, `pets@1.0.0` | packages visible | unpublish/deprecate |
| 5 | Afterlife Lease (lead-owned change, C47): add the pinned deps + `sync-assets.mjs`; CI runs sync + verify; **`public/assets` content unchanged** (same bytes) | CI green; `git diff --stat public/assets` = 0 | revert the PR |
| 6 | After **two** green releases on packs: park the in-repo pipelines: move `tools/blender/**` to `parked/tools/blender/**` with a `docs/PARKED.md` row (what, why, where: `asset-bank@<sha>`, decider: owner), leave `tools/blender/README.md` pointing to asset-bank | PARKED entry exists | move back |
| 7 | Decide later (owner) whether committed `public/assets/**` binaries stay in the game repo or come only from packs at build time | owner decision | — |

Proposed PARKED row (for step 6, the lead writes it): `P-00x | <date> | tools/blender/** (asset pipelines) | moved to
the cross-game asset repo (W-040) | rblake2320/asset-bank@<sha> (pipelines/blender/**), copy in parked/tools/blender
| owner`.

## 9. What other games get on day one

| Pack | Contents | Reuse notes |
|---|---|---|
| `characters@1` | classic procedural zombie generator + `zombie.glb` with 45 clips | any game using the 22-bone rig |
| `cast@1` | 25 ZS2 bodies retargeted to the rig, thumbnails, contact sheet | the owner's "great looking zombies" usable everywhere |
| `objects@1` | 69 furniture/props + 12 environment models | life-sim/home props |
| `pets@1` | pets (desktop lane) | |
| later | vehicles (W-032), build pieces (W-030), level kits (L2…) | |

## 10. Acceptance tests

| # | Test |
|---|---|
| 1 | Reproducibility: two clean builds of each pack are byte-identical (GLB + manifest) |
| 2 | Parity: pack outputs == current Afterlife Lease `public/assets` hashes (migration step 3) |
| 3 | Schemas: every pack.json/manifest/provenance validates; every asset has provenance with a passed IP review |
| 4 | AI records: any `ai-*` source has tool, model, date, terms snapshot, prompt hash, human edits, disclosure |
| 5 | Game side: `verify:assets` fails on a wrong `packVersion` pin, a tampered file, an orphan (`--strict`) |
| 6 | Afterlife Lease builds and its e2e suite passes with assets from packs (no byte changes) |

## 11. Open questions for the owner / lead

| Id | Question | Default |
|---|---|---|
| Q-A1 | npm packages on GitHub Packages (default) or a git submodule? | npm |
| Q-A2 | Keep built binaries committed in game repos (offline builds) or packs-only? | keep committed until step 7 |
| Q-A3 | Vendor Zombie Smash 2 source models into asset-bank (LFS) or reference by commit only? | reference by commit + SHA-256; vendor only if ZS2 may be archived |
| Q-A4 | Licence id `LicenseRef-Proprietary-rblake2320` for all first-party assets? | yes |

## References

- [GitHub Docs: working with the npm registry (GitHub Packages)](https://docs.github.com/enterprise-server@3.14/packages/working-with-a-github-packages-registry/working-with-the-npm-registry)
  (scoped `@owner/name` packages, token with `read:packages`).
- [US Copyright Office, Copyright and AI Part 2: Copyrightability (Jan 2025)](https://copyright.gov/newsnet/2025/1060.html).
- Steam AI disclosure (pre-generated vs live-generated): [PC Gamer](https://www.pcgamer.com/valve-updates-its-steam-policy-on-ai-so-it-can-release-the-vast-majority-of-games-that-use-it),
  [PC Gamer: disclosure form focuses on player-facing content](https://www.pcgamer.com/software/ai/steam-updates-ai-disclosure-form-to-specify-that-its-focused-on-ai-generated-content-that-is-consumed-by-players-not-efficiency-tools-used-behind-the-scenes/).
- Content provenance standard (optional future step: embed C2PA manifests in thumbnails/renders):
  [C2PA: Use of Content Credentials](https://c2pa.org/wp-content/uploads/sites/33/2026/07/Use-of-Content-Credentials-to-Identify-Synthetic-and-Non-Synthetic-Content.pdf).
