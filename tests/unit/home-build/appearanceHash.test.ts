/**
 * Row 9 (installed upgrade and rollback with saves kept), the part that can be proven in the repo: every zombie's saved
 * APPEARANCE (body, look slots, colours, the rest) is byte-identical after a save, a load through the world validator,
 * and further play. The same canonical SHA-256 is what the installed-app run records before an upgrade, after it and after
 * a rollback. A negative control proves the hash notices a one-field change in any member's look.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as simModule from '../../../src/sim/index';
import type { SimulationAPI } from '../../../src/sim/contracts';
import type { WorldState } from '../../../src/sim/types';
import { buildCazCatalog } from '../../../src/game/gddCatalog';
import { randomHousehold } from '../../../src/game/randomZombie';
import { validateWorld } from '../../../src/persistence/validation';
import { PREMIUM_BODY_IDS } from '../../../src/shared/premiumBodies';

const canon = (o: unknown): string => {
  if (Array.isArray(o)) return `[${o.map(canon).join(',')}]`;
  if (o && typeof o === 'object') return `{${Object.keys(o as object).sort().map((k) => `${JSON.stringify(k)}:${canon((o as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(o);
};
/** The household's looks: id -> SHA-256 of the canonical appearance block. */
export function appearanceHashes(w: Pick<WorldState, 'agents' | 'household'>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of [...w.household.memberIds].sort()) out[id] = createHash('sha256').update(canon(w.agents[id].appearance)).digest('hex');
  return out;
}

function world(seed: number, members = 3): WorldState {
  const m = simModule;
  const h = randomHousehold(seed * 7919, buildCazCatalog(m.loadContent(), m.LOT_TEMPLATES), members);
  return m.createNewWorld({ seed, householdName: h.householdName, members: h.members, lotTemplate: 'starter', difficulty: 'normal' });
}
const load = (w: unknown): WorldState => {
  const v = validateWorld(JSON.parse(JSON.stringify(w)));
  if (!v.ok) throw new Error(`world refused: ${v.errors.join('; ')}`);
  return v.world;
};

describe('Row 9: every zombie look survives save, load and play byte-identically', () => {
  // One test per household (W-153 lesson: a single 40-household test ran within 2 s of its 60 s limit on a fast
  // machine and timed out on a slower one). Every assertion is kept; the total is checked at the end.
  let checked = 0;
  for (let seed = 1; seed <= 40; seed++) {
    it(`household ${seed}: the appearance hash is unchanged by a validated load and by 3 game hours`, () => {
      const w = world(seed);
      const before = appearanceHashes(w);
      const loaded = load(w);
      expect(appearanceHashes(loaded), `seed ${seed} after load`).toEqual(before);
      const sim: SimulationAPI = simModule.createSimulation(loaded);
      for (let i = 0; i < 3 * 60 * 4; i++) sim.step();
      expect(appearanceHashes(sim.state), `seed ${seed} after 3 h`).toEqual(before);
      checked += Object.keys(before).length;
    });
  }

  it('all 40 households were checked: at least 120 zombie looks', () => {
    expect(checked).toBeGreaterThanOrEqual(120);
  });

  for (const body of PREMIUM_BODY_IDS) {
    it(`premium body ${body}: the look and the body id survive a load and play`, () => {
      const w = world(7);
      const id = w.household.memberIds[0];
      (w.agents[id].appearance as { body: string }).body = body;
      const before = appearanceHashes(w);
      const sim = simModule.createSimulation(load(w));
      for (let i = 0; i < 400; i++) sim.step();
      expect(appearanceHashes(sim.state), body).toEqual(before);
      expect((sim.state.agents[id].appearance as { body: string }).body).toBe(body);
    });
  }

  it('a second save and load of an already loaded world changes nothing (idempotent)', () => {
    const w = load(world(11));
    expect(appearanceHashes(load(w))).toEqual(appearanceHashes(w));
  });

  it('NEGATIVE CONTROL: the hash notices a one-field change in any single member look', () => {
    const w = world(5);
    const base = appearanceHashes(w);
    for (const id of w.household.memberIds) {
      const copy = JSON.parse(JSON.stringify(w)) as WorldState;
      const a = copy.agents[id].appearance as unknown as Record<string, unknown>;
      const key = Object.keys(a).find((k) => typeof a[k] === 'string');
      expect(key).toBeTruthy();
      a[key!] = `${String(a[key!])}x`;
      const changed = appearanceHashes(copy);
      expect(changed[id]).not.toBe(base[id]);
      for (const other of w.household.memberIds) if (other !== id) expect(changed[other]).toBe(base[other]);
    }
  });
});
