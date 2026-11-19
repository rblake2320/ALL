import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { PREMIUM_BODY_IDS, premiumGlbPath } from '../../../src/shared/premiumBodies';
import { evaluate, lookName } from '../../../tools/clip-audit/audit';
import { buildMatrix } from '../../../tools/clip-audit/scenarios';
import { factoryLoadedPaths, factoryWarnings, internals, poseRig, rigFor, sampleRig } from '../../../tools/clip-audit/rigs';
import { GATE_LOOKS, GATE_OPTIONS, judgeEvaluation } from '../../../tools/clip-audit/gate';

describe('premium gate coverage on the shipped runtime', () => {
  it('loads all five premium bodies at high and low through the real quality selector, never a fallback', async () => {
    expect(GATE_LOOKS).toHaveLength(12);
    for (const body of PREMIUM_BODY_IDS) {
      const sizes: number[] = [];
      for (const detail of ['high', 'low'] as const) {
        const look = { body, height: 0.5, detail };
        const lr = await rigFor(look);
        expect(lr.rig.kind, lookName(look)).toBe('cast');
        expect(lr.rig.body).toBe(body);
        expect(factoryLoadedPaths(detail).some((p) => p.endsWith(premiumGlbPath(body, detail)))).toBe(true);
        poseRig(lr, { anim: 'idle' }, { x: 0, y: 0, z: 0, facing: 0 }, 0.5);
        sizes.push(sampleRig(lr).body.tri.length);
      }
      expect(sizes[0], `${body}: low representation must contain fewer triangles`).toBeGreaterThan(sizes[1]);
    }
    expect(factoryWarnings()).toEqual([]);
  }, 180_000);

  it('current standing-eat plate is clear; a displaced real carry anchor fails the named new scenario', async () => {
    const sc = buildMatrix().find((s) => s.key === 'floor:standEat+plate')!;
    const look = { body: 'waitress' as const, height: 0.5 };
    const current = await evaluate(sc, look, GATE_OPTIONS);
    const clean = current.checks.find((c) => c.name === 'pen:item-body');
    expect(clean, sc.key).toBeDefined();
    expect(clean!.value, sc.key).toBeLessThanOrEqual(15);
    const lr = await rigFor(look);
    const setCarry = lr.rig.setCarry.bind(lr.rig);
    const spy = vi.spyOn(lr.rig, 'setCarry').mockImplementation((item) => {
      setCarry(item);
      if (item !== 'plate') return;
      const carried = internals(lr.rig).carryObj!;
      const chest = lr.rig.root.getObjectByName('chest')!;
      // Test-only anchor displacement: centre the actual plate in the chest in its actual parent frame.
      const centre = chest.getWorldPosition(new THREE.Vector3());
      carried.position.copy(carried.parent!.worldToLocal(centre));
    });
    try {
      const shifted = await evaluate(sc, look, GATE_OPTIONS);
      const bad = judgeEvaluation(shifted).failures.find((f) => f.check === 'pen:item-body');
      console.log(`[plate-control] current ${clean!.value} mm; shifted ${shifted.checks.find(c => c.name === 'pen:item-body')?.value} mm; ${sc.key}`);
      expect(bad, sc.key).toBeDefined();
      expect(bad!.key).toBe('floor:standEat+plate');
      expect(bad!.mm).toBeGreaterThan(15);
    } finally {
      spy.mockRestore();
      // Retire the mutated carry object before another test uses this pooled rig.
      lr.rig.setCarry(null);
    }
    const restored = await evaluate(sc, look, GATE_OPTIONS);
    expect(restored.checks.find((c) => c.name === 'pen:item-body')!.value).toBe(clean!.value);
  }, 180_000);

  it.each(['missing', 'late-missing', 'invisible', 'separated'])('rejects the actual-rig %s carry control', async (mode) => {
    const sc = buildMatrix().find((s) => s.key === 'floor:standEat+plate')!;
    const look = { body: 'waitress' as const, height: 0.5 };
    const lr = await rigFor(look);
    const original = lr.rig.setCarry.bind(lr.rig);
    let calls = 0;
    const spy = vi.spyOn(lr.rig, 'setCarry').mockImplementation((item) => {
      calls++;
      if (mode === 'missing' || mode === 'late-missing' && calls === 3) { original(null); return; }
      original(item);
      if (item !== 'plate') return;
      const obj = internals(lr.rig).carryObj!;
      // every node, not only the root: the rig sets the root's own visibility each update (pickup reveal, PR #98)
      if (mode === 'invisible') obj.traverse((o) => { o.visible = false; });
      if (mode === 'separated') {
        const target = lr.rig.root.getObjectByName('chest')!.getWorldPosition(new THREE.Vector3());
        target.z += 0.65;
        obj.position.copy(obj.parent!.worldToLocal(target));
      }
    });
    try {
      const e = await evaluate(sc, look, GATE_OPTIONS);
      const failures = judgeEvaluation(e).failures;
      expect(failures.some((f) => mode === 'separated' ? f.check === 'gap:hand-item' && f.mm > 25 : f.check.startsWith('error:missing-carry'))).toBe(true);
      if (mode === 'late-missing') expect(e.checks.some((c) => c.name === 'pen:item-body')).toBe(true);
    } finally { spy.mockRestore(); lr.rig.setCarry(null); }
  }, 180_000);

  it('requires the requested carry on pair participant B as well', async () => {
    const look = { body: 'waitress' as const, height: 0.5 };
    const lr = await rigFor(look, 'B');
    const original = lr.rig.setCarry.bind(lr.rig);
    const spy = vi.spyOn(lr.rig, 'setCarry').mockImplementation(() => original(null));
    try {
      const e = await evaluate({ kind: 'pair', key: 'pair:idle~standEat+plate@1', spacing: 1, via: ['control'],
        a: { anim: 'idle', carry: null, expression: 'neutral' }, b: { anim: 'standEat', carry: 'plate', expression: 'neutral' } }, look, GATE_OPTIONS);
      expect(judgeEvaluation(e).failures.some((f) => f.check === 'error:missing-carry:B')).toBe(true);
    } finally { spy.mockRestore(); lr.rig.setCarry(null); }
  }, 180_000);
});
