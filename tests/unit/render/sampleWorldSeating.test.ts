import { describe, expect, it } from 'vitest';
import { buildSampleWorld } from '../../../src/render/dev/sampleWorld';
import { seatedOffset } from '../../../src/render/agents/agents';
import { createSpatial } from '../../../src/sim/spatial';
import { loadContent } from '../../../src/sim';

describe('render sample world', () => {
  it('routes the seated actor through the gameplay sofa slot offset', () => {
    const world = buildSampleWorld();
    const actor = world.agents.a2;
    const target = actor.active?.stageTarget;
    expect(target?.kind).toBe('object');
    if (target?.kind !== 'object') return;
    expect(world.objects[target.id]?.defId).toBe('sofa_velvet');
    expect(actor.active?.slot).toBe(1);
    expect(seatedOffset(actor, actor.anim, world.objects, { forward: 0, lift: 0 }).forward).not.toBe(0);
  });

  it('keeps each scripted walking segment on walkable tiles', () => {
    const world = buildSampleWorld();
    const spatial = createSpatial(() => world, loadContent());
    const bad: string[] = [];
    for (const actor of Object.values(world.agents)) {
      const path = actor.path;
      if (!path || path.length < 2) continue;
      for (let i = 0; i < path.length; i++) {
        const a = path[i], b = path[(i + 1) % path.length];
        const samples = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 10);
        let previous: { x: number; z: number } | undefined;
        for (let n = 0; n <= samples; n++) {
          const x = Math.floor(a.x + (b.x - a.x) * n / samples);
          const z = Math.floor(a.z + (b.z - a.z) * n / samples);
          if (!spatial.isWalkable(x, z)) bad.push(`${actor.id} segment ${i}: ${x},${z}`);
          if (previous && (previous.x !== x || previous.z !== z) && !spatial.canStep(previous.x, previous.z, x, z)) bad.push(`${actor.id} segment ${i}: blocked edge ${previous.x},${previous.z} to ${x},${z}`);
          previous = { x, z };
        }
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });
});
