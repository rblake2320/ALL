/**
 * Buy-mode input and state (GameController.buy).
 *
 *  - Catalog placement: a ghost follows renderer.pickGrid(); validity from sim.spatial.checkPlace /
 *    checkWallItem / checkOpening (by PhysicalSpec.placement), blocked slots marked. R / rotatePlacement rotates.
 *    Click places ONE item (sim build 'buy' / 'buyWallItem' / 'buyOpening') and returns to the catalog with the item
 *    still highlighted (W-116, D-062 — the Sims convention). Shift+click (Shift+Enter by keyboard) or the touch
 *    "Place another" toggle keeps placing; Done / Esc / right-click stop.
 *  - Hand tool: clicking an existing object picks it up to move (original hidden via renderer.setHiddenObject);
 *    the next valid click moves it ('move' / 'moveWallItem' / 'moveOpening'), Esc puts it back. Delete sells the
 *    carried or hovered object.
 * Every spatial/renderer call is guarded: a throwing check reads as "can't place here", never a crash.
 */
import type { BuyState } from '../contracts';
import type { BuildCommand, ObjectDef, PlacementResult, SimulationAPI } from '../../sim/contracts';
import type { EdgeKey, ObjectId } from '../../sim/types';
import type { PlacementGhost } from '../../render/contracts';
import { BUY_CATEGORIES } from '../../shared/catalog';
import { serviceOf } from '../../shared/homeBuild';
import { clampTile, floorOrigin, gridPoint, gridStepForScreen, normalizeRot, slotMarkerTiles, tileEdge, type ScreenDir, type TileXZ } from './grid';
import { formatMoney, placementText } from './format';
import { objectHoverLabel } from './live';
import { placementVerdict } from './placementPreview';
import type { InputHost, ModeHandler, Mods, PointerPos, PrimaryDownResult } from './types';

type Candidate =
  | { kind: 'floor'; x: number; z: number; result: PlacementResult }
  | { kind: 'wall'; edge: EdgeKey; side: 0 | 1; result: PlacementResult }
  | { kind: 'opening'; edge: EdgeKey; result: PlacementResult };

const NO_PLACE: PlacementResult = { ok: false, reason: "Can't place here", tiles: [], blockedSlots: [], cost: 0 };

function guardResult(fn: () => PlacementResult): PlacementResult {
  try {
    const r = fn();
    if (!r || typeof r !== 'object') return NO_PLACE;
    return {
      ok: r.ok === true,
      reason: typeof r.reason === 'string' ? r.reason : undefined,
      tiles: Array.isArray(r.tiles) ? r.tiles : [],
      blockedSlots: Array.isArray(r.blockedSlots) ? r.blockedSlots : [],
      cost: Number.isFinite(r.cost) ? r.cost : 0,
    };
  } catch {
    return NO_PLACE;
  }
}

/** Wall items, doors and windows snap to a wall edge instead of covering floor tiles. */
function isEdgePlacement(def: ObjectDef): boolean {
  return def.placement === 'wall' || def.placement === 'door' || def.placement === 'window';
}

export function isMovableObject(sim: SimulationAPI, id: ObjectId): boolean {
  const o = sim.object(id);
  if (!o) return false;
  const k = o.placement.kind;
  if (k !== 'floor' && k !== 'wall' && k !== 'opening') return false;
  const def = sim.content.objects[o.defId];
  return !!def && def.buyable !== false;
}

export class BuyInput implements ModeHandler {
  readonly state: BuyState = { placingDefId: null, movingObjectId: null, rot: 0, tint: null, category: BUY_CATEGORIES[0]?.id ?? 'seating', hoverObjectId: null, keepPlacing: false, lastDefId: null };
  private lastPos: PointerPos | null = null;
  private candidate: Candidate | null = null;
  private ghostKey = '';
  /** Snap-point markers currently shown (home build rules): the key says for which item / count / lot they were made. */
  private snapKey = '';
  /**
   * Keyboard placement cursor (WCAG 2.1.1, W-064): while set, the ghost sits on this tile instead of following the
   * pointer. Arrow keys create/move it, a real pointer move hands control back to the mouse.
   */
  private kb: TileXZ | null = null;
  private announceSeq = 0;
  /** Latest screen-reader announcement for keyboard placement (GameController.placementAnnouncement). */
  announcement: { seq: number; text: string } | null = null;

  constructor(private readonly host: InputHost) {}

  /** Snapshot for the UI (a new object only when something changed). */
  private snap: BuyState = { ...this.state };
  view(): BuyState {
    const s = this.state;
    const v = this.snap;
    if (
      v.placingDefId !== s.placingDefId ||
      v.movingObjectId !== s.movingObjectId ||
      v.rot !== s.rot ||
      v.tint !== s.tint ||
      v.category !== s.category ||
      v.hoverObjectId !== s.hoverObjectId ||
      v.keepPlacing !== s.keepPlacing ||
      v.lastDefId !== s.lastDefId
    ) {
      this.snap = { ...s };
    }
    return this.snap;
  }

  /** BuyState.hoverObjectId: placed object under the cursor (UI offers Sell / Move). */
  private setHovered(id: ObjectId | null): void {
    if (this.state.hoverObjectId === id) return;
    this.state.hoverObjectId = id;
    this.host.changed(false);
  }

  private def(sim: SimulationAPI, defId: string | null): ObjectDef | null {
    if (!defId) return null;
    const d = sim.content?.objects?.[defId];
    return d && typeof d === 'object' ? d : null;
  }

  setCategory(category: string): void {
    if (typeof category !== 'string' || category.length === 0 || category.length > 40) return;
    this.state.category = category;
    this.host.changed(true);
  }

  startPlacing(defId: string, tint?: string | null): boolean {
    const sim = this.host.sim();
    const def = sim ? this.def(sim, defId) : null;
    if (!sim || !def || def.buyable !== true || def.placement === 'item') {
      this.host.sfx('uiError');
      return false;
    }
    this.dropMoving();
    this.state.placingDefId = defId;
    this.state.lastDefId = defId;
    this.state.tint = this.validTint(def, tint === undefined ? null : tint);
    this.ghostKey = '';
    this.refresh();
    this.host.sfx('uiClick');
    // a keyboard cursor that was already out (switching items) stays where it is
    this.announce(this.kb && this.host.sim() ? `${placementText.start(this.itemName(defId))} ${this.positionText(this.host.sim()!, this.kb)}` : placementText.start(this.itemName(defId)));
    this.host.changed(true);
    return true;
  }

  pickUp(objectId: ObjectId): boolean {
    const sim = this.host.sim();
    if (!sim || !isMovableObject(sim, objectId)) {
      this.host.sfx('uiError');
      return false;
    }
    const obj = sim.object(objectId)!;
    this.kb = null;
    this.dropMoving();
    this.state.movingObjectId = objectId;
    this.state.placingDefId = obj.defId;
    this.state.rot = obj.placement.kind === 'floor' ? normalizeRot(obj.placement.rot) : this.state.rot;
    this.state.tint = typeof obj.tint === 'string' ? obj.tint : null;
    this.guard(() => this.host.renderer.setHiddenObject(objectId));
    this.ghostKey = '';
    this.host.sfx('pickUpObject');
    this.refresh();
    this.host.changed(true);
    return true;
  }

  rotate(dir: 1 | -1): void {
    const d = dir === -1 ? -1 : 1;
    this.state.rot = normalizeRot(this.state.rot + d);
    if (this.state.placingDefId) this.host.sfx('rotateObject');
    this.refresh();
    if (this.kb && this.state.placingDefId) this.announce(`${placementText.rotated(this.state.rot)} ${this.statusText()}`);
    this.host.changed(true);
  }

  setTint(tint: string | null): void {
    const sim = this.host.sim();
    const def = sim ? this.def(sim, this.state.placingDefId) : null;
    this.state.tint = def ? this.validTint(def, tint) : tint === null || (typeof tint === 'string' && /^#[0-9a-fA-F]{6}$/.test(tint)) ? tint : this.state.tint;
    this.refresh();
    this.host.changed(true);
  }

  private validTint(def: ObjectDef, tint: string | null): string | null {
    if (tint === null) return null;
    if (typeof tint !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(tint)) return null;
    return tint;
  }

  /** Esc / right-click / cancelPlacement. Returns true if something was active. */
  cancel(): boolean {
    const active = this.state.placingDefId !== null || this.state.movingObjectId !== null;
    if (active && this.kb) this.announce(placementText.cancelled(this.itemName(this.state.placingDefId)));
    this.kb = null;
    this.dropMoving();
    this.state.placingDefId = null;
    this.candidate = null;
    this.ghostKey = '';
    this.guard(() => this.host.renderer.setPlacementGhost(null));
    this.updateSnapMarkers();
    this.host.setBuildPreviewLabel(null);
    if (active) this.host.changed(true);
    return active;
  }

  /** The placement bar's Done (W-116): stop placing, back to the catalog (the item stays highlighted). */
  done(): boolean {
    return this.cancel();
  }

  /** The touch "Place another" toggle (W-116). */
  setKeepPlacing(on: boolean): void {
    const v = on === true;
    if (this.state.keepPlacing === v) return;
    this.state.keepPlacing = v;
    this.host.changed(true);
  }

  private dropMoving(): void {
    if (this.state.movingObjectId !== null) {
      this.state.movingObjectId = null;
      this.state.placingDefId = null;
      this.guard(() => this.host.renderer.setHiddenObject(null));
    }
  }

  sell(objectId: ObjectId): boolean {
    const sim = this.host.sim();
    if (!sim || typeof objectId !== 'string' || !sim.object(objectId)) return false;
    const wasMoving = this.state.movingObjectId === objectId;
    const ok = this.host.applyBuild({ type: 'sell', objectId });
    if (ok && wasMoving) {
      this.state.movingObjectId = null;
      this.state.placingDefId = null;
      this.guard(() => this.host.renderer.setHiddenObject(null));
      this.guard(() => this.host.renderer.setPlacementGhost(null));
      this.host.setBuildPreviewLabel(null);
    }
    if (ok && this.state.hoverObjectId === objectId) this.setHovered(null);
    this.host.changed(true);
    return ok;
  }

  /** Delete key: sell the carried object, else the hovered one. */
  sellCurrent(): boolean {
    const id = this.state.movingObjectId ?? this.state.hoverObjectId;
    return id ? this.sell(id) : false;
  }

  /** World changed (undo, lot event, funds) or rotation: recompute the ghost at the last pointer position. */
  refresh(): void {
    this.ghostKey = '';
    const sim = this.host.sim();
    if (this.kb && this.state.placingDefId && sim) this.updateGhostAtTile(sim, this.kb);
    else if (this.lastPos) this.hover(this.lastPos);
    else if (!this.state.placingDefId) this.guard(() => this.host.renderer.setPlacementGhost(null));
  }

  /** The moved object vanished (sold elsewhere / burned / repossessed). */
  objectRemoved(id: ObjectId): void {
    if (this.state.movingObjectId === id) this.cancel();
    if (this.state.hoverObjectId === id) this.setHovered(null);
  }

  // ───────────────────────── ModeHandler ─────────────────────────

  hover(pos: PointerPos): void {
    this.lastPos = pos;
    const sim = this.host.sim();
    if (!sim) return;
    // keyboard placement owns the ghost until the pointer really moves (pointerMoved)
    if (this.kb && this.state.placingDefId) return;
    if (!this.state.placingDefId) {
      this.candidate = null;
      const pick = this.safePick(pos, { objects: true });
      if (pick && pick.kind === 'object' && isMovableObject(sim, pick.objectId)) {
        this.setHovered(pick.objectId);
        this.guard(() => this.host.renderer.setHover({ kind: 'object', id: pick.objectId }));
        this.host.setHoverLabel(objectHoverLabel(sim, pick.objectId, true));
      } else {
        this.setHovered(null);
        this.guard(() => this.host.renderer.setHover(null));
        this.host.setHoverLabel(null);
      }
      return;
    }
    this.setHovered(null);
    this.guard(() => this.host.renderer.setHover(null));
    this.host.setHoverLabel(null);
    this.updateGhost(sim, pos);
  }

  private safePick(pos: PointerPos, opts: { objects?: boolean; walls?: boolean }) {
    try {
      return this.host.renderer.pick(pos.cx, pos.cy, { agents: false, objects: !!opts.objects, walls: !!opts.walls, tiles: false });
    } catch {
      return null;
    }
  }

  private safeGrid(pos: PointerPos) {
    try {
      return this.host.renderer.pickGrid(pos.cx, pos.cy);
    } catch {
      return null;
    }
  }

  private wallUnderCursor(pos: PointerPos): { edge: EdgeKey; side: 0 | 1 } | null {
    const p = this.safePick(pos, { walls: true });
    if (p && p.kind === 'wall') return { edge: p.edge, side: p.side };
    const g = this.safeGrid(pos);
    if (g && typeof g.edge === 'string') return { edge: g.edge, side: g.edgeSide === 0 ? 0 : 1 };
    return null;
  }

  private updateGhost(sim: SimulationAPI, pos: PointerPos): void {
    const defId = this.state.placingDefId!;
    const def = this.def(sim, defId);
    if (!def) {
      this.cancel();
      return;
    }
    let built: { cand: Candidate; ghost: PlacementGhost } | null = null;
    const g = this.safeGrid(pos);
    if (isEdgePlacement(def)) {
      const w = this.wallUnderCursor(pos);
      if (w) built = this.edgeCandidate(sim, def, w.edge, w.side);
      this.host.setGridHover(g ? { x: g.x, z: g.z, edge: g.edge } : null);
    } else if (g) {
      built = this.floorCandidate(sim, def, gridPoint(g));
      this.host.setGridHover({ x: g.x, z: g.z, edge: g.edge });
    } else {
      this.host.setGridHover(null);
    }
    this.show(built);
  }

  /** Keyboard cursor: the ghost centred on tile `t` (floor items) or on the tile's edge picked by the rotation. */
  private updateGhostAtTile(sim: SimulationAPI, t: TileXZ): void {
    const def = this.def(sim, this.state.placingDefId);
    if (!def) {
      this.cancel();
      return;
    }
    if (isEdgePlacement(def)) {
      const e = tileEdge(t.x, t.z, this.state.rot);
      this.show(this.edgeCandidate(sim, def, e.edge, e.side));
      this.host.setGridHover({ x: t.x, z: t.z, edge: e.edge });
    } else {
      this.show(this.floorCandidate(sim, def, { x: t.x + 0.5, z: t.z + 0.5 }));
      this.host.setGridHover({ x: t.x, z: t.z, edge: null });
    }
  }

  private floorCandidate(sim: SimulationAPI, def: ObjectDef, cursor: { x: number; z: number }): { cand: Candidate; ghost: PlacementGhost } {
    const defId = this.state.placingDefId!;
    const rot = this.state.rot;
    const o = floorOrigin(def.footprint, rot, cursor);
    const shape = () => guardResult(() => sim.spatial.checkPlace(defId, o.x, o.z, rot, this.state.movingObjectId));
    const result = this.verdict(sim, { kind: 'floor', x: o.x, z: o.z, result: NO_PLACE }, shape);
    let markers: { x: number; z: number }[] = [];
    try {
      markers = result.blockedSlots.length > 0 ? slotMarkerTiles(def, o.x, o.z, rot, result.blockedSlots) : [];
    } catch {
      markers = [];
    }
    return {
      cand: { kind: 'floor', x: o.x, z: o.z, result },
      ghost: { defId, x: o.x, z: o.z, rot, valid: result.ok, tint: this.state.tint, tiles: result.tiles, blockedSlots: markers },
    };
  }

  private edgeCandidate(sim: SimulationAPI, def: ObjectDef, edge: EdgeKey, side: 0 | 1): { cand: Candidate; ghost: PlacementGhost } {
    const defId = this.state.placingDefId!;
    const moving = this.state.movingObjectId;
    if (def.placement === 'wall') {
      const shape = () => guardResult(() => sim.spatial.checkWallItem(defId, edge, side, moving));
      const result = this.verdict(sim, { kind: 'wall', edge, side, result: NO_PLACE }, shape);
      return { cand: { kind: 'wall', edge, side, result }, ghost: { defId, edge, side, valid: result.ok, tint: this.state.tint, tiles: result.tiles } };
    }
    const shape = () => guardResult(() => sim.spatial.checkOpening(defId, edge, moving));
    const result = this.verdict(sim, { kind: 'opening', edge, result: NO_PLACE }, shape);
    return { cand: { kind: 'opening', edge, result }, ghost: { defId, edge, valid: result.ok, tint: this.state.tint, tiles: result.tiles } };
  }

  /**
   * Ghost colour, label and click share one verdict: the build preview of the exact command commit() would send
   * (funds, not-for-sale and the planner's rules included). The spatial check only supplies tiles for drawing.
   */
  private verdict(sim: SimulationAPI, c: Candidate, display: () => PlacementResult | null): PlacementResult {
    const cmd = this.commandFor(c);
    return cmd ? placementVerdict(sim, cmd, display) : NO_PLACE;
  }

  /**
   * Home build rules: while the first 20 items go on snap points, glowing markers show where the item being placed
   * may stand. Cached by item / placed count / lot version, so moving the pointer costs nothing.
   */
  private updateSnapMarkers(): void {
    const sim = this.host.sim();
    const defId = this.state.movingObjectId === null ? this.state.placingDefId : null;
    const hb = sim?.state.homeBuild;
    const key = sim && defId && hb && (!hb.freePlacement || serviceOf(defId)) ? `${defId}:${hb.placedEver}:${sim.state.lot.version}:${Object.keys(sim.state.objects).length}` : '';
    if (key === this.snapKey) return;
    this.snapKey = key;
    const pts = key && sim && defId ? this.snapPointsOf(sim, defId) : null;
    this.guard(() => this.host.renderer.setSnapPoints?.(pts));
  }

  private snapPointsOf(sim: SimulationAPI, defId: string): { x: number; z: number; kind: string }[] | null {
    try {
      return sim.spatial.snapPoints?.(defId) ?? null;
    } catch {
      return null;
    }
  }

  private show(built: { cand: Candidate; ghost: PlacementGhost } | null): void {
    this.updateSnapMarkers();
    const cand = built?.cand ?? null;
    const ghost = built?.ghost ?? null;
    this.candidate = cand;
    const key = ghost ? JSON.stringify([ghost.x, ghost.z, ghost.rot, ghost.edge, ghost.side, ghost.valid, ghost.tint, ghost.defId, ghost.tiles.length]) : 'none';
    if (key !== this.ghostKey) {
      this.ghostKey = key;
      this.guard(() => this.host.renderer.setPlacementGhost(ghost));
    }
    this.host.setBuildPreviewLabel(cand ? this.label(cand) : null);
  }

  // ───────────────────────── keyboard placement (W-064) ─────────────────────────

  /** A catalog item / carried object is being placed. */
  isPlacing(): boolean {
    return this.state.placingDefId !== null;
  }

  /** The keyboard cursor owns the ghost (Space places instead of pausing). */
  keyboardActive(): boolean {
    return this.kb !== null && this.state.placingDefId !== null;
  }

  /** A real pointer move over the world: the mouse takes the ghost back. */
  pointerMoved(): void {
    if (!this.kb) return;
    this.kb = null;
    this.ghostKey = '';
  }

  /**
   * Arrow key while placing: the first press puts the ghost on the tile under the pointer's last ghost (or the
   * camera's focus) and announces it; later presses move it one tile (four with `big`) in the camera-relative
   * direction. The camera follows a ghost that leaves the screen. Returns false when nothing is being placed.
   */
  keyNudge(dir: ScreenDir, big = false): boolean {
    const sim = this.host.sim();
    if (!sim || !this.state.placingDefId) return false;
    const w = this.lotSize(sim);
    if (!this.kb) {
      this.kb = clampTile(this.startTile(sim), w.w, w.d);
    } else {
      let yaw = 0;
      try {
        yaw = this.host.renderer.getCamera().yaw;
      } catch {
        yaw = 0;
      }
      const s = gridStepForScreen(yaw, dir);
      const n = big ? 4 : 1;
      this.kb = clampTile({ x: this.kb.x + s.x * n, z: this.kb.z + s.z * n }, w.w, w.d);
    }
    this.ghostKey = '';
    this.updateGhostAtTile(sim, this.kb);
    this.keepInView(this.kb);
    this.announce(this.positionText(sim, this.kb));
    this.host.changed(false);
    return true;
  }

  /**
   * Enter / Space while placing: place (or drop the carried object) where the ghost is, with the same validation as a
   * click; a refused spot is announced with its reason. Returns false when nothing is being placed.
   */
  keyPlace(keep = false): boolean {
    const sim = this.host.sim();
    if (!sim || !this.state.placingDefId) return false;
    if (!this.kb) {
      // Enter before any arrow key: put the keyboard cursor where the ghost is and say what a second Enter would
      // do, instead of buying blind at a spot the player has not heard about (the first keyNudge never moves).
      return this.keyNudge('up');
    }
    this.ghostKey = '';
    this.updateGhostAtTile(sim, this.kb);
    this.commit(keep);
    return true;
  }

  private lotSize(sim: SimulationAPI): { w: number; d: number } {
    try {
      return { w: sim.spatial.width(), d: sim.spatial.depth() };
    } catch {
      return { w: 1, d: 1 };
    }
  }

  private startTile(sim: SimulationAPI): TileXZ {
    const c = this.candidate;
    const def = this.def(sim, this.state.placingDefId);
    if (c && c.kind === 'floor' && def) {
      const rot = this.state.rot;
      const fw = Math.max(1, Math.floor(def.footprint.w || 1));
      const fd = Math.max(1, Math.floor(def.footprint.d || 1));
      const sw = rot % 2 === 0 ? fw : fd;
      const sd = rot % 2 === 0 ? fd : fw;
      return { x: c.x + Math.floor((sw - 1) / 2), z: c.z + Math.floor((sd - 1) / 2) };
    }
    try {
      const t = this.host.renderer.getCamera().target;
      if (Number.isFinite(t.x) && Number.isFinite(t.z)) return { x: Math.floor(t.x), z: Math.floor(t.z) };
    } catch {
      /* fall through */
    }
    const s = this.lotSize(sim);
    return { x: Math.floor(s.w / 2), z: Math.floor(s.d / 2) };
  }

  private keepInView(t: TileXZ): void {
    this.guard(() => {
      const p = this.host.renderer.worldToScreen(t.x + 0.5, 0, t.z + 0.5);
      if (!p.visible) this.host.renderer.focus({ x: t.x + 0.5, z: t.z + 0.5 });
    });
  }

  private itemName(defId: string | null): string {
    const sim = this.host.sim();
    const d = sim ? this.def(sim, defId) : null;
    return d && typeof d.name === 'string' && d.name ? d.name : 'item';
  }

  private statusText(): string {
    const c = this.candidate;
    if (!c) return placementText.invalid("Can't place here");
    if (!c.result.ok) return placementText.invalid(c.result.reason ?? "Can't place here");
    if (this.state.movingObjectId) return placementText.okMove();
    return c.result.blockedSlots.length > 0 ? `${placementText.ok(c.result.cost)} ${placementText.blockedSlots()}` : placementText.ok(c.result.cost);
  }

  private positionText(sim: SimulationAPI, t: TileXZ): string {
    let where = 'outdoors';
    try {
      where = sim.spatial.isIndoor(t.x, t.z) ? 'indoors' : 'outdoors';
    } catch {
      where = 'outdoors';
    }
    return placementText.at(this.itemName(this.state.placingDefId), t.x, t.z, where, this.statusText());
  }

  private announce(text: string): void {
    this.announcement = { seq: ++this.announceSeq, text };
    this.host.changed(false);
  }

  private label(c: Candidate): string {
    if (!c.result.ok) return c.result.reason ?? "Can't place here";
    if (this.state.movingObjectId) return 'Move here';
    const blocked = c.result.blockedSlots.length > 0 ? ' · Some spots are blocked' : '';
    return `${formatMoney(c.result.cost)}${blocked}`;
  }

  primaryDown(): PrimaryDownResult {
    return 'deferred';
  }

  toolMove(): void {}
  toolEnd(): void {}
  toolCancel(): void {}

  click(pos: PointerPos, mods: Mods): void {
    const sim = this.host.sim();
    if (!sim) return;
    if (!this.state.placingDefId) {
      const pick = this.safePick(pos, { objects: true });
      if (pick && pick.kind === 'object' && isMovableObject(sim, pick.objectId)) this.pickUp(pick.objectId);
      return;
    }
    this.pointerMoved();
    this.ghostKey = '';
    this.hover(pos); // re-validate against the current world
    this.commit(!!mods && mods.shift === true);
  }

  /**
   * Place / drop at the current candidate (already validated against the current world). A placement places ONE item
   * and ends placement (W-116, D-062) unless `keep` (Shift) or the "Place another" toggle is on. One call sends at most
   * one build command, so one click can never charge twice.
   */
  private commit(keep = false): void {
    const c = this.candidate;
    const keyboard = this.kb !== null;
    if (!c || !c.result.ok) {
      this.host.sfx('placeInvalid');
      if (keyboard) this.announce(this.statusText());
      return;
    }
    const cmd = this.commandFor(c);
    if (!cmd) return;
    const moving = this.state.movingObjectId !== null;
    const name = this.itemName(this.state.placingDefId);
    const cost = c.result.cost;
    if (this.host.applyBuild(cmd)) {
      if (moving) {
        this.state.movingObjectId = null;
        this.state.placingDefId = null;
        this.kb = null;
        this.guard(() => this.host.renderer.setHiddenObject(null));
        this.guard(() => this.host.renderer.setPlacementGhost(null));
        this.host.setBuildPreviewLabel(null);
        this.ghostKey = '';
        if (keyboard) this.announce(placementText.moved(name));
        this.host.changed(true);
      } else if (keep || this.state.keepPlacing) {
        this.refresh(); // Shift / "Place another": keep placing
        if (keyboard) this.announce(placementText.placed(name, cost));
      } else {
        // one item placed: back to the catalog, the item still highlighted there (state.lastDefId)
        this.state.placingDefId = null;
        this.candidate = null;
        this.kb = null;
        this.ghostKey = '';
        this.guard(() => this.host.renderer.setPlacementGhost(null));
        this.host.setBuildPreviewLabel(null);
        this.host.setGridHover(null);
        if (keyboard) this.announce(placementText.placedDone(name, cost));
        this.host.changed(true);
      }
    } else if (keyboard) {
      this.announce(placementText.failed());
    }
  }

  private commandFor(c: Candidate): BuildCommand | null {
    const defId = this.state.placingDefId;
    if (!defId) return null;
    const moving = this.state.movingObjectId;
    const tint = this.state.tint;
    switch (c.kind) {
      case 'floor':
        return moving ? { type: 'move', objectId: moving, x: c.x, z: c.z, rot: this.state.rot } : { type: 'buy', defId, x: c.x, z: c.z, rot: this.state.rot, tint };
      case 'wall':
        return moving ? { type: 'moveWallItem', objectId: moving, edge: c.edge, side: c.side } : { type: 'buyWallItem', defId, edge: c.edge, side: c.side, tint };
      case 'opening':
        return moving ? { type: 'moveOpening', objectId: moving, edge: c.edge } : { type: 'buyOpening', defId, edge: c.edge, tint };
    }
  }

  secondaryClick(): void {
    this.cancel();
  }

  doubleClick(): void {}

  escape(): boolean {
    return this.cancel();
  }

  reset(): void {
    this.cancel();
    this.announcement = null;
    this.lastPos = null;
    this.setHovered(null);
    this.guard(() => this.host.renderer.setHover(null));
    this.host.setHoverLabel(null);
    this.host.setGridHover(null);
  }

  private guard(fn: () => void): void {
    try {
      fn();
    } catch {
      /* renderer overlays are cosmetic */
    }
  }
}
