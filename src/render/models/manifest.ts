/**
 * `public/assets/manifest.objects.json` (written by tools/blender/objects/build_all.py):
 *   { version, objects: { [id]: { file, bytes, sha256, tris, bounds: { min:[x,y,z], max:[x,y,z] } } } }
 * Bounds are THREE/glTF axes (Y up, +Z front). Parsing is tolerant: malformed entries are dropped, never thrown.
 */

export interface ManifestEntry {
  /** Path relative to the manifest (e.g. "models/objects/chair_creaky.glb"). */
  file: string;
  bytes: number;
  sha256: string;
  tris: number;
  bounds: { min: [number, number, number]; max: [number, number, number] } | null;
}

export interface ObjectsManifest {
  version: number;
  objects: Record<string, ManifestEntry>;
}

export const MANIFEST_FILE = 'manifest.objects.json';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function vec3(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const n = v[i];
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    out[i] = n;
  }
  return out;
}

/** Only plain relative paths inside the asset tree are accepted (no protocol, no "..", no absolute paths). */
export function isSafeRelativePath(p: string): boolean {
  if (!p || p.length > 256) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith('/') || p.startsWith('\\')) return false;
  if (p.split(/[\\/]/).some((seg) => seg === '..')) return false;
  return /^[A-Za-z0-9_./-]+$/.test(p);
}

export function parseManifest(raw: unknown): ObjectsManifest {
  const out: ObjectsManifest = { version: 0, objects: {} };
  if (!isRecord(raw)) return out;
  if (typeof raw.version === 'number' && Number.isFinite(raw.version)) out.version = raw.version;
  const objs = raw.objects;
  if (!isRecord(objs)) return out;
  for (const [id, e] of Object.entries(objs)) {
    if (!/^[a-z][a-z0-9_]*$/.test(id) || !isRecord(e)) continue;
    const file = typeof e.file === 'string' ? e.file : '';
    if (!isSafeRelativePath(file)) continue;
    let bounds: ManifestEntry['bounds'] = null;
    if (isRecord(e.bounds)) {
      const min = vec3(e.bounds.min);
      const max = vec3(e.bounds.max);
      if (min && max && min[0] <= max[0] && min[1] <= max[1] && min[2] <= max[2]) bounds = { min, max };
    }
    out.objects[id] = {
      file,
      bytes: typeof e.bytes === 'number' && Number.isFinite(e.bytes) ? e.bytes : 0,
      sha256: typeof e.sha256 === 'string' ? e.sha256 : '',
      tris: typeof e.tris === 'number' && Number.isFinite(e.tris) ? e.tris : 0,
      bounds,
    };
  }
  return out;
}

/** Join a base URL (with or without trailing slash) and a relative path. */
export function joinUrl(base: string, rel: string): string {
  if (!base) return rel;
  return base.endsWith('/') ? base + rel : `${base}/${rel}`;
}
