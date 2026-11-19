import { describe, expect, it } from 'vitest';
import type { ObjectDef, InteractionDef, MenuEntry, RelationshipView, TownieView } from '../../../src/sim/contracts';
import type { Toast } from '../../../src/game/contracts';
import { PHYSICAL_SPECS } from '../../../src/shared/catalog';
import {
  buildCatalog,
  categoryCounts,
  envLabel,
  footprintLabel,
  goodFor,
  itemsInCategory,
  normalizeSearch,
  openingSpecs,
  resolveLabel,
  searchCatalog,
} from '../../../src/ui/hud/lib/catalog';
import { filterRelationships, relationTone, sortRelationships, sortTownies } from '../../../src/ui/hud/lib/relationships';
import { advanceToastClocks, toastRemaining, visibleToasts, TOAST_LIFETIME_MS } from '../../../src/ui/hud/lib/toasts';
import { clampGuestList, toggleGuest, validateHouseholdName, HOUSEHOLD_NAME_MAX } from '../../../src/ui/hud/lib/validation';
import { phoneOptions, type PhoneContext } from '../../../src/ui/hud/lib/phone';
import { ht, hasKey, HUD_EN } from '../../../src/ui/hud/strings';

function objectDef(id: string, extra: Partial<ObjectDef> = {}): ObjectDef {
  const spec = PHYSICAL_SPECS.find((s) => s.id === id)!;
  return { ...spec, interactions: [], env: 0, depreciation: 0.15, breakChance: 0, sellable: true, params: {}, ...extra };
}

describe('catalog', () => {
  it('falls back to the physical catalog and excludes non-buyable items', () => {
    const items = buildCatalog(null);
    expect(items.length).toBeGreaterThan(40);
    expect(items.some((i) => i.defId === 'item_meal')).toBe(false);
    expect(items.every((i) => i.price >= 0)).toBe(true);
    // category order then price
    const seating = itemsInCategory(items, 'seating');
    for (let i = 1; i < seating.length; i++) expect(seating[i].price).toBeGreaterThanOrEqual(seating[i - 1].price);
  });
  it('prefers live content (env scores) when present', () => {
    const items = buildCatalog({ chair_creaky: objectDef('chair_creaky', { env: 2 }), tv_crt: objectDef('tv_crt', { env: -1 }) });
    expect(items.map((i) => i.defId)).toEqual(['chair_creaky', 'tv_crt']);
    expect(items[0].env).toBe(2);
  });
  it('tolerates corrupt content entries', () => {
    const bad = { x: null, y: { id: 5 } } as unknown as Record<string, ObjectDef>;
    expect(() => buildCatalog(bad)).not.toThrow();
  });
  it('searches with diacritic folding and token AND semantics', () => {
    const items = buildCatalog(null);
    expect(normalizeSearch('  Séance   TV! ')).toBe('seance tv');
    expect(searchCatalog(items, 'seance').map((i) => i.defId)).toContain('tv_seance');
    expect(searchCatalog(items, 'coffin banana').length).toBe(0);
    expect(searchCatalog(items, 'coffin cryo').map((i) => i.defId)).toEqual(['sarcophagus_cryo']);
    expect(searchCatalog(items, 'coffin').length).toBeGreaterThanOrEqual(2);
    expect(searchCatalog(items, '').length).toBe(items.filter((i) => i.category !== 'doors' && i.category !== 'windows').length);
    expect(searchCatalog(items, 'door').some((i) => i.category === 'doors')).toBe(false);
    expect(searchCatalog(items, 'door', { includeBuild: true }).some((i) => i.category === 'doors')).toBe(true);
    expect(searchCatalog(items, 12345 as never).length).toBeGreaterThan(0);
  });
  it('counts per category', () => {
    const c = categoryCounts(buildCatalog(null));
    expect(c.seating).toBeGreaterThan(0);
  });
  it('derives "good for" from interactions, skipping hidden ones', () => {
    const interactions: Record<string, InteractionDef> = {
      home_watch: { id: 'home_watch', label: 'Watch {target}', icon: 'tv', targetKind: 'object', advertise: { fun: 30, social: 2 } },
      home_learn: {
        id: 'home_learn',
        label: 'Watch Cooking Channel',
        icon: 'tv',
        targetKind: 'object',
        stage: { target: { kind: 'target' }, duration: 60, anim: 'sitTV', skillXpPerHour: { cooking: 6 }, needsPerHour: { fun: 10 } },
      },
      home_secret: { id: 'home_secret', label: 'Secret', icon: 'tv', targetKind: 'object', hidden: true, advertise: { energy: 99 } },
    };
    const objects = { tv_crt: objectDef('tv_crt', { interactions: ['home_watch', 'home_learn', 'home_secret', 'missing_id'] }) };
    const g = goodFor('tv_crt', { objects, interactions });
    expect(g.actions).toEqual(['Watch Flickering CRT', 'Watch Cooking Channel']);
    expect(g.needs[0]).toEqual({ need: 'fun', amount: 30 });
    expect(g.needs.some((n) => n.need === 'energy')).toBe(false);
    expect(g.skills).toEqual(['cooking']);
    expect(goodFor('nope', { objects, interactions })).toEqual({ actions: [], needs: [], skills: [] });
    expect(goodFor('tv_crt', null)).toEqual({ actions: [], needs: [], skills: [] });
  });
  it('survives a throwing stagesOf', () => {
    const interactions: Record<string, InteractionDef> = {
      a: { id: 'a', label: 'Do it', icon: 'star', targetKind: 'object' },
    };
    const objects = { tv_crt: objectDef('tv_crt', { interactions: ['a'] }) };
    const g = goodFor('tv_crt', {
      objects,
      interactions,
      stagesOf: () => {
        throw new Error('boom');
      },
    });
    expect(g.actions).toEqual(['Do it']);
  });
  it('resolves labels', () => {
    expect(resolveLabel('Sit on {target}', 'Sofa')).toBe('Sit on Sofa');
    expect(resolveLabel('Cook {param:recipe} …', 'Stove')).toBe('Cook…');
    expect(resolveLabel(null, 'x')).toBe('');
  });
  it('lists door and window specs', () => {
    expect(openingSpecs('door').map((s) => s.id)).toEqual(['door_splintered', 'door_crypt']);
    expect(openingSpecs('window').every((s) => s.placement === 'window')).toBe(true);
  });
  it('labels env and footprint', () => {
    expect(envLabel(3)).toBe('+3');
    expect(envLabel(-2)).toBe('−2');
    expect(envLabel(NaN)).toBe('0');
    expect(footprintLabel({ w: 2, d: 1 })).toBe('2×1');
    expect(footprintLabel(null)).toBe('1×1');
  });
});

const rel = (name: string, friendship: number, romance = 0, extra: Partial<RelationshipView> = {}): RelationshipView => ({
  otherId: name.toLowerCase(),
  name,
  friendship,
  romance,
  label: 'Acquaintance',
  inHousehold: false,
  onLot: false,
  ...extra,
});

describe('relationships', () => {
  const list = [
    rel('Ophelia', 80, 0, { inHousehold: true, label: 'Best Friend' }),
    rel('Bram', -60, 0, { label: 'Disliked' }),
    rel('Cassia', 40, 65, { label: 'Partner', onLot: true }),
    rel('Dante', 40, 0, { onLot: true }),
    rel('Edgar', 5),
  ];
  it('sorts totally and stably', () => {
    expect(sortRelationships(list, 'friendship').map((r) => r.name)).toEqual(['Ophelia', 'Cassia', 'Dante', 'Edgar', 'Bram']);
    expect(sortRelationships(list, 'romance').map((r) => r.name)[0]).toBe('Cassia');
    expect(sortRelationships(list, 'name').map((r) => r.name)).toEqual(['Bram', 'Cassia', 'Dante', 'Edgar', 'Ophelia']);
    expect(sortRelationships([null as never, ...list], 'name').length).toBe(5);
  });
  it('filters', () => {
    expect(filterRelationships(list, 'household').map((r) => r.name)).toEqual(['Ophelia']);
    expect(filterRelationships(list, 'friends').map((r) => r.name)).toEqual(['Ophelia', 'Cassia', 'Dante']);
    expect(filterRelationships(list, 'romance').map((r) => r.name)).toEqual(['Cassia']);
    expect(filterRelationships(list, 'onLot').map((r) => r.name)).toEqual(['Cassia', 'Dante']);
    expect(filterRelationships(list, 'rivals').map((r) => r.name)).toEqual(['Bram']);
    expect(filterRelationships(list, 'all', 'partner').map((r) => r.name)).toEqual(['Cassia']);
    expect(filterRelationships(list, 'bogus' as never).length).toBe(5);
  });
  it('tones', () => {
    expect(relationTone(list[2])).toBe('romance');
    expect(relationTone(list[1])).toBe('bad');
    expect(relationTone(list[0])).toBe('good');
    expect(relationTone(list[4])).toBe('neutral');
  });
  it('orders townies available → met → friendship', () => {
    const t = (name: string, available: boolean, met: boolean, friendship: number): TownieView => ({
      id: name,
      name,
      occupation: null,
      friendship,
      romance: 0,
      met,
      label: met ? 'Acquaintance' : 'Stranger',
      available,
    });
    const out = sortTownies([t('A', false, true, 90), t('B', true, false, 0), t('C', true, true, 10), t('D', true, true, 50)]);
    expect(out.map((x) => x.name)).toEqual(['D', 'C', 'B', 'A']);
    expect(sortTownies([t('Zed', true, true, 1)], 'ze').length).toBe(1);
    expect(sortTownies([t('Zed', true, true, 1)], 'qq').length).toBe(0);
  });
});

const toast = (id: number, createdAt: number): Toast => ({ id, kind: 'info', title: 't', text: '', agentId: null, objectId: null, createdAt });

describe('toast clocks', () => {
  it('caps visible toasts, newest first', () => {
    const list = [1, 2, 3, 4, 5, 6, 7].map((i) => toast(i, i * 10));
    const { visible, overflow } = visibleToasts(list, 5);
    expect(visible.map((t) => t.id)).toEqual([7, 6, 5, 4, 3]);
    expect(overflow).toEqual([2, 1]);
    expect(visibleToasts([], 5).visible).toEqual([]);
    expect(visibleToasts(list, -1).visible).toEqual([]);
  });
  it('ages unpaused toasts and expires them after the lifetime', () => {
    const list = [toast(1, 0), toast(2, 0)];
    let s = advanceToastClocks({}, list, 1000, new Set());
    expect(s.expired).toEqual([]);
    s = advanceToastClocks(s.clocks, list, 1000 + TOAST_LIFETIME_MS - 1, new Set([2]));
    expect(s.expired).toEqual([]);
    s = advanceToastClocks(s.clocks, list, 1000 + TOAST_LIFETIME_MS + 5, new Set([2]));
    expect(s.expired).toEqual([1]);
    expect(toastRemaining(s.clocks[2])).toBeGreaterThan(0.99);
  });
  it('freezes everything while globally paused and drops clocks for removed toasts', () => {
    let s = advanceToastClocks({}, [toast(1, 0)], 0, new Set());
    s = advanceToastClocks(s.clocks, [toast(1, 0)], 100000, new Set(), TOAST_LIFETIME_MS, true);
    expect(s.expired).toEqual([]);
    s = advanceToastClocks(s.clocks, [], 200000, new Set());
    expect(Object.keys(s.clocks)).toEqual([]);
  });
  it('tolerates clock going backwards and junk lifetimes', () => {
    let s = advanceToastClocks({}, [toast(1, 0)], 5000, new Set());
    s = advanceToastClocks(s.clocks, [toast(1, 0)], 1000, new Set(), NaN);
    expect(s.expired).toEqual([]);
    expect(toastRemaining(undefined)).toBe(1);
  });
});

describe('validation', () => {
  it('validates household names', () => {
    expect(validateHouseholdName('  The   Grimsbys ')).toEqual({ ok: true, value: 'The Grimsbys' });
    expect(validateHouseholdName('')).toEqual({ ok: false, error: 'empty' });
    expect(validateHouseholdName('   \t\n ')).toEqual({ ok: false, error: 'empty' });
    expect(validateHouseholdName('!!!')).toEqual({ ok: false, error: 'noLetters' });
    expect(validateHouseholdName('x'.repeat(HOUSEHOLD_NAME_MAX + 1))).toEqual({ ok: false, error: 'tooLong' });
    expect(validateHouseholdName('x'.repeat(HOUSEHOLD_NAME_MAX))).toMatchObject({ ok: true });
    expect(validateHouseholdName(42)).toEqual({ ok: false, error: 'empty' });
  });
  it('strips invisible and bidi-override characters', () => {
    const sneaky = 'Gr' + String.fromCharCode(0x200b) + 'ave' + String.fromCharCode(0x202e) + 's' + String.fromCharCode(0x0007);
    expect(validateHouseholdName(sneaky)).toEqual({ ok: true, value: 'Graves' });
    expect(validateHouseholdName(String.fromCharCode(0xfeff, 0x200d))).toEqual({ ok: false, error: 'empty' });
  });
  it('counts code points, not UTF-16 units', () => {
    const skull = '\u{1F480}';
    expect(validateHouseholdName('A' + skull.repeat(HOUSEHOLD_NAME_MAX - 1))).toMatchObject({ ok: true });
  });
  it('clamps and toggles guest lists', () => {
    expect(clampGuestList(['a', 'b', 'a', '', 3, null, 'c'], 2)).toEqual(['a', 'b']);
    expect(toggleGuest(['a'], 'a')).toEqual([]);
    expect(toggleGuest(['a', 'b'], 'c', 2)).toEqual(['a', 'b']);
    expect(toggleGuest(['a'], 'b', 2)).toEqual(['a', 'b']);
    expect(toggleGuest(['a'], '' as string)).toEqual(['a']);
  });
});

const ctx = (patch: Partial<PhoneContext> = {}): PhoneContext => ({
  hasCareer: true,
  funds: 100,
  partyActive: false,
  canHost: true,
  townieCount: 5,
  sickDaysUsed: 0,
  atHome: true,
  ...patch,
});
const entry = (interactionId: string, label: string, available = true, reason: string | null = null, cost: number | null = null): MenuEntry => ({
  interactionId,
  label,
  group: 'Phone',
  icon: 'phone',
  available,
  reason,
  cost,
  params: {},
});

describe('phone options', () => {
  it('derives availability locally when the sim offers nothing', () => {
    const o = phoneOptions([], ctx({ hasCareer: false, funds: 10 }));
    expect(o.pizza).toMatchObject({ available: false, reasonKey: 'phone.reason.cantAfford', cost: 35 });
    expect(o.quitJob).toMatchObject({ available: false, reasonKey: 'phone.reason.noJob' });
    expect(o.findJob.available).toBe(true);
    expect(phoneOptions(null, ctx({ sickDaysUsed: 3 })).callInSick.reasonKey).toBe('phone.reason.noSickDays');
    expect(phoneOptions(null, ctx({ partyActive: true })).party.reasonKey).toBe('phone.reason.partyActive');
    expect(phoneOptions(null, ctx({ canHost: false })).party.reasonKey).toBe('phone.reason.noHost');
    expect(phoneOptions(null, ctx({ townieCount: 0 })).invite.reasonKey).toBe('phone.reason.noTownies');
    const away = phoneOptions(null, ctx({ atHome: false }));
    expect(Object.values(away).every((x) => !x.available)).toBe(true);
  });
  it('prefers sim menu entries (ids, reasons, costs)', () => {
    const entries = [
      entry('phone_orderPizza', 'Order Brain Pizza', false, 'Delivery ghoul is on strike', 40),
      entry('phone_throwParty', 'Throw a Party'),
      entry('phone_inviteOver', 'Invite Over…'),
      entry('phone_getJob', 'Get a Job'),
      entry('phone_quitJob', 'Quit Job'),
      entry('phone_callInSick', 'Call in Sick', false, null),
      entry('home_watch', 'Watch TV'),
    ];
    const o = phoneOptions(entries, ctx());
    expect(o.pizza).toMatchObject({ available: false, reason: 'Delivery ghoul is on strike', cost: 40, interactionId: 'phone_orderPizza' });
    expect(o.party.interactionId).toBe('phone_throwParty');
    expect(o.invite.interactionId).toBe('phone_inviteOver');
    expect(o.findJob.interactionId).toBe('phone_getJob');
    expect(o.quitJob.interactionId).toBe('phone_quitJob');
    expect(o.callInSick).toMatchObject({ available: false, reason: null, reasonKey: 'phone.reason.unavailable' });
  });
  it('ignores junk entries', () => {
    const o = phoneOptions([null as never, { interactionId: 5 } as never], ctx());
    expect(o.invite.available).toBe(true);
  });
});

describe('strings', () => {
  it('interpolates and falls back to the key', () => {
    expect(ht('top.day', { day: 3 })).toBe('Day 3');
    expect(ht('no.such.key')).toBe('hud.no.such.key');
    expect(hasKey('need.hunger')).toBe(true);
    expect(hasKey('toString')).toBe(false);
  });
  it('has no empty strings and every phone reason key exists', () => {
    for (const [k, v] of Object.entries(HUD_EN)) expect(v.length, k).toBeGreaterThan(0);
    for (const k of ['away', 'noTownies', 'partyActive', 'noHost', 'cantAfford', 'noJob', 'noSickDays', 'unavailable']) {
      expect(hasKey(`phone.reason.${k}`)).toBe(true);
    }
  });
});
