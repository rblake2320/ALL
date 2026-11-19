/**
 * Renderer hook for pets and strays (W-013). Read-only contract with the sim: the world's optional `pets` block
 * (`{ pets: PetState[], strays: StrayState[] }`, src/sim/types.ts) gives every animal's species, position, facing and
 * anim. The sim is never written to.
 *
 * Species load lazily: a rig is only asked for when its animal is inside the camera's view, and the library only
 * fetches that species' model then (src/render/pets/rig.ts). Dispose releases every rig and, with the renderer, the
 * library. The sim moves animals in steps of one tick, so the layer eases each rig toward the latest position.
 */
import * as THREE from 'three';
import { isPetVariant, type PetLibrary, type PetRig, type PetVariant } from './rig';

export interface PetView {
  id: string;
  species: string;
  variant: PetVariant;
  /** Tile / world coordinates, same space as AgentState.pos. */
  pos: { x: number; z: number };
  /** Radians, same convention as AgentState.facing (rotation.y; front +Z). */
  facing: number;
  /** One of PET_ANIM_STATES (unknown values idle). */
  anim: string;
  /** Set by the reader from the list it came from. */
  kind: 'pet' | 'stray';
}

function readList(raw: unknown, kind: PetView['kind'], out: PetView[]): void {
  if (!Array.isArray(raw)) return;
  for (const e of raw as unknown[]) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    const pos = r.pos as { x?: unknown; z?: unknown } | null | undefined;
    if (typeof r.id !== 'string' || typeof r.species !== 'string') continue;
    if (!pos || typeof pos.x !== 'number' || typeof pos.z !== 'number' || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) continue;
    out.push({
      id: r.id,
      species: r.species,
      variant: isPetVariant(r.variant) ? r.variant : 'normal',
      pos: { x: pos.x, z: pos.z },
      facing: typeof r.facing === 'number' && Number.isFinite(r.facing) ? r.facing : 0,
      anim: typeof r.anim === 'string' ? r.anim : 'idle',
      kind,
    });
  }
}

/** Pets then strays from the world's `pets` block; malformed entries are skipped. Never throws. */
export function readPetViews(world: unknown): PetView[] {
  const out: PetView[] = [];
  if (!world || typeof world !== 'object') return out;
  const block = (world as { pets?: unknown }).pets as { pets?: unknown; strays?: unknown } | null | undefined;
  if (!block || typeof block !== 'object') return out;
  readList(block.pets, 'pet', out);
  readList(block.strays, 'stray', out);
  return out;
}

/** Radius (tiles) of the click target around an animal, and how far past the screen edge it still counts as in view. */
export const PET_PICK_RADIUS = 0.6;
export const PET_VIEW_MARGIN = 2;
const EASE_PER_SEC = 12;
const SNAP_TILES = 4;

interface Live {
  rig: PetRig;
  kind: PetView['kind'];
  x: number;
  z: number;
  facing: number;
}

const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class PetLayer {
  readonly group = new THREE.Group();
  private readonly live = new Map<string, Live>();
  private readonly seen = new Set<string>();
  private readonly tmp = new THREE.Vector3();
  private readonly sphere = new THREE.Sphere();
  private renderRevision = 0;

  constructor(private readonly lib: PetLibrary) {
    this.group.name = 'pets';
  }

  get count(): number {
    return this.live.size;
  }

  get materialRevision(): string {
    return this.live.size ? String(this.renderRevision) : '';
  }

  rigOf(id: string): PetRig | null {
    return this.live.get(id)?.rig ?? null;
  }

  /** `inView(x, z)`: only animals it accepts get a rig (and so load their species). Absent = every animal. */
  sync(world: unknown, dt: number, inView?: (x: number, z: number) => boolean): void {
    const views = readPetViews(world);
    this.seen.clear();
    const k = 1 - Math.exp(-EASE_PER_SEC * Math.min(Math.max(dt, 0), 0.25));
    for (const v of views) {
      if (this.seen.has(v.id)) continue;
      this.seen.add(v.id);
      let l = this.live.get(v.id);
      if (l && (l.rig.species !== v.species || l.rig.variant !== v.variant)) {
        l.rig.dispose();
        this.live.delete(v.id);
        this.renderRevision++;
        l = undefined;
      }
      if (!l) {
        if (inView && !inView(v.pos.x, v.pos.z)) continue;
        const made = this.lib.create(v.species, v.variant);
        if (!made) continue; // not loaded yet: the library is fetching it, try again next frame
        l = { rig: made, kind: v.kind, x: v.pos.x, z: v.pos.z, facing: v.facing };
        this.live.set(v.id, l);
        this.renderRevision++;
        this.group.add(made.root);
      }
      l.kind = v.kind;
      if (Math.hypot(v.pos.x - l.x, v.pos.z - l.z) > SNAP_TILES) {
        l.x = v.pos.x;
        l.z = v.pos.z;
        l.facing = v.facing;
      } else {
        l.x += (v.pos.x - l.x) * k;
        l.z += (v.pos.z - l.z) * k;
        l.facing += angleDiff(v.facing, l.facing) * k;
      }
      l.rig.setPose(l.x, 0, l.z, l.facing);
      l.rig.play(v.anim);
      l.rig.update(dt);
    }
    for (const [id, l] of this.live) {
      if (this.seen.has(id)) continue;
      l.rig.dispose();
      this.live.delete(id);
      this.renderRevision++;
    }
  }

  /** Nearest animal along a camera ray (a sphere around each one); null when the ray misses all. */
  pick(ray: THREE.Ray): { id: string; kind: PetView['kind']; t: number; point: THREE.Vector3 } | null {
    let best: { id: string; kind: PetView['kind']; t: number; point: THREE.Vector3 } | null = null;
    for (const [id, l] of this.live) {
      this.sphere.set(this.tmp.set(l.x, 0.35, l.z), PET_PICK_RADIUS);
      const hit = ray.intersectSphere(this.sphere, new THREE.Vector3());
      if (!hit) continue;
      const t = ray.origin.distanceTo(hit);
      if (!best || t < best.t) best = { id, kind: l.kind, t, point: hit };
    }
    return best;
  }

  dispose(): void {
    for (const l of this.live.values()) l.rig.dispose();
    this.live.clear();
    this.group.removeFromParent();
  }
}
