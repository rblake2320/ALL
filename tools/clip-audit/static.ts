/**
 * CLIP-AUDIT static checks (no characters): things that push through each other because of how a model sits in its
 * footprint, on a wall, on a surface or on the floor.
 *
 *  footprint   model geometry beyond its catalog footprint: two neighbours placed side by side interpenetrate by
 *              the sum of their overhangs; a floor object pushed against a wall sinks into the wall when its
 *              overhang exceeds 0 (the wall's half thickness, DIM.WALL_THICKNESS / 2, already occupies the tile edge)
 *              and shows through the far side of the wall beyond WALL_THICKNESS.
 *  wall        wall-mounted items: geometry behind the wall surface (local z < 0).
 *  surface     every catalog surface point: the modelled top under the point vs the spec height loose items rest at
 *              (items sink when the model is higher, float when it is lower).
 *  lieSurface  every 'lie' slot: catalog lie.height (the renderer rests lying backs on it) vs the modelled mattress /
 *              lining under the slot pose.
 *  itemBase    loose item models: lowest point vs their placement origin (floor / surface contact).
 *  pets        every pet clip: lowest vertex vs the floor (sinks / floats).
 *  levels      level kit models (manifest bounds) vs their footprint.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { DIM } from '../../src/shared/dimensions';
import { PHYSICAL_SPECS } from '../../src/shared/catalog';
import { extractMeshes, hasAsset, loadGlb, readJson } from './assets';
import { meshAabb } from './geometry';
import { NON_SOLID_NODE, hasModel, modelFile, placeFloorObject } from './objects';
import { OUT } from './shots';
import { THRESHOLDS, penVerdict, type Verdict } from './thresholds';

export interface StaticFinding {
  check: string;
  id: string;
  value: number;
  verdict: Verdict;
  detail: string;
}

const HALF_WALL = DIM.WALL_THICKNESS / 2;

function r1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Footprint overhang per side (mm, + = beyond the footprint) of a floor object's solid geometry. */
export async function footprintOverhang(id: string): Promise<{ left: number; right: number; back: number; front: number; minY: number }> {
  const spec = PHYSICAL_SPECS.find((s) => s.id === id)!;
  const o = await placeFloorObject(id, 0, 0, 0, false, false);
  const b = meshAabb(o.solid.mesh);
  const cx = spec.footprint.w / 2;
  const cz = spec.footprint.d / 2;
  return {
    left: r1((-(b.min[0] - cx) - cx) * 1000),
    right: r1((b.max[0] - cx - cx) * 1000),
    back: r1((-(b.min[2] - cz) - cz) * 1000),
    front: r1((b.max[2] - cz - cz) * 1000),
    minY: r1(b.min[1] * 1000),
  };
}

/** All static checks; `write` = also write dev/out/clip-audit/static.json and print the non-PASS rows. */
export async function runStatic(write = true): Promise<StaticFinding[]> {
  const out: StaticFinding[] = [];
  const add = (check: string, id: string, value: number, verdict: Verdict, detail: string) => out.push({ check, id, value: r1(value), verdict, detail });
  // footprint / wall clearance (floor objects; rugs are designed to overlap; outdoor trees overhang by design)
  for (const spec of PHYSICAL_SPECS) {
    if (spec.placement !== 'floor' || !hasModel(spec.id)) continue;
    const ov = await footprintOverhang(spec.id);
    const sides = { left: ov.left, right: ov.right, back: ov.back, front: ov.front };
    const worstSide = (Object.entries(sides) as [string, number][]).sort((a, b) => b[1] - a[1])[0];
    const exempt = spec.layer === 'rug' ? 'rug layer (overlaps by design)' : null;
    const canopy = spec.outdoorOnly && spec.height > 2.5 && worstSide[1] > 0 ? 'outdoor canopy (overhangs by design)' : null;
    const v = exempt ? 'PASS' : canopy ? 'WARN' : penVerdict(worstSide[1]);
    add('footprint', spec.id, worstSide[1], v, `${worstSide[0]} overhang; L ${ov.left} R ${ov.right} B ${ov.back} F ${ov.front} mm${exempt ? `; ${exempt}` : ''}${canopy ? `; ${canopy}` : ''}`);
    // against a wall: the wall body starts HALF_WALL inside the tile edge
    for (const [side, mm] of Object.entries(sides)) {
      const intoWall = mm + HALF_WALL * 1000;
      if (exempt || side === 'front') continue;
      if (intoWall > THRESHOLDS.penWarnMm) {
        const through = mm - HALF_WALL * 1000;
        // inside the wall body it is hidden while walls are up (visible over the cutaway stubs): WARN; through the
        // far face it shows in the next room: FAIL (outdoor trees: canopy over a wall is art direction, WARN)
        add('wall-clearance', spec.id, intoWall, through > 0 && !spec.outdoorOnly ? 'FAIL' : 'WARN', `${side} side sinks ${r1(intoWall)} mm into a wall it is pushed against${through > 0 ? `; shows ${r1(through)} mm through the far side` : ''}`);
      }
    }
    if (ov.minY < -THRESHOLDS.penWarnMm) add('floor', spec.id, -ov.minY, penVerdict(-ov.minY), `geometry ${-ov.minY} mm below the floor`);
  }
  // wall items: nothing behind the wall surface
  for (const spec of PHYSICAL_SPECS) {
    if (spec.placement !== 'wall' || !hasModel(spec.id)) continue;
    const g = await loadGlb(modelFile(spec.id));
    const root = g.scene.clone(true);
    root.updateMatrixWorld(true);
    const m = extractMeshes(root, { skip: (o) => NON_SOLID_NODE.test(o.name) });
    const b = meshAabb(m);
    const behind = -b.min[2] * 1000;
    add('wall-item', spec.id, Math.max(0, behind), behind > DIM.WALL_THICKNESS * 1000 ? 'FAIL' : penVerdict(behind), `back at local z ${r1(b.min[2] * 1000)} mm (wall surface = 0)`);
  }
  // surfaces: modelled top vs the spec height loose items rest at
  for (const spec of PHYSICAL_SPECS) {
    if (!spec.surfaces?.length || spec.placement !== 'floor' || !hasModel(spec.id)) continue;
    const o = await placeFloorObject(spec.id, 0, 0, 0, false, false);
    spec.surfaces.forEach((s, i) => {
      const h = o.solid.bvh.raycast(s.x, s.y + 0.5, s.z, 0, -1, 0, 2);
      const top = Number.isFinite(h) ? s.y + 0.5 - h : -Infinity;
      if (!Number.isFinite(top)) {
        add('surface', `${spec.id}#${i}`, 1000, 'FAIL', `no geometry under surface point (${s.x}, ${s.z}): items float in the air`);
        return;
      }
      const d = (top - s.y) * 1000;
      if (d > 0) add('surface', `${spec.id}#${i}`, d, penVerdict(d), `model top ${r1(top * 1000)} mm, items rest at ${s.y * 1000} mm: items sink ${r1(d)} mm`);
      else add('surface', `${spec.id}#${i}`, -d, -d > THRESHOLDS.floatFailMm ? 'FAIL' : -d > THRESHOLDS.penWarnMm ? 'WARN' : 'PASS', `model top ${r1(top * 1000)} mm, items rest at ${s.y * 1000} mm: items hover ${r1(-d)} mm`);
    });
  }
  // lie slots: catalog lie.height (the renderer rests lying backs on it) vs the modelled surface under the pose
  for (const spec of PHYSICAL_SPECS) {
    if (spec.placement !== 'floor' || !hasModel(spec.id)) continue;
    const lies = spec.slots.filter((s) => s.kind === 'lie' && s.pose);
    if (!lies.length) continue;
    const o = await placeFloorObject(spec.id, 0, 0, 0, true, false);
    for (const s of lies) {
      // from 15 cm above the sim pose (under a half-closed lid, e.g. coffin_chillrest), straight down
      const y0 = s.pose!.y + 0.15;
      const h = o.solid.bvh.raycast(s.pose!.x, y0, s.pose!.z, 0, -1, 0, 2);
      const top = Number.isFinite(h) ? y0 - h : NaN;
      const cat = s.lie?.height;
      const d = cat === undefined || !Number.isFinite(top) ? 1000 : Math.abs(top - cat) * 1000;
      add('lie-surface', `${spec.id}#${s.id}`, d, d > THRESHOLDS.penFailMm ? 'FAIL' : d > THRESHOLDS.penWarnMm ? 'WARN' : 'PASS', `modelled surface ${r1(top * 1000)} mm, catalog lie.height ${cat === undefined ? 'missing' : cat * 1000} mm, pose.y ${s.pose!.y * 1000} mm`);
    }
  }
  // loose item bases
  for (const spec of PHYSICAL_SPECS) {
    if (spec.placement !== 'item' || !hasModel(spec.id)) continue;
    const g = await loadGlb(modelFile(spec.id));
    const root = g.scene.clone(true);
    root.updateMatrixWorld(true);
    const m = extractMeshes(root, { skip: (o) => NON_SOLID_NODE.test(o.name) });
    const b = meshAabb(m);
    const y = b.min[1] * 1000;
    add('item-base', spec.id, Math.abs(y), y < 0 ? penVerdict(-y) : y > THRESHOLDS.penWarnMm ? 'WARN' : 'PASS', `lowest point ${r1(y)} mm (rests on its origin)`);
  }
  // pets
  for (const sp of ['cat', 'dog', 'crow', 'raccoon']) {
    const rel = `models/pets/${sp}.glb`;
    if (!hasAsset(rel)) continue;
    const g = await loadGlb(rel);
    // the cached (shared) pet scene is only ever posed here, sequentially
    const mixer = new THREE.AnimationMixer(g.scene);
    for (const clip of g.animations) {
      mixer.stopAllAction();
      const a = mixer.clipAction(clip);
      a.reset().play();
      let lo = Infinity;
      let hiLow = -Infinity;
      for (let i = 0; i < 6; i++) {
        mixer.setTime((clip.duration * (i + 0.5)) / 6);
        g.scene.updateMatrixWorld(true);
        const m = extractMeshes(g.scene, { boneLabels: false });
        const b = meshAabb(m);
        lo = Math.min(lo, b.min[1]);
        hiLow = Math.max(hiLow, b.min[1]);
      }
      const sink = -lo * 1000;
      const flies = clip.name === 'flee' || clip.name === 'play';
      add('pet-floor', `${sp}:${clip.name}`, Math.max(sink, hiLow * 1000), sink > THRESHOLDS.penWarnMm ? penVerdict(sink) : !flies && hiLow * 1000 > THRESHOLDS.floatFailMm && sp !== 'crow' ? 'FAIL' : 'PASS', `lowest ${r1(lo * 1000)} mm, highest-lowest ${r1(hiLow * 1000)} mm over 6 samples`);
    }
  }
  // level kit (manifest bounds vs footprint)
  if (hasAsset('manifest.levels.json')) {
    const lm = readJson<{ models: { id: string; kind: string; footprint: number[]; bounds: { min: number[]; max: number[] } }[] }>('manifest.levels.json');
    for (const m of lm.models) {
      if (m.kind !== 'floor') continue;
      const [w, d] = m.footprint;
      const ov = Math.max(-m.bounds.min[0] - w / 2, m.bounds.max[0] - w / 2, -m.bounds.min[2] - d / 2, m.bounds.max[2] - d / 2) * 1000;
      add('level-footprint', m.id, ov, penVerdict(ov), `bounds x [${m.bounds.min[0]}, ${m.bounds.max[0]}] z [${m.bounds.min[2]}, ${m.bounds.max[2]}] vs ${w}x${d}`);
      if (m.bounds.min[1] < -THRESHOLDS.penWarnMm / 1000) add('level-floor', m.id, -m.bounds.min[1] * 1000, penVerdict(-m.bounds.min[1] * 1000), 'below floor');
    }
  }
  out.sort((a, b) => (a.check === b.check ? b.value - a.value : a.check < b.check ? -1 : 1));
  if (!write) return out;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'static.json'), JSON.stringify(out, null, 1));
  const bad = out.filter((f) => f.verdict !== 'PASS');
  for (const f of bad) console.log(`${f.verdict.padEnd(4)} ${f.check.padEnd(16)} ${f.id.padEnd(28)} ${String(f.value).padStart(7)}  ${f.detail}`);
  console.log(`[clip-audit] static: ${out.length} checks, ${bad.filter((f) => f.verdict === 'FAIL').length} FAIL, ${bad.filter((f) => f.verdict === 'WARN').length} WARN`);
  return out;
}
