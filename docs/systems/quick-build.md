# W-030 Quick Build: snap pieces, edit grid, material tiers, multi-storey (one build system)

Status: **implementation-ready spec v1.0** (2026-11-05). Sources: DESIGN_PILLARS §C (owner direction), GDD §15
(build rules, $15 per wall segment, undo), `src/sim/spatial/**` (edges, rooms, BuildService, planner), CONTRACTS
decisions #9/#21/#23, `src/shared/dimensions.ts`, `src/shared/styles.ts`, DESIGN_WORLD_LEVELS (L6 needs floor −1,
P-W11), docs/levels/README.md §2 (every lot is a 30×30 grid).

## 1. Player fantasy

*"Click, click, click: a two-storey crooked cottage with a balcony in five minutes. Cut a round window, swap the roof
to a witch-hat gable, done."* Quick Build is the fast, chunky, satisfying way to build. It sits next to the precise
classic tools (walls on edges, room rectangles, paint). The rule is **one building system, two input styles**:
whatever Quick Build places is made of the same walls, floors and openings the sim already understands, so rooms,
environment, pathing, cutaway, bills and saves all keep working.

## 2. Core idea: pieces are macros over spatial primitives

- The sim's source of truth stays the **primitives**: wall segments on edges, floor tiles, openings and objects.
  This spec extends them with **storeys** (§4).
- A Quick Build **piece** is a saved record that *owns* a set of primitives (3 wall segments, 9 floor tiles, a stair
  object, a roof cell...) and remembers the material tier and edit pattern. Placing, editing, re-materialing or
  removing a piece is **one `BuildCommand`**: the planner expands it into primitive changes, charges once, and records
  one undo entry.
- If a classic tool changes a primitive owned by a piece (deletes one segment, paints it), the piece's pattern is
  **recomputed** from the primitives (§6.4). Primitives always win. A piece with no primitives left is deleted.
  Players can freely mix tools.

## 3. The Quick Build grid

- **Cell = 3 × 3 tiles.** A wall piece spans 3 edge segments (3 m), so the **3×3 edit grid maps onto real
  primitives**: each grid **column** is one wall segment, and each **row** is a third of the wall height
  (0.9 m bands of the 2.7 m wall).
- **Grid origin** = `LotState.buildable` min corner `(x0, z0)`. Cell `(cx, cz)` covers tiles
  `[x0 + 3cx, x0 + 3cx + 3) × [z0 + 3cz, z0 + 3cz + 3)`. Only **full cells inside `buildable`** are offered. On the
  standard lot (buildable x∈[1,29), z∈[1,27)) that is **9 × 8 = 72 cells** covering x 1–27, z 1–24. The leftover
  strip (x 28, z 25–26) is still buildable with classic tools. Lots with a smaller `buildable` (apartments) get
  `floor(w/3) × floor(d/3)` cells.
- **Cell sides** (`n`/`e`/`s`/`w`) are runs of 3 edges: `n` = `h:(x0..x0+2):z0`, `s` = `h:(x0..x0+2):(z0+3)`,
  `w` = `v:x0:(z0..z0+2)`, `e` = `v:(x0+3):(z0..z0+2)`. Two neighbouring cells share a side. Placing a wall on it from
  either cell names the same piece (`pieceKey = 'w:L:<n|w>:cx:cz'`, canonicalised to the north/west owner).
- **Fine snap (opt-in):** holding `Alt` while placing a wall/floor piece snaps at **1-tile** offsets instead of
  3-tile cells, so pieces can line up with classic builds. The piece then records its own origin `(ox, oz)`. Default
  is coarse snap. Fine snap is always available because pieces are only macros.

## 4. Spatial extensions (multi-storey): exact contract changes

These are the changes SIM-SPATIAL, RENDER and SIM-ENGINE need. Everything is **additive and optional**: an absent
field means "storey 0", so every existing save and template is unchanged byte-for-byte.

### 4.1 Storeys and heights
- `src/shared/dimensions.ts`: `DIM.FLOOR_SLAB = 0.2`, `DIM.STOREY_HEIGHT = DIM.WALL_HEIGHT + DIM.FLOOR_SLAB` (= 2.9),
  `DIM.HALF_WALL = 0.9`, `DIM.SHORT_WALL = 1.8`, `MIN_STOREY = -1`, `MAX_STOREY = 2` (basement + ground + 2 upper
  floors). The world y of storey `L`'s floor is `L × STOREY_HEIGHT`, and of the basement floor `−STOREY_HEIGHT`.
- `LotState` gains:
  ```ts
  /** Storeys other than 0. Key = storey index as a string ('-1' | '1' | '2'). Storey 0 stays in walls/floors. */
  storeys?: Record<string, StoreyState>;
  /** Quick Build pieces (macros). Key = pieceId 'q<n>' from world.nextId. */
  pieces?: Record<string, QbPiece>;
  /** Roofs by storey and cell. Key = `${L}:${cx}:${cz}` (fine-snap roofs: `${L}:f:${x}:${z}`). */
  roofs?: Record<string, RoofState>;
  /** Bumped on storey/roof changes (renderer cache key; also bumps `version` when structure changes). */
  storeyVersion?: number;
  ```
  ```ts
  export interface StoreyState {
    walls: Record<EdgeKey, WallSegment>;
    /** Row-major like LotState.floors. For L ≥ 1: null = no slab (void, not walkable). For L = -1: null = undug earth (L6). */
    floors: (FloorStyleId | null)[];
  }
  ```
- `WallSegment` gains (optional, every storey including 0):
  ```ts
  /** Edit-grid column pattern = kept panels, bits b|m|t (bottom=1, middle=2, top=4). Absent = 7 (full wall).
   *  7 full · 5 window (bottom+top kept, glazed middle) · 4 doorway (top lintel only) · 3 short · 1 half.
   *  A gap (0) is never stored: the segment is deleted. 2 and 6 are invalid (floating panels). */
  pattern?: 1 | 3 | 4 | 5 | 7;
  material?: 'wood' | 'stone' | 'metal';
  pieceId?: string;
  ```
  The renderer and pathing need the semantics to be unambiguous, so the **column variants** are:

| Variant | Panels kept (b,m,t) | Encoding | Blocks walking | Separates rooms | Wall items | Door/window object allowed | Height |
|---|---|---|---|---|---|---|---|
| Full | ■■■ (b,m,t) | `pattern 7` | yes | yes | yes | door, window (replaces) | 2.7 |
| Window | ■□■ | `pattern 5` | yes | yes | no | window object replaces the built-in pane | 2.7 |
| Doorway | □□■ | `pattern 4` (top lintel only) | **no** | yes (like a door) | no | door object (fills the doorway) | 2.7 |
| Short | ■■□ | `pattern 3` | yes | yes | yes (lower 1.8 m) | — | 1.8 |
| Half / railing | ■□□ | `pattern 1` | yes | **no** | no | — | 0.9 |
| Gap | □□□ | segment **removed** (no `WallSegment`) | no | no | — | — | — |

  *Gap is never stored as a segment: an all-removed column deletes the segment, so the existing "no wall" semantics
  apply.* The two remaining masks, □■■ (6) and □■□ (2), leave **floating panels** ("nothing can float"). The edit UI
  refuses them, with the reason "That bit would float — keep the panel below it".
  Two adjacent Doorway columns render as a single **wide arch** (purely visual; both segments are passable).
  Two or three adjacent Window columns render as one wide window.

### 4.2 Placement levels
- `ObjectPlacement` variants `floor`, `wall`, `opening`, `loose` gain `level?: number` (absent = 0). `held` follows its
  agent. `checkPlace`, `checkWallItem` and `checkOpening` gain an optional trailing `level = 0`.
- `AgentState` gains `level?: number` (absent = 0) and, while on stairs/ramps, `posY` carries the interpolated height
  (already in the contract: "vertical root offset for the current pose"). The renderer adds
  `level × STOREY_HEIGHT`.
- `Vec2`-based APIs: path waypoints become `Vec2 & { level?: number }` (extra optional field; existing consumers ignore
  it).

### 4.3 SpatialAPI additions (all optional-parameter extensions, defaults = storey 0)
```ts
isWalkable(x, z, level?: number): boolean;
canStep(fx, fz, tx, tz, level?: number): boolean;           // within one storey
roomAt(x, z, level?: number): number;                        // room ids are global; RoomInfo gains level
isIndoor(x, z, level?: number): boolean;
isCovered(x, z, level?: number): boolean;                    // NEW: roof or a slab above (weather, W-034)
distanceField(from: Vec2 & { level?: number }): DistanceField; // nodes = (level, x, z), see §4.4
findPath(from: Vec2 & { level?: number }, to: { x: number; z: number; level?: number }): (Vec2 & { level?: number })[] | null;
nearestWalkable(p: Vec2 & { level?: number }, maxRadius?: number): { x: number; z: number; level: number } | null;
storeys(): number[];                                         // NEW: storeys present, ascending (always includes 0)
supportAt(x, z, level): { supported: boolean; spanLeft: number }; // NEW: §5.3
```
`DistanceField.dist/parent` index = `levelOffset(level) + z × width + x`, with levels packed in ascending order
(`storeys()`). A lot with only storey 0 has exactly today's arrays (same size, same indices). **Decision #9 / cache
behaviour stays identical for old lots.**

### 4.4 Vertical links (stairs and ramps)
- **Stair objects** are floor objects (catalog `placement: 'floor'`) at storey `L` with a new spec field:
  ```ts
  // PhysicalSpec (src/shared/catalog.ts) gains:
  vertical?: { kind: 'stairs' | 'ramp'; run: number /* tiles along local +Z */; width: number; rise: 1 /* storeys */ };
  ```
  The footprint is `width × run` tiles. With local +Z as the climb direction, the **bottom entry tile** is local
  `(i, −1)` at storey L and the **top exit tile** is local `(i, run)` at storey L+1, for each `i` in `0..width−1`.
- Pathing: footprint tiles are walkable at storey L **only along the run axis** (no sideways steps on stairs; ramps
  allow sideways), and the step from the last footprint row to the exit row moves to storey L+1. Step cost: stairs 1.5
  per tile, ramp 1.2. Crawling zombies (both legs missing) climb stairs at ×0.5 of crawl speed and ramps at normal
  crawl speed (ramps are the accessible choice, said in the catalogue blurb).
- **Stairwell:** placing stairs at storey L **auto-removes** the storey L+1 slab tiles over the footprint (a free
  stairwell, no refund needed, restored on undo or stair removal). It requires the exit row at L+1 to be a slab tile
  (or to be built in the same command; the planner checks after expansion).
- `posY` on stairs = `t × STOREY_HEIGHT` where `t` = progress along the run (0 at the bottom edge, 1 at the top edge).

### 4.5 Rooms, indoors, cutaway
- `computeRooms` runs per storey: a room is a 4-connected set of slab/floor tiles at storey L bounded by
  room-separating segments (§4.1 table) of storey L. **Indoor** (today: enclosed) is unchanged for storey 0, so
  existing room results are byte-identical. For L ≥ 1 the same enclosure rule applies. Room ids are allocated in
  storey order (0 first), so existing ids don't shift.
- Room environment (`roomEnvironment`) is per room, so it works unchanged.
- **Cutaway/view storey** (render + UI): a *view storey* `V` (PgUp/PgDn, or the storey buttons in the HUD). Storeys
  `> V` and roofs on storeys `≥ V` are hidden. Storey `V` walls follow the current WallMode (up/cutaway/down).
  Storeys `< V` are drawn fully, with their walls up. Agents on hidden storeys are hidden and show a portrait badge
  "upstairs". `pick`/`pickGrid` operate on storey `V` (an additive `level` field in the pick results).

### 4.6 BuildCommand additions
```ts
| { type: 'qbPlace'; piece: QbPlaceSpec }                          // one piece
| { type: 'qbRun'; pieces: QbPlaceSpec[] }                         // drag run, ≤ 64 pieces, one history entry
| { type: 'qbEdit'; pieceId: string; columns?: number[]; roofShape?: RoofShape; roofRot?: Rot }
| { type: 'qbMaterial'; pieceId: string; material: QbMaterial }
| { type: 'qbRemove'; pieceIds: string[] }
// Existing commands gain optional `level?: number` (default 0): buy, buyWallItem, buyOpening, move*, addWalls,
// removeWalls, room, floor, paintWall, paintRoom.

export type QbMaterial = 'wood' | 'stone' | 'metal';
export type QbPieceKind = 'wall' | 'floor' | 'stairs' | 'grandStairs' | 'ramp' | 'roof' | 'pillar';
export interface QbPlaceSpec {
  kind: QbPieceKind; level: number; material: QbMaterial;
  cell?: { cx: number; cz: number };            // coarse snap
  origin?: { x: number; z: number };            // fine snap (Alt)
  side?: 'n' | 'e' | 's' | 'w';                 // walls
  rot?: Rot;                                    // stairs/ramps/roofs
  lane?: 0 | 1 | 2;                             // narrow stairs: which tile column of the cell
  preset?: 'full' | 'doorway' | 'window' | 'half' | 'short' | 'arch'; // wall presets (= edit patterns)
  pay?: 'funds' | 'stash';                      // §7
}
export interface QbPiece {
  id: string; kind: QbPieceKind; level: number; material: QbMaterial;
  cell: { cx: number; cz: number } | null; origin: { x: number; z: number } | null;
  side?: 'n' | 'e' | 's' | 'w'; rot?: Rot; lane?: number;
  /** Owned primitives (for edits/removal; recomputed on repair). */
  edges?: EdgeKey[]; tiles?: number[]; objectId?: ObjectId; roofKey?: string;
  /** What was paid (refund basis). */
  paid: { funds: number; stash: Partial<Record<MaterialId, number>> };
  placedTick: number;
}
export type RoofShape = 'flat' | 'shed' | 'gable' | 'hip' | 'cornerOut' | 'cornerIn' | 'peak';
export interface RoofState { shape: RoofShape; rot: Rot; material: QbMaterial; pieceId?: string; styleId?: string }
```
BuildPreview gains `pieces?: QbPlaceSpec[]` (the ghosts the renderer draws) and `support?: { x; z; level; ok }[]`.

## 5. Pieces, rules and numbers

### 5.1 Palette
| Key | Piece | Footprint / primitives | Rules |
|---|---|---|---|
| `1` | **Wall** (+ presets: Doorway, Window, Arch = 2 doorway columns + window, Half, Short) | 3 segments on a cell side, storey L | each segment at L ≥ 1 must have a slab tile on at least one side, or a full/short segment directly below |
| `2` | **Floor / Platform** | 3×3 slab/floor tiles at L | L = 0: sets the floor style on any tile with none (ground already exists). L ≥ 1: a **slab**, which needs support (§5.3) |
| `3` | **Stairs** (narrow) | 1×3 stair object in a cell lane; `rot` = climb direction | §4.4; exit row needs a slab at L+1 |
| `Shift+3` | **Grand Stairs** | 3×3 stair object | same |
| `4` | **Ramp** | 3×3 ramp object (also 1×3 narrow with `Alt`) | same; accessible |
| `5` | **Roof** | one roof cell over 3×3 at storey L (sits on top of L's walls) | needs ≥ 1 full/short segment or pillar under its perimeter at storey L; blocks a slab on the same cell at L+1 (remove the roof first) |
| `6` | **Pillar** | 1×1 floor object at L, a 0.35 m post, blocks its tile | supports slabs above it (§5.3) |
| `Shift+2` | **Balcony** = a slab cell + half-wall railings on its open sides (one command, two kinds of pieces) | — | the slab must be within support span; railings are Half segments |

Decks are storey-0 platforms: a floor piece with the **Deck** floor style (outdoor, porch boards) plus optional Half
railings. They have no special rules.

### 5.2 Materials and prices (wall price parity with GDD §15)
Classic walls cost **$15/segment**. A Quick Build wood wall piece costs exactly 3 × $15, so the two input styles have
the same price. Stone and metal cost more, look different and carry a longer support span. They add **no
environment, need or room bonus**: purely look plus structure.

| Piece | Wood $ | Stone ("Bonecrete") $ | Wrought-Iron $ | Wood stash | Stone stash | Metal stash |
|---|---|---|---|---|---|---|
| Wall (3 seg) | **45** | 75 | 120 | wood 6 | bone 4, scrap 4 | scrap 6, wire 2 |
| Floor at L = 0 (9 tiles) | floor style price × tiles (unchanged classic rule) | same | same | — | — | — |
| Slab L ≥ 1 (9 tiles, incl. default floor style) | 60 | 95 | 140 | wood 10 | bone 6, scrap 6 | scrap 10, wire 3 |
| Narrow stairs | 120 | 180 | 260 | wood 10 | bone 6, scrap 6 | scrap 10, wire 3 |
| Grand stairs | 260 | 380 | 540 | wood 22 | bone 12, scrap 12 | scrap 22, wire 6 |
| Ramp (3×3) | 180 | 260 | 380 | wood 16 | bone 9, scrap 9 | scrap 16, wire 4 |
| Roof cell | 50 | 80 | 120 | wood 6, cloth 2 | bone 5, scrap 4 | scrap 6, wire 2 |
| Pillar | 25 | 40 | 60 | wood 2 | bone 2, scrap 1 | scrap 2, wire 1 |
| **Support span** (§5.3) | 2 | 3 | 4 | | | |

- **Edits are free** (removing panels refunds nothing; restoring panels removed by edits is free). That means no
  edit/undo money exploit.
- **Removal refund** (`qbRemove`, outside the session undo): $ pieces refund `floor(paid.funds × 2/3)` (matching the
  classic wall $10 of $15). Stash-paid pieces return `floor(50 %)` of each material. Openings or wall items on removed
  segments are sold/refunded by the existing rule. Undo within the session restores the exact charge, as today.
- **Re-material** (`qbMaterial`): costs `newPrice − oldPaid` when positive. A downgrade refunds 2/3 of the difference.
- Paint: wall styles apply to the **interior** sides by default, exactly like classic walls. New styles
  `wall_raw_wood`, `wall_raw_bonecrete`, `wall_raw_iron` (price 0) show the raw material (the default exterior for
  pieces of that material). Classic walls are material-less (`material` absent = the existing look).
- **Lot value and bills:** pieces add `paid.funds` (or the material market value for stash-paid pieces) to lot value.
  At bills = `0.005 × lotValue`, a 20-piece wood house (~$1,100) adds ~$5.50 per bill. Bills are unchanged in form.

### 5.3 Support (no collapse physics, ever)
Calm, deterministic and E10+: pieces **never fall**. Unsupported placements and removals are **refused**, with a clear
reason and a red overlay. The support colours are inspired by survival-builder stability overlays (blue → red), shown
only as UI.

- A **slab tile** at storey L ≥ 1 is **directly supported** if any of these is true:
  1. a full/short wall segment of storey L−1 lies on one of its 4 edges;
  2. a pillar sits on the tile below at storey L−1;
  3. a stair/ramp exit row at L lands on it (the stair supports its landing);
  4. it lies over a directly supported basement wall (L = 0 over −1 is ground and always supported).
- A slab tile is **supported** if it is within `span` steps (4-connected, through slab tiles of the same storey) of a
  directly supported tile. `span` = the tile's piece material span (wood 2, stone 3, metal 4); for classic floors at
  L ≥ 1 (if a classic floor tool is used upstairs) it is 2.
- Wall segments at L ≥ 1: allowed if a slab tile lies on either side **or** a full/short segment of L−1 lies directly
  below.
- **Removal check:** removing a wall, pillar, slab or stairs recomputes support for the affected storeys (bounded BFS
  ≤ 900 tiles × 3 storeys). If any tile would become unsupported, the command is **refused**: "Removing this would
  leave 6 floor tiles hanging — add a pillar or remove them first". The overlay highlights those tiles. Undo/redo
  replay the same checks.
- The overlay (Quick Build mode, `V` toggles) colours slab tiles by `spanLeft`: blue (direct), teal, yellow,
  orange (last step), red (unsupported preview). A colourblind pattern overlay adds stripes per step.

### 5.4 Edit grid (3×3)
- Select a placed wall piece (or hover it) and press `G` (or *Edit*). A 3×3 panel overlay appears on its face at
  storey V: columns = its 3 segments (left→right as seen from the camera side), rows = bottom/middle/top bands.
- **Mouse:** click or drag-paint panels to toggle removed/kept. **Keyboard (a11y):** arrows move the focus cell, Space
  toggles, `Enter` confirms, `Esc` cancels, `Backspace` resets to full. **Presets** (buttons and number keys inside
  edit mode): `1` Door(way) on the centre column, `2` Window centre, `3` Arch (two doorway columns + one window),
  `4` Half wall, `5` Short wall, `6` Triple window, `0` Reset.
- On confirm, each column's (b, m, t) mask maps to a variant (§4.1 table). Invalid masks (floating panels) block the
  confirm, with the column outlined in red and a tooltip. An all-gap piece is equivalent to removing the piece (with
  the removal refund).
- **Door/window objects:** after an edit, a doorway column accepts any door object (classic `buyOpening`), which turns
  the segment into today's door segment (`openingId` set; the stored `pattern 4` is kept so removing the door restores the doorway). A window object can
  replace a Window column's built-in pane. Removing the object reverts the column to the edited variant.
- **Roof edit:** `G` on a roof cell shows a 3×3 grid whose **marked panels are the high points**. Mapping (rot is
  derived from where the marks are):

| Marked panels | Shape |
|---|---|
| none | flat |
| one full edge row | shed (rising toward the marked row) |
| centre row or centre column | gable (ridge along it) |
| centre only | hip |
| centre + all 4 edge middles | peak (witch-hat) |
| one corner + its two edge middles | cornerOut |
| three corners | cornerIn |
Any other mark set snaps to the nearest shape by Hamming distance (ties broken by the order in this table). Roof
`G` + `R` cycles shapes and rotations without the grid.

### 5.5 Drag runs, rotate, undo
- **Drag-to-build:** hold the mouse on a cell side and drag. Walls follow the cell-boundary path (Manhattan, max 64
  pieces), and floors fill the dragged cell rectangle. A run is one `qbRun` command, so one undo step. The preview
  shows the total cost and the count of pieces it skips (already built).
- `R` rotates (stairs, ramps, roofs, the side for walls when hovering a cell centre). `F` cycles the material.
  `Tab` toggles pay-with $/Stash.
- **Undo/redo:** `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`) use the existing BuildService history (200 entries; one per
  command). This "instant undo" is the existing history: undo is immediate and refunds exactly.
- Agents in the way: pieces that block tiles (pillars, stairs, ramps) follow buy-mode rules. Tiles under an agent
  are allowed, and the engine relocates agents with `nearestWalkable` after the op (existing behaviour for objects).
  A slab never goes under an agent who is on a different storey.

## 6. Planner and state rules

### 6.1 Expansion
`qbPlace` expands into primitives at plan time. Ids come from `nextId` at **apply** time, never at preview (preview is
side-effect free). It returns `cost` = sum of new primitives (already-built segments/tiles cost 0 and are skipped: a
wall placed over 2 existing classic segments charges 1 × $15 for wood and adopts the 2 existing segments into the
piece, keeping their paint).

### 6.2 Limits
At most 64 pieces per `qbRun`, 900 tiles per command (existing), and 400 edges (existing). At most **600 pieces per
lot** and **3 storeys above ground**. The per-lot object cap (240 for community lots) is not counted against pieces,
because pieces are primitives, not objects (stairs/pillars are objects and do count).

### 6.3 Rooms after edits
Doorway, window and short variants still separate rooms. Half and gap variants do not, so editing a wall into a half
wall merges rooms, and environment recomputes (existing `spatial.invalidate()`).

### 6.4 Consistency and repair (decision #9 safe)
`repairWorld` checks pieces against primitives **only if `lot.pieces` exists**. A piece whose primitives disagree is
recomputed. A piece with no primitives is deleted. A primitive referencing a missing piece gets its `pieceId` removed.
Warnings are emitted only when something changed. A healthy world is a no-op. Classic edits of piece-owned primitives
update the piece in the same Tx.

### 6.5 Storey 0 identity guarantee
For any lot without `storeys`/`pieces`/`roofs`, every SpatialAPI answer, cost, room id and path is identical to the
current build. This is a **golden test** over the shipped templates (§13).

## 7. Paying with materials (W-029 tie-in)
`pay: 'stash'` charges the material column instead of $. Mixed payment is not allowed per piece. If the stash runs
short mid-run, the run stops at the last affordable piece (the preview shows where), so the player never builds half a
piece. Stash-paid pieces record `paid.stash` for refunds. Undo restores materials exactly (idempotent with the build
Tx).

## 8. UI flows

- **Mode:** Build mode gets a two-tab header, **Classic | Quick Build** (`B` toggles while in Build mode). Quick Build
  shows the piece palette (6 icons with keys 1–6), the material picker (wood/stone/metal swatches + `F`), pay-with
  ($ / Stash with counts), the storey selector (▲▼ + PgUp/PgDn, label "Ground / Upstairs / Attic / Basement"), and
  toggles for edit `G`, support overlay `V` and fine snap (hold `Alt`).
- **Ghosts:** translucent piece previews (valid = toxic green, invalid = rust red with the reason text near the cursor;
  the cost floats above). Already-built segments in a run show as faint outlines with "skip".
- **Camera:** in Quick Build the camera eases to storey V's floor height. Upper storeys are hidden per §4.5.
- **Keymap ownership:** these keys are active only while Quick Build is the active Build sub-mode, so they cannot
  collide with Live-mode hotkeys. GAME owns the key handler (CONTRACTS #16 rule), and the HUD KEYMAP documents them.
- **A11y:** every action is reachable by keyboard: arrow keys move a **cell cursor** (a visible focus ring on the cell),
  `Enter` places the selected piece, `Shift+arrows` choose the side for walls, and the edit grid is fully
  keyboard-driven (§5.4). The screen-reader live region announces "Wood wall, north side of cell 3,4, ground floor,
  45 dollars. Placed." Reduced motion turns off the snap-bounce animation.
- **Tutorial:** quest `story_ww_quickBuild` (L1): "Build a shed with Quick Build" (4 walls, 1 floor, 1 roof, 1 door
  edit), 80 Bones + the *Shed Happens* sign decor.

## 9. Render needs

- **Wall pieces as panel grids:** each segment's mesh is built from 3 stacked panels (0.9 m bands) + trims, per
  material. A variant is a visibility mask over the panels plus a frame trim for doorway/window (no CSG at runtime).
  Merged per 8×8 chunk and storey in the existing static batching (decision #23). Wall-piece meshes are generated in
  code, not GLBs: ≤ 160 tris per panel including bevels, so ≤ 480 per segment and ≤ 1,440 per piece.
- **Roofs:** 7 shapes × 3 materials, procedural (shingle rows as a normal-free geometry stepping, ≤ 900 tris per
  cell). Neighbouring roof cells of the same shape/rot merge their gable ends (the renderer checks the 4 neighbours).
- **Stairs/ramps/pillars:** GLBs per material (narrow stairs ≤ 1,800, grand ≤ 3,500, ramp ≤ 1,200, pillar ≤ 400)
  by ASSETS-OBJECTS (W-032 art).
- **Storeys:** each storey is a separate group, hidden via the view-storey rule. The slab underside renders as the
  ceiling of the storey below (a bone plaster ceiling colour by default).
- Support overlay: a per-tile coloured quad batch, 1 draw call.
- **Perf budget:** a full 72-cell, 2-storey house with roofs must stay ≤ 650 draw calls (the existing stress
  budget). Estimate: walls 8×8 chunks × 3 materials × 3 storeys ≈ 36 batches, roofs ≈ 12, stairs/pillars ≈ 20.

## 10. Audio needs

New SFX: `qbSnap` (chunky wood clack; stone and metal variants by pitch/filter), `qbRun` (rapid ticks during drag),
`qbEditPanel` (soft pop per panel), `qbRefuse` (= `placeInvalid`), `roofShingle`. `undo` exists.

## 11. Store tie-ins (cosmetic only)

Premium/bones **material skins** for the three tiers (e.g. *Gothic Stone*, *Gingerbread Haunt* trims, *Art-Deco Iron*)
with **identical span and price**. They change only the meshes and colours. Roof shingle colour packs. The *Volt-Hearse*
carport sponsor skin is in vehicles.md. Pieces are never sold for GG directly; in-world placement always costs $ or
materials.

## 12. Interplay with levels

| Level | Quick Build role |
|---|---|
| L1 | Introduces Quick Build (storey 0–1, wood); the Empty Plot is the showcase; tutorial quest |
| L2 | Mausoleum-style stone pieces unlock (story reward: *Bonecrete* tier) |
| L3 | Apartments: Quick Build allowed inside a reduced `buildable` (no upper storeys on apartment lots: `maxStorey` per LotDef, additive field `buildRules?: { maxStorey: number }`) |
| L4 | Stilt houses: stairs/ramps from the ground to storey 1 over the swamp; storey 0 = posts (pillars) only |
| L5 | Metal tier (*Wrought-Iron*) + 2 upper storeys for mansions |
| L6 | **Storey −1** (basements): dig first (L6's dig tool turns `null` earth tiles into floor), then the same Quick Build pieces apply. Stairs down = a stair object at storey −1 whose exit is at storey 0 |
| L7 | Blueprints = serialized pieces + objects (piece records are the compact form for sharing, much smaller than primitives) |

## 13. Edge cases

- **Classic room tool over a Quick Build piece:** the existing segments are kept, and new ones join no piece. The
  piece pattern is recomputed if its segments changed.
- **Door object on an upper-storey wall:** fine. An exterior door at L ≥ 1 that opens onto void is refused: "This
  door would open onto thin air".
- **Stairs with the exit blocked** by an object at L+1: refused at placement. If the blocking object is bought later,
  that is refused too (the exit tile is reserved by `vertical` links).
- **Roof over a cell with walls only on 2 sides:** allowed (needs ≥ 1). Cosmetic overhang.
- **Removing the last support of a balcony:** refused (§5.3).
- **Agents upstairs when the lot is swapped (W-025):** snapshot keeps `level`. On re-entry, `nearestWalkable` with
  level validates them, falling back to the ground near the stairs.
- **Fire (GDD §5) upstairs:** the spread rules use same-storey adjacency only. Ash falls on the same storey.
- **Repo Ghoul** repossesses only objects (stairs/pillars count with value); walls and slabs are never repossessed
  (existing rule: objects only).
- **Corrupt `storeys` key** ('7', 'abc'): ignored by spatial (outside MIN..MAX), and repair removes it with one warning.
- **Fine-snap piece overlapping a coarse cell piece:** allowed. Edges are shared primitives, and the newer piece
  adopts existing segments.
- **Undo after a lot swap:** history is dropped when `ctx.state` is replaced (existing rule).

## 14. Acceptance tests

Unit/adversarial (`tests/unit/spatial/qb/**`):
1. **Golden storey-0 identity:** for both shipped templates, every `SpatialAPI` method over every tile, `computeRooms`,
   200 random `findPath` calls and every classic `BuildCommand` preview give byte-identical results compared with
   the pre-change implementation (recorded fixtures).
2. Column variant table: all 8 masks → the correct variant (0 deletes the segment), or refusal for masks 2 and 6. Walking/room/wall-item
   rules per variant.
3. Support: fixtures for wood/stone/metal spans. A removal that would strand tiles is refused with the exact count.
   Property test: after any accepted command sequence (5,000 random ops), every slab tile is supported.
4. Price parity: a wood wall piece costs 3 × WALL_SEGMENT_PRICE. A piece over existing segments charges only the new
   ones. Remove/undo/redo refunds exactly. Re-material deltas.
5. Stash payment: a run stopping at the last affordable piece; undo restores materials exactly.
6. Stairs pathing: a path from storey 0 to storey 2 via two stair flights. No sideways steps on stairs; ramps allow
   them. A crawler on a ramp uses ×1 crawl speed. The stairwell slab is auto-removed and restored on undo.
7. Fuzz: 10,000 random qb/classic/undo/redo commands, including NaN coordinates, unknown pieceIds, levels 99/−5, and
   runs of 65 pieces. Invariants (`checkInvariants` + new: piece ↔ primitive consistency, funds ≥ 0, stash ≥ 0, no
   orphan stairwells). No throw.

Integration:
8. **Determinism:** build a 2-storey house with Quick Build, live 2 days with zombies using the upstairs bedroom. A
   save → load at random ticks gives byte-identical state. Journal replay is identical.
9. **Balance:** all BALANCE scenarios rerun unchanged (no scenario uses Quick Build). Scenario **D** (Empty Plot +
   day-1 build) gets a variant **DQ** that builds the same 9×7 crypt with Quick Build (wood). Targets as D, and funds
   within ±$10 of D (price parity).
10. Perf (CI box, headless): a distance field on a 3-storey lot (2,700 nodes) ≤ 2 ms. Support recompute after a
    removal ≤ 1 ms. Planner for a 64-piece run ≤ 5 ms. Render (desktop report): a 72-cell 2-storey house with roofs
    ≤ 650 draw calls and 60 fps on a GTX 1660 at 1080p.
11. Real-browser (Playwright): the keyboard-only flow builds a 1-room shed with a door edit and a roof; screenshots of
    each wall variant, the 7 roof shapes and the support overlay.

## References

- Fortnite-style editing (community guides; verify current behaviour in game): pieces snap to a grid; walls (and
  ramps/roofs) are edited on a 3×3 grid and floors on 2×2; the selected tiles determine the final shape; a middle-tile
  removal makes a window: [bo3.gg editing guide](https://bo3.gg/games/articles/how-to-edit-buildings-in-fortnite-2024),
  [progameguides editing guide](https://progameguides.com/fortnite/fortnite-guides/fortnite-editing-guide/). We adopt
  only the generic snap-and-edit-grid mechanic. Our grid maps columns to real wall segments, and our pieces, art and
  names are original.
- Survival-builder stability overlays (colour from most to least stable, stone/iron carrying further than wood):
  [Windows Central Valheim building guide](https://www.windowscentral.com/valheim-building-guide-build-your-base-right-way),
  [Mobalytics Valheim building guide](https://mobalytics.gg/gamebase/guides/valheim-general-building-guide). We adopt
  the idea of a support span per material tier but **never collapse** builds (refuse instead), for E10+ tone and
  determinism.
- GDD §15 (walls $15/segment, undo refunds exactly) is the price-parity basis.
