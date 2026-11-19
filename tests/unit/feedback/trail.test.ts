/** W-110 event trail: last 50 closed-vocabulary events, merged repeats, sim event allowlist, FPS summary. */
import { describe, expect, it } from 'vitest';
import { EventTrail, trailKey } from '../../../src/feedback/trail';

describe('EventTrail', () => {
  it('keeps the last 50, merges consecutive repeats, keys are reduced to a safe alphabet', () => {
    let now = 0;
    const t = new EventTrail(() => now);
    for (let i = 0; i < 120; i++) {
      now += 10;
      t.push('key', i % 2 ? 'modeBuy' : 'modeLive');
    }
    t.push('key', 'modeLive');
    t.push('key', 'modeLive');
    const l = t.list();
    expect(l).toHaveLength(50);
    expect(l[l.length - 1]).toMatchObject({ k: 'key:modeLive', n: 2 });
    expect(trailKey('error', 'Hello <b>Mortimer</b> said "hi"')).toBe('error:Hello__b_Mortimer__b__said__hi_');
    expect(trailKey('x', { evil: 1 })).toBe('x:none');
    expect(trailKey('x', 'y'.repeat(200))).toHaveLength(64);
  });
  it('records only allow-listed sim event TYPES (never payloads)', () => {
    const t = new EventTrail(() => 0);
    t.simEvents([{ type: 'sfx' }, { type: 'notify', text: 'Mortimer is starving' } as never, { type: 'fx' }, null as never, { type: 'choice' }]);
    expect(t.list().map((e) => e.k)).toEqual(['sim:notify', 'sim:choice']);
    expect(JSON.stringify(t.list())).not.toContain('Mortimer');
  });
  it('FPS: at most one sample per second; min/avg/max/now', () => {
    let now = 0;
    const t = new EventTrail(() => now);
    expect(t.fps(0)).toEqual({ now: 0, min: 0, avg: 0, max: 0, samples: 0 });
    for (const [ms, f] of [[0, 60], [500, 10], [1000, 30], [2500, 45], [2600, NaN], [4000, -5]] as const) {
      now = ms;
      t.sampleFps(f);
    }
    expect(t.fps(50)).toEqual({ now: 50, min: 30, avg: 45, max: 60, samples: 3 });
  });
});
