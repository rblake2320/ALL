/**
 * TEST FIXTURE content: a compact household catalogue exercising every StageTarget kind, costs, power,
 * pairs, socials, uninterruptible runs, counting/throwing behaviours. Ids are prefixed `fx_`.
 */
import type { ContentModule, InteractionDef, MoodletDef, ObjectDef, TraitDef } from '../../contracts';
import { PHYSICAL_BY_ID } from '../../../shared/catalog';

const OPEN = 1e9;

function obj(id: string, interactions: string[], extra: Partial<ObjectDef> = {}): ObjectDef {
  const spec = PHYSICAL_BY_ID[id];
  if (!spec) throw new Error(`fixture: no catalog spec '${id}'`);
  return { ...spec, interactions, env: 1, depreciation: 0.15, breakChance: 0, sellable: true, params: {}, ...extra };
}

export const FIXTURE_OBJECTS: ObjectDef[] = [
  obj('fridge_humming', ['fx_snack', 'fx_dinner']),
  obj('coffin_pine', ['fx_sleep']),
  obj('chair_creaky', ['fx_sit']),
  obj('table_rickety', []),
  obj('tv_crt', ['fx_watchTv'], { params: { tvFun: 1 } }),
  obj('stereo_boombox', ['fx_dance']),
  obj('shower_drizzle', ['fx_shower']),
  obj('mirror_cracked', ['fx_admire']),
  obj('headstone_decor', ['fx_ritual']),
  obj('desk_hauntedpc', ['fx_luxury']),
  obj('arcade_tombstone', ['fx_throwy']),
  obj('station_embalming', []),
  obj('door_splintered', [], { sellable: false }),
  obj('item_meal', ['fx_eatItem'], { sellable: false }),
  obj('item_dish', [], { sellable: false }),
];

export const FIXTURE_INTERACTIONS: InteractionDef[] = [
  {
    id: 'fx_snack',
    label: 'Grab a Snack',
    icon: 'fridge',
    targetKind: 'object',
    stage: { target: { kind: 'target', slots: ['front'] }, duration: 3, anim: 'standEat', effectsOnComplete: [{ id: 'needs', params: { deltas: { hunger: 30 } } }] },
    requires: [{ id: 'power' }],
    tags: ['food'],
    menuOrder: 1,
  },
  {
    id: 'fx_dinner',
    label: 'Have Dinner',
    icon: 'plate',
    targetKind: 'object',
    cost: 12,
    stages: [
      { target: { kind: 'target', slots: ['front'] }, duration: 2, anim: 'pickup', carry: 'ingredients' },
      {
        target: { kind: 'seat', preferTable: true, radius: 12, near: 'actor' },
        fallback: { kind: 'here' },
        duration: 20,
        anim: 'sitEat',
        carry: 'plate',
        needsPerHour: { hunger: 150 },
      },
    ],
    moodletsOnComplete: [{ id: 'fx_happy' }],
    tags: ['food'],
    menuOrder: 2,
  },
  {
    id: 'fx_sleep',
    label: 'Sleep',
    icon: 'coffin',
    targetKind: 'object',
    stage: { target: { kind: 'target', slots: ['lie'] }, duration: OPEN, anim: 'sleep', needsPerHour: { energy: 14 }, stopWhen: { need: 'energy', atLeast: 95 }, sfxLoop: 'snore' },
    tags: ['sleep'],
  },
  {
    id: 'fx_sit',
    label: 'Sit',
    icon: 'house',
    targetKind: 'object',
    stage: { target: { kind: 'target', slots: ['sit'] }, duration: 10, anim: 'sit', needsPerHour: { energy: 3 } },
  },
  {
    id: 'fx_watchTv',
    label: 'Watch TV',
    icon: 'tv',
    targetKind: 'object',
    stage: {
      target: { kind: 'seat', facingTarget: true, radius: 6, near: 'target' },
      fallback: { kind: 'target', slots: ['watch'] },
      duration: 60,
      anim: 'sitTV',
      needsPerHour: { fun: 25 },
      scaleByObjectParam: { fun: 'tvFun' },
      power: true,
    },
    joinable: true,
    visitorAllowed: true,
    tags: ['tv'],
  },
  {
    id: 'fx_dance',
    label: 'Dance',
    icon: 'dance',
    targetKind: 'object',
    stage: { target: { kind: 'tileNear', radius: 3, of: 'target' }, duration: 30, anim: 'dance', needsPerHour: { fun: 30, energy: -4 }, power: true },
    joinable: true,
    visitorAllowed: true,
    tags: ['dance'],
  },
  {
    id: 'fx_shower',
    label: 'Shower',
    icon: 'shower',
    targetKind: 'object',
    stage: { target: { kind: 'target' }, duration: OPEN, anim: 'shower', needsPerHour: { hygiene: 300 }, stopWhen: { need: 'hygiene', atLeast: 98 } },
  },
  {
    id: 'fx_admire',
    label: 'Admire Reflection',
    icon: 'mirror',
    targetKind: 'object',
    behavior: 'fx_counter',
    stage: { target: { kind: 'target' }, duration: 20, anim: 'admire', skillXpPerHour: { charisma: 30 } },
  },
  {
    id: 'fx_ritual',
    label: 'Graveside Ritual',
    icon: 'skull',
    targetKind: 'object',
    stage: { target: { kind: 'target' }, duration: 30, anim: 'mourn', needsPerHour: { fun: 5 } },
    interruptible: false,
    visitorAllowed: true,
  },
  {
    id: 'fx_luxury',
    label: 'Order Gold-Plated Embalming Fluid',
    icon: 'computer',
    targetKind: 'object',
    cost: 5000,
    stage: { target: { kind: 'target' }, duration: 10, anim: 'sitComputer', needsPerHour: { fun: 40 } },
  },
  {
    id: 'fx_throwy',
    label: 'Play Cursed Arcade',
    icon: 'game',
    targetKind: 'object',
    behavior: 'fx_throws',
    autonomous: false,
    stage: { target: { kind: 'target' }, duration: 30, anim: 'idle' },
  },
  {
    id: 'fx_eatItem',
    label: 'Have a Serving',
    icon: 'plate',
    targetKind: 'object',
    stages: [
      { target: { kind: 'target' }, duration: 1, anim: 'pickup', effectsOnComplete: [{ id: 'holdTarget' }] },
      {
        target: { kind: 'seat', preferTable: true, radius: 10, near: 'actor' },
        fallback: { kind: 'here' },
        duration: 15,
        anim: 'sitEat',
        needsPerHour: { hunger: 120 },
        effectsOnComplete: [{ id: 'releaseHeld', params: { to: 'destroy' } }],
      },
    ],
    tags: ['food'],
  },
  {
    id: 'fx_chat',
    label: 'Chat with {target}',
    group: 'Friendly',
    icon: 'chat',
    targetKind: 'agent',
    behavior: 'fx_social',
    social: { baseChance: 0.85, friendship: [4, -2], social: 8, targetAnim: 'listen', voice: 'neutral' },
    stage: { target: { kind: 'agentAdjacent' }, duration: 10, anim: 'talk' },
    visitorAllowed: true,
  },
  {
    id: 'fx_hug',
    label: 'Hug {target}',
    group: 'Friendly',
    icon: 'heart',
    targetKind: 'agent',
    behavior: 'fx_social',
    social: { baseChance: 0.8, friendship: [7, -5], social: 8, minFriendship: 30, targetAnim: 'hug', voice: 'happy' },
    stage: { target: { kind: 'agentAdjacent' }, duration: 6, anim: 'hug' },
  },
  {
    id: 'fx_propose',
    label: 'Propose to {target}',
    group: 'Romantic',
    icon: 'ring',
    targetKind: 'agent',
    behavior: 'fx_social',
    social: { baseChance: 0.7, friendship: [5, -15], social: 8, status: 'partners', targetAnim: 'cheer', voice: 'flirty' },
    stage: { target: { kind: 'agentAdjacent' }, duration: 12, anim: 'kiss' },
  },
  {
    id: 'fx_waveOver',
    label: 'Wave Over {target}',
    group: 'Friendly',
    icon: 'wave',
    targetKind: 'agent',
    behavior: 'fx_social',
    social: { baseChance: 0.9, friendship: [2, 0], social: 4, targetAnim: 'wave', voice: 'happy' },
    requires: [{ id: 'targetWalkBy' }],
    stage: { target: { kind: 'agentAdjacent' }, duration: 2, anim: 'wave' },
  },
  {
    id: 'fx_embalmOther',
    label: 'Embalm {target}',
    icon: 'embalm',
    targetKind: 'agent',
    pair: { partnerInteraction: 'fx_beEmbalmed', partnerTarget: 'sameObject' },
    stage: { target: { kind: 'nearestTag', tag: 'embalm', slots: ['work'] }, duration: 30, anim: 'embalm' },
    autonomous: false,
  },
  {
    id: 'fx_beEmbalmed',
    label: 'Being Embalmed',
    icon: 'embalm',
    targetKind: 'object',
    stage: { target: { kind: 'target', slots: ['lie'] }, duration: OPEN, anim: 'beEmbalmed', needsPerHour: { preservation: 40 } },
    hidden: true,
    playerAllowed: false,
    autonomous: false,
  },
  {
    id: 'fx_phone',
    label: 'Call the Psychic Hotline',
    group: 'Phone',
    icon: 'phone',
    targetKind: 'self',
    stage: { target: { kind: 'here' }, duration: 5, anim: 'phone', carry: 'phone', needsPerHour: { fun: 12 } },
    autonomous: false,
  },
];

export const FIXTURE_MOODLETS: MoodletDef[] = [
  { id: 'fx_happy', label: 'Good Meal', description: 'Brains, done right.', mood: 10, durationMin: 60, maxStacks: 3, icon: 'happy', kind: 'good' },
  { id: 'fx_sad', label: 'Gloomy', description: 'Even for a zombie.', mood: -10, durationMin: null, maxStacks: 1, icon: 'sad', kind: 'bad' },
];

export const FIXTURE_TRAITS: TraitDef[] = [
  { id: 'fx_glutton', name: 'Glutton', description: 'Always peckish.', icon: 'brain', conflicts: [], reward: false, needDecay: { hunger: 2 }, needGain: { hunger: 1.5 } },
  { id: 'fx_quick', name: 'Quick Study', description: 'Learns fast.', icon: 'book', conflicts: [], reward: false, skillGain: { charisma: 2 } },
  { id: 'fx_grumpy', name: 'Grumpy', description: 'Hmph.', icon: 'angry', conflicts: ['fx_cheery'], reward: false, baseMood: -6 },
  { id: 'fx_cheery', name: 'Cheery', description: 'Unsettlingly upbeat.', icon: 'happy', conflicts: ['fx_grumpy'], reward: false, baseMood: 6 },
  { id: 'fx_nightowl', name: 'Night Owl', description: 'Lives for the dark.', icon: 'zzz', conflicts: [], reward: false, mult: { nightEnergyDecay: 0.5 } },
  { id: 'fx_deep', name: 'Deep Sleeper', description: 'Reward trait.', icon: 'coffin', conflicts: [], reward: true, needGain: { energy: 1.3 } },
];

export const fixtureContent: ContentModule = {
  id: 'fixture',
  objects: FIXTURE_OBJECTS,
  interactions: FIXTURE_INTERACTIONS,
  moodlets: FIXTURE_MOODLETS,
  traits: FIXTURE_TRAITS,
  names: { first: ['Mort', 'Ghoulia', 'Rotney', 'Cadavera'], last: ['Graves', 'Moldwell'], occupations: ['Gravedigger'] },
};
