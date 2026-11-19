/**
 * Roofs and ceilings, part 4: the three.js layer. Render-only (no sim state): it reads the room grid through the same
 * `roomAt` the cutaway uses, builds ONE roof mesh per building and ONE ceiling mesh per room (so a house costs one draw
 * for its roof, and only the ROOM the zombie is in ever draws a ceiling), and fades them by the pure rules in ./visibility.
 *
 *  - A rebuild (any lot change) CARRIES the fade state of every building that is still there, and a new building starts at
 *    its current target, hidden, so an edit never flashes a roof in Build/Buy or pops one back in Live.
 *  - The rebuild key is (lot identity, version, wallVersion, size, beams, a forced flag), the same things the sim's spatial
 *    cache and the walls layer watch, so a world swap or a wall-only change never leaves a stale roof.
 *  - Work per frame is a few field compares while nothing changes.
 */
import * as THREE from 'three';
import type { LotState } from '../../sim/types';
import type { Perspective, ViewMode } from '../contracts';
import { DIM } from '../../shared/dimensions';
import { findBuildings, buildingAt, type Building } from './footprint';
import { buildCeilingArrays, buildRoofArrays, type MeshArrays, type Rgb } from './geometry';
import { drawn, fadeStep, roofTargets, type RoofView } from './visibility';

interface CeilingPiece {
  room: number;
  level: number;
  /** The tiles it covers: a carried fade is matched by overlap, so renumbered room ids never mix opacities up. */
  cells: ReadonlySet<number>;
  mesh: THREE.Mesh;
  opacity: number;
  target: number;
}

interface Entry {
  building: Building;
  /** The tiles of the building: a carried fade is matched by overlap (a wall that splits a room keeps its fade). */
  cells: ReadonlySet<number>;
  roof: THREE.Mesh;
  roofOpacity: number;
  roofTarget: number;
  ceilings: CeilingPiece[];
}

const PLASTER: Rgb = [0.86, 0.83, 0.75];
const UNSET = Number.NaN;

function geometryOf(m: MeshArrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(m.normals, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(m.colors, 3));
  g.setIndex(m.indices);
  g.computeBoundingSphere();
  return g;
}

/** The old item whose tiles overlap the new tiles the most (null if none overlap): where a fade is carried from. */
function bestOverlap<T extends { cells: ReadonlySet<number> }>(olds: readonly T[], cells: readonly number[], taken: Set<T>): T | null {
  let best: T | null = null;
  let bestN = 0;
  for (const o of olds) {
    if (taken.has(o)) continue;
    let n = 0;
    for (const c of cells) if (o.cells.has(c)) n++;
    if (n > bestN) {
      bestN = n;
      best = o;
    }
  }
  if (best) taken.add(best);
  return best;
}

export class RoofLayer {
  readonly group = new THREE.Group();
  private entries: Entry[] = [];
  private buildings: Building[] = [];
  private roomOf = new Int32Array(0);
  private width = 0;
  private lot: LotState | null = null;
  private version = NaN;
  private wallVersion = NaN;
  private beams = false;
  private forced = true;
  /** The view the targets were last computed for (null = recompute). */
  private viewViewMode: ViewMode | null = null;
  private viewPerspective: Perspective | null = null;
  private viewBuilding = -2;
  private viewRoom = -2;
  private viewLevel = -1;
  private targetsStale = true;
  /** Meshes drawn this frame (for the draw-count report). */
  drawCalls = 0;
  /** How many times the meshes were rebuilt (tests, perf reports). */
  rebuilds = 0;

  constructor() {
    this.group.name = 'roofs';
  }

  /** Beams under the ceiling are a High-tier extra. Safe to call every frame: it rebuilds only on a change. */
  setBeams(on: boolean): void {
    if (on !== this.beams) {
      this.beams = on;
      this.forced = true;
    }
  }

  /** Rebuild at the next sync whatever the lot says (a world swap, a save load, a 'lot' event). */
  invalidate(): void {
    this.forced = true;
  }

  /** Which building a point is in (-1 outdoors). */
  buildingAt(x: number, z: number): number {
    return buildingAt(this.buildings, this.width, x, z);
  }

  /** The enclosed room id at a point (0 outdoors). */
  roomAtPoint(x: number, z: number): number {
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (!Number.isFinite(x) || !Number.isFinite(z) || tx < 0 || tz < 0 || tx >= this.width) return 0;
    const i = tz * this.width + tx;
    return i < this.roomOf.length ? this.roomOf[i] : 0;
  }

  /** Rebuild when the lot's structure changed. `roomAt` is the sim's (0 = outdoors). */
  sync(lot: LotState, roomAt: ((x: number, z: number) => number) | null): void {
    if (!this.forced && lot === this.lot && lot.version === this.version && lot.wallVersion === this.wallVersion) return;
    this.forced = false;
    this.lot = lot;
    this.version = lot.version;
    this.wallVersion = lot.wallVersion;
    this.rebuild(lot, roomAt);
  }

  private rebuild(lot: LotState, roomAt: ((x: number, z: number) => number) | null): void {
    this.rebuilds++;
    const old = this.entries;
    const takenEntries = new Set<Entry>();
    this.entries = [];
    this.buildings = [];
    this.targetsStale = true;
    const w = Math.floor(lot.width);
    const d = Math.floor(lot.depth);
    this.width = w;
    this.roomOf = new Int32Array(Math.max(0, w * d));
    if (roomAt) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) this.roomOf[z * w + x] = roomAt(x + 0.5, z + 0.5) | 0;
    this.buildings = findBuildings(w, d, this.roomOf);
    const tint = (room: number): Rgb => {
      const k = 0.96 + 0.08 * (((room * 2654435761) >>> 0) / 4294967296);
      return [Math.min(1, PLASTER[0] * k), Math.min(1, PLASTER[1] * k), Math.min(1, PLASTER[2] * k)];
    };
    for (const b of this.buildings) {
      const before = bestOverlap(old, b.cells, takenEntries);
      const roof = new THREE.Mesh(
        geometryOf(buildRoofArrays(b, w, DIM.WALL_HEIGHT)),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.FrontSide, transparent: true }),
      );
      roof.name = `roof:${b.id}`;
      roof.castShadow = false;
      const entry: Entry = { building: b, cells: new Set(b.cells), roof, roofOpacity: before ? before.roofOpacity : UNSET, roofTarget: UNSET, ceilings: [] };
      const takenPieces = new Set<CeilingPiece>();
      const oldPieces = before ? before.ceilings : [];
      for (let level = 0; level < b.levels; level++) {
        for (const room of b.rooms) {
          const cells = b.cells.filter((i) => this.roomOf[i] === room);
          const mesh = new THREE.Mesh(
            geometryOf(buildCeilingArrays({ ...b, cells }, w, this.roomOf, DIM.WALL_HEIGHT, tint, this.beams, level)),
            new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.FrontSide, transparent: true }),
          );
          mesh.name = `ceiling:${b.id}:${level}:${room}`;
          mesh.castShadow = false;
          const prev = bestOverlap(oldPieces.filter((c) => c.level === level), cells, takenPieces);
          entry.ceilings.push({ room, level, cells: new Set(cells), mesh, opacity: prev ? prev.opacity : UNSET, target: UNSET });
          this.group.add(mesh);
        }
      }
      // a carried building keeps drawing at its carried opacity; a new one is hidden until update() sets its target
      // (so a new building never shows a stale first frame)
      if (Number.isNaN(entry.roofOpacity)) roof.visible = false;
      else this.apply(roof, entry.roofOpacity);
      for (const c of entry.ceilings) {
        if (Number.isNaN(c.opacity)) c.mesh.visible = false;
        else this.apply(c.mesh, c.opacity);
      }
      this.group.add(roof);
      this.entries.push(entry);
    }
    for (const e of old) this.disposeEntry(e);
  }

  /** Fade toward the targets for this view. Hidden meshes are not drawn at all. */
  update(dt: number, viewMode: ViewMode, perspective: Perspective, subjectX: number | null, subjectZ: number | null, subjectLevel = 0): void {
    const building = subjectX === null || subjectZ === null ? -1 : this.buildingAt(subjectX, subjectZ);
    const room = building < 0 || subjectX === null || subjectZ === null ? 0 : this.roomAtPoint(subjectX, subjectZ);
    const level = Math.max(0, Math.floor(subjectLevel) || 0);
    if (this.targetsStale || viewMode !== this.viewViewMode || perspective !== this.viewPerspective || building !== this.viewBuilding || room !== this.viewRoom || level !== this.viewLevel) {
      this.viewViewMode = viewMode;
      this.viewPerspective = perspective;
      this.viewBuilding = building;
      this.viewRoom = room;
      this.viewLevel = level;
      this.targetsStale = false;
      const view: RoofView = { viewMode, perspective, subjectBuilding: building };
      const targets = roofTargets(this.buildings, view);
      for (let i = 0; i < this.entries.length; i++) {
        const e = this.entries[i];
        e.roofTarget = targets[i].roof;
        for (const c of e.ceilings) c.target = c.room === room && c.level === level ? targets[i].ceiling : 0;
      }
    }
    let calls = 0;
    for (const e of this.entries) {
      if (e.roofOpacity !== e.roofTarget) {
        e.roofOpacity = Number.isNaN(e.roofOpacity) ? e.roofTarget : fadeStep(e.roofOpacity, e.roofTarget, dt);
        this.apply(e.roof, e.roofOpacity);
      }
      if (e.roof.visible) calls++;
      for (const c of e.ceilings) {
        if (c.opacity !== c.target) {
          c.opacity = Number.isNaN(c.opacity) ? c.target : fadeStep(c.opacity, c.target, dt);
          this.apply(c.mesh, c.opacity);
        }
        if (c.mesh.visible) calls++;
      }
    }
    this.drawCalls = calls;
  }

  private apply(mesh: THREE.Mesh, opacity: number): void {
    mesh.visible = drawn(opacity);
    const m = mesh.material as THREE.MeshStandardMaterial;
    m.opacity = opacity;
    m.transparent = opacity < 0.999;
    m.depthWrite = opacity >= 0.999;
  }

  private disposeEntry(e: Entry): void {
    for (const m of [e.roof, ...e.ceilings.map((c) => c.mesh)]) {
      this.group.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }

  dispose(): void {
    for (const e of this.entries) this.disposeEntry(e);
    this.entries = [];
    this.buildings = [];
  }
}
