/**
 * W-013 undead pet looks: a premium (Grave Gold) store unlock per species, cosmetic only, shown "coming soon" and locked
 * like the premium cast bodies. Catalogue and store, the `look` command on a real simulation, the game layer's
 * entitlement check (the sim knows no entitlements), saves, and what the renderer reads.
 */
import { describe, expect, it } from 'vitest';
import type { Command } from '../../../src/sim/contracts';
import type { PetsState, WorldState } from '../../../src/sim/types';
import { allSystems } from '../../../src/sim/index';
import type { EngineSimulation } from '../../../src/sim/engine';
import * as simModule from '../../../src/sim/index';
import { validateWorld } from '../../../src/persistence/validation';
import { CATALOG, PET_VARIANTS_LIVE, PET_VARIANT_PRICE_GG, PET_VARIANT_SPECIES, catalogEntry, isUsable, petVariantId } from '../../../src/economy/catalog';
import { isServerOnlyEntitlement } from '../../../src/economy/entitlements';
import { STORE_SKUS, skuById } from '../../../src/economy/skus';
import { skusForTab, tabForSku } from '../../../src/ui/store/model';
import { createDevWallet } from '../../../src/economy/devWallet';
import { readPetViews } from '../../../src/render/pets';
import { jsonClone, newWorld, opts, simOf } from '../quests/helpers';
import { memory, service } from '../economy/helpers';
import { startedHarness } from '../game/controllerHarness';

const world = (seed = 71): EngineSimulation => {
  const sys = allSystems();
  return simOf(newWorld(opts(seed, 2), sys), sys);
};
const pets = (sim: EngineSimulation): PetsState => sim.state.pets!;
function adopt(sim: EngineSimulation): string {
  const stray = pets(sim).strays[0];
  const agentId = sim.state.household.memberIds[0];
  sim.state.agents[agentId].pos = { ...stray.pos };
  stray.trust = 90;
  expect(sim.dispatch({ type: 'pet', action: 'adopt', agentId, strayId: stray.id } as Command).ok).toBe(true);
  return stray.id.replace(/^s/, 'p');
}

describe('the catalogue and the store', () => {
  it('one premium entry per pet species, 400 GG, never free; each has a pet-variant SKU in the Bodies tab', () => {
    for (const sp of PET_VARIANT_SPECIES) {
      const e = catalogEntry(petVariantId(sp));
      expect(e).toMatchObject({ tier: 'premium', priceGG: PET_VARIANT_PRICE_GG });
      const sku = skuById(petVariantId(sp))!;
      expect(sku.kind).toBe('petVariant');
      expect(sku.priceGG).toBe(PET_VARIANT_PRICE_GG);
      expect(tabForSku(sku.id)).toBe('bodies');
      expect(skusForTab('bodies').map((s) => s.id)).toContain(sku.id);
    }
    expect(CATALOG.filter((c) => c.contentId.startsWith('petvariant:')).length).toBe(PET_VARIANT_SPECIES.length);
    expect(STORE_SKUS.filter((s) => s.kind === 'petVariant').length).toBe(PET_VARIANT_SPECIES.length);
  });

  it('locked by default (unlike the cast bodies they are NOT free meanwhile), server-only, usable only when entitled', () => {
    for (const sp of PET_VARIANT_SPECIES) {
      expect(isUsable(petVariantId(sp), new Set())).toBe(false);
      expect(isUsable(petVariantId(sp), new Set([petVariantId(sp)]))).toBe(true);
      expect(isServerOnlyEntitlement(petVariantId(sp))).toBe(true); // the local Bones ledger can never mint it
    }
    expect(isUsable(petVariantId('cat'), new Set([petVariantId('dog')]))).toBe(false); // per species
  });

  it('coming soon: the store marks it, and neither Bones nor Grave Gold can buy it while PET_VARIANTS_LIVE is false', async () => {
    expect(PET_VARIANTS_LIVE).toBe(false);
    const s = service(memory(), { wallet: createDevWallet(5000) });
    await s.init();
    s.answerAgeGate(1980);
    const id = petVariantId('cat');
    expect(s.skuState(id)?.block).toBe('comingSoon');
    const r = await s.purchaseGG(id);
    expect(r.ok).toBe(false);
    expect(s.wallet.gg).toBe(5000); // nothing charged
    expect(s.isUsable(id)).toBe(false);
    const u = await s.unlock(id);
    expect(u.ok).toBe(false);
  });
});

describe('the look command on the real simulation', () => {
  it('a pet starts normal; look sets undead and back; unknown pets and looks are refused; no zombie needs to walk', () => {
    const sim = world();
    const petId = adopt(sim);
    const pet = pets(sim).pets.find((p) => p.id === petId)!;
    expect(pet.variant).toBe('normal');
    const pendingBefore = pets(sim).pending.length;
    expect(sim.dispatch({ type: 'pet', action: 'look', petId, variant: 'undead' } as Command).ok).toBe(true);
    expect(pet.variant).toBe('undead');
    expect(pets(sim).pending.length).toBe(pendingBefore);
    expect(sim.dispatch({ type: 'pet', action: 'look', petId, variant: 'normal' } as Command).ok).toBe(true);
    expect(pet.variant).toBe('normal');
    expect(sim.dispatch({ type: 'pet', action: 'look', petId: 'p999', variant: 'undead' } as Command).ok).toBe(false);
    expect(sim.dispatch({ type: 'pet', action: 'look', petId, variant: 'zombie' } as unknown as Command).ok).toBe(false);
    expect(pet.variant).toBe('normal');
  });

  it('the look is saved, survives validation, and a broken value falls back to normal', () => {
    const sim = world(72);
    const petId = adopt(sim);
    sim.dispatch({ type: 'pet', action: 'look', petId, variant: 'undead' } as Command);
    const w = jsonClone(sim.serialize()) as WorldState;
    const v = validateWorld(jsonClone(w));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.world.pets!.pets[0].variant).toBe('undead');
    const bad = jsonClone(w) as WorldState;
    (bad.pets!.pets[0] as { variant: unknown }).variant = 'zombie';
    const v2 = validateWorld(bad);
    expect(v2.ok).toBe(true);
    if (v2.ok) expect(v2.world.pets!.pets[0].variant).toBe('normal');
  });

  it('the renderer reads the pet look from the world', () => {
    const sim = world(73);
    const petId = adopt(sim);
    sim.dispatch({ type: 'pet', action: 'look', petId, variant: 'undead' } as Command);
    const views = readPetViews(jsonClone(sim.serialize()));
    expect(views.find((x) => x.id === petId)!.variant).toBe('undead');
    expect(views.filter((x) => x.kind === 'stray').every((x) => x.variant === 'normal')).toBe(true);
  });
});

describe('the game layer checks the entitlement (the sim does not)', () => {
  const real = { createNewWorld: simModule.createNewWorld, createSimulation: simModule.createSimulation, loadContent: simModule.loadContent, LOT_TEMPLATES: simModule.LOT_TEMPLATES };
  type G = { pet(c: Command extends infer C ? Record<string, unknown> & C : never): { ok: boolean; reason?: string }; sim: { state: { pets?: PetsState } } };

  async function started(entitled: string[]) {
    // an economy double that knows only entitlements (the real ledger refuses to mint server-only ones)
    const econ = new Proxy({ age: { bracket: 'adult' }, isUsable: (id: string) => entitled.includes(id) } as Record<string, unknown>, { get: (t, k) => (k in t ? t[k as string] : () => undefined) });
    const h = await startedHarness({ realSim: real, economy: econ });
    const g = h.game as unknown as G;
    const sim = g.sim as unknown as EngineSimulation;
    const stray = sim.state.pets!.strays[0];
    const agentId = sim.state.household.memberIds[0];
    sim.state.agents[agentId].pos = { ...stray.pos };
    stray.trust = 90;
    expect(g.pet({ action: 'adopt', agentId, strayId: stray.id } as never).ok).toBe(true);
    const pet = sim.state.pets!.pets[0];
    return { g, pet };
  }

  it('without the entitlement the undead look is refused with the coming-soon reason and the pet stays normal', async () => {
    const { g, pet } = await started([]);
    const r = g.pet({ action: 'look', petId: pet.id, variant: 'undead' } as never);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/later update/i);
    expect(pet.variant).toBe('normal');
    expect(g.pet({ action: 'look', petId: pet.id, variant: 'normal' } as never).ok).toBe(true); // normal is always allowed
  });

  it('with the entitlement for THAT species it is accepted; for another species it is not', async () => {
    const probe = await started([]);
    const species = probe.pet.species;
    const other = PET_VARIANT_SPECIES.find((s) => s !== species)!;
    const { g, pet } = await started([petVariantId(species)]);
    if (pet.species === species) {
      expect(g.pet({ action: 'look', petId: pet.id, variant: 'undead' } as never).ok).toBe(true);
      expect(pet.variant).toBe('undead');
    }
    const w = await started([petVariantId(other)]);
    if (w.pet.species !== other) expect(w.g.pet({ action: 'look', petId: w.pet.id, variant: 'undead' } as never).ok).toBe(false);
  });
});
