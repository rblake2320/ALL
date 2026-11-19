/**
 * Build-mode tools (GameController.buildTool):
 *   wall        drag along grid lines → straight run of 'addWalls' (previewed live via sim.build.preview)
 *   deleteWall  drag (or click an edge) → 'removeWalls' over existing walls only
 *   room        drag a tile rectangle → 'room' (walls + floor)
 *   floor       drag a tile rectangle (click = one tile) → 'floor' (styleId null removes flooring)
 *   door/window hover a wall edge → checkOpening ghost; click → 'buyOpening'
 *   paintWall   click a wall side → 'paintWall', or 'paintRoom' for the room on that side (wholeRoom)
 *   eyedropper  click a wall side / floor tile / object → switch to the matching tool with that style
 * Releasing a drag applies it only if the latest preview was ok; Esc / right-click cancel the drag.
 */
import type { BuildTool } from '../contracts';
import type { BuildCommand, BuildPreview, SimulationAPI } from '../../sim/contracts';
import type { BuildOverlay, PlacementGhost } from '../../render/contracts';
import type { EdgeKey } from '../../sim/types';
import { DEFAULT_INTERIOR_WALL, FLOOR_STYLE_BY_ID, WALL_STYLE_BY_ID } from '../../shared/styles';

/** Floor a room / floor tool falls back to when handed an id that is not a floor style (matches the sim default). */
export const DEFAULT_TOOL_FLOOR = 'floor_planks_worn';

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
/**
 * Known wall finish, else the default interior wall. A wall / room / paint tool is never left holding an id the sim
 * would refuse with "Unknown style" (stale HUD state, an old save's eyedropped finish, a scripted caller): the drag
 * overlay then reads "$15 · 1 wall" with the default finish instead of an error before a finish was ever picked.
 */
export function knownWallStyle(id: string): string {
  return hasOwn(WALL_STYLE_BY_ID, id) ? id : DEFAULT_INTERIOR_WALL;
}
export function knownFloorStyle(id: string): string {
  return hasOwn(FLOOR_STYLE_BY_ID, id) ? id : DEFAULT_TOOL_FLOOR;
}
import { edgeSideTile, gridPoint, nearestVertex, parseEdge, rectTiles, tileRect, wallRun, type TileRect, type TileXZ } from './grid';
import { buildLabel, formatMoney } from './format';
import { CANT_PLACE, placementVerdict, previewBuild } from './placementPreview';
import type { InputHost, ModeHandler, Mods, PointerPos, PrimaryDownResult } from './types';

type DragTool = 'wall' | 'deleteWall' | 'room' | 'floor';

interface Drag {
  tool: DragTool;
  startVertex: TileXZ;
  startTile: TileXZ;
  cmd: BuildCommand | null;
  preview: BuildPreview | null;
  key: string;
}

export function sanitizeBuildTool(raw: unknown): BuildTool | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const s = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null);
  switch (t.kind) {
    case 'select':
      return { kind: 'select' };
    case 'eyedropper':
      return { kind: 'eyedropper' };
    case 'deleteWall':
      return { kind: 'deleteWall' };
    case 'wall': {
      const style = s(t.style);
      return style ? { kind: 'wall', style: knownWallStyle(style) } : null;
    }
    case 'room': {
      const wallStyle = s(t.wallStyle);
      const floor = t.floor === null ? null : s(t.floor);
      if (!wallStyle || (t.floor !== null && floor === null)) return null;
      return { kind: 'room', floor: floor === null ? null : knownFloorStyle(floor), wallStyle: knownWallStyle(wallStyle) };
    }
    case 'door':
    case 'window': {
      const defId = s(t.defId);
      return defId ? { kind: t.kind, defId } : null;
    }
    case 'floor': {
      const styleId = t.styleId === null ? null : s(t.styleId);
      if (t.styleId !== null && styleId === null) return null;
      return { kind: 'floor', styleId: styleId === null ? null : knownFloorStyle(styleId) };
    }
    case 'paintWall': {
      const styleId = s(t.styleId);
      return styleId ? { kind: 'paintWall', styleId: knownWallStyle(styleId), wholeRoom: t.wholeRoom === true } : null;
    }
    default:
      return null;
  }
}

export function toolsEqual(a: BuildTool, b: BuildTool): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Existing walls among the given edges (deleteWall only touches real walls). */
export function existingWalls(sim: SimulationAPI, edges: readonly EdgeKey[]): EdgeKey[] {
  const walls = sim.state?.lot?.walls ?? {};
  return edges.filter((e) => Object.prototype.hasOwnProperty.call(walls, e));
}

export class BuildInput implements ModeHandler {
  private toolValue: BuildTool = { kind: 'select' };
  private drag: Drag | null = null;
  private lastPos: PointerPos | null = null;
  private hoverCmd: BuildCommand | null = null;
  private hoverPreview: BuildPreview | null = null;
  private overlayKey = '';
  private ghostKey = '';

  constructor(private readonly host: InputHost) {}

  get tool(): BuildTool {
    return this.toolValue;
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  setTool(raw: BuildTool): boolean {
    const tool = sanitizeBuildTool(raw);
    if (!tool) {
      this.host.sfx('uiError');
      return false;
    }
    this.cancelDrag();
    this.toolValue = tool;
    this.clearOverlays();
    if (this.lastPos) this.hover(this.lastPos);
    this.host.changed(true);
    return true;
  }

  // ───────────────────────── helpers ─────────────────────────

  private grid(pos: PointerPos) {
    try {
      return this.host.renderer.pickGrid(pos.cx, pos.cy);
    } catch {
      return null;
    }
  }

  private wallAt(pos: PointerPos): { edge: EdgeKey; side: 0 | 1 } | null {
    try {
      const p = this.host.renderer.pick(pos.cx, pos.cy, { agents: false, objects: false, walls: true, tiles: false });
      if (p.kind === 'wall') return { edge: p.edge, side: p.side };
    } catch {
      /* fall back to the grid */
    }
    const g = this.grid(pos);
    if (g && typeof g.edge === 'string') return { edge: g.edge, side: g.edgeSide === 0 ? 0 : 1 };
    return null;
  }

  private preview(sim: SimulationAPI, cmd: BuildCommand): BuildPreview {
    return previewBuild(sim, cmd);
  }

  private setOverlay(o: BuildOverlay | null): void {
    const key = o ? JSON.stringify(o) : 'none';
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    try {
      this.host.renderer.setBuildOverlay(o);
    } catch {
      /* cosmetic */
    }
  }

  private setGhost(g: PlacementGhost | null): void {
    const key = g ? JSON.stringify(g) : 'none';
    if (key === this.ghostKey) return;
    this.ghostKey = key;
    try {
      this.host.renderer.setPlacementGhost(g);
    } catch {
      /* cosmetic */
    }
  }

  private clearOverlays(): void {
    this.setOverlay(null);
    this.setGhost(null);
    this.hoverCmd = null;
    this.hoverPreview = null;
    this.host.setBuildPreviewLabel(null);
  }

  private overlayFor(cmd: BuildCommand, p: BuildPreview, label: string | null): BuildOverlay {
    const base = { valid: p.ok, label: label ?? undefined };
    switch (cmd.type) {
      case 'addWalls':
        return { ...base, edges: p.edges ?? cmd.edges, edgeMode: 'add', styleId: cmd.style ?? null };
      case 'removeWalls':
        return { ...base, edges: p.edges ?? cmd.edges, edgeMode: 'remove' };
      case 'room':
        return { ...base, edges: p.edges, edgeMode: 'add', tiles: p.tiles ?? rectTiles(cmd), tileMode: 'room', styleId: cmd.floor ?? null };
      case 'floor':
        return { ...base, tiles: p.tiles ?? rectTiles(cmd), tileMode: cmd.styleId === null ? 'remove' : 'paint', styleId: cmd.styleId };
      case 'paintWall':
        return { ...base, edges: p.edges ?? [cmd.edge], edgeMode: 'add', styleId: cmd.styleId };
      case 'paintRoom':
        return { ...base, edges: p.edges, edgeMode: 'add', styleId: cmd.styleId, tiles: p.tiles, tileMode: 'paint' };
      default:
        return { ...base };
    }
  }

  private dragCommand(d: Drag, vertex: TileXZ, tile: TileXZ, sim: SimulationAPI): BuildCommand | null {
    const t = this.toolValue;
    switch (d.tool) {
      case 'wall': {
        const edges = wallRun(d.startVertex, vertex);
        return edges.length > 0 && t.kind === 'wall' ? { type: 'addWalls', edges, style: t.style } : null;
      }
      case 'deleteWall': {
        const edges = existingWalls(sim, wallRun(d.startVertex, vertex));
        return edges.length > 0 ? { type: 'removeWalls', edges } : null;
      }
      case 'room': {
        const r: TileRect = tileRect(d.startTile, tile);
        return t.kind === 'room' ? { type: 'room', ...r, floor: t.floor, wallStyle: t.wallStyle } : null;
      }
      case 'floor': {
        const r: TileRect = tileRect(d.startTile, tile);
        return t.kind === 'floor' ? { type: 'floor', ...r, styleId: t.styleId } : null;
      }
    }
  }

  private cancelDrag(): void {
    if (this.drag) {
      this.drag = null;
      this.setOverlay(null);
      this.host.setBuildPreviewLabel(null);
    }
  }

  // ───────────────────────── ModeHandler ─────────────────────────

  hover(pos: PointerPos): void {
    this.lastPos = pos;
    const sim = this.host.sim();
    if (!sim) return;
    const g = this.grid(pos);
    this.host.setGridHover(g ? { x: g.x, z: g.z, edge: g.edge } : null);
    if (this.drag) return; // the drag owns the overlay
    const t = this.toolValue;
    switch (t.kind) {
      case 'door':
      case 'window': {
        const w = this.wallAt(pos);
        if (!w) {
          // nothing under the cursor: a click must not buy at the previously hovered edge
          this.hoverCmd = null;
          this.hoverPreview = null;
          this.setGhost(null);
          this.host.setBuildPreviewLabel(null);
          return;
        }
        // the ghost, the label and the click share one verdict: the build preview of the exact command
        const cmd: BuildCommand = { type: 'buyOpening', defId: t.defId, edge: w.edge };
        const p = placementVerdict(sim, cmd);
        this.hoverCmd = cmd;
        this.hoverPreview = { ok: p.ok, reason: p.reason, cost: p.cost };
        this.setGhost({ defId: t.defId, edge: w.edge, valid: p.ok, tiles: p.tiles });
        this.host.setBuildPreviewLabel(p.ok ? formatMoney(p.cost) : p.reason ?? CANT_PLACE);
        return;
      }
      case 'paintWall': {
        const w = this.wallAt(pos);
        const walls = sim.state?.lot?.walls ?? {};
        if (!w || !Object.prototype.hasOwnProperty.call(walls, w.edge)) {
          this.hoverCmd = null;
          this.setOverlay(null);
          this.host.setBuildPreviewLabel(null);
          return;
        }
        const cmd = this.paintCommand(t, w);
        const p = cmd ? this.preview(sim, cmd) : null;
        this.hoverCmd = cmd;
        this.hoverPreview = p;
        const label = cmd && p ? buildLabel(cmd, p) : null;
        this.setOverlay(cmd && p ? this.overlayFor(cmd, p, label) : null);
        this.host.setBuildPreviewLabel(label);
        return;
      }
      case 'deleteWall': {
        const edge = g?.edge ?? null;
        const walls = sim.state?.lot?.walls ?? {};
        if (edge && Object.prototype.hasOwnProperty.call(walls, edge)) {
          const cmd: BuildCommand = { type: 'removeWalls', edges: [edge] };
          const p = this.preview(sim, cmd);
          this.hoverCmd = cmd;
          this.hoverPreview = p;
          const label = buildLabel(cmd, p);
          this.setOverlay(this.overlayFor(cmd, p, label));
          this.host.setBuildPreviewLabel(label);
        } else {
          this.hoverCmd = null;
          this.setOverlay(null);
          this.host.setBuildPreviewLabel(null);
        }
        return;
      }
      case 'eyedropper':
        this.host.setBuildPreviewLabel(this.eyedropperLabel(sim, pos));
        return;
      default:
        this.hoverCmd = null;
        this.host.setBuildPreviewLabel(null);
        return;
    }
  }

  private paintCommand(t: Extract<BuildTool, { kind: 'paintWall' }>, w: { edge: EdgeKey; side: 0 | 1 }): BuildCommand | null {
    if (!t.wholeRoom) return { type: 'paintWall', edge: w.edge, side: w.side, styleId: t.styleId };
    const e = parseEdge(w.edge);
    if (!e) return null;
    const tile = edgeSideTile(e, w.side);
    return { type: 'paintRoom', x: tile.x, z: tile.z, styleId: t.styleId };
  }

  private eyedropperLabel(sim: SimulationAPI, pos: PointerPos): string | null {
    const picked = this.eyedrop(sim, pos);
    return picked ? `Pick ${picked.name}` : null;
  }

  private eyedrop(sim: SimulationAPI, pos: PointerPos): { tool: BuildTool | null; name: string; object?: { defId: string; tint: string | null } } | null {
    let pick;
    try {
      pick = this.host.renderer.pick(pos.cx, pos.cy, { agents: false, objects: true, walls: true, tiles: true });
    } catch {
      return null;
    }
    const lot = sim.state?.lot;
    if (pick.kind === 'wall') {
      const seg = lot?.walls?.[pick.edge];
      const styleId = seg?.paint?.[pick.side];
      if (typeof styleId !== 'string') return null;
      return { tool: { kind: 'paintWall', styleId, wholeRoom: false }, name: WALL_STYLE_BY_ID[styleId]?.name ?? styleId };
    }
    if (pick.kind === 'tile' && lot) {
      if (pick.x < 0 || pick.z < 0 || pick.x >= lot.width || pick.z >= lot.depth) return null;
      const styleId = lot.floors?.[pick.z * lot.width + pick.x] ?? null;
      return { tool: { kind: 'floor', styleId }, name: styleId ? FLOOR_STYLE_BY_ID[styleId]?.name ?? styleId : 'Bare ground' };
    }
    if (pick.kind === 'object') {
      const o = sim.object(pick.objectId);
      const def = o ? sim.content.objects[o.defId] : undefined;
      if (!o || !def || def.buyable !== true) return null;
      return { tool: null, name: def.name, object: { defId: o.defId, tint: o.tint } };
    }
    return null;
  }

  primaryDown(pos: PointerPos): PrimaryDownResult {
    const t = this.toolValue.kind;
    if (t !== 'wall' && t !== 'deleteWall' && t !== 'room' && t !== 'floor') return 'deferred';
    const g = this.grid(pos);
    if (!g) return 'deferred';
    const p = gridPoint(g);
    this.drag = { tool: t, startVertex: nearestVertex(p), startTile: { x: g.x, z: g.z }, cmd: null, preview: null, key: '' };
    this.setGhost(null);
    this.updateDrag(pos);
    return 'tool';
  }

  private updateDrag(pos: PointerPos): void {
    // The drag pointer is the pointer: a world refresh mid-drag (lot event, undo) must re-preview HERE, not at the
    // pre-drag hover position (that blanked the label / overlay until the next pointer move).
    this.lastPos = pos;
    const d = this.drag;
    const sim = this.host.sim();
    if (!d || !sim) return;
    const g = this.grid(pos);
    if (!g) return;
    const p = gridPoint(g);
    const cmd = this.dragCommand(d, nearestVertex(p), { x: g.x, z: g.z }, sim);
    const key = cmd ? JSON.stringify(cmd) : 'none';
    if (key === d.key) return;
    d.key = key;
    d.cmd = cmd;
    if (!cmd) {
      d.preview = null;
      this.setOverlay(null);
      this.host.setBuildPreviewLabel(d.tool === 'deleteWall' ? 'No walls here' : null);
      return;
    }
    d.preview = this.preview(sim, cmd);
    const label = buildLabel(cmd, d.preview);
    this.setOverlay(this.overlayFor(cmd, d.preview, label));
    this.host.setBuildPreviewLabel(label);
  }

  toolMove(pos: PointerPos): void {
    this.updateDrag(pos);
  }

  toolEnd(pos: PointerPos, _mods: Mods, moved: boolean): void {
    const d = this.drag;
    if (!d) return;
    this.updateDrag(pos);
    this.drag = null;
    const cmd = d.cmd;
    const preview = d.preview;
    this.setOverlay(null);
    this.host.setBuildPreviewLabel(null);
    // A plain click only applies for single-tile floor painting and single-edge wall deletion.
    if (!moved && d.tool !== 'floor' && d.tool !== 'deleteWall') return;
    if (!cmd) return;
    if (!preview || !preview.ok) {
      this.host.sfx('placeInvalid');
      if (preview?.reason) this.host.toast('warning', "Can't build that", preview.reason);
      return;
    }
    this.host.applyBuild(cmd);
    if (this.lastPos) this.hover(this.lastPos);
  }

  toolCancel(): void {
    this.cancelDrag();
  }

  click(pos: PointerPos): void {
    const sim = this.host.sim();
    if (!sim) return;
    const t = this.toolValue;
    if (t.kind === 'eyedropper') {
      const picked = this.eyedrop(sim, pos);
      if (!picked) {
        this.host.sfx('uiError');
        return;
      }
      if (picked.object) {
        this.host.placeCopy(picked.object.defId, picked.object.tint);
        return;
      }
      if (picked.tool) {
        this.setTool(picked.tool);
        this.host.sfx('uiClick');
      }
      return;
    }
    this.hover(pos);
    if (!this.hoverCmd || !this.hoverPreview) return;
    if (!this.hoverPreview.ok) {
      this.host.sfx('placeInvalid');
      return;
    }
    this.host.applyBuild(this.hoverCmd);
    this.overlayKey = '';
    this.ghostKey = '';
    if (this.lastPos) this.hover(this.lastPos);
  }

  secondaryClick(): void {
    if (this.drag) this.cancelDrag();
  }

  doubleClick(): void {}

  escape(): boolean {
    if (this.drag) {
      this.cancelDrag();
      return true;
    }
    if (this.toolValue.kind !== 'select') {
      this.setTool({ kind: 'select' });
      return true;
    }
    return false;
  }

  /** World changed (undo/redo, lot event): re-run previews. */
  refresh(): void {
    this.overlayKey = '';
    this.ghostKey = '';
    if (this.drag) {
      this.drag.key = '';
      if (this.lastPos) this.updateDrag(this.lastPos);
    } else if (this.lastPos) {
      this.hover(this.lastPos);
    }
  }

  reset(): void {
    this.drag = null;
    this.lastPos = null;
    this.clearOverlays();
    this.host.setGridHover(null);
  }
}
