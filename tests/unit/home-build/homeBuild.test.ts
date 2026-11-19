/**
 * Home build rules (src/shared/homeBuild.ts; docs/contract-requests/home-build-system.md section 4 step 1): snap points
 * until 20 items then Free Placement, service points and caps per tier, furniture sets 2/4/6 (life bonuses only), the
 * Hearth on Rot Essence switched off by unpaid utilities, permissions.
 */
import { describe, expect, it } from 'vitest';
import { PHYSICAL_BY_ID, PHYSICAL_SPECS } from '../../../src/shared/catalog';
import {
  FIGHT_STAT_WORDS, FREE_PLACEMENT_AT, FURNITURE_SETS, HEARTH_UPGRADES, HOME_TIERS, HOME_TIER_IDS, LIFE_BONUS_KEYS, PERMISSION_LEVELS, SERVICE_FURNITURE, SERVICE_KINDS, SET_THRESHOLDS,
  activeHearthUpgrades, buyHearthUpgrade, canPlace, decorCount, defaultPermission, hearthBuildOptions, hearthWards, homeLifeBonus, newHearthState, newHomeBuildState, permits, placementMode,
  registerPlacement, servicePointsLeft, setBonuses, setProgress, snapKindFor, type HomeBuildState, type PlacedItem,
} from '../../../src/shared/homeBuild';

const info = (defId: string) => PHYSICAL_BY_ID[defId];
let uid = 0;
const item = (defId: string): PlacedItem => ({ id: `i${++uid}`, defId });

describe('snap points, then Free Placement at exactly 20 items', () => {
  it('snap mode for items 1 to 20, Free Placement from the 20th placement on, and it unlocks once', () => {
    let s = newHomeBuildState();
    const unlocks: number[] = [];
    for (let n = 1; n <= 25; n++) {
      expect(placementMode(s), `before item ${n}`).toBe(n <= FREE_PLACEMENT_AT ? 'snap' : 'free');
      const r = registerPlacement(s);
      if (r.unlockedNow) unlocks.push(n);
      s = r.state;
    }
    expect(FREE_PLACEMENT_AT).toBe(20);
    expect(unlocks).toEqual([20]);
    expect(placementMode({ ...newHomeBuildState(), placedEver: 19 })).toBe('snap');
    expect(placementMode({ ...newHomeBuildState(), placedEver: 20 })).toBe('free');
  });

  it('the milestone never relocks: it is a flag, not a count of what is standing', () => {
    const s: HomeBuildState = { tier: 'starter', placedEver: 20, freePlacement: true };
    expect(placementMode(s)).toBe('free');
    expect(placementMode({ ...s, placedEver: 0 })).toBe('free');
  });

  it('in snap mode an item needs a snap point of its kind; in Free Placement it does not', () => {
    const snap = newHomeBuildState();
    const sofa = info('sofa_velvet');
    expect(canPlace(snap, [], sofa, info, null)).toMatchObject({ ok: false, reason: 'noSnapPoint' });
    expect(canPlace(snap, [], sofa, info, 'wall')).toMatchObject({ ok: false, reason: 'wrongSnapKind' });
    expect(canPlace(snap, [], sofa, info, 'floor')).toMatchObject({ ok: true });
    expect(canPlace(snap, [], info('painting_greatgrand'), info, 'wall')).toMatchObject({ ok: true });
    expect(canPlace(snap, [], info('headstone_decor'), info, 'garden')).toMatchObject({ ok: true });
    const free = { ...snap, placedEver: FREE_PLACEMENT_AT, freePlacement: true };
    expect(canPlace(free, [], sofa, info, null)).toMatchObject({ ok: true });
    expect(canPlace(free, [], sofa, info, 'wall')).toMatchObject({ ok: true });
  });

  it('every catalogue object has a snap kind: walls, doors and windows on wall points, yard objects in the garden, the rest on the floor', () => {
    for (const s of PHYSICAL_SPECS.filter((x) => x.buyable)) {
      const k = snapKindFor(s);
      if (s.placement === 'wall' || s.placement === 'door' || s.placement === 'window') expect(k, s.id).toBe('wall');
      else if (s.outdoorOnly || s.category === 'outdoor') expect(k, s.id).toBe('garden');
      else expect(k, s.id).toBe('floor');
    }
  });
});

describe('service points and caps per tier', () => {
  const free = (tier: HomeBuildState['tier']): HomeBuildState => ({ tier, placedEver: 99, freePlacement: true });

  it('each tier is bigger than the one before (decoration budget and service points)', () => {
    for (let i = 1; i < HOME_TIER_IDS.length; i++) {
      expect(HOME_TIERS[HOME_TIER_IDS[i]].decorBudget).toBeGreaterThan(HOME_TIERS[HOME_TIER_IDS[i - 1]].decorBudget);
      expect(HOME_TIERS[HOME_TIER_IDS[i]].servicePoints).toBeGreaterThan(HOME_TIERS[HOME_TIER_IDS[i - 1]].servicePoints);
    }
  });

  it('the decoration cap is refused at the budget; doors and windows are structure and never count', () => {
    for (const tier of HOME_TIER_IDS) {
      const s = free(tier);
      const budget = HOME_TIERS[tier].decorBudget;
      const items = Array.from({ length: budget }, () => item('chair_creaky'));
      expect(decorCount(items, info)).toBe(budget);
      expect(canPlace(s, items.slice(1), info('chair_creaky'), info)).toMatchObject({ ok: true });
      expect(canPlace(s, items, info('chair_creaky'), info)).toMatchObject({ ok: false, reason: 'limit:decor' });
      expect(canPlace(s, items, info('door_splintered'), info)).toMatchObject({ ok: true });
      expect(canPlace(s, items, info('window_grimy'), info)).toMatchObject({ ok: true });
    }
  });

  it('service furniture takes a service point, not decoration budget; the cap is per tier and refused', () => {
    const embalm = info('station_embalming');
    for (const tier of HOME_TIER_IDS) {
      const s = free(tier);
      const points = HOME_TIERS[tier].servicePoints;
      const placed = Array.from({ length: points }, () => item('station_embalming'));
      expect(servicePointsLeft(s, placed)).toBe(0);
      expect(canPlace(s, placed, embalm, info)).toMatchObject({ ok: false, reason: 'limit:service' });
      expect(canPlace(s, placed.slice(1), embalm, info, 'floor')).toMatchObject({ ok: true, service: 'embalming' });
      // amenities stay on service points for good: no snap point, no placement, even in Free Placement
      expect(canPlace(s, placed.slice(1), embalm, info, null)).toMatchObject({ ok: false, reason: 'noSnapPoint' });
      expect(decorCount(placed, info)).toBe(0);
      const full = Array.from({ length: HOME_TIERS[tier].decorBudget }, () => item('chair_creaky'));
      expect(canPlace(s, full, embalm, info, 'floor')).toMatchObject({ ok: true });
    }
  });

  it('every service kind has furniture reserved for it; the ones that exist today are in the catalogue', () => {
    expect(new Set(Object.values(SERVICE_FURNITURE).map((f) => f.service))).toEqual(new Set(SERVICE_KINDS));
    for (const [id, f] of Object.entries(SERVICE_FURNITURE)) if (!f.planned) expect(PHYSICAL_BY_ID[id], id).toBeDefined();
  });
});

describe('furniture sets: 2 / 4 / 6 pieces, life bonuses only', () => {
  it('every set piece is a real buyable object, in exactly one set, six pieces per set', () => {
    const seen = new Set<string>();
    for (const set of FURNITURE_SETS) {
      expect(set.pieces.length, set.id).toBe(6);
      for (const p of set.pieces) {
        expect(PHYSICAL_BY_ID[p]?.buyable, `${set.id}:${p}`).toBe(true);
        expect(seen.has(p), `${p} in two sets`).toBe(false);
        seen.add(p);
      }
      expect(Object.keys(set.bonuses).map(Number)).toEqual([...SET_THRESHOLDS]);
    }
  });

  it('a set bonus appears at 2, 4 and 6 distinct pieces and disappears when a piece is removed', () => {
    const mausoleum = FURNITURE_SETS.find((s) => s.id === 'mausoleum')!;
    const placed: PlacedItem[] = [];
    const tierAt = () => setProgress(placed).find((p) => p.set.id === 'mausoleum')?.tier ?? 0;
    expect(setBonuses(placed)).toEqual({});
    placed.push(item(mausoleum.pieces[0]));
    expect(tierAt()).toBe(0);
    expect(setBonuses(placed)).toEqual({});
    placed.push(item(mausoleum.pieces[1]));
    expect(tierAt()).toBe(2);
    expect(setBonuses(placed)).toEqual({ restRestorePct: 10 });
    placed.push(item(mausoleum.pieces[2]));
    expect(tierAt()).toBe(2);
    placed.push(item(mausoleum.pieces[3]));
    expect(tierAt()).toBe(4);
    expect(setBonuses(placed)).toEqual({ restRestorePct: 10, freshnessPerHourAsleep: 1 });
    placed.push(item(mausoleum.pieces[4]));
    placed.push(item(mausoleum.pieces[5]));
    expect(tierAt()).toBe(6);
    expect(setBonuses(placed)).toMatchObject({ restRestorePct: 10, freshnessPerHourAsleep: 1, startOfDayFeeling: 'wellInterred' });
    placed.splice(5, 1);
    expect(tierAt()).toBe(4);
    expect(setBonuses(placed).startOfDayFeeling).toBeUndefined();
    placed.splice(3, 2);
    expect(tierAt()).toBe(2);
    expect(setBonuses(placed)).toEqual({ restRestorePct: 10 });
    placed.splice(1, 2);
    expect(placed).toHaveLength(1);
    expect(setBonuses(placed)).toEqual({});
  });

  it('a duplicate of one piece counts once; two different sets give their own bonuses and add', () => {
    expect(setProgress([item('coffin_pine'), item('coffin_pine'), item('coffin_pine')])[0]).toMatchObject({ pieces: 1, tier: 0 });
    const both = [item('coffin_pine'), item('lamp_skull'), item('headstone_decor'), item('tree_gnarled')];
    expect(setBonuses(both)).toEqual({ restRestorePct: 10, gardenGrowthPct: 10 });
  });

  it('no set bonus, hearth upgrade or tier carries a fight stat: LIFE keys only, no fight word anywhere', () => {
    const keys = new Set<string>(LIFE_BONUS_KEYS);
    // whole words only (camelCase and spaces split): "growthPct" is not "hp"
    const words = (s: string) => {
      const toks = s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/).filter(Boolean);
      return FIGHT_STAT_WORDS.filter((w) => toks.includes(w));
    };
    for (const set of FURNITURE_SETS) {
      expect(words(set.id + set.name), set.id).toEqual([]);
      for (const b of Object.values(set.bonuses)) for (const k of Object.keys(b)) expect(keys.has(k), `${set.id}.${k}`).toBe(true);
    }
    for (const u of HEARTH_UPGRADES) {
      expect(words(u.id + u.name), u.id).toEqual([]);
      if (u.effect.kind === 'ward') for (const k of Object.keys(u.effect.bonus)) expect(keys.has(k), `${u.id}.${k}`).toBe(true);
      else expect(['loadoutSlot', 'perkSlot']).toContain(u.effect.option);
    }
    for (const k of LIFE_BONUS_KEYS) expect(words(k), k).toEqual([]);
  });
});

describe('the Hearth: Rot Essence upgrades, off while the utilities are unpaid', () => {
  it('an upgrade costs its Rot Essence, needs its prerequisite, cannot be bought twice or without enough essence', () => {
    let h = newHearthState(100);
    expect(buyHearthUpgrade(h, 'nope', true)).toMatchObject({ ok: false, reason: 'unknown' });
    expect(buyHearthUpgrade(h, 'perkSlot', true)).toMatchObject({ ok: false, reason: 'needs' });
    const r = buyHearthUpgrade(h, 'loadoutSlot2', true);
    expect(r).toMatchObject({ ok: true, spent: 40 });
    if (!r.ok) return;
    h = r.state;
    expect(h.essence).toBe(60);
    expect(buyHearthUpgrade(h, 'loadoutSlot2', true)).toMatchObject({ ok: false, reason: 'owned' });
    expect(buyHearthUpgrade(newHearthState(10), 'wardRest', true)).toMatchObject({ ok: false, reason: 'essence' });
    expect(buyHearthUpgrade(h, 'perkSlot', true)).toMatchObject({ ok: true });
  });

  it('unpaid utilities switch every upgrade off and paying restores them; what was bought is kept', () => {
    let h = newHearthState(500);
    for (const id of ['loadoutSlot2', 'wardRest', 'wardGarden']) {
      const r = buyHearthUpgrade(h, id, true);
      expect(r.ok, id).toBe(true);
      if (r.ok) h = r.state;
    }
    expect(activeHearthUpgrades(h, true).map((u) => u.id)).toEqual(['loadoutSlot2', 'wardRest', 'wardGarden']);
    expect(hearthWards(h, true)).toEqual({ restRestorePct: 5, gardenGrowthPct: 10 });
    expect(hearthBuildOptions(h, true)).toEqual(['loadoutSlot']);
    expect(activeHearthUpgrades(h, false)).toEqual([]);
    expect(hearthWards(h, false)).toEqual({});
    expect(hearthBuildOptions(h, false)).toEqual([]);
    expect(h.owned).toEqual(['loadoutSlot2', 'wardRest', 'wardGarden']);
    expect(activeHearthUpgrades(h, true)).toHaveLength(3);
    expect(hearthWards(h, true)).toEqual({ restRestorePct: 5, gardenGrowthPct: 10 });
  });

  it('a cold Hearth sells nothing: buying needs the utilities on', () => {
    expect(buyHearthUpgrade(newHearthState(500), 'wardRest', false)).toMatchObject({ ok: false, reason: 'unpowered' });
  });

  it('the home gives the household its set bonuses plus the Hearth wards, and the wards go with the power', () => {
    let h = newHearthState(500);
    const r = buyHearthUpgrade(h, 'wardRest', true);
    if (r.ok) h = r.state;
    const items = [item('coffin_pine'), item('lamp_skull')];
    expect(homeLifeBonus(items, h, true)).toEqual({ restRestorePct: 15 });
    expect(homeLifeBonus(items, h, false)).toEqual({ restRestorePct: 10 });
  });
});

describe('permissions', () => {
  it('four levels, each includes the ones before; stored goods and Hearth spending are household-only', () => {
    expect([...PERMISSION_LEVELS]).toEqual(['visit', 'use', 'decorate', 'defend']);
    expect(permits('visit', 'enter')).toBe(true);
    expect(permits('visit', 'useService')).toBe(false);
    expect(permits('use', 'useService')).toBe(true);
    expect(permits('use', 'placeItem')).toBe(false);
    expect(permits('decorate', 'placeItem')).toBe(true);
    expect(permits('decorate', 'standGuard')).toBe(false);
    expect(permits('defend', 'standGuard')).toBe(true);
    for (const l of PERMISSION_LEVELS) {
      expect(permits(l, 'takeItem')).toBe(false);
      expect(permits(l, 'spendHearth')).toBe(false);
    }
  });

  it('defaults are child-safe: a child profile only ever visits', () => {
    expect(defaultPermission('stranger')).toBe('visit');
    expect(defaultPermission('friend')).toBe('use');
    expect(defaultPermission('crew')).toBe('decorate');
    for (const g of ['stranger', 'friend', 'crew'] as const) expect(defaultPermission(g, true)).toBe('visit');
  });
});
