import { describe, expect, it } from 'vitest';
import { PREMIUM_BODY_IDS } from '../../../src/shared/premiumBodies';
import { CAST_BODY_IDS } from '../../../src/shared/cast';
import { isUsable } from '../../../src/economy/catalog';
import { canUseBody, unownedPremiumBody } from '../../../src/game/premiumAccess';
import { townieBodies } from '../../../src/sim/systems/people/townies/castBodies';
import { createHarness, startedHarness } from './controllerHarness';
import { makeWorld } from './fakes';
import { createDevWallet } from '../../../src/economy/devWallet';
import { skuById } from '../../../src/economy/skus';
import { memory, service } from '../economy/helpers';

const premium = PREMIUM_BODY_IDS[0];
const facade = (owned: readonly string[] = [], ready = true) => ({
  ready, wallet: { entitlements: new Set(owned.map((id) => `body:${id}`)) }, age: { bracket: 'adult' },
});

describe('premium body authority', () => {
  it('fails closed while profile data is absent, pending or broken; permits only the owned premium id', () => {
    const owned = facade([premium]);
    for (const id of PREMIUM_BODY_IDS) {
      expect(canUseBody(id, null)).toBe(false);
      expect(canUseBody(id, facade([id], false) as never)).toBe(false);
      expect(canUseBody(id, { ready: true, get wallet() { throw new Error('offline'); } } as never)).toBe(false);
      expect(canUseBody(id, owned as never)).toBe(id === premium);
      expect(isUsable(`body:${id}`, new Set())).toBe(false);
      expect(isUsable(`body:${id}`, new Set([`body:${id}`]))).toBe(true);
    }
    for (const id of ['classic', ...CAST_BODY_IDS]) {
      expect(canUseBody(id, null)).toBe(true);
      if (id !== 'classic') expect(isUsable(`body:${id}`, new Set())).toBe(true);
    }
  });

  it('refuses direct member and bulk CAZ edits, and catches a forged state before start', async () => {
    const h = await createHarness();
    h.game.beginNewGame();
    const before = h.game.caz!.members[0].appearance.body;
    h.game.updateCazMember(0, { appearance: { ...h.game.caz!.members[0].appearance, body: premium } });
    expect(h.game.caz!.members[0].appearance.body).toBe(before);
    const forged = structuredClone(h.game.caz!.members);
    forged[0].appearance.body = premium;
    h.game.updateCaz({ members: forged });
    expect(h.game.caz!.members[0].appearance.body).toBe(before);
    h.game.caz!.members[0].appearance.body = premium;
    expect(h.game.validateCazDetailed().some((x) => x.field === 'appearance' && /not owned/i.test(x.message))).toBe(true);
    const worldsBeforeStart = h.simModule.worlds.length; // boot creates a separate demo world
    await h.game.startGame();
    expect(h.game.screen).toBe('caz');
    expect(h.simModule.worlds).toHaveLength(worldsBeforeStart);
  });

  it('accepts an owned premium body in CAZ while allowing the free kit without an economy', async () => {
    const h = await createHarness({ economy: facade([premium]) });
    h.game.beginNewGame();
    h.game.updateCazMember(0, { appearance: { ...h.game.caz!.members[0].appearance, body: premium } });
    expect(h.game.caz!.members[0].appearance.body).toBe(premium);
    expect(h.game.validateCaz()).toEqual([]);
    const plain = await createHarness();
    plain.game.beginNewGame();
    plain.game.updateCazMember(0, { appearance: { ...plain.game.caz!.members[0].appearance, body: CAST_BODY_IDS[0] } });
    expect(plain.game.caz!.members[0].appearance.body).toBe(CAST_BODY_IDS[0]);
  });

  it('allows locked selections to be replaced one at a time if entitlements disappear during CAZ', async () => {
    const economy = facade([PREMIUM_BODY_IDS[0], PREMIUM_BODY_IDS[1]]);
    const h = await createHarness({ economy });
    h.game.beginNewGame();
    h.game.addCazMember();
    for (let i = 0; i < 2; i++) h.game.updateCazMember(i, { appearance: { ...h.game.caz!.members[i].appearance, body: PREMIUM_BODY_IDS[i] } });
    economy.wallet.entitlements.clear();
    expect(h.game.validateCazDetailed().filter((x) => x.field === 'appearance')).toHaveLength(2);
    h.game.updateCazMember(0, { appearance: { ...h.game.caz!.members[0].appearance, body: 'classic' } });
    expect(h.game.caz!.members[0].appearance.body).toBeUndefined(); // Classic is canonicalized to the default body.
    expect(h.game.validateCazDetailed().filter((x) => x.field === 'appearance')).toHaveLength(1);
    h.game.updateCazMember(1, { appearance: { ...h.game.caz!.members[1].appearance, body: 'classic' } });
    expect(h.game.validateCazDetailed().filter((x) => x.field === 'appearance')).toHaveLength(0);
  });

  it('rejects an unowned body in a saved townie without mutating the saved slot or current session', async () => {
    const h = await startedHarness();
    const previous = h.game.sim;
    const world = makeWorld();
    world.agents.a99.appearance.body = premium;
    const original = JSON.stringify(world);
    const info = { slotId: 'locked', name: 'Locked', savedAt: '', createdAt: '', playMinutes: 0, meta: {} as never, isAutosave: false, recoveredFromBackup: false, bytes: 1 };
    h.saves.slots.set('locked', { world, info });
    const result = await h.game.loadGame('locked');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/premium body.*not own/i);
    expect(h.game.sim).toBe(previous);
    expect(JSON.stringify(h.saves.slots.get('locked')!.world)).toBe(original);
    expect(unownedPremiumBody(world, facade([premium]) as never)).toBeNull();
  });

  it('loads an owned premium body and reports its store SKU as owned even while sales are coming soon', async () => {
    const wallet = createDevWallet();
    const sku = skuById(`body:${premium}`)!;
    expect((await wallet.purchase(sku)).ok).toBe(true); // isolated server-wallet stand-in
    const economy = service(memory(), { wallet });
    await economy.init();
    expect(economy.skuState(sku.id)).toMatchObject({ owned: true, block: 'owned' });
    const h = await createHarness({ economy });
    const world = makeWorld();
    world.agents.a1.appearance.body = premium;
    h.saves.slots.set('owned', { world, info: { slotId: 'owned', name: 'Owned', savedAt: '', createdAt: '', playMinutes: 0, meta: {} as never, isAutosave: false, recoveredFromBackup: false, bytes: 1 } });
    const pending = h.game.loadGame('owned');
    await h.until(() => h.game.screen === 'game');
    expect((await pending).ok).toBe(true);
    expect(h.game.sim!.state.agents.a1.appearance.body).toBe(premium);
  });

  it('never deals premium bodies to randomly generated townies', () => {
    for (let seed = 0; seed < 128; seed++) {
      for (const body of townieBodies(seed, 128)) expect(body === null || (CAST_BODY_IDS as readonly string[]).includes(body)).toBe(true);
    }
  });
});
