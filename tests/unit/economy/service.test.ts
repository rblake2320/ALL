import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../../src/sim/contracts';
import { TICKS_PER_DAY } from '../../../src/sim/types';
import { grantsFromEvents, MAX_QUEST_BONES } from '../../../src/economy/grants';
import { memory, service, sharedLocks } from './helpers';
import { createDevWallet } from '../../../src/economy/devWallet';
import { STORE_SKUS } from '../../../src/economy/skus';
import { newWorld, opts, simOf, systemsWithQuests, playerScript } from '../quests/helpers';

const world = (extra: Record<string, unknown> = {}) => ({ seed: 42, tick: 10, flags: {}, quests: { worldId: 'w16-abc', grants: [] }, household: { memberIds: [], bills: [] }, agents: {}, objects: {}, relationships: {}, stats: { counters: {}, agent: {} }, ...extra });
const qc = (n: number, bones = 30): SimEvent => ({ type: 'questCompleted', questId: `q${n}`, instance: 1, grantId: `w16-abc:q${n}:1`, title: `Quest ${n}`, grant: { grantId: `w16-abc:q${n}:1`, bones, reason: 'x' } }) as SimEvent;

describe('grantsFromEvents', () => {
  it('reads the questCompleted grant, clamps amounts, dedupes in-batch, skips cheated worlds and junk', () => {
    const g = grantsFromEvents([qc(1), qc(1), qc(2, 1e9), { type: 'questCompleted' }, null, 5, { type: 'milestone', agentId: 'a1', aspirationId: 'asp', milestoneId: 'm1' }, { type: 'promotion', agentId: 'a1', level: 2, title: 'Boss' }, { type: 'skillUp', agentId: 'a1', skill: 'cooking', level: 3 }], world());
    expect(g.map((x) => x.grantId)).toEqual(['w16-abc:q1:1', 'w16-abc:q2:1', 'w16-abc:milestone:a1:asp:m1', 'w16-abc:promotion:a1:2', 'w16-abc:skill:a1:cooking:3']);
    expect(g[1].bones).toBe(MAX_QUEST_BONES);
    expect(grantsFromEvents([qc(1)], world({ flags: { cheated: true } }))).toEqual([]);
    expect(grantsFromEvents([{ type: 'questCompleted', grant: { grantId: 'bad id with spaces', bones: 5 } }], world())).toEqual([]);
  });
});

describe('EconomyService', () => {
  it('pays a quest grant once — duplicate storms, reloads and replays never double-pay', async () => {
    const b = memory();
    const s1 = service(b);
    await s1.init();
    const sim = { state: world() };
    for (let i = 0; i < 50; i++) s1.onSimEvents(sim, [qc(1), qc(1)]);
    await s1.idle();
    expect(s1.wallet.bones).toBe(30);
    expect(s1.toasts.length).toBe(1);
    // reload (new service on the same storage) + the world replays the same completion
    const s2 = service(b);
    await s2.init();
    s2.onSimEvents({ state: world() }, [qc(1)]);
    await s2.idle();
    expect(s2.wallet.bones).toBe(30);
    expect(s2.toasts.length).toBe(0);
  });

  it('two windows granting the same quest at the same time → one entry', async () => {
    const b = memory();
    const locks = sharedLocks();
    const [a, c] = [service(b, { locks }), service(b, { locks })];
    await Promise.all([a.init(), c.init()]);
    a.onSimEvents({ state: world() }, [qc(7)]);
    c.onSimEvents({ state: world() }, [qc(7)]);
    await Promise.all([a.idle(), c.idle()]);
    const fresh = service(b);
    await fresh.init();
    expect(fresh.wallet.bones).toBe(30);
    expect(fresh.ledgerSnapshot!.entries.length).toBe(1);
  });

  it('reconciles grants recorded in the world that were never seen as events (crash before the grant was written)', async () => {
    const b = memory();
    const s = service(b);
    await s.init();
    s.registerNewWorld(world()); // reconciliation only runs for worlds this profile created (security review H-1)
    s.onFrame({ state: world({ quests: { worldId: 'w16-abc', grants: [{ grantId: 'w16-abc:story_firstMeal:1', questId: 'story_firstMeal', instance: 1, tick: 5, bones: 30, entitlements: [] }] } }) } as never);
    await s.idle();
    expect(s.wallet.bones).toBe(30);
  });

  it('unlock: needs the age gate answered, spends Bones once, grants the entitlement, opens the item in Buy mode', async () => {
    const b = memory();
    const s = service(b);
    await s.init();
    expect(s.needsAgeGate).toBe(true);
    s.onSimEvents({ state: world() }, [qc(1, 500)]);
    await s.idle();
    expect((await s.unlock('item:sofa_velvet')).ok).toBe(false); // gate first
    expect(s.answerAgeGate(1990)).toBe('ok');
    expect(s.buyLock('sofa_velvet').state).toBe('locked');
    const [r1, r2] = await Promise.all([s.unlock('item:sofa_velvet'), s.unlock('item:sofa_velvet')]);
    expect([r1.ok, r2.ok].filter(Boolean).length).toBe(1);
    expect(s.wallet.bones).toBe(50);
    expect(s.buyLock('sofa_velvet').state).toBe('open');
    expect(s.skuState('item:sofa_velvet')!.owned).toBe(true);
    const again = service(b);
    await again.init();
    expect(again.isUsable('sofa_velvet')).toBe(true);
    expect(again.needsAgeGate).toBe(false);
  });

  it('insufficient Bones → nothing written; GG and real money always end at "Sign in to buy"', async () => {
    const s = service(memory());
    await s.init();
    s.answerAgeGate(1990);
    const r = await s.unlock('item:tv_seance');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('insufficient');
    expect(s.ledgerSnapshot!.entries.length).toBe(0);
    for (const id of ['item:rug_funeral', 'gg:pocket_change', 'bundle:starter_pack', 'sub:afterlife_plus', 'season:lease_s1']) {
      const p = await s.purchaseGG(id);
      expect(p.ok).toBe(false);
      if (!p.ok) expect(p.block).toBe('signIn');
    }
    expect(s.wallet.gg).toBeNull();
    expect((await s.unlock('gg:pocket_change')).ok).toBe(false);
  });

  it('Grave Gold: a coming-soon body is not charged, and nothing that stays owned is charged twice', async () => {
    const s = service(memory(), { wallet: createDevWallet(5000) });
    await s.init();
    s.answerAgeGate(1980);
    // Any Grave Gold body in this build's catalogue (the premium bodies of PR #92 are not in it yet); when the
    // catalogue has none, a synthetic id still has to be refused without a charge.
    const ggBody = STORE_SKUS.find((k) => k.kind === 'body' && k.priceGG !== undefined)?.id;
    if (ggBody) expect(s.skuState(ggBody)?.block).toBe('comingSoon');
    const body = await s.purchaseGG(ggBody ?? 'body:not_in_catalogue');
    expect(body.ok).toBe(false);
    expect(s.wallet.gg).toBe(5000);
    expect((await s.purchaseGG('bundle:graveyard_garden')).ok).toBe(true);
    expect(s.wallet.gg).toBe(4400);
    const again = await s.purchaseGG('bundle:graveyard_garden');
    expect(again.ok).toBe(false);
    expect(s.wallet.gg).toBe(4400);
  });

  it('under-13: GG blocked with the real reason; Bones unlocks still work', async () => {
    const s = service(memory());
    await s.init();
    s.answerAgeGate(2018);
    const p = await s.purchaseGG('gg:pocket_change');
    expect(!p.ok && p.block).toBe('under13');
    expect(s.answerAgeGate(1980)).toBe('locked');
    s.onSimEvents({ state: world() }, [qc(3, 200)]);
    await s.idle();
    expect((await s.unlock('item:chair_ribcage')).ok).toBe(true);
  });

  it('ignores the menu demo / cheated worlds and never throws on junk', async () => {
    const s = service(memory());
    await s.init();
    expect(() => s.onSimEvents(null as never, [qc(1)])).not.toThrow();
    expect(() => s.onSimEvents({ state: world({ flags: { cheated: true } }) }, [qc(1)])).not.toThrow();
    expect(() => s.onFrame({ state: null } as never)).not.toThrow();
    await s.idle();
    expect(s.wallet.bones).toBe(0);
  });
});

describe('real simulation: first story quest → Bones once (determinism untouched)', () => {
  it('completes story_firstMeal, grants 30 Bones once, a replay of the same save pays nothing, and the sim state is unchanged by the economy', async () => {
    const systems = systemsWithQuests();
    const base = newWorld(opts(9), systems);
    const run = async (econ: ReturnType<typeof service> | null) => {
      const sim = simOf(JSON.parse(JSON.stringify(base)), systems);
      while (sim.state.tick < TICKS_PER_DAY) {
        for (const c of playerScript(sim, sim.state.tick)) sim.dispatch(c);
        sim.step();
        const ev = sim.drainEvents();
        if (econ) {
          econ.onSimEvents(sim, ev);
          if (sim.state.tick % 240 === 0) econ.onFrame(sim);
        }
      }
      return sim;
    };
    const b = memory();
    let t = Date.parse('2026-11-05T12:00:00Z');
    const econ = service(b, { now: () => (t += 1000) });
    await econ.init();
    const withEcon = await run(econ);
    await econ.idle();
    const without = await run(null);
    expect(JSON.stringify(withEcon.serialize())).toBe(JSON.stringify(without.serialize()));
    const keys = econ.ledgerSnapshot!.entries.map((e) => e.key);
    const firstMeal = keys.filter((k) => k.endsWith(':story_firstMeal:1'));
    expect(firstMeal.length).toBe(1);
    expect(econ.wallet.bones).toBeGreaterThanOrEqual(30);
    const before = econ.wallet.bones;
    // replay the same day in a "reloaded" game: no quest grant is paid again
    const econ2 = service(b, { now: () => (t += 1000) });
    await econ2.init();
    await run(econ2);
    await econ2.idle();
    expect(econ2.ledgerSnapshot!.entries.filter((e) => e.key.endsWith(':story_firstMeal:1')).length).toBe(1);
    expect(econ2.ledgerSnapshot!.entries.filter((e) => !e.key.startsWith('daily')).length).toBe(econ.ledgerSnapshot!.entries.filter((e) => !e.key.startsWith('daily')).length);
    expect(econ2.wallet.bones).toBeGreaterThanOrEqual(before);
  }, 120_000);
});
