/**
 * DEV ONLY — a believable, self-contained SimulationAPI for the UI-SHELL harness (no engine needed).
 * Data: the Grimsby household on Day 12 of their afterlife.
 */
import type {
  AgentSummary,
  AspirationDef,
  ContentRegistry,
  MoodView,
  NeedView,
  SimulationAPI,
  TraitDef,
  TimeInfo,
} from '../../../sim/contracts';
import type { AgentState, NeedId, SkillId, WorldState, Speed } from '../../../sim/types';
import { NEED_IDS, SAVE_SCHEMA_VERSION, SKILL_IDS } from '../../../sim/types';
import { defaultAppearance, intactLimbs, type ZombieAppearance } from '../../../shared/appearance';
import { FALLBACK_ASPIRATIONS, FALLBACK_TRAITS } from '../data';

export const MOCK_MEMBERS: { id: string; first: string; last: string; app: Partial<ZombieAppearance>; traits: string[]; asp: string }[] = [
  {
    id: 'a1',
    first: 'Mortimer',
    last: 'Grimsby',
    app: { skinTone: 0, hairStyle: 'combover', hairColor: '#3b2f2f', topStyle: 'cardigan', topColor: '#6b4f8a', eyeStyle: 'droopy', accessory: 'glasses', build: 0.55, height: 0.62 },
    traits: ['gourmand', 'grumpy', 'bookworm'],
    asp: 'masterPreserver',
  },
  {
    id: 'a2',
    first: 'Ophelia',
    last: 'Grimsby',
    app: { skinTone: 5, hairStyle: 'bob', hairColor: '#6e2a35', topStyle: 'dress', topColor: '#3f5a4a', eyeStyle: 'wide', eyeColor: '#9fe870', accessory: 'flower', build: 0.3, height: 0.45, voicePitch: 0.7 },
    traits: ['artistic', 'hopelessRomantic', 'cheerful'],
    asp: 'eternalRomance',
  },
  {
    id: 'a3',
    first: 'Bartholomew',
    last: 'Grimsby',
    app: { skinTone: 3, hairStyle: 'mohawk', hairColor: '#4f6b45', topStyle: 'hoodie', topColor: '#a5532f', eyeStyle: 'mismatched', accessory: 'bandage', build: 0.7, height: 0.4, voicePitch: 0.35 },
    traits: ['clumsy', 'partyAnimal', 'lazy'],
    asp: 'afterparty',
  },
];

export function mockTime(tick: number): TimeInfo {
  const totalMinutes = 9 * 60 + tick * 0.25;
  const dayIndex = Math.floor(totalMinutes / 1440);
  const minuteOfDay = Math.floor(totalMinutes - dayIndex * 1440);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const day = dayIndex + 1;
  const weekday = dayIndex % 7;
  const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return {
    tick,
    totalMinutes,
    day,
    weekday,
    weekdayName: names[weekday],
    hour,
    minute,
    minuteOfDay,
    isNight: hour >= 20 || hour < 6,
    label: `${names[weekday].slice(0, 3)} ${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`,
    fullMoon: false,
  };
}

function agentState(m: (typeof MOCK_MEMBERS)[number], idx: number): AgentState {
  const i = idx % 3;
  const needs = { hunger: [62, 18, 71][i], energy: [44, 80, 9][i], preservation: [58, 77, 34][i], social: [70, 46, 88][i], fun: [35, 64, 52][i], hygiene: [81, 59, 22][i] } as Record<NeedId, number>;
  const skills = Object.fromEntries(SKILL_IDS.map((s, k) => [s, { level: (i + k * 2) % 6, xp: 40 }])) as Record<SkillId, { level: number; xp: number }>;
  return {
    id: m.id,
    role: 'household',
    presence: i === 1 ? 'atWork' : 'onLot',
    firstName: m.first,
    lastName: m.last,
    appearance: { ...defaultAppearance(), ...m.app },
    traits: m.traits,
    rewardTraits: [],
    aspiration: m.asp,
    aspirationMilestones: [],
    aspirationPoints: 250 * (i + 1),
    needs,
    vitality: [86, 100, 72][i],
    moodlets: [],
    skills,
    career: null,
    limbs: i === 2 ? { ...intactLimbs(), armL: 'missing' } : intactLimbs(),
    pos: { x: 10 + i * 2, z: 12 },
    prevPos: { x: 10 + i * 2, z: 12 },
    posY: 0,
    facing: 0,
    prevFacing: 0,
    path: null,
    pathIndex: 0,
    queue: [],
    active: null,
    anim: 'idle',
    expression: 'neutral',
    carrying: null,
    carryObjectId: null,
    status: { zeroPreservationMinutes: 0, passedOut: false, feral: false, autonomyCooldownUntil: 0, lastSocialTick: 0, autonomyFails: 0, bonePileId: null, crumbledTick: null },
    visit: null,
    walkBy: null,
    voiceSeed: 1000 + i,
    createdTick: 0,
    occupation: null,
  };
}

export function mockContent(): ContentRegistry {
  const traits: Record<string, TraitDef> = {};
  for (const tr of FALLBACK_TRAITS) traits[tr.id] = { id: tr.id, name: tr.name, description: tr.description, icon: tr.icon, conflicts: tr.conflicts, reward: tr.reward };
  const aspirations: Record<string, AspirationDef> = {};
  for (const a of FALLBACK_ASPIRATIONS)
    aspirations[a.id] = { id: a.id, name: a.name, description: a.description, icon: a.icon, milestones: a.milestones.map((m) => ({ ...m, condition: { kind: 'mock', params: {} } })) };
  return {
    objects: {},
    interactions: {},
    moodlets: {},
    traits,
    skills: Object.fromEntries(
      SKILL_IDS.map((id) => [id, { id, name: id[0].toUpperCase() + id.slice(1), description: '', icon: 'book' as const, xpPerLevel: [100, 150, 220, 300, 400, 520, 660, 820, 1000, 1200] }]),
    ) as ContentRegistry['skills'],
    careers: {},
    aspirations,
    rewards: {},
    recipes: {},
    lifeEvents: [],
    names: { first: [], last: [], occupations: [] },
    stagesOf: () => [],
  };
}

/** Stress roster (8 members, long names) for overflow testing. */
export const STRESS_MEMBERS: (typeof MOCK_MEMBERS)[number][] = [
  ...MOCK_MEMBERS.map((m, i) => ({ ...m, first: ['Bartholomew-Jebb', 'Maximilliana', 'Cornelius-Ambrose'][i] ?? m.first, last: 'Pennyworth-Grave' })),
  { id: 'a4', first: 'Winifred', last: 'Coffinwell-Smythe', app: { skinTone: 2, hairStyle: 'bun', hairColor: '#d8d0c0', topStyle: 'blouse', topColor: '#8a3a5c', eyeStyle: 'sleepy', accessory: 'necklace' }, traits: ['neatFreak', 'vain', 'ambitious'], asp: 'tycoon' },
  { id: 'a5', first: 'Ignatius', last: 'Mouldwick', app: { skinTone: 6, hairStyle: 'bald', topStyle: 'suit', topColor: '#1f2a3a', eyeStyle: 'beady', accessory: 'bowtie' }, traits: ['loner', 'nightOwl', 'squeamish'], asp: 'renaissanceCorpse' },
  { id: 'a6', first: 'Prudence', last: 'Hollowell', app: { skinTone: 4, hairStyle: 'long', hairColor: '#b06a35', topStyle: 'tee', topColor: '#b8963e', eyeStyle: 'wide', accessory: 'beanie' }, traits: ['socialButterfly', 'cheerful', 'partyAnimal'], asp: 'afterparty' },
  { id: 'a7', first: 'Silas', last: 'Blackthorn', app: { skinTone: 1, hairStyle: 'messy', hairColor: '#1f1a1a', topStyle: 'tatters', topColor: '#3a3f55', eyeStyle: 'mismatched', accessory: 'eyepatch' }, traits: ['hothead', 'slob', 'clumsy'], asp: 'tycoon' },
  { id: 'a8', first: 'Gertrude', last: 'Ashworth', app: { skinTone: 7, hairStyle: 'bob', hairColor: '#5b3f6e', topStyle: 'cardigan', topColor: '#4a6a7a', eyeStyle: 'wide', accessory: 'none' }, traits: ['bookworm', 'artistic', 'lazy'], asp: 'masterPreserver' },
];

export function createMockSim(opts: { householdName?: string; day?: number; funds?: number; members?: number; gameOver?: boolean; stress?: boolean } = {}): SimulationAPI {
  const day = opts.day ?? 12;
  const tick = (day - 1) * 5760 + 10 * 240 + 160; // ~7:40 PM
  const roster = opts.stress ? STRESS_MEMBERS : MOCK_MEMBERS;
  const members = roster.slice(0, Math.max(1, Math.min(roster.length, opts.members ?? (opts.stress ? 8 : 3))));
  const agents: Record<string, AgentState> = {};
  members.forEach((m, i) => {
    const a = agentState(m, i);
    if (opts.gameOver) a.presence = 'crumbled';
    agents[a.id] = a;
  });
  const state: WorldState = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    seed: 1337,
    rng: { a: 1, b: 2, c: 3, d: 4 },
    tick,
    nextId: 100,
    household: { name: opts.householdName ?? 'The Grimsbys', funds: opts.funds ?? 4280, memberIds: members.map((m) => m.id), bills: [], utilitiesOn: true, repoDispatchedDay: null, txLog: [] },
    lot: { width: 30, depth: 30, buildable: { x0: 1, z0: 1, x1: 29, z1: 27 }, sidewalkZ: 28, entryPoints: [], walls: {}, floors: [], version: 1, wallVersion: 1, floorVersion: 1 },
    agents,
    objects: {},
    relationships: {},
    notifications: [],
    choices: [],
    party: null,
    flags: {},
    stats: { counters: opts.stress ? { limbsLost: 1_234_567, mealsCooked: 98_765_432, partiesThrown: 4_321, billsPaid: 999_999 } : { limbsLost: 7, mealsCooked: 41, partiesThrown: 2, billsPaid: 6 }, agent: {} },
    settings: { autonomy: 'full', difficulty: 'normal', visitorsEnabled: true },
    gameOver: !!opts.gameOver,
  };
  const reg = mockContent();
  const needLabel: Record<NeedId, string> = { hunger: 'Appetite', energy: 'Rest', preservation: 'Freshness', social: 'Company', fun: 'Amusement', hygiene: 'Odor Control' };
  const summary = (a: AgentState): AgentSummary => {
    const mood = Math.round(NEED_IDS.reduce((s, n) => s + (a.needs[n] - 50), 0) / 4);
    const band: MoodView['band'] = mood <= -50 ? 'miserable' : mood <= -15 ? 'uneasy' : mood < 15 ? 'fine' : mood < 50 ? 'good' : 'great';
    const crit = NEED_IDS.find((n) => a.needs[n] <= 15) ?? null;
    return {
      id: a.id,
      name: `${a.firstName} ${a.lastName}`,
      firstName: a.firstName,
      role: a.role,
      presence: a.presence,
      moodBand: band,
      mood,
      criticalNeed: crit,
      activity: a.presence === 'atWork' ? 'At work' : 'Watching TV',
      activityIcon: a.presence === 'atWork' ? 'work' : 'tv',
      isVisitor: false,
      appearance: a.appearance,
    };
  };
  const list = () => Object.values(agents);
  const api: SimulationAPI = {
    state,
    content: reg,
    spatial: null as unknown as SimulationAPI['spatial'],
    repairWarnings: [],
    build: {
      preview: () => ({ ok: true, cost: 0 }),
      apply: () => ({ ok: true, cost: 0 }),
      undo: () => false,
      redo: () => false,
      canUndo: () => false,
      canRedo: () => false,
      clearHistory: () => {},
    },
    step: () => {},
    dispatch: () => ({ ok: true }),
    drainEvents: () => [],
    faults: () => [],
    time: () => mockTime(state.tick),
    agent: (id) => agents[id],
    object: () => undefined,
    household: () => list().map(summary),
    summary: (id) => (agents[id] ? summary(agents[id]) : null),
    onLotSummaries: () => list().filter((a) => a.presence === 'onLot').map(summary),
    menu: () => [],
    queueView: () => [],
    needs: (id): NeedView[] =>
      NEED_IDS.map((n) => {
        const a = agents[id];
        const v = a ? a.needs[n] : 50;
        return { id: n, label: needLabel[n], value: v, cap: n === 'preservation' && a ? a.vitality : 100, trend: n === 'energy' ? -5 : n === 'fun' ? 3 : -1.3, critical: v <= 15 };
      }),
    mood: (id) => {
      const s = agents[id] ? summary(agents[id]) : null;
      return { value: s?.mood ?? 0, band: s?.moodBand ?? 'fine', label: 'Fine', contributors: [] };
    },
    moodlets: () => [],
    skills: () => [],
    career: () => null,
    relationships: () => [],
    aspiration: () => null,
    bills: () => ({ outstanding: 186, overdue: 0, nextDueLabel: 'Thu 9:00 AM', utilitiesOn: true, bills: [] }),
    objectView: () => null,
    townies: () => [],
    careersAvailable: () => [],
    party: () => null,
    lotValue: () => 18400,
    serialize: () => JSON.parse(JSON.stringify(state)) as WorldState,
    checkInvariants: () => [],
  };
  return api;
}

export const SPEED_LABELS: Record<Speed, string> = { 0: 'Paused', 1: 'Normal', 2: 'Fast', 3: 'Faster', 4: 'Ultra' };
