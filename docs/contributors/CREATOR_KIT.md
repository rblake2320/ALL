# Afterlife Lease Creator Kit

Create original cosmetic house-brand packs using your own authoring tools and AI
account. This kit runs locally, spends no credits, reads no provider credentials,
and never signs or publishes a pack. The game remains TypeScript/Three.js/Preact;
the SDK is isolated in `scripts/creator`, outside the renderer bundle.

**Current executable path: brand skins only.** Objects, quests, lots, bodies and
creatures are **not yet admitted**. Their typed registrars are coming in
[W-084](../WORKBOARD.md). A generated GLB is an art source, not an installable
game pack. Do not invent fields or insert executable code into packs.

## Setup and first pack

Use an isolated clone/worktree and Node 22.12 or newer. From the repository root:

```sh
npm ci --ignore-scripts
npm --prefix scripts/creator ci --ignore-scripts
npm --prefix scripts/creator run build
npm --prefix scripts/creator test
node scripts/creator/cli.mjs contract
```

Create an empty directory you own, outside shared saves. The workspace must
already exist and be an absolute path; its ancestors may not be links/junctions.
For PowerShell 7, run from the repository root:

```powershell
$creatorWorkspace = Join-Path $env:TEMP ('afterlife-author-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $creatorWorkspace | Out-Null
$draft = @{ id='my-chiller'; author='Your name'; brand='Grave-Cola'; displayName='Night Chiller'; flavorText='Original house-brand artwork.' } | ConvertTo-Json -Compress
node scripts/creator/cli.mjs init --workspace $creatorWorkspace --json $draft
```

On macOS/Linux, use an absolute account-owned directory such as `$HOME/afterlife-author-01`:

```sh
mkdir "$HOME/afterlife-author-01"
node scripts/creator/cli.mjs init --workspace "$HOME/afterlife-author-01" --json '{"id":"my-chiller","author":"Your name","brand":"Grave-Cola","displayName":"Night Chiller","flavorText":"Original house-brand artwork."}'
```

Edit `drafts/my-chiller/pack.json` and `drafts/my-chiller/art/logo.svg` in that
workspace. This is the actual game manifest, not a second content format. Keep
`assets: []` in the draft: build derives that exact list, sizes and SHA-256 values
from the files. The starter targets the real `fridge_humming` catalog object with
`Paint` and `logo` cosmetic slots. `contract` lists current target IDs and approved
house brands. Use original artwork consistent with [ART_DIRECTION](../ART_DIRECTION.md)
and [IP_NOTES](../IP_NOTES.md). The starter logo demonstrates packaging; it is not
a finished art submission.

```powershell
$built = node scripts/creator/cli.mjs build --workspace $creatorWorkspace --json '{"id":"my-chiller"}' | ConvertFrom-Json
$artifact = @{ artifact=$built.artifact } | ConvertTo-Json -Compress
node scripts/creator/cli.mjs verify --workspace $creatorWorkspace --json $artifact
node scripts/creator/cli.mjs gate --workspace $creatorWorkspace --json $artifact
node scripts/creator/checks.mjs --workspace $creatorWorkspace --artifact $built.artifact
```

POSIX shells use the same commands with an absolute workspace and the artifact
ID printed by `build`: `--json '{"artifact":"<printed-artifact-id>"}'`.
Exit code 1 means failure/blocked verification; inspect stderr or the check receipt.
Do not describe a nonzero check as passed.

Artifacts live under `artifacts/<id>-<version>-<full-64-hex-sha256>/` in directory-pack form.
Same inputs produce the same bytes/hash. Existing artifacts and drafts are never
overwritten. Edit the draft and bump its manifest version for a release, then
build again. Failed staging directories remain parked for inspection. A lock
error means another writer or interrupted operation: inspect it before manually
moving the lock into a parked directory. There is no automatic lock removal,
recursive cleanup, delete, signing-key, arbitrary-command or publishing tool.

## What each gate actually checks

`build` snapshots bounded regular files, calculates the manifest's asset hashes,
and runs the game's **real** `verifyPack` in explicit offline Creator mode. It
also rejects unsupported content, unapproved/licensed brands, unknown catalog
targets and active/external SVG content. The narrow artwork profile admits only
static SVG: `svg`, `g`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`,
`path`, `text`, `title`, `desc`; bounded numeric geometry, hex fills/strokes,
plain text and generic fonts. It forbids CSS, events, scripts, URL references,
embedded images, entities, processing instructions and foreign content. Simplify
exported SVGs to that subset; do not weaken the validator to accept an export.

`verify` checks exact file membership, sizes/hashes, schema, engine version,
signature policy and artwork again. It requires canonical `pack.json` bytes and
recomputes the entire artifact name from the manifest and full directory digest.
Old 16-hex artifact names must be rebuilt from the retained draft. All-disabled
packs and advertised targets without an enabled pack skin are rejected. Every
skin must win at least one target: remove disabled entries and entries fully
overridden by later skins before building. Partial overlaps are allowed when
each skin still applies somewhere. It registers the verified pack in the actual
`PackRegistry`, resolves each target through `brandSkinFor`, records the result,
and unregisters it in `finally`. Built-in-ID collisions fail. It also checks that
the unsigned pack is rejected without Creator mode. This is an executable engine
contract demo in a Node process, not a claim that a player-facing import screen
or every renderer material binding has shipped.

`gate` writes an immutable JSON receipt bound to pack bytes, bundled engine
SHA-256, every bundled source hash and Creator Kit code hashes. Its repository
CI status stays **Blocked**. `publicationReady` is always false. These local
results cannot be substituted for lead admission or a green PR.

`checks` runs fixed local commands: renderer/Electron typechecks, all unit and
adversarial tests, web and single-file builds, source/built asset verification,
clipping regression tests and the full balance harness. Workers are capped;
steps are serial. These suites run against the repository baseline; they never
load the contributor pack. The v2 receipt separates `repositoryChecks` from
`artifactVerification`, with separate scope and outcome fields and no overall
pack-admission verdict. Contributor-pack CI remains W-084. Commands and receipt
paths are relative; child processes receive an allowlisted environment without
provider credentials, `NODE_OPTIONS`, `NODE_PATH` or Node's inherited test context.
Repository, home and workspace roots are automatically replaced with `[repo]`,
`[home]` and `[workspace]` before either output stream reaches a step log. Relative
filenames, diagnostics and failure codes remain available; review other log
content before sharing it. MCP filesystem errors report the stable error code
without the host path, and the server remains usable after a refused operation.
Logs, exit codes, timeouts, input hashes and before/after identity go into workspace receipts. A failed check remains Failed; a
timeout, failed start or changing input becomes Blocked. No user-supplied shell
command runs. Logs can be large; use a workspace with available disk space.

Brand-only packs cannot alter meshes, collisions, prices, need rates, auras or
other gameplay fields. Clipping tests exercise the existing detector; they do
not evaluate a new mesh because none is admitted. Geometry/contact-frame and
pack-aware balance tests must be added with W-084 before those content kinds
are accepted. Do not mark a future furniture/creature pack passed using this
cosmetic workflow. Current PR CI includes repository builds and browser e2e;
Windows installer validation is a separate release-lane check. `checks` does not
launch shared game instances or infer those external outcomes.

## MCP access

Use a local stdio server with an explicit absolute workspace. Example host
configuration (replace the two paths):

```json
{
  "mcpServers": {
    "afterlife-creator": {
      "command": "node",
      "args": ["/absolute/afterlife-lease/scripts/creator/mcp.mjs", "--workspace", "/absolute/my-creator-workspace"]
    }
  }
}
```

Windows paths in JSON need escaped backslashes or forward slashes. Install and
build the kit first. Registration is explicit in your host; this repository does
not change Codex settings. Tools are:

| Tool | Input | Result |
|---|---|---|
| `creator_contract` | `{}` | current content support, target IDs, brands, limits |
| `creator_init` | `id`, `author`, `brand`, `displayName`, `flavorText` | new draft; no generation |
| `creator_build` | `id` | immutable unsigned artifact and hash |
| `creator_verify` | `artifact` | real game verifier/registry evidence |
| `creator_gate` | `artifact` | local receipt; CI/admission pending |

Each input schema is strict. Tools serialize access to the process-global game
registry. Results include readable JSON and matching `structuredContent`; tool
failures have `isError: true`. Only JSON-RPC goes to stdout. This local authoring
process is not an OS sandbox: use an account-owned workspace, and do not allow
another process to replace its directories while it runs. It opens no network
listener and provides no remote credential or paid-generation tools.

Rebuild and restart the kit after changing engine sources, kit code or the lock
file. A stale bundle/source/code hash fails verification. Generated bundles are
ignored, rebuilt locally, and not treated as canonical source.

## Authoring with your own AI tools

You may use Blender, Meshy, image tools or an editor under your own account.
The pack tool needs none of those credentials. Keep a separate submission record
outside the runtime pack: creator, tool/model/version, prompts or task IDs,
dates, license/usage basis, original source file hashes, export settings, and
any human edits. Never include secrets. Asset Bank is the cross-game source
catalog (`rblake2320/asset-bank`), with its own rig/static/creature contracts and
review ownership; coordinate bank admission rather than writing into another
seat's worktree.

Two current official Meshy routes are documented:

- [Meshy for Codex](https://docs.meshy.ai/en/webapp/plugins/codex/introduction):
  local CLI production with browser sign-in, local exports, previews/task IDs,
  plus rigging, animation and remeshing. Newly installed plugin skills load in
  a new Codex session. The owner reported CLI 0.8.3 installed/authenticated on
  this workstation on 2026-11-05; other contributors set up their own account.
- [Meshy 3D for ChatGPT](https://docs.meshy.ai/en/webapp/plugins/chatgpt/introduction):
  connected account models, including existing website assets, with downloads.
  Retain downloaded files and provenance with the art source.

Generation spends credits. Agree a batch budget before any paid operation.
Existing local Meshy MCP access is also available to the team's art seats;
the absence of a tool from one session's injected list is not an access verdict.
This kit never calls Meshy or spends credits. Meshy/Blender output still needs
art, topology, footprint/contact, animation, clipping and runtime review before
future W-084 admission. Unity/Unreal exports can be source assets under the
same bank contracts; engine-specific projects do not replace this game's runtime.

## Submission and recovery

Claim one workboard item and branch, add the pack source/art provenance and
receipts in your own paths, and open a draft PR into `ship/final-phase`. Include
the complete artifact digest, source/build identity, all check results, age/IP/art
review, and proposed target objects. Preserve superseded files in a parked path
for review. No private publisher key belongs in a contributor PR.

The lead requires green CI, independent review and publisher admission. The
runtime supports Ed25519 signatures over `canonicalJson(pack.json)` including
asset hashes, with explicit trusted publisher keys. This kit cannot sign, modify
that trust list, install an unsigned pack into an online town or publish it.
The first-party builder `scripts/build-pack.mjs` is an existing house-brand
release tool, not a generic contributor signing service.

For a retained CLI + MCP demo in a fresh empty workspace:

```sh
node scripts/creator/demo.mjs /absolute/new-empty-workspace
```

It creates a real pack, checks its registry effect and production rejection,
performs real stdio calls and an invalid-input rejection, and saves
`demo-evidence.json`. Read-only model
evaluation questions are in [mcp-evaluation.xml](mcp-evaluation.xml); deterministic
protocol tests are executable, while an LLM quality score is not claimed.
