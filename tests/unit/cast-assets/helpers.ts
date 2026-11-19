/**
 * Cast-body asset helpers (tools/blender/cast): raw GLB parsing (no three.js) + a manifest validator that the
 * suites run against the published files AND against deliberately tampered copies (adversarial checks).
 * CAST_ASSETS=<dir> points the suites at another build root (DIR/manifest.cast.json, DIR/models/characters/cast).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CAST_BODIES, CAST_BODY_IDS } from '../../../src/shared/cast';

export const ROOT = resolve(__dirname, '../../..');
export const ASSETS = process.env.CAST_ASSETS ? resolve(process.env.CAST_ASSETS) : resolve(ROOT, 'public/assets');
export const MANIFEST_PATH = resolve(ASSETS, 'manifest.cast.json');
export const ZOMBIE_GLB = resolve(ROOT, 'public/assets/models/characters/zombie.glb');
export const THUMB_DIR = resolve(ASSETS, 'ui/cast');

export const CAST_BONES = [
  'root', 'pelvis', 'spine', 'chest', 'neck', 'head',
  'shoulder_L', 'upperarm_L', 'forearm_L', 'hand_L', 'prop_L',
  'shoulder_R', 'upperarm_R', 'forearm_R', 'hand_R', 'prop_R',
  'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R',
];
/**
 * W-120: bodies whose held prop is its own loose piece, skinned rigidly to the prop bone on that side, so the
 * runtime can stow it. Only props that are separate pieces in the source model are here.
 */
export const PROP_PIECES: Record<string, string[]> = {
  shield: ['prop_L'],        // the coffin lid
  streamer: ['prop_L'],      // the phone
  business: ['prop_L', 'prop_R'],
  boss: ['prop_L'],          // the staff above the fist, cut out of the sculpt (W-120 step 2b)
  ringmaster: ['prop_L'],    // the cane above the fist, cut out of the sculpt
};
/** W-120: bodies whose skirt or cape carries the `_HEMMASK` vertex attribute (from their `skirt_*` / `cape_*` source bones). */
export const HEM_BODIES = ['boss', 'bride', 'business', 'fortune', 'granny'];
export const TRI_BUDGET = 9000;
export const GLB_BYTES_BUDGET = 900 * 1024;
export const TOTAL_BYTES_BUDGET = 20 * 1024 * 1024;
export const TEX_MAX = 1024;
export const HEIGHT_TOL = 0.02;

export interface Glb {
  json: any;
  bin: Buffer;
}

export function parseGlb(buf: Buffer): Glb {
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  if (buf.readUInt32LE(8) !== buf.length) throw new Error('GLB length header mismatch');
  let off = 12;
  let json: any = null;
  let bin: Buffer = Buffer.alloc(0);
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  if (!json) throw new Error('GLB without JSON chunk');
  return { json, bin };
}

/** Re-pack a GLB with modified JSON (for tamper tests). */
export function packGlb(json: any, bin: Buffer): Buffer {
  let js = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (4 - (js.length % 4)) % 4;
  js = Buffer.concat([js, Buffer.alloc(pad, 0x20)]);
  const total = 12 + 8 + js.length + 8 + bin.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  out.writeUInt32LE(js.length, 12); out.writeUInt32LE(0x4e4f534a, 16); js.copy(out, 20);
  const b = 20 + js.length;
  out.writeUInt32LE(bin.length, b); out.writeUInt32LE(0x004e4942, b + 4); bin.copy(out, b + 8);
  return out;
}

const NCOMP: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function accessor(g: Glb, idx: number): number[][] {
  const a = g.json.accessors[idx];
  const bv = g.json.bufferViews[a.bufferView];
  const n = NCOMP[a.type];
  const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType as 5126]!;
  const stride = bv.byteStride || size * n;
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const rd = (o: number): number => {
    switch (a.componentType) {
      case 5126: return g.bin.readFloatLE(o);
      case 5125: return g.bin.readUInt32LE(o);
      case 5123: return a.normalized ? g.bin.readUInt16LE(o) / 65535 : g.bin.readUInt16LE(o);
      case 5121: return a.normalized ? g.bin.readUInt8(o) / 255 : g.bin.readUInt8(o);
      case 5122: return g.bin.readInt16LE(o);
      default: return g.bin.readInt8(o);
    }
  };
  const out: number[][] = [];
  for (let i = 0; i < a.count; i++) {
    const row: number[] = [];
    for (let c = 0; c < n; c++) row.push(rd(base + i * stride + c * size));
    out.push(row);
  }
  return out;
}

export function jointNames(g: Glb): string[] {
  return g.json.skins[0].joints.map((j: number) => g.json.nodes[j].name);
}

export function restRotations(g: Glb): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const j of g.json.skins[0].joints) out[g.json.nodes[j].name] = g.json.nodes[j].rotation ?? [0, 0, 0, 1];
  return out;
}

/** Angle (deg) between unit quaternions, stable near zero. */
export function quatAngleDeg(a: number[], b: number[]): number {
  const d1 = Math.hypot(...a.map((x, i) => x - b[i]));
  const d2 = Math.hypot(...a.map((x, i) => x + b[i]));
  return (4 * Math.asin(Math.min(1, Math.min(d1, d2) / 2)) * 180) / Math.PI;
}

/** Width/height of a JPEG (SOF0/1/2) or PNG. */
export function imageSize(buf: Buffer): [number, number] | null {
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

export function images(g: Glb): { mime: string; size: [number, number] | null; bytes: number }[] {
  return (g.json.images ?? []).map((im: any) => {
    const bv = g.json.bufferViews[im.bufferView];
    const raw = g.bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
    return { mime: im.mimeType, size: imageSize(raw), bytes: bv.byteLength };
  });
}

export function triangles(g: Glb): number {
  let t = 0;
  for (const m of g.json.meshes) for (const p of m.primitives) t += g.json.accessors[p.indices].count / 3;
  return t;
}

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function readManifest(): any {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

export function readBodyGlb(file: string): Buffer {
  return readFileSync(resolve(ASSETS, file));
}

export function assetsPresent(): boolean {
  return existsSync(MANIFEST_PATH);
}

/**
 * Validate a manifest + its GLBs (bytes supplied by `read(file)`, so tests can feed tampered copies).
 * Returns human-readable problems; [] == valid.
 */
export function validateCast(manifest: any, read: (file: string) => Buffer | null, zombieRot: Record<string, number[]>): string[] {
  const p: string[] = [];
  if (manifest?.animationsShared !== true) p.push('animationsShared must be true');
  const bodies: any[] = Array.isArray(manifest?.bodies) ? manifest.bodies : [];
  const ids = bodies.map((b) => b.id);
  if (JSON.stringify(ids) !== JSON.stringify([...CAST_BODY_IDS])) p.push(`ids ${JSON.stringify(ids)} != CAST_BODY_IDS`);
  let total = 0;
  for (const b of bodies) {
    const def = CAST_BODIES.find((d) => d.id === b.id);
    const buf = read(b.file);
    if (!def) { p.push(`${b.id}: unknown id`); continue; }
    if (!buf) { p.push(`${b.id}: file missing`); continue; }
    total += buf.length;
    if (buf.length !== b.bytes) p.push(`${b.id}: bytes ${buf.length} != manifest ${b.bytes}`);
    if (sha256(buf) !== b.sha256) p.push(`${b.id}: sha256 mismatch`);
    if (buf.length > GLB_BYTES_BUDGET) p.push(`${b.id}: ${buf.length} bytes > budget`);
    let g: Glb;
    try { g = parseGlb(buf); } catch (e) { p.push(`${b.id}: ${(e as Error).message}`); continue; }
    const joints = jointNames(g);
    if (JSON.stringify([...joints].sort()) !== JSON.stringify([...CAST_BONES].sort())) p.push(`${b.id}: bone set ${joints}`);
    if (JSON.stringify(b.bones) !== JSON.stringify(joints)) p.push(`${b.id}: manifest bones != GLB joints`);
    const rr = restRotations(g);
    for (const n of CAST_BONES) {
      if (!rr[n] || !zombieRot[n]) continue;
      const a = quatAngleDeg(rr[n], zombieRot[n]);
      if (a > 0.001) p.push(`${b.id}: ${n} rest rotation differs from zombie.glb by ${a.toFixed(4)} deg`);
    }
    if ((g.json.animations ?? []).length) p.push(`${b.id}: carries animations (clips must be shared)`);
    const tris = triangles(g);
    if (tris > TRI_BUDGET) p.push(`${b.id}: ${tris} triangles > budget`);
    if (tris !== b.triangles) p.push(`${b.id}: triangles ${tris} != manifest ${b.triangles}`);
    for (const im of images(g)) {
      if (im.mime !== 'image/jpeg') p.push(`${b.id}: texture ${im.mime}`);
      if (!im.size || Math.max(...im.size) > TEX_MAX) p.push(`${b.id}: texture size ${im.size}`);
    }
    const posAcc = g.json.accessors[g.json.meshes[0].primitives[0].attributes.POSITION];
    if (Math.abs(posAcc.max[1] - def.height) > HEIGHT_TOL) p.push(`${b.id}: height ${posAcc.max[1]} != ${def.height}`);
    if (Math.abs(posAcc.min[1]) > 0.005) p.push(`${b.id}: feet at y=${posAcc.min[1]}`);
    if (Math.abs(b.height - def.height) > 1e-9) p.push(`${b.id}: manifest height ${b.height} != cast.ts ${def.height}`);
  }
  if (total > TOTAL_BYTES_BUDGET) p.push(`total ${total} bytes > budget`);
  return p;
}
