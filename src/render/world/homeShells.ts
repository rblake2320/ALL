/**
 * Home exterior shells (W-049, `public/assets/manifest.homes.json`, PR #23) for neighbour lots in the walkable world
 * (W-025 S5). Each shell ships two levels of detail: LOD0 (≤ 6,000 triangles) for full-detail regions near the camera,
 * LOD1 (≤ 2,000) for the warm ring. A shell is one node with two materials, `Shell` (vertex colours) and `Glass`.
 *
 * Loading is lazy: the manifest is fetched on first use and a GLB only when a region asks for that shell + LOD.
 * Prototypes (geometry + materials) are library-owned and shared by every region; regions build their own meshes
 * on the shared geometry and dispose only what they own. Until a GLB has arrived (or when it fails) `get()` returns
 * null and the region draws its placeholder box house; `onLoaded` tells the world view to swap it in (the same
 * late-asset behaviour as the object library). Never throws, never rejects.
 */
import * as THREE from 'three';
import { defaultFetch, fetchBytes, fetchJson, parseGlb, type FetchLike } from '../models/loader';
import { isSafeRelativePath, joinUrl } from '../models/manifest';

export const HOMES_MANIFEST_FILE = 'manifest.homes.json';

export interface ShellInfo {
  id: string;
  /** Lot template the shell stands for ('starter', 'wormwood_bungalow', ...). */
  template: string;
  /** The manifest's `lot` field: a LotDef id ('wormwood:starter') or, for newer shells (PR #65), the bare template id ('derelict'). */
  lot: string;
  level: string;
  /** Wall bounds in tiles (the house's footprint on its lot map). */
  footprint: { w: number; d: number };
  /** Front doors, shell-local metres (front = +Z). */
  doors: { x: number; z: number }[];
  /** LOD files (index = lod). */
  lods: { file: string; triangles: number }[];
}

export interface ShellPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** True for the window panes (`Glass`): glow at night, hidden while the shell is cut away. */
  glass: boolean;
}

/** Parse manifest.homes.json defensively (malformed entries are dropped, never thrown). Pure. */
export function parseHomesManifest(raw: unknown): Map<string, ShellInfo> {
  const out = new Map<string, ShellInfo>();
  if (!raw || typeof raw !== 'object') return out;
  const shells = (raw as { shells?: unknown }).shells;
  if (!shells || typeof shells !== 'object' || Array.isArray(shells)) return out;
  for (const [id, e] of Object.entries(shells as Record<string, unknown>)) {
    if (!/^shell_[a-z0-9_]+$/.test(id) || !e || typeof e !== 'object') continue;
    const s = e as Record<string, unknown>;
    const fp = s.tileFootprint as { w?: unknown; d?: unknown } | undefined;
    const w = Number(fp?.w);
    const d = Number(fp?.d);
    if (!Number.isFinite(w) || !Number.isFinite(d) || w < 1 || d < 1 || w > 30 || d > 30) continue;
    const lodsRaw = Array.isArray(s.lods) ? s.lods : [];
    const lods: ShellInfo['lods'] = [];
    for (const l of lodsRaw) {
      const lod = l as { lod?: unknown; file?: unknown; triangles?: unknown };
      if (typeof lod?.file !== 'string' || !isSafeRelativePath(lod.file) || (lod.lod !== 0 && lod.lod !== 1)) continue;
      lods[lod.lod] = { file: lod.file, triangles: Number.isFinite(Number(lod.triangles)) ? Number(lod.triangles) : 0 };
    }
    if (!lods[0]) continue;
    if (!lods[1]) lods[1] = lods[0];
    const doors = (Array.isArray(s.doors) ? s.doors : [])
      .map((dd) => ({ x: Number((dd as { x?: unknown }).x), z: Number((dd as { z?: unknown }).z) }))
      .filter((dd) => Number.isFinite(dd.x) && Number.isFinite(dd.z));
    out.set(id, { id, template: typeof s.template === 'string' ? s.template : id.slice(6), lot: typeof s.lot === 'string' ? s.lot : '', level: typeof s.level === 'string' ? s.level : '', footprint: { w, d }, doors, lods });
  }
  return out;
}

interface Proto {
  parts: ShellPart[];
  triangles: number;
}

export class HomeShellLibrary {
  private manifest: Map<string, ShellInfo> | null = null;
  private manifestPromise: Promise<void> | null = null;
  private readonly protos = new Map<string, Proto>();
  private readonly pending = new Set<string>();
  private readonly failed = new Set<string>();
  private disposed = false;
  /** Called once per (shell, lod) that finished loading. */
  onLoaded: ((id: string, lod: number) => void) | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: FetchLike | null = defaultFetch(),
    private readonly warn: (key: string, msg: string, e?: unknown) => void = () => undefined,
    private readonly timeoutMs = 20000,
  ) {}

  /** Start fetching the manifest (idempotent). Resolves when it is parsed or failed. Never rejects. */
  load(): Promise<void> {
    if (this.manifestPromise) return this.manifestPromise;
    this.manifestPromise = (async () => {
      try {
        if (!this.fetchFn) throw new Error('no fetch implementation');
        const raw = await fetchJson(this.fetchFn, joinUrl(this.baseUrl, HOMES_MANIFEST_FILE), this.timeoutMs);
        if (!this.disposed) this.manifest = parseHomesManifest(raw);
      } catch (e) {
        this.manifest = new Map();
        this.warn('homes-manifest', 'homes manifest unavailable; neighbour lots use placeholder houses', e);
      }
      // regions built before the manifest arrived draw placeholders: let them rebuild (and request their GLBs)
      if (!this.disposed && this.manifest && this.manifest.size > 0) this.onLoaded?.('', -1);
    })();
    return this.manifestPromise;
  }

  /** Test seam: install a parsed manifest directly. */
  setManifest(m: Map<string, ShellInfo>): void {
    this.manifest = m;
    this.manifestPromise = Promise.resolve();
  }

  ids(): string[] {
    return this.manifest ? [...this.manifest.keys()] : [];
  }

  info(id: string): ShellInfo | null {
    return this.manifest?.get(id) ?? null;
  }

  /**
   * Shell for a lot TEMPLATE id ('starter' → shell_starter, 'derelict' → shell_derelict), or null (the caller draws
   * the placeholder house). Matched by the manifest's `template` field, else its `lot` field (a bare template id, or
   * the template part of a LotDef id 'level:template'). Never by slot.
   */
  forTemplate(templateId: string | null | undefined): ShellInfo | null {
    if (!templateId || !this.manifest) return null;
    for (const s of this.manifest.values()) if (s.template === templateId) return s;
    for (const s of this.manifest.values()) if (s.lot === templateId || s.lot.slice(s.lot.indexOf(':') + 1) === templateId) return s;
    return null;
  }

  /** Shared parts of a loaded shell LOD; null while loading / failed (the caller draws a placeholder). */
  get(id: string, lod: 0 | 1): ShellPart[] | null {
    const p = this.protos.get(`${id}#${lod}`);
    if (p) return p.parts;
    this.request(id, lod);
    return null;
  }

  triangles(id: string, lod: 0 | 1): number {
    return this.protos.get(`${id}#${lod}`)?.triangles ?? this.info(id)?.lods[lod]?.triangles ?? 0;
  }

  isLoading(): boolean {
    return this.pending.size > 0;
  }

  /** Test seam: install a prototype directly. */
  setProto(id: string, lod: 0 | 1, parts: ShellPart[]): void {
    this.protos.set(`${id}#${lod}`, { parts, triangles: 0 });
  }

  private request(id: string, lod: 0 | 1): void {
    const key = `${id}#${lod}`;
    if (this.disposed || this.pending.has(key) || this.failed.has(key)) return;
    const info = this.info(id);
    if (!info || !this.fetchFn) {
      if (this.manifest) this.failed.add(key);
      return;
    }
    const file = info.lods[lod]?.file;
    if (!file) {
      this.failed.add(key);
      return;
    }
    this.pending.add(key);
    const url = joinUrl(this.baseUrl, file);
    void (async () => {
      try {
        const bytes = await fetchBytes(this.fetchFn!, url, this.timeoutMs);
        if (this.disposed) return;
        const scene = await parseGlb(bytes, url.slice(0, url.lastIndexOf('/') + 1));
        if (this.disposed) {
          disposeTree(scene);
          return;
        }
        const proto = protoOf(scene);
        if (proto.parts.length === 0) throw new Error('shell GLB has no meshes');
        this.protos.set(key, proto);
        this.onLoaded?.(id, lod);
      } catch (e) {
        this.failed.add(key);
        this.warn(`homes-${key}`, `home shell ${id} lod${lod} failed to load; using a placeholder house`, e);
      } finally {
        this.pending.delete(key);
      }
    })();
  }

  dispose(): void {
    this.disposed = true;
    for (const p of this.protos.values())
      for (const part of p.parts) {
        part.geometry.dispose();
        part.material.dispose();
      }
    this.protos.clear();
    this.onLoaded = null;
  }
}

/** Flatten a shell scene into (geometry baked to shell-root space, material) parts. */
function protoOf(scene: THREE.Group): Proto {
  const parts: ShellPart[] = [];
  let triangles = 0;
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const mat = mats[0];
    if (!mat) return;
    const glass = typeof mat.name === 'string' && mat.name.toLowerCase().includes('glass');
    triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    parts.push({ geometry: g, material: mat, glass });
  });
  // the clones are baked: the loaded originals are no longer needed
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.geometry?.dispose();
  });
  return { parts, triangles };
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    for (const x of Array.isArray(m.material) ? m.material : [m.material]) x?.dispose();
  });
}
