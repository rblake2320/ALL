/**
 * W-073 request D1 (docs/contract-requests/clipping.md): a fridge door must not swing into the zombie using it.
 *
 * The door is a `door` node whose GLB extras carry `openAngle` (radians); the renderer swings it open while the
 * fridge is in use. This runs the clipping audit on every fridge interaction with the door open, on the gate's
 * two bodies, and holds what the door leaf does to the body.
 *
 * Measured on the mascot (the widest body), deepest contact with the leaf by open angle: 97-100 degrees (as
 * shipped) 98-99 mm, 110 degrees 57-61 mm, 115 degrees 37-50 mm, 120 degrees 23 mm, 125 degrees none.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../../../tools/clip-audit/audit';
import { buildMatrix, type SlotScenario } from '../../../tools/clip-audit/scenarios';
import { readGlb } from '../models/glbReader';
import { fullGate, GATE_LOOKS } from './gate';

const FRIDGES = ['fridge_humming', 'fridge_cryo'];
const MODELS = join(__dirname, '..', '..', '..', 'public', 'assets', 'models', 'objects');

describe('fridge doors open away from the user (W-073 D1)', () => {
  it.each(FRIDGES)('%s: the door opens between 110 and 130 degrees', (id) => {
    const g = readGlb(join(MODELS, `${id}.glb`));
    const door = g.json.nodes!.find((n) => n.name === 'door') as unknown as { extras: { part: string; openAngle: number } };
    expect(door.extras.part).toBe('door');
    expect(Math.abs(door.extras.openAngle)).toBeGreaterThanOrEqual((110 * Math.PI) / 180 - 1e-6);
    expect(Math.abs(door.extras.openAngle)).toBeLessThanOrEqual((130 * Math.PI) / 180);   // no further than it needs: the leaf sweeps the tile beside the fridge
    expect(door.extras.openAngle).toBeLessThan(0);                                         // left hinge, swings to the front
  });

  it.each(FRIDGES)('%s: the door node says which side it hinges on, and that is where the hinge is', (id) => {
    const g = readGlb(join(MODELS, `${id}.glb`));
    const door = g.json.nodes!.find((n) => n.name === 'door') as unknown as {
      translation: number[]; extras: { hingeSide: string; openAngle: number };
    };
    expect(['left', 'right']).toContain(door.extras.hingeSide);
    // object-local, seen from the front (+Z): left is -X. The hinge is the door node's own origin.
    expect(Math.abs(door.translation[0]!)).toBeGreaterThan(0.2);
    expect(door.extras.hingeSide).toBe(door.translation[0]! < 0 ? 'left' : 'right');
    // a left hinge opens with a negative angle (the free edge swings to the front), a right hinge with a positive one
    expect(Math.sign(door.extras.openAngle)).toBe(door.extras.hingeSide === 'left' ? -1 : 1);
  });

  // the audit part runs with the full gate (`npm run clip:gate`), like the other gate suites; the angle is checked always
  it.skipIf(!fullGate)('with the door open, no fridge interaction puts the body deeper than 15 mm into the door leaf', async () => {
    const scenarios = buildMatrix().filter((s): s is SlotScenario => s.kind === 'slot' && FRIDGES.includes(s.objectId));
    expect(scenarios.length).toBeGreaterThan(0);
    const rows: string[] = [];
    let worstLeaf = 0;
    for (const sc of scenarios) {
      for (const look of GATE_LOOKS) {
        const ev = await evaluate(sc, look, { times: 6, rot: 0 });
        for (const c of ev.checks) {
          if (!/door_leaf/.test(c.detail)) continue;
          rows.push(`${sc.key} ${ev.look} ${c.name} ${c.value.toFixed(1)} mm ${c.detail}`);
          worstLeaf = Math.max(worstLeaf, c.value);
        }
      }
    }
    console.log(`[fridge-door] ${scenarios.length} scenarios; door-leaf contacts:\n${rows.join('\n') || '(none)'}`);
    expect(worstLeaf, rows.join('\n')).toBeLessThanOrEqual(15);
  }, 600000);
});
