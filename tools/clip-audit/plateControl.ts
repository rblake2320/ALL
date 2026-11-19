/** Standalone gate control. --shift displaces the real carry anchor into the chest and must exit 1. */
import * as THREE from 'three';
import { evaluate } from './audit';
import { GATE_OPTIONS, judgeEvaluation } from './gate';
import { internals, rigFor } from './rigs';
import { buildMatrix } from './scenarios';

const scenario = buildMatrix().find((s) => s.key === 'floor:standEat+plate');
if (!scenario) throw new Error('missing floor:standEat+plate');
const look = { body: 'waitress' as const, height: 0.5 };
const rig = (await rigFor(look)).rig;
// Settle before computing the test-only position in the actual parent frame.
await evaluate(scenario, look, GATE_OPTIONS);
const original = rig.setCarry.bind(rig);
if (process.argv.includes('--shift')) rig.setCarry = (item) => {
  original(item);
  if (item !== 'plate') return;
  const plate = internals(rig).carryObj!;
  const centre = rig.root.getObjectByName('chest')!.getWorldPosition(new THREE.Vector3());
  plate.position.copy(plate.parent!.worldToLocal(centre));
};
try {
  const e = await evaluate(scenario, look, GATE_OPTIONS);
  const result = judgeEvaluation(e);
  if (!e.checks.some((c) => c.name === 'pen:item-body')) throw new Error('plate not measured');
  console.log(JSON.stringify({ key: e.key, look: e.look, shifted: process.argv.includes('--shift'),
    plateMm: e.checks.find((c) => c.name === 'pen:item-body')!.value, ...result }, null, 2));
  process.exitCode = result.failures.length ? 1 : 0;
} finally {
  rig.setCarry = original;
  rig.setCarry(null);
}
