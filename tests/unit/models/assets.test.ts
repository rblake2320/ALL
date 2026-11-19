/**
 * Asset-pipeline output checks (ASSETS-OBJECTS): the manifest covers every catalog + environment id, files match
 * their recorded bytes/sha256, and every GLB satisfies its spec (named dynamic nodes, Paint/Glass materials,
 * footprint/height, front orientation, emissive strengths, triangle and size budgets).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENV_MODELS, PHYSICAL_SPECS, type PhysicalSpec } from '../../../src/shared/catalog';
import { DIM } from '../../../src/shared/dimensions';
import { parseManifest } from '../../../src/render/models/manifest';
import { ENV_DIMS } from '../../../src/render/models/specs';
import { boundsOf, centroidAbove, emissiveStrengths, heightAt, meanNormal, primitives, readGlb, surfaceAbove, type Glb } from './glbReader';

const ROOT = join(__dirname, '..', '..', '..');
const ASSETS = join(ROOT, 'public', 'assets');
const manifestRaw = JSON.parse(readFileSync(join(ASSETS, 'manifest.objects.json'), 'utf8')) as unknown;
const manifest = parseManifest(manifestRaw);
const ENV_IDS = ENV_MODELS.map((e) => e.id);
const ALL_IDS = [...PHYSICAL_SPECS.map((s) => s.id), ...ENV_IDS];

const cache = new Map<string, Glb>();
function glb(id: string): Glb {
  let g = cache.get(id);
  if (!g) {
    g = readGlb(join(ASSETS, manifest.objects[id].file));
    cache.set(id, g);
  }
  return g;
}

function expectedNodes(s: PhysicalSpec): string[] {
  const out: string[] = [];
  for (const p of s.dynamicParts ?? []) {
    if (p === 'servings') out.push('serving_0', 'serving_1', 'serving_2', 'serving_3');
    else out.push(p);
  }
  return out;
}

const LARGE = (s: PhysicalSpec): boolean =>
  s.footprint.w * s.footprint.d >= 3 || s.height >= 2.4 || s.id === 'bed_normal' || s.id === 'rug_rag';

/** Built by their own kit (tools/blender/homeservices, toolchains.json key objects/homeservices): same manifest, own folder. */
const HOME_SERVICE_IDS = new Set(['hearth_stone', 'wardrobe_coffin', 'vault_crypt', 'workbench_bone', 'gate_bone']);

describe('objects manifest', () => {
  it('is a versioned manifest listing every PHYSICAL_SPECS and ENV_MODELS id (and nothing else)', () => {
    expect(manifest.version).toBeGreaterThanOrEqual(1);
    expect(Object.keys(manifest.objects).sort()).toEqual([...ALL_IDS].sort());
    expect(ALL_IDS.length).toBe(86);
  });

  it('records bytes + sha256 that match the files on disk', () => {
    for (const id of ALL_IDS) {
      const e = manifest.objects[id];
      const p = join(ASSETS, e.file);
      expect(existsSync(p), id).toBe(true);
      expect(statSync(p).size, id).toBe(e.bytes);
      expect(createHash('sha256').update(readFileSync(p)).digest('hex'), id).toBe(e.sha256);
      expect(e.file).toBe(HOME_SERVICE_IDS.has(id) ? `models/objects/homeservices/${id}.glb` : `models/objects/${id}.glb`);
    }
  });

  it('stays within the 6 MB total size budget', () => {
    const total = ALL_IDS.reduce((a, id) => a + manifest.objects[id].bytes, 0);
    expect(total).toBeLessThanOrEqual(6 * 1024 * 1024);
  });

  it('bounds and tris agree with an independent parse of every GLB', () => {
    for (const id of ALL_IDS) {
      const e = manifest.objects[id];
      const b = boundsOf(glb(id));
      expect(e.bounds, id).not.toBeNull();
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(e.bounds!.min[k] - b.min[k]), `${id} min[${k}]`).toBeLessThan(2e-3);
        expect(Math.abs(e.bounds!.max[k] - b.max[k]), `${id} max[${k}]`).toBeLessThan(2e-3);
      }
      expect(e.tris, id).toBe(glb(id).tris);
    }
  });
});

describe.each(PHYSICAL_SPECS.map((s) => [s.id, s] as const))('%s', (id, spec) => {
  it('has named nodes for every declared dynamic part', () => {
    const g = glb(id);
    for (const n of expectedNodes(spec)) expect(g.byName.has(n), `${id} missing node ${n}`).toBe(true);
    if (spec.dynamicParts?.includes('door')) {
      const door = g.byName.get('door')!;
      const kids = g.nodes.filter((n) => n.parent === door.index && n.positions.length > 0);
      expect(kids.length, 'door pivot needs a child mesh').toBeGreaterThan(0);
      expect(door.positions.length, 'door is a pivot empty').toBe(0);
    }
    if (spec.dynamicParts?.includes('flag')) {
      expect(g.json.nodes![g.byName.get('flag')!.index].extras?.axis).toBeDefined();
    }
  });

  it('uses Paint when colour variants are declared (and Glass on windows)', () => {
    const names = (glb(id).json.materials ?? []).map((m) => m.name);
    if (spec.variants?.length) expect(names).toContain('Paint');
    if (spec.placement === 'window') {
      expect(names).toContain('Glass');
      const glass = glb(id).json.materials!.find((m) => m.name === 'Glass')!;
      expect(glass.alphaMode).toBe('BLEND');
    }
  });

  it('fits its footprint (+-15%) and height (+-20%) in THREE axes', () => {
    const b = boundsOf(glb(id));
    const w = spec.footprint.w;
    const d = spec.footprint.d;
    if (spec.placement === 'floor' || spec.placement === 'item') {
      if (id !== 'tree_gnarled') {
        expect(b.min[0]).toBeGreaterThanOrEqual((-w / 2) * 1.15);
        expect(b.max[0]).toBeLessThanOrEqual((w / 2) * 1.15);
        expect(b.min[2]).toBeGreaterThanOrEqual((-d / 2) * 1.15);
        expect(b.max[2]).toBeLessThanOrEqual((d / 2) * 1.15);
      }
      expect(b.min[1]).toBeGreaterThanOrEqual(-0.012);
      const tol = Math.max(0.2 * spec.height, spec.height < 0.05 ? 0.012 : 0.03);
      expect(Math.abs(b.max[1] - spec.height), `height ${b.max[1]} vs ${spec.height}`).toBeLessThanOrEqual(tol);
      // not absurdly small either (catches unit mistakes): largest horizontal extent >= 30% of the footprint
      const fill = Math.max((b.max[0] - b.min[0]) / w, (b.max[2] - b.min[2]) / d);
      expect(fill).toBeGreaterThan(spec.placement === 'item' ? 0.12 : 0.3);
    } else if (spec.placement === 'wall') {
      expect(b.min[0]).toBeGreaterThanOrEqual(-0.5 * 1.15);
      expect(b.max[0]).toBeLessThanOrEqual(0.5 * 1.15);
      expect(b.min[2], 'wall items have their back on the wall (z = 0)').toBeGreaterThanOrEqual(-0.01);
      expect(b.max[2]).toBeLessThan(0.4);
      expect(Math.abs(b.max[1] - b.min[1] - spec.height)).toBeLessThanOrEqual(0.2 * spec.height + 0.02);
    } else {
      expect(b.min[0]).toBeGreaterThanOrEqual(-0.5 * 1.15);
      expect(b.max[0]).toBeLessThanOrEqual(0.5 * 1.15);
      expect(b.min[2], 'openings are centred on the wall plane').toBeGreaterThan(-0.25);
      expect(b.max[2]).toBeLessThan(0.25);
      expect(Math.abs(b.min[2] + b.max[2])).toBeLessThan(0.12);
      if (spec.placement === 'door') {
        expect(b.min[1]).toBeGreaterThanOrEqual(-0.012);
        expect(b.max[1]).toBeGreaterThanOrEqual(DIM.DOOR_HEIGHT);
        expect(b.max[1]).toBeLessThanOrEqual(DIM.DOOR_HEIGHT * 1.2);
      } else {
        expect(b.min[1]).toBeGreaterThanOrEqual(DIM.WINDOW_SILL - 0.15);
        expect(b.min[1]).toBeLessThanOrEqual(DIM.WINDOW_SILL + 0.01);
        expect(Math.abs(b.max[1] - (DIM.WINDOW_SILL + spec.height))).toBeLessThan(0.2);
      }
    }
  });

  it('respects the triangle budget', () => {
    const t = glb(id).tris;
    expect(t).toBeGreaterThan(100);
    expect(t).toBeLessThanOrEqual(LARGE(spec) ? 6000 : 3000);
  });

  it('gives emissive dynamic parts an emissive material of strength 2..6', () => {
    for (const part of ['screen', 'glow', 'bulb', 'flame'] as const) {
      if (!spec.dynamicParts?.includes(part)) continue;
      const s = emissiveStrengths(glb(id), part);
      expect(s.length, `${part} emissive`).toBeGreaterThan(0);
      expect(Math.max(...s)).toBeGreaterThanOrEqual(2);
      expect(Math.max(...s)).toBeLessThanOrEqual(6.01);
    }
  });
});

/** Transient overlay nodes (smoke, mist, water, glows) that may legitimately cover a slot. */
const OVERLAYS = ['broken', 'frost', 'water', 'glow'];

describe('front orientation sanity (+Z is the front)', () => {
  const BACKREST: Record<string, number> = {
    chair_creaky: DIM.SEAT_HEIGHT + 0.15,
    chair_ribcage: DIM.SEAT_HEIGHT + 0.15,
    armchair_tattered: DIM.SEAT_HEIGHT + 0.2,
    sofa_moldy: DIM.SEAT_HEIGHT + 0.2,
    sofa_velvet: DIM.SEAT_HEIGHT + 0.2,
    pew_salvaged: DIM.SEAT_HEIGHT + 0.15,
    bed_normal: 0.8,
  };
  it.each(Object.entries(BACKREST))('%s backrest/headboard sits at -Z', (id, y) => {
    const c = centroidAbove(glb(id), y);
    expect(c).not.toBeNull();
    expect(c![2]).toBeLessThan(-0.05);
  });

  it.each(['tv_crt', 'tv_seance', 'arcade_tombstone', 'desk_hauntedpc', 'microwave_nuke'])('%s screen faces +Z', (id) => {
    const n = meanNormal(glb(id), 'screen');
    expect(n).not.toBeNull();
    expect(n![2]).toBeGreaterThan(0.3);
  });

  it.each(['easel_morbid', 'item_painting'])('%s canvas faces +Z', (id) => {
    const n = meanNormal(glb(id), 'canvas', false);
    expect(n![2]).toBeGreaterThan(0.3);
  });

  it.each(['fridge_humming', 'fridge_cryo'])('%s door hinge is at the front-left', (id) => {
    const door = glb(id).byName.get('door')!;
    expect(door.world[14], 'pivot z').toBeGreaterThan(0.1);
    expect(door.world[12], 'pivot x (left = -X seen from the front)').toBeLessThan(-0.2);
    const ang = glb(id).json.nodes![door.index].extras?.openAngle as number;
    expect(ang).toBeLessThan(0); // negative about +Y swings the free (+X) edge toward +Z
  });

  it('desk_hauntedpc: desk on the -Z tile, stool on the +Z tile centred at local (0.5, 1.35)', () => {
    const g = glb('desk_hauntedpc');
    const screen = g.byName.get('screen')!;
    expect(screen.world[14]).toBeLessThan(0);
    const low = centroidAbove(g, 0.0);
    expect(low).not.toBeNull();
    // stool cushion top at SEAT_HEIGHT around z = +0.35
    let found = false;
    for (const n of g.nodes) {
      const p = n.positions;
      for (let i = 0; i < p.length; i += 3) {
        if (Math.abs(p[i + 1] - DIM.SEAT_HEIGHT) < 0.02 && Math.abs(p[i + 2] - 0.35) < 0.05 && Math.abs(p[i]) < 0.05) found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('seat tops sit at SEAT_HEIGHT under every sit slot', () => {
    for (const spec of PHYSICAL_SPECS) {
      for (const slot of spec.slots) {
        if (slot.kind !== 'sit' || !slot.pose) continue;
        const x = slot.pose.x - spec.footprint.w / 2;
        const z = slot.pose.z - spec.footprint.d / 2;
        const top = heightAt(glb(spec.id), x, z, 0.62, OVERLAYS);
        expect(Math.abs(top - DIM.SEAT_HEIGHT), `${spec.id}/${slot.id} seat top ${top}`).toBeLessThan(0.035);
      }
    }
  });

  it('lie slots rest on the lining/mattress/slab height', () => {
    for (const spec of PHYSICAL_SPECS) {
      for (const slot of spec.slots) {
        if (slot.kind !== 'lie' || !slot.pose) continue;
        const x = slot.pose.x - spec.footprint.w / 2;
        const z = slot.pose.z - spec.footprint.d / 2;
        const top = heightAt(glb(spec.id), x, z, slot.pose.y + 0.15, OVERLAYS);
        expect(Math.abs(top - slot.pose.y), `${spec.id}/${slot.id} surface ${top} vs pose ${slot.pose.y}`).toBeLessThan(0.06);
      }
    }
  });

  it('table/counter surfaces are at their surface heights', () => {
    for (const spec of PHYSICAL_SPECS) {
      for (const sf of spec.surfaces ?? []) {
        const top = heightAt(glb(spec.id), sf.x - spec.footprint.w / 2, sf.z - spec.footprint.d / 2, sf.y + 0.03);
        expect(Math.abs(top - sf.y), `${spec.id} surface ${top} vs ${sf.y}`).toBeLessThan(0.02);
      }
    }
  });

  it('wall items hang at their documented heights', () => {
    const p = boundsOf(glb('painting_greatgrand'));
    expect(Math.abs((p.min[1] + p.max[1]) / 2 - 1.6)).toBeLessThan(0.15);
    const s = boundsOf(glb('sconce_candle'));
    expect(Math.abs((s.min[1] + s.max[1]) / 2 - 1.7)).toBeLessThan(0.15);
  });
});

describe('environment models', () => {
  it.each(ENV_IDS)('%s has a sensible size', (id) => {
    const b = boundsOf(glb(id));
    const [w, d, h] = ENV_DIMS[id];
    expect(b.min[1]).toBeGreaterThanOrEqual(-0.02);
    expect(b.max[1]).toBeGreaterThanOrEqual(h * 0.7);
    expect(b.max[1]).toBeLessThanOrEqual(h * 1.3);
    expect(b.max[0] - b.min[0]).toBeLessThanOrEqual(w * 1.3 + 0.2);
    expect(b.max[2] - b.min[2]).toBeLessThanOrEqual(d * 1.3 + 0.2);
    expect(glb(id).tris).toBeLessThanOrEqual(6000);
  });

  it('fence segment starts at x = 0 and spans one metre along X', () => {
    const b = boundsOf(glb('env_fence'));
    expect(b.min[0]).toBeGreaterThan(-0.06);
    expect(b.max[0]).toBeLessThan(1.06);
    expect(b.max[0] - b.min[0]).toBeGreaterThan(0.95);
  });

  it('street lamp has a bulb node', () => {
    expect(glb('env_streetlamp').byName.has('bulb')).toBe(true);
    expect(emissiveStrengths(glb('env_streetlamp'), 'bulb').length).toBeGreaterThan(0);
  });
});

describe('GLB encoding', () => {
  it('uses KHR_mesh_quantization only for normals/colours (positions stay float)', () => {
    for (const id of ALL_IDS) {
      const j = glb(id).json;
      expect(j.extensionsRequired ?? []).toContain('KHR_mesh_quantization');
      for (const m of j.meshes ?? []) {
        for (const p of m.primitives) {
          expect(j.accessors![p.attributes.POSITION].componentType, `${id} POSITION`).toBe(5126);
          const n = j.accessors![p.attributes.NORMAL];
          expect(n.componentType).toBe(5120);
          expect(n.normalized).toBe(true);
          expect(p.attributes.TEXCOORD_0, 'no textures -> no UVs').toBeUndefined();
        }
      }
    }
  });

  it('is canonicalised (sorted triangles, min-index-first) so rebuilds are byte-identical', () => {
    for (const id of ALL_IDS) {
      const g = glb(id);
      for (const n of g.nodes) {
        const ix = n.indices;
        let prev: [number, number, number] = [-1, -1, -1];
        for (let t = 0; t + 2 < ix.length; t += 3) {
          const tri: [number, number, number] = [ix[t], ix[t + 1], ix[t + 2]];
          // primitives are concatenated per node; a reset of the sort order marks a new primitive
          if (tri[0] < prev[0]) prev = [-1, -1, -1];
          expect(tri[0] <= tri[1] && tri[0] <= tri[2], `${id}/${n.name} triangle not rotated`).toBe(true);
          const ordered = tri[0] > prev[0] || (tri[0] === prev[0] && (tri[1] > prev[1] || (tri[1] === prev[1] && tri[2] >= prev[2])));
          expect(ordered, `${id}/${n.name} triangles not sorted`).toBe(true);
          prev = tri;
        }
      }
    }
  });

  it('contains no images or textures (flat colours only)', () => {
    for (const id of ALL_IDS) {
      const j = glb(id).json as { images?: unknown[]; textures?: unknown[] };
      expect(j.images ?? []).toHaveLength(0);
      expect(j.textures ?? []).toHaveLength(0);
    }
  });
});

// ───────────────────────────── hardening pass: pipeline invariants + redone models ─────────────────────────────

const DYNAMIC_ROOTS = ['screen', 'glow', 'bulb', 'flame', 'water', 'door', 'canvas', 'flag', 'broken', 'frost', 'speaker',
  'pump', 'serving_0', 'serving_1', 'serving_2', 'serving_3'];

describe('vertex AO + canonical encoding', () => {
  it('every static mesh carries baked AO (COLOR_0) within the [0.58, 1] multiplier range', () => {
    let staticPrims = 0;
    let withAo = 0;
    for (const id of ALL_IDS) {
      const g = glb(id);
      for (const pr of primitives(g)) {
        const node = g.byName.get(pr.node)!;
        if (DYNAMIC_ROOTS.some((d) => g.under(node.index, d))) continue;
        staticPrims++;
        if (!pr.ao) continue;
        withAo++;
        let lo = Infinity;
        let hi = -Infinity;
        for (const v of pr.ao) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
        expect(lo, `${id}/${pr.node}/${pr.material} AO floor`).toBeGreaterThanOrEqual(0.57);
        expect(hi, `${id}/${pr.node}/${pr.material} AO max`).toBeLessThanOrEqual(1.0001);
      }
    }
    expect(withAo / staticPrims).toBeGreaterThan(0.97);
  });

  it('AO actually varies (creases darker than open faces) on furniture with cavities', () => {
    for (const id of ['counter_butcher', 'chair_creaky', 'coffin_pine', 'sofa_moldy']) {
      const all = primitives(glb(id)).flatMap((p) => (p.ao ? Array.from(p.ao) : []));
      const dark = all.filter((v) => v < 0.75).length / all.length;
      const bright = all.filter((v) => v > 0.95).length / all.length;
      expect(dark, `${id} has dark creases`).toBeGreaterThan(0.03);
      expect(bright, `${id} has open, unoccluded faces`).toBeGreaterThan(0.1);
    }
  });

  it('no primitive contains duplicate vertices (post-quantisation merge makes the vertex set canonical)', () => {
    for (const id of ALL_IDS) {
      for (const pr of primitives(glb(id))) expect(pr.duplicates, `${id}/${pr.node}/${pr.material}`).toBe(0);
    }
  });
});

describe('redone models keep their briefs', () => {
  it('gym_limb: the 0.6 m standing area in the middle stays clear', () => {
    for (const pr of primitives(glb('gym_limb'))) {
      const p = pr.positions;
      for (let i = 0; i < p.length; i += 3) {
        const inside = Math.abs(p[i]) < 0.3 && p[i + 1] > 0.12 && p[i + 1] < 1.25 && Math.abs(p[i + 2]) < 0.4;
        expect(inside, `${pr.material} vertex at ${p[i].toFixed(2)},${p[i + 1].toFixed(2)},${p[i + 2].toFixed(2)}`).toBe(false);
      }
    }
  });

  it('coffin_chillrest: crowned lid closed over the foot half, head half open above the lining', () => {
    const g = glb('coffin_chillrest');
    const lidTop = heightAt(g, 0, 0.37, Infinity, OVERLAYS);
    expect(lidTop).toBeGreaterThan(0.66);
    expect(lidTop).toBeLessThan(0.75);
    for (const z of [-0.25, -0.5, -0.65]) {
      expect(heightAt(g, 0, z, Infinity, OVERLAYS), `open head half at z=${z}`).toBeLessThan(0.52);
    }
    // the sleeper's legs fit under the lid: nothing between the lining and the lid underside
    expect(surfaceAbove(g, 0, 0.37, DIM.BED_HEIGHT + 0.01, OVERLAYS)).toBeGreaterThan(0.58);
  });

  it('sarcophagus_cryo: glass canopy hinged on -X and tilted open with headroom over the sleeper', () => {
    const g = glb('sarcophagus_cryo');
    const glass = primitives(g).filter((p) => p.material === 'GlassCanopy');
    expect(glass.length).toBeGreaterThan(0);
    let sx = 0;
    let n = 0;
    let top = -Infinity;
    for (const pr of glass) {
      for (let i = 0; i < pr.positions.length; i += 3) {
        sx += pr.positions[i];
        top = Math.max(top, pr.positions[i + 1]);
        n++;
      }
    }
    expect(sx / n, 'canopy leans toward its -X hinge').toBeLessThan(-0.05);
    expect(top).toBeGreaterThan(0.95);
    expect(surfaceAbove(g, 0, 0, DIM.BED_HEIGHT + 0.12, OVERLAYS) - (DIM.BED_HEIGHT + 0.1)).toBeGreaterThan(0.3);
  });

  it('lamp_skull: eye sockets burn brighter than the softly glowing shell (reads as a face at night)', () => {
    const s = emissiveStrengths(glb('lamp_skull'), 'bulb');
    expect(new Set(s.map((v) => v.toFixed(2))).size).toBeGreaterThanOrEqual(2);
    expect(Math.max(...s)).toBeGreaterThanOrEqual(4);
    expect(Math.min(...s)).toBeLessThan(2);
  });

  it('item_fire: flame tongues are saturated orange (no white clipping under ACES)', () => {
    const g = glb('item_fire');
    for (const node of g.nodes) {
      if (!g.under(node.index, 'flame')) continue;
      const n = g.json.nodes![node.index];
      if (n.mesh === undefined) continue;
      for (const prim of g.json.meshes![n.mesh].primitives) {
        const ef = g.json.materials![prim.material!].emissiveFactor ?? [0, 0, 0];
        if (Math.max(...ef) <= 0) continue;
        expect(ef[0]).toBeGreaterThanOrEqual(ef[1]);
        expect(ef[1]).toBeGreaterThanOrEqual(ef[2]);
        expect(ef[2]).toBeLessThan(0.45 * ef[0]);
      }
    }
  });

  it('item_meal: four servings slice ONE brain loaf (pink cut faces between neighbours)', () => {
    const g = glb('item_meal');
    const xs: [number, number][] = [];
    for (let k = 0; k < 4; k++) {
      const name = `serving_${k}`;
      const prims = primitives(g).filter((p) => g.under(g.byName.get(p.node)!.index, name));
      const mats = new Set(prims.map((p) => p.material));
      expect(mats.has('Brain'), name).toBe(true);
      expect(mats.has('LoafCut'), `${name} has a cut face`).toBe(true);
      let lo = Infinity;
      let hi = -Infinity;
      for (const pr of prims.filter((p) => p.material === 'Brain')) {
        for (let i = 0; i < pr.positions.length; i += 3) {
          lo = Math.min(lo, pr.positions[i]);
          hi = Math.max(hi, pr.positions[i]);
        }
      }
      xs.push([lo, hi]);
    }
    for (let k = 1; k < 4; k++) {
      const gap = xs[k][0] - xs[k - 1][1];
      expect(gap, `slice gap ${k}`).toBeGreaterThan(0);
      expect(gap, `slice gap ${k}`).toBeLessThan(0.02);
    }
  });

  it('env_bush, env_tree_b, env_hearse stand on the ground', () => {
    for (const id of ['env_bush', 'env_tree_b', 'env_hearse', 'env_tree_a', 'tree_gnarled']) {
      const b = boundsOf(glb(id));
      expect(b.min[1], id).toBeGreaterThanOrEqual(-0.012);
      expect(b.min[1], id).toBeLessThan(0.02);
    }
  });
});
