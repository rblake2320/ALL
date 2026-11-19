/**
 * GLB container + structure checks for every published object model (ASSETS-OBJECTS), written independently of the
 * Python pipeline (tools/blender/common/glb.py) so the two cross-check each other:
 *   - binary layout: header length == file size, JSON then BIN chunk, 4-byte aligned chunks and padding
 *   - one embedded buffer; every bufferView inside it; every accessor inside its bufferView
 *   - triangle lists only, index values in range, no degenerate or duplicated triangles, attribute counts agree
 *   - a well-formed node forest (each node has <= 1 parent, no cycles, everything reachable from the scene)
 *   - unique, lower_snake_case node names; unique material names; every primitive has a material
 *   - only extensions three 0.180's GLTFLoader implements (KHR_mesh_quantization is the only required one)
 *   - material conventions: 'Paint' opaque and non-emissive (tint/dirt variants + static batching rely on it),
 *     'Glass' alpha-blended at ~0.35
 *   - per-model budgets: draw calls (primitives), materials, vertices per primitive (uint16 indices), file size
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENV_MODELS, PHYSICAL_SPECS } from '../../../src/shared/catalog';
import { parseManifest } from '../../../src/render/models/manifest';
import type { GltfJson } from './glbReader';

const ROOT = join(__dirname, '..', '..', '..');
const ASSETS = join(ROOT, 'public', 'assets');
const manifest = parseManifest(JSON.parse(readFileSync(join(ASSETS, 'manifest.objects.json'), 'utf8')) as unknown);
const ALL_IDS = [...PHYSICAL_SPECS.map((s) => s.id), ...ENV_MODELS.map((e) => e.id)];

/** Extensions three.js r180 GLTFLoader implements that the pipeline is allowed to emit. */
const SUPPORTED_EXTENSIONS = new Set(['KHR_mesh_quantization', 'KHR_materials_emissive_strength', 'KHR_materials_clearcoat']);
const REQUIRED_OK = new Set(['KHR_mesh_quantization']);

/** Budgets (current maxima in brackets): primitives = draw calls before the renderer's static batching [23],
 *  materials [19], vertices per primitive [~5.7k] (uint16 indices), bytes per file [~156 KB]. */
const MAX_PRIMITIVES = 24;
const MAX_MATERIALS = 20;
const MAX_VERTS_PER_PRIMITIVE = 65535;
const MAX_FILE_BYTES = 180 * 1024;

const COMP_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NCOMP: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

interface Raw {
  file: string;
  bytes: Buffer;
  json: GltfJson & { asset?: { version?: string }; buffers?: { byteLength: number; uri?: string }[] };
  jsonChunk: Buffer;
  bin: Buffer;
  binOffset: number;
}

const rawCache = new Map<string, Raw>();
function raw(id: string): Raw {
  const hit = rawCache.get(id);
  if (hit) return hit;
  const file = join(ASSETS, manifest.objects[id].file);
  const bytes = readFileSync(file);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jl = dv.getUint32(12, true);
  const jsonChunk = bytes.subarray(20, 20 + jl);
  const binOffset = 20 + jl;
  const bl = binOffset + 8 <= bytes.length ? dv.getUint32(binOffset, true) : 0;
  const bin = bytes.subarray(binOffset + 8, binOffset + 8 + bl);
  const r: Raw = { file, bytes, json: JSON.parse(jsonChunk.toString('utf8')) as Raw['json'], jsonChunk, bin, binOffset };
  rawCache.set(id, r);
  return r;
}

function readIndices(r: Raw, accIdx: number): number[] {
  const acc = r.json.accessors![accIdx];
  const view = r.json.bufferViews![acc.bufferView!];
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const dv = new DataView(r.bin.buffer, r.bin.byteOffset, r.bin.byteLength);
  const out: number[] = new Array(acc.count);
  for (let i = 0; i < acc.count; i++) {
    out[i] = acc.componentType === 5125 ? dv.getUint32(base + i * 4, true)
      : acc.componentType === 5123 ? dv.getUint16(base + i * 2, true) : dv.getUint8(base + i);
  }
  return out;
}

describe.each(ALL_IDS)('%s GLB structure', (id) => {
  it('has a valid binary container (header, chunk order, alignment, padding)', () => {
    const r = raw(id);
    const dv = new DataView(r.bytes.buffer, r.bytes.byteOffset, r.bytes.byteLength);
    expect(dv.getUint32(0, true), 'magic').toBe(0x46546c67);
    expect(dv.getUint32(4, true), 'version').toBe(2);
    expect(dv.getUint32(8, true), 'header length == file size').toBe(r.bytes.length);
    expect(dv.getUint32(16, true), 'first chunk is JSON').toBe(0x4e4f534a);
    expect(r.jsonChunk.length % 4, 'JSON chunk 4-byte aligned').toBe(0);
    // JSON padding (if any) is spaces, BIN chunk follows and is the last chunk, zero padded
    const text = r.jsonChunk.toString('utf8');
    expect(text.trimEnd().endsWith('}')).toBe(true);
    expect(dv.getUint32(r.binOffset + 4, true), 'second chunk is BIN').toBe(0x004e4942);
    expect(r.bin.length % 4, 'BIN chunk 4-byte aligned').toBe(0);
    expect(r.binOffset + 8 + r.bin.length, 'BIN is the last chunk').toBe(r.bytes.length);
    expect(r.json.asset?.version).toBe('2.0');
  });

  it('keeps every buffer view and accessor inside its parent range', () => {
    const r = raw(id);
    const { json } = r;
    expect(json.buffers?.length, 'exactly one buffer').toBe(1);
    const buf = json.buffers![0];
    expect(buf.uri, 'buffer is embedded (no external .bin)').toBeUndefined();
    expect(buf.byteLength).toBeLessThanOrEqual(r.bin.length);
    expect(r.bin.length - buf.byteLength, 'BIN padding < 4 bytes').toBeLessThan(4);
    for (const [i, v] of (json.bufferViews ?? []).entries()) {
      expect(v.buffer, `view ${i}`).toBe(0);
      expect((v.byteOffset ?? 0) + v.byteLength, `view ${i} end`).toBeLessThanOrEqual(buf.byteLength);
      if (v.byteStride !== undefined) {
        expect(v.byteStride % 4, `view ${i} stride alignment`).toBe(0);
        expect(v.byteStride).toBeGreaterThanOrEqual(4);
        expect(v.byteStride).toBeLessThanOrEqual(252);
      }
    }
    for (const [i, acc] of (json.accessors ?? []).entries()) {
      expect(acc.bufferView, `accessor ${i} has a view`).toBeDefined();
      const view = json.bufferViews![acc.bufferView!];
      const size = COMP_SIZE[acc.componentType];
      const elem = size * NCOMP[acc.type];
      const stride = view.byteStride ?? elem;
      expect(acc.count, `accessor ${i} count`).toBeGreaterThan(0);
      expect((acc.byteOffset ?? 0) % size, `accessor ${i} offset alignment`).toBe(0);
      expect((acc.byteOffset ?? 0) + (acc.count - 1) * stride + elem, `accessor ${i} end`).toBeLessThanOrEqual(view.byteLength);
    }
  });

  it('draws indexed triangle lists with valid, non-degenerate, unique triangles', () => {
    const r = raw(id);
    for (const mesh of r.json.meshes ?? []) {
      for (const [pi, prim] of mesh.primitives.entries()) {
        const where = `${mesh.name ?? '?'}#${pi}`;
        expect(prim.mode ?? 4, `${where} mode`).toBe(4);
        expect(prim.indices, `${where} indexed`).toBeDefined();
        const pos = r.json.accessors![prim.attributes.POSITION];
        expect(pos.type).toBe('VEC3');
        expect(pos.min?.length, `${where} POSITION min (required by the spec)`).toBe(3);
        expect(pos.max?.length, `${where} POSITION max`).toBe(3);
        for (const [name, ai] of Object.entries(prim.attributes)) {
          expect(r.json.accessors![ai].count, `${where} ${name} count`).toBe(pos.count);
        }
        const ia = r.json.accessors![prim.indices!];
        expect(ia.type).toBe('SCALAR');
        expect([5123, 5125]).toContain(ia.componentType);
        expect(ia.count % 3, `${where} index count`).toBe(0);
        const idx = readIndices(r, prim.indices!);
        const seen = new Set<number>();
        const bad: string[] = [];
        for (let t = 0; t < idx.length; t += 3) {
          const a = idx[t];
          const b = idx[t + 1];
          const c = idx[t + 2];
          if (Math.max(a, b, c) >= pos.count) bad.push(`index out of range in triangle ${t / 3}`);
          if (a === b || b === c || a === c) bad.push(`degenerate triangle ${t / 3} (${a},${b},${c})`);
          // canonical rotation (smallest first) keeps winding, so equal keys mean an exact duplicate
          const m = a < b ? (a < c ? 0 : 2) : b < c ? 1 : 2;
          const key = idx[t + m] * 4294967296 + idx[t + ((m + 1) % 3)] * 65536 + idx[t + ((m + 2) % 3)];
          if (seen.has(key)) bad.push(`duplicate triangle ${t / 3}`);
          seen.add(key);
        }
        expect(bad.slice(0, 5), where).toEqual([]);
      }
    }
  });

  it('has a node forest with unique lower_snake_case names, all reachable from the scene', () => {
    const { json } = raw(id);
    const nodes = json.nodes ?? [];
    const parent = new Map<number, number>();
    for (const [i, n] of nodes.entries()) {
      for (const c of n.children ?? []) {
        expect(c, `node ${i} child`).toBeLessThan(nodes.length);
        expect(parent.has(c), `node ${c} has two parents`).toBe(false);
        parent.set(c, i);
      }
    }
    const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
    expect(roots.length).toBeGreaterThan(0);
    for (const r of roots) expect(parent.has(r), `scene root ${r} is also a child`).toBe(false);
    const reached = new Set<number>();
    const stack = [...roots];
    while (stack.length) {
      const n = stack.pop()!;
      expect(reached.has(n), `cycle at node ${n}`).toBe(false);
      reached.add(n);
      stack.push(...(nodes[n].children ?? []));
    }
    expect(reached.size, 'every node reachable from the scene').toBe(nodes.length);
    const names = nodes.map((n) => n.name ?? '');
    for (const n of names) expect(n, 'node name').toMatch(/^[a-z][a-z0-9_]{0,59}$/);
    expect(new Set(names).size, `duplicate node names in ${names.join(',')}`).toBe(names.length);
  });

  it('uses only supported extensions and well-formed, uniquely named materials', () => {
    const { json } = raw(id);
    for (const e of json.extensionsUsed ?? []) expect(SUPPORTED_EXTENSIONS.has(e), `extension ${e}`).toBe(true);
    for (const e of json.extensionsRequired ?? []) expect(REQUIRED_OK.has(e), `required extension ${e}`).toBe(true);
    const mats = json.materials ?? [];
    const names = mats.map((m) => m.name ?? '');
    expect(new Set(names).size, 'material names unique').toBe(names.length);
    for (const mesh of json.meshes ?? []) {
      for (const prim of mesh.primitives) {
        expect(prim.material, `${mesh.name} primitive without material`).toBeDefined();
        expect(prim.material!).toBeLessThan(mats.length);
      }
    }
    for (const m of mats) {
      if (m.name === 'Paint') {
        expect(m.alphaMode ?? 'OPAQUE', 'Paint must stay opaque (tints, dirt, batching)').toBe('OPAQUE');
        expect(Math.max(...(m.emissiveFactor ?? [0, 0, 0])), 'Paint must not glow').toBe(0);
      }
      if (m.name === 'Glass') {
        expect(m.alphaMode).toBe('BLEND');
        const a = m.pbrMetallicRoughness?.baseColorFactor?.[3] ?? 1;
        expect(a).toBeGreaterThanOrEqual(0.25);
        expect(a).toBeLessThanOrEqual(0.45);
      }
    }
  });

  it('stays within the draw-call, material, vertex and file-size budgets', () => {
    const r = raw(id);
    const prims = (r.json.meshes ?? []).reduce((n, m) => n + m.primitives.length, 0);
    expect(prims, 'primitives (draw calls before batching)').toBeLessThanOrEqual(MAX_PRIMITIVES);
    expect((r.json.materials ?? []).length, 'materials').toBeLessThanOrEqual(MAX_MATERIALS);
    for (const mesh of r.json.meshes ?? []) {
      for (const prim of mesh.primitives) {
        expect(r.json.accessors![prim.attributes.POSITION].count).toBeLessThanOrEqual(MAX_VERTS_PER_PRIMITIVE);
      }
    }
    expect(statSync(r.file).size, 'file size').toBeLessThanOrEqual(MAX_FILE_BYTES);
  });
});

describe('powered appliances only glow through dynamic-part nodes', () => {
  /** Decorative always-on glows that are part of an object's identity even without power. */
  const ALWAYS_ON: Readonly<Record<string, readonly string[]>> = {
    stove_necrochef: ['GlowToxic'], // the radioactive goo in its pot glows by itself
  };
  const LIT_PARTS = new Set(['screen', 'glow', 'bulb', 'flame', 'broken', 'frost', 'canvas']);
  it.each(PHYSICAL_SPECS.filter((s) => s.needsPower).map((s) => s.id))('%s', (id) => {
    const { json } = raw(id);
    const nodes = json.nodes ?? [];
    const parent = new Map<number, number>();
    nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
    const underLitPart = (i: number): boolean => {
      for (let n: number | undefined = i; n !== undefined; n = parent.get(n)) if (LIT_PARTS.has(nodes[n].name ?? '')) return true;
      return false;
    };
    const offenders: string[] = [];
    nodes.forEach((n, i) => {
      if (n.mesh === undefined || underLitPart(i)) return;
      for (const prim of json.meshes![n.mesh].primitives) {
        const mat = json.materials![prim.material!];
        if (Math.max(...(mat.emissiveFactor ?? [0, 0, 0])) <= 0) continue;
        if ((ALWAYS_ON[id] ?? []).includes(mat.name ?? '')) continue;
        offenders.push(`${n.name}/${mat.name}`);
      }
    });
    expect(offenders, 'static emissive meshes stay lit when the object is unpowered').toEqual([]);
  });
});
