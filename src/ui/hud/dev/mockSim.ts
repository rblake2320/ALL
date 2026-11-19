/**
 * DEV ONLY — mock world + SimulationAPI for the UI-HUD harness: four household zombies in very different states
 * (selected & busy, at work, asleep with a critical need, crumbled), visitors, townies, bills, a party, choices,
 * notifications. Views are hand-authored tables so every HUD state can be shown deterministically.
 */
import { defaultAppearance, intactLimbs, type LimbState, type ZombieAppearance } from '../../../shared/appearance';
import type {
  AgentSummary,
  AspirationView,
  BillsView,
  CareerView,
  Command,
  CommandResult,
  MenuEntry,
  MoodView,
  MoodletView,
  NeedView,
  ObjectView,
  PartyView,
  QueueView,
  RelationshipView,
  SimulationAPI,
  SkillView,
  TownieView,
  BuildService,
  SpatialAPI,
} from '../../../sim/contracts';
import { timeInfo, tickAt } from '../../../sim/time';
import type { AgentState, ChoiceState, NeedId, Notification, ObjectState, SkillId, TargetRef, WorldState } from '../../../sim/types';
import { SAVE_SCHEMA_VERSION } from '../../../sim/types';
import { MOCK_CAREERS, mockContent } from './mockContent';
import type { HarnessParams } from './params';

const NEED_LABEL: Record<NeedId, string> = { hunger: 'Appetite', energy: 'Rest', preservation: 'Freshness', social: 'Company', fun: 'Amusement', hygiene: 'Odor Control' };
const NEED_ORDER: NeedId[] = ['hunger', 'energy', 'preservation', 'social', 'fun', 'hygiene'];

interface AgentSpec {
  id: string;
  first: string;
  last: string;
  role: AgentState['role'];
  presence: AgentState['presence'];
  app: Partial<ZombieAppearance>;
  needs: Record<NeedId, number>;
  trends: Partial<Record<NeedId, number>>;
  vitality: number;
  traits: string[];
  rewardTraits?: string[];
  limbs?: Partial<LimbState>;
  anim?: AgentState['anim'];
  mood: number;
  activity: string | null;
  activityIcon: AgentSummary['activityIcon'];
  occupation?: string | null;
}

function app(p: Partial<ZombieAppearance>): ZombieAppearance {
  return { ...defaultAppearance(), ...p };
}

function band(mood: number): MoodView['band'] {
  if (mood <= -50) return 'miserable';
  if (mood <= -15) return 'uneasy';
  if (mood < 15) return 'fine';
  if (mood < 50) return 'good';
  return 'great';
}

const BAND_LABEL: Record<MoodView['band'], string> = { miserable: 'Miserable', uneasy: 'Uneasy', fine: 'Fine', good: 'Good', great: 'Undead and Loving It' };

function makeAgent(s: AgentSpec): AgentState {
  return {
    id: s.id,
    role: s.role,
    presence: s.presence,
    firstName: s.first,
    lastName: s.last,
    appearance: app(s.app),
    traits: s.traits,
    rewardTraits: s.rewardTraits ?? [],
    aspiration: s.role === 'household' ? 'masterPreserver' : null,
    aspirationMilestones: [],
    aspirationPoints: 0,
    needs: s.needs,
    vitality: s.vitality,
    moodlets: [],
    skills: { cooking: { level: 0, xp: 0 }, charisma: { level: 0, xp: 0 }, mortuary: { level: 0, xp: 0 }, logic: { level: 0, xp: 0 }, creativity: { level: 0, xp: 0 }, fitness: { level: 0, xp: 0 } },
    career: null,
    limbs: { ...intactLimbs(), ...(s.limbs ?? {}) },
    pos: { x: 10, z: 10 },
    prevPos: { x: 10, z: 10 },
    posY: 0,
    facing: 0,
    prevFacing: 0,
    path: null,
    pathIndex: 0,
    queue: [],
    active: null,
    anim: s.anim ?? 'idle',
    expression: 'neutral',
    carrying: null,
    carryObjectId: null,
    status: { zeroPreservationMinutes: 0, passedOut: false, feral: false, autonomyCooldownUntil: 0, lastSocialTick: 0, autonomyFails: 0, bonePileId: null, crumbledTick: null },
    visit: null,
    walkBy: null,
    voiceSeed: 7,
    createdTick: 0,
    occupation: s.occupation ?? null,
  };
}

const N = (hunger: number, energy: number, preservation: number, social: number, fun: number, hygiene: number): Record<NeedId, number> => ({ hunger, energy, preservation, social, fun, hygiene });

export const AGENTS: AgentSpec[] = [
  {
    id: 'a1',
    first: 'Mortimer',
    last: 'Grimsby',
    role: 'household',
    presence: 'onLot',
    app: { skinTone: 0, hairStyle: 'combover', hairColor: '#3b2f2f', topStyle: 'cardigan', topColor: '#5e4a7a', eyeStyle: 'droopy', eyeColor: '#f2e86d', accessory: 'glasses', stitches: true },
    needs: N(62, 41, 58, 74, 33, 52),
    trends: { hunger: -5.5, energy: -5, preservation: -1.3, social: 8, fun: 18, hygiene: -3.5 },
    vitality: 82,
    traits: ['gourmand', 'clumsy', 'nightOwl'],
    rewardTraits: ['castIronStomach'],
    limbs: { armL: 'missing', legR: 'prosthetic' },
    mood: 38,
    activity: 'Watching Flickering CRT',
    activityIcon: 'tv',
    anim: 'sitTV',
  },
  {
    id: 'a2',
    first: 'Ophelia',
    last: 'Grimsby',
    role: 'household',
    presence: 'atWork',
    app: { skinTone: 5, hairStyle: 'bob', hairColor: '#2b2f3a', topStyle: 'blouse', topColor: '#6e2a35', eyeStyle: 'wide', eyeColor: '#7fe0ff', accessory: 'necklace', stitches: false },
    needs: N(48, 55, 77, 82, 44, 61),
    trends: { hunger: -4, energy: -6, preservation: -1.3, social: 3, fun: -4, hygiene: -3 },
    vitality: 94,
    traits: ['ambitious', 'bookworm', 'vain'],
    mood: 56,
    activity: 'At work',
    activityIcon: 'work',
  },
  {
    id: 'a3',
    first: 'Bartholomew',
    last: 'Grimsby',
    role: 'household',
    presence: 'onLot',
    app: { skinTone: 7, hairStyle: 'messy', hairColor: '#a5532f', topStyle: 'tatters', topColor: '#4a4a3a', eyeStyle: 'sleepy', eyeColor: '#9fe870', accessory: 'beanie', stitches: true },
    needs: N(38, 12, 34, 40, 51, 9),
    trends: { hunger: -2.2, energy: 14, preservation: -0.65, social: -1, fun: -1, hygiene: -1.5 },
    vitality: 71,
    traits: ['slob', 'lazy', 'partyAnimal'],
    mood: -22,
    activity: 'Sleeping in the Pine Box Coffin',
    activityIcon: 'zzz',
    anim: 'sleep',
  },
  {
    id: 'a4',
    first: 'Lenore',
    last: 'Grimsby',
    role: 'household',
    presence: 'crumbled',
    app: { skinTone: 8, hairStyle: 'long', hairColor: '#e8e0c8', topStyle: 'dress', topColor: '#2b2f3a', eyeStyle: 'mismatched', eyeColor: '#ff8f7a', accessory: 'flower', stitches: true },
    needs: N(10, 20, 0, 15, 10, 30),
    trends: {},
    vitality: 34,
    traits: ['hopelessRomantic', 'artistic', 'squeamish'],
    limbs: { armR: 'missing', legL: 'missing' },
    mood: -64,
    activity: null,
    activityIcon: 'skull',
  },
  // stress=1 extras: long names, mixed states
  { id: 'a5', first: 'Bartholomew-Ignatius', last: 'Grimsby-Featherstonehaugh', role: 'household', presence: 'onLot', app: { skinTone: 3, hairStyle: 'mohawk', hairColor: '#7fe0ff', topStyle: 'hoodie', topColor: '#3a3f55', eyeStyle: 'beady' }, needs: N(8, 66, 45, 30, 22, 40), trends: { hunger: -6 }, vitality: 60, traits: ['gourmand'], mood: -55, activity: 'Searching the fridge for something, anything, with a brain in it', activityIcon: 'fridge' },
  { id: 'a6', first: 'Wilhelmina', last: 'Grimsby', role: 'household', presence: 'atWork', app: { skinTone: 6, hairStyle: 'pigtails', hairColor: '#9fe870', topStyle: 'blouse', topColor: '#6e2a35' }, needs: N(55, 45, 70, 60, 55, 65), trends: {}, vitality: 88, traits: ['ambitious'], mood: 20, activity: 'At work', activityIcon: 'work' },
  { id: 'a7', first: 'Ezekiel', last: 'Grimsby', role: 'household', presence: 'onLot', app: { skinTone: 9, hairStyle: 'buzz', hairColor: '#e8e0c8', topStyle: 'suit', topColor: '#1f1f24', accessory: 'bowtie' }, needs: N(70, 80, 64, 50, 75, 90), trends: {}, vitality: 99, traits: ['cheerful'], mood: 72, activity: 'Practising a speech in the mirror', activityIcon: 'mirror' },
  { id: 'a8', first: 'Persephone', last: 'Grimsby', role: 'household', presence: 'onLot', app: { skinTone: 2, hairStyle: 'long', hairColor: '#5b3f6e', topStyle: 'dress', topColor: '#5b3f6e', accessory: 'flower' }, needs: N(40, 9, 50, 45, 60, 55), trends: { energy: -5 }, vitality: 77, traits: ['nightOwl'], mood: 3, activity: 'Napping on the sofa', activityIcon: 'zzz', anim: 'sleep' },
  { id: 't1', first: 'Cassia', last: 'Morrow', role: 'townie', presence: 'onLot', app: { skinTone: 4, hairStyle: 'pigtails', hairColor: '#5b3f6e', topStyle: 'hoodie', topColor: '#3f5a4a', eyeColor: '#ffb35a' }, needs: N(60, 60, 70, 60, 60, 70), trends: {}, vitality: 90, traits: ['cheerful'], mood: 30, activity: 'Chatting', activityIcon: 'chat', occupation: 'Florist (wilted arrangements)' },
  { id: 't2', first: 'Dante', last: 'Vex', role: 'townie', presence: 'onLot', app: { skinTone: 1, hairStyle: 'mohawk', hairColor: '#9fe870', topStyle: 'tee', topColor: '#2b2f3a', eyeStyle: 'beady', accessory: 'eyepatch' }, needs: N(60, 60, 70, 60, 60, 70), trends: {}, vitality: 90, traits: ['grumpy'], mood: 5, activity: 'Telling a Gross Joke', activityIcon: 'joke', occupation: 'Night Bus Driver' },
  { id: 't3', first: 'Wren', last: 'Ashcombe', role: 'townie', presence: 'offLot', app: { skinTone: 2, hairStyle: 'bun', hairColor: '#6e2a35', topStyle: 'suit', topColor: '#3a3f55', accessory: 'bowtie' }, needs: N(60, 60, 70, 60, 60, 70), trends: {}, vitality: 90, traits: [], mood: 20, activity: null, activityIcon: null, occupation: 'Cemetery Gardener' },
  { id: 't4', first: 'Bram', last: 'Holloway', role: 'townie', presence: 'offLot', app: { skinTone: 9, hairStyle: 'buzz', hairColor: '#1f1f24', topStyle: 'suit', topColor: '#1f1f24' }, needs: N(60, 60, 70, 60, 60, 70), trends: {}, vitality: 90, traits: [], mood: -10, activity: null, activityIcon: null, occupation: 'Landlord (alive, regrettably)' },
  { id: 't5', first: 'Edgar', last: 'Pell', role: 'townie', presence: 'offLot', app: { skinTone: 6, hairStyle: 'afro', hairColor: '#3b2f2f', topStyle: 'cardigan', topColor: '#7a6a3a', accessory: 'glasses' }, needs: N(60, 60, 70, 60, 60, 70), trends: {}, vitality: 90, traits: [], mood: 10, activity: null, activityIcon: null, occupation: 'Taxidermist' },
  { id: 't6', first: 'Silas', last: 'Crane', role: 'townie', presence: 'offLot', app: { skinTone: 3, hairStyle: 'long', hairColor: '#2b2f3a', topStyle: 'hoodie', topColor: '#6e3b3b' }, needs: N(60, 60, 70, 60, 60, 70), trends: {}, vitality: 90, traits: [], mood: -5, activity: null, activityIcon: null, occupation: 'Séance Medium' },
  { id: 't7', first: 'Maude', last: 'Bellweather', role: 'townie', presence: 'offLot', app: { skinTone: 8, hairStyle: 'bun', hairColor: '#e8e0c8', topStyle: 'dress', topColor: '#5b3f6e', accessory: 'necklace' }, needs: N(60, 60, 70, 60, 60, 70), trends: {}, vitality: 90, traits: [], mood: 30, activity: null, activityIcon: null, occupation: 'Retired Banshee' },
];

const SPEC = Object.fromEntries(AGENTS.map((a) => [a.id, a]));

const SKILLS: Record<string, Partial<Record<SkillId, [number, number]>>> = {
  a1: { cooking: [4, 0.62], charisma: [2, 0.1], mortuary: [3, 0.85], logic: [1, 0.3], creativity: [0, 0.4], fitness: [2, 0.45] },
  a2: { cooking: [1, 0.2], charisma: [3, 0.5], mortuary: [0, 0], logic: [6, 0.71], creativity: [2, 0.1], fitness: [1, 0.9] },
  a3: { cooking: [0, 0.1], charisma: [1, 0.6], mortuary: [0, 0.2], logic: [0, 0], creativity: [1, 0.3], fitness: [10, 0] },
  a4: { cooking: [2, 0], charisma: [2, 0], mortuary: [1, 0], logic: [0, 0], creativity: [7, 0.4], fitness: [0, 0] },
};

const MOODLETS: Record<string, MoodletView[]> = {
  a1: [
    { id: 'deliciousMeal', label: 'Delicious Meal', description: 'That Frontal Lobe Lasagna was to die for. Again.', mood: 10, stacks: 1, icon: 'plate', kind: 'good', remaining: 142 },
    { id: 'lostLimb', label: 'Lost a Limb', description: 'An arm fell off in the middle of dinner. Somebody pick that up.', mood: -15, stacks: 1, icon: 'limb', kind: 'bad', remaining: 385 },
    { id: 'familyDinner', label: 'Family Dinner', description: 'Ate together at the table, like a proper undead family.', mood: 8, stacks: 1, icon: 'house', kind: 'good', remaining: 75 },
    { id: 'stenchNearby', label: 'Stench Nearby', description: 'Someone in this room has stopped bathing entirely.', mood: -10, stacks: 2, icon: 'flies', kind: 'bad', remaining: 38 },
    { id: 'moonstruck', label: 'Moonstruck', description: 'The full moon makes everything feel a little peculiar.', mood: 4, stacks: 1, icon: 'sparkle', kind: 'good', remaining: null },
  ],
  a2: [{ id: 'promoted', label: 'Promoted!', description: 'Moved up in the world, if not out of the grave.', mood: 20, stacks: 1, icon: 'trophy', kind: 'good', remaining: 920 }],
  a3: [
    { id: 'reeking', label: 'Reeking', description: 'Flies have started paying rent.', mood: -12, stacks: 1, icon: 'flies', kind: 'bad', remaining: null },
    { id: 'sleptOnFloor', label: 'Slept on the Floor', description: 'Passed out on the floorboards. Everything aches.', mood: -10, stacks: 1, icon: 'zzz', kind: 'bad', remaining: 210 },
    // long real-content name on an odd last card (layout: spans the row, wraps instead of truncating)
    { id: 'ventedFrustration', label: 'Got It Out of My System', description: 'Slammed a door, felt better. The door did not.', mood: 3, stacks: 1, icon: 'angry', kind: 'good', remaining: 60 },
  ],
  a4: [{ id: 'mourning', label: 'Mourning', description: 'A housemate has crumbled. The house feels emptier.', mood: -20, stacks: 1, icon: 'urn', kind: 'bad', remaining: 2400 }],
};

const CONTRIBUTORS: Record<string, { label: string; value: number }[]> = {
  a1: [
    { label: 'Moodlets', value: 6 },
    { label: 'Company', value: 4.8 },
    { label: 'Appetite', value: 3.4 },
    { label: 'Night Owl (evening)', value: 8 },
    { label: 'Room environment', value: 5 },
    { label: 'Amusement', value: -2.9 },
    { label: 'Rest', value: -1.1 },
  ],
};

function careerView(id: string): CareerView | null {
  if (id === 'a1') {
    return {
      trackId: 'mortuary',
      trackName: 'Mortuary Sciences',
      level: 2,
      title: "Embalmer's Assistant",
      wage: 22,
      schedule: 'Mon–Fri · 9:00 AM – 5:00 PM',
      performance: 64,
      nextTitle: 'Embalmer',
      promoteReq: [{ skill: 'mortuary', level: 4, met: false }],
      status: 'Next shift tomorrow at 9:00 AM · carpool 8:30 AM',
      icon: 'embalm',
    };
  }
  if (id === 'a2') {
    return {
      trackId: 'necrotech',
      trackName: 'Necro-Tech',
      level: 3,
      title: 'Senior Developer',
      wage: 36,
      schedule: 'Mon–Fri · 9:00 AM – 5:00 PM',
      performance: 88,
      nextTitle: 'Lead Architect',
      promoteReq: [{ skill: 'logic', level: 6, met: true }],
      status: 'At work until 5:00 PM',
      icon: 'computer',
    };
  }
  return null;
}

const REL = (otherId: string, friendship: number, romance: number, label: string, inHousehold = false, onLot = false): RelationshipView => ({
  otherId,
  name: `${SPEC[otherId].first} ${SPEC[otherId].last}`,
  friendship,
  romance,
  label,
  inHousehold,
  onLot,
});

const RELS: Record<string, RelationshipView[]> = {
  a1: [
    REL('a2', 82, 91, 'Spouse', true, false),
    REL('a3', 64, 0, 'Good Friend', true, true),
    REL('a4', 47, 0, 'Friend', true, false),
    REL('t1', 41, 34, 'Crush', false, true),
    REL('t2', 22, 0, 'Acquaintance', false, true),
    REL('t3', 88, 0, 'Best Friend'),
    REL('t4', -72, 0, 'Nemesis'),
    REL('t5', 8, 0, 'Acquaintance'),
    REL('t6', -38, 0, 'Disliked'),
  ],
  a2: [REL('a1', 82, 91, 'Spouse', true, false), REL('a3', 30, 0, 'Acquaintance', true, true), REL('t7', 55, 0, 'Friend')],
  a3: [REL('a1', 64, 0, 'Good Friend', true, true), REL('t2', 70, 0, 'Good Friend', false, true)],
  a4: [],
};

export interface MockSimOptions {
  params: HarnessParams;
}

export class MockSim implements SimulationAPI {
  readonly state: WorldState;
  readonly content = mockContent();
  readonly repairWarnings: string[] = [];
  readonly spatial = {} as SpatialAPI;
  readonly build: BuildService;
  private p: HarnessParams;
  aspPoints = 1250;
  owned = new Set<string>(['r_castIron']);

  constructor({ params }: MockSimOptions) {
    this.p = params;
    const tick = params.fullMoon ? tickAt(7, 22 * 60 + 15) : params.night ? tickAt(4, 21 * 60 + 40) : tickAt(4, 16 * 60 + 35);
    const agents: Record<string, AgentState> = {};
    for (const s of AGENTS) agents[s.id] = makeAgent(s);
    agents.a1.career = { trackId: 'mortuary', level: 2, performance: 64, daysAtLevel: 3, missedStreak: 0, lastShiftDay: 4, shiftStatus: 'done', shiftStartTick: null, moodSum: 0, moodSamples: 0, sickDaysUsed: 1 };
    agents.a2.career = { trackId: 'necrotech', level: 3, performance: 88, daysAtLevel: 5, missedStreak: 0, lastShiftDay: 4, shiftStatus: 'atWork', shiftStartTick: null, moodSum: 0, moodSamples: 0, sickDaysUsed: 0 };
    if (params.allAsleep) {
      agents.a1.anim = 'sleep';
      agents.a3.anim = 'sleep';
    }
    const objects: Record<string, ObjectState> = {
      o1: obj('o1', 'mailbox_crooked', 14, 26),
      o2: obj('o2', 'sofa_velvet', 8, 9),
      o3: obj('o3', 'fridge_humming', 12, 6),
      o4: obj('o4', 'tv_crt', 9, 12),
    };
    const bills = params.bills === 'none' ? [] : params.bills === 'ok' ? [bill('b2', 178, tick + 900, null)] : [bill('b1', 212, tick - 2400, null, 3), bill('b2', 178, tick + 900, null), bill('b0', 190, tick - 9000, tick - 8000)];
    this.state = {
      schemaVersion: SAVE_SCHEMA_VERSION,
      seed: 1,
      rng: { a: 1, b: 2, c: 3, d: 4 },
      tick,
      nextId: 100,
      household: {
        name: params.stress ? 'The Grimsby-Featherstonehaughs of Hollow Lane' : 'The Grimsbys',
        funds: params.funds,
        memberIds: params.stress ? ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'] : ['a1', 'a2', 'a3', 'a4'],
        bills,
        utilitiesOn: !params.powerOff,
        repoDispatchedDay: null,
        txLog: [],
      },
      lot: { width: 30, depth: 30, buildable: { x0: 1, z0: 1, x1: 29, z1: 27 }, sidewalkZ: 28, entryPoints: [], walls: {}, floors: [], version: 1, wallVersion: 1, floorVersion: 1 },
      agents,
      objects,
      relationships: {},
      notifications: makeNotifications(tick),
      choices: params.choice ? [makeChoice(tick)] : [],
      party: params.party ? { hostId: 'a1', startTick: tick - 360, endTick: tick + 600, guestIds: ['t1', 't2'], score: params.partyScore, ended: false } : null,
      flags: {},
      stats: { counters: {}, agent: {} },
      settings: { autonomy: 'full', difficulty: 'normal', visitorsEnabled: true },
      gameOver: false,
    };
    this.build = {
      preview: () => ({ ok: true, cost: 0 }),
      apply: () => ({ ok: true, cost: 0 }),
      undo: () => true,
      redo: () => true,
      canUndo: () => true,
      canRedo: () => false,
      clearHistory: () => undefined,
    };
  }

  step(): void {}
  drainEvents() {
    return [];
  }
  faults() {
    return [];
  }
  time() {
    return timeInfo(this.state.tick);
  }
  agent(id: string) {
    return this.state.agents[id];
  }
  object(id: string) {
    return this.state.objects[id];
  }

  summary(id: string): AgentSummary | null {
    const s = SPEC[id];
    const a = this.state.agents[id];
    if (!s || !a) return null;
    const crit = NEED_ORDER.find((n) => a.presence === 'onLot' && a.needs[n] <= 15 && n !== 'energy') ?? null;
    return {
      id,
      name: `${s.first} ${s.last}`,
      firstName: s.first,
      role: s.role,
      presence: a.presence,
      moodBand: band(s.mood),
      mood: s.mood,
      criticalNeed: crit,
      activity: a.anim === 'sleep' && id === 'a1' ? 'Sleeping' : s.activity,
      activityIcon: a.anim === 'sleep' ? 'zzz' : s.activityIcon,
      isVisitor: s.role !== 'household' && a.presence === 'onLot',
      appearance: a.appearance,
    };
  }
  household(): AgentSummary[] {
    return this.state.household.memberIds.map((id) => this.summary(id)).filter((x): x is AgentSummary => !!x);
  }
  onLotSummaries(): AgentSummary[] {
    return Object.keys(this.state.agents)
      .filter((id) => this.state.agents[id].presence === 'onLot')
      .map((id) => this.summary(id)!)
      .filter(Boolean);
  }
  needs(id: string): NeedView[] {
    const a = this.state.agents[id];
    const s = SPEC[id];
    if (!a || !s) return [];
    return NEED_ORDER.map((n) => ({
      id: n,
      label: NEED_LABEL[n],
      value: a.needs[n],
      cap: n === 'preservation' ? a.vitality : 100,
      trend: s.trends[n] ?? 0,
      critical: a.needs[n] <= 15,
    }));
  }
  mood(id: string): MoodView {
    const m = SPEC[id]?.mood ?? 0;
    return { value: m, band: band(m), label: BAND_LABEL[band(m)], contributors: CONTRIBUTORS[id] ?? [{ label: 'Moodlets', value: m / 2 }] };
  }
  moodlets(id: string): MoodletView[] {
    if (this.p.stress && id === 'a1') return stressMoodlets();
    return MOODLETS[id] ?? [];
  }
  skills(id: string): SkillView[] {
    const t = SKILLS[id] ?? {};
    return this.content ? Object.values(this.content.skills).map((d) => ({ id: d.id, name: d.name, icon: d.icon, level: t[d.id]?.[0] ?? 0, progress: t[d.id]?.[1] ?? 0 })) : [];
  }
  career(id: string): CareerView | null {
    return this.state.agents[id]?.career ? careerView(id) : null;
  }
  relationships(id: string): RelationshipView[] {
    if (this.p.stress && id === 'a1') return stressRelationships();
    return RELS[id] ?? [];
  }
  aspiration(id: string): AspirationView | null {
    if (id === 'a3' || !this.state.agents[id] || this.state.agents[id].role !== 'household') return null;
    const def = this.content.aspirations.masterPreserver;
    return {
      id: def.id,
      name: def.name,
      icon: def.icon,
      points: this.aspPoints,
      milestones: def.milestones.map((m, i) => ({ id: m.id, label: m.label, points: m.points, done: i < 2 })),
      rewards: Object.values(this.content.rewards).map((r) => ({ id: r.id, name: r.name, description: r.description, cost: r.cost, owned: this.owned.has(r.id), affordable: r.cost <= this.aspPoints, icon: r.icon })),
    };
  }
  bills(): BillsView {
    const t = this.state.tick;
    const list = this.state.household.bills.map((b) => ({ id: b.id, amount: b.amount, dueLabel: timeInfo(b.dueTick).label, overdue: b.paidTick === null && b.dueTick < t, paid: b.paidTick !== null }));
    const unpaid = list.filter((b) => !b.paid);
    return {
      outstanding: unpaid.reduce((s, b) => s + b.amount, 0),
      overdue: unpaid.filter((b) => b.overdue).reduce((s, b) => s + b.amount, 0),
      nextDueLabel: unpaid.find((b) => !b.overdue)?.dueLabel ?? null,
      utilitiesOn: this.state.household.utilitiesOn,
      bills: list,
    };
  }
  objectView(id: string): ObjectView | null {
    const o = this.state.objects[id];
    if (!o) return null;
    const d = this.content.objects[o.defId];
    return { id, defId: o.defId, name: d?.name ?? o.defId, description: d?.description ?? '', value: d?.price ?? 0, sellValue: Math.round((d?.price ?? 0) * 0.85), broken: false, powered: true, inUse: false, detail: o.defId === 'fridge_humming' ? 'Leftovers: 2 servings' : null };
  }
  townies(forId: string): TownieView[] {
    const rels = new Map((RELS[forId] ?? []).map((r) => [r.otherId, r]));
    return AGENTS.filter((a) => a.role === 'townie').map((a) => {
      const r = rels.get(a.id);
      return {
        id: a.id,
        name: `${a.first} ${a.last}`,
        occupation: a.occupation ?? null,
        friendship: r?.friendship ?? 0,
        romance: r?.romance ?? 0,
        met: !!r,
        label: r?.label ?? 'Stranger',
        available: a.id !== 't6' && a.presence !== 'onLot',
      };
    });
  }
  careersAvailable() {
    return MOCK_CAREERS.map((c) => ({ id: c.id, name: c.name, description: c.description, startTitle: c.levels[0].title, wage: c.levels[0].wage, schedule: c.id === 'retail' ? 'Mon–Fri · 10:00 PM – 4:00 AM' : c.id === 'culinary' ? 'Wed–Sun · 4:00 PM – 11:00 PM' : c.id === 'politics' ? 'Mon–Fri · 10:00 AM – 5:00 PM' : 'Mon–Fri · 9:00 AM – 5:00 PM', icon: c.icon }));
  }
  party(): PartyView | null {
    const p = this.state.party;
    if (!p) return null;
    // SIM-PEOPLE's party view says the whole phrase ("Ends 12:10 AM"); the HUD must not prefix "Ends" again
    return { active: !p.ended, score: p.score, endsLabel: `Ends ${timeInfo(p.endTick).label.replace(/^\S+\s/, '')}`, guests: 5 };
  }
  lotValue() {
    return 18_450;
  }
  queueView(id: string): QueueView[] {
    if (this.p.stress && id === 'a1') return stressQueue();
    if (id === 'a1')
      return [
        { uid: 11, label: 'Watch Flickering CRT', icon: 'tv', active: true, progress: 0.62, cancellable: true, source: 'player' },
        { uid: 12, label: 'Cook Frontal Lobe Lasagna', icon: 'plate', active: false, progress: 0, cancellable: true, source: 'player' },
        { uid: 13, label: 'Take a Shower', icon: 'shower', active: false, progress: 0, cancellable: true, source: 'auto' },
        { uid: 14, label: 'Chat with Cassia', icon: 'chat', active: false, progress: 0, cancellable: true, source: 'player' },
        { uid: 15, label: 'Go to Work', icon: 'work', active: false, progress: 0, cancellable: false, source: 'system' },
      ];
    // real labels run long (28+ chars): the active label must not clip at the old 12rem
    if (id === 'a3') return [{ uid: 21, label: 'Sleep in the Pine Box Coffin', icon: 'zzz', active: true, progress: 0.34, cancellable: true, source: 'auto' }];
    return [];
  }
  menu(actorId: string, target: TargetRef): MenuEntry[] {
    const e = (interactionId: string, label: string, icon: MenuEntry['icon'], group: string | null, available = true, reason: string | null = null, cost: number | null = null, children?: MenuEntry[]): MenuEntry => ({ interactionId, label, group, icon, available, reason, cost, params: {}, children });
    if (target.kind === 'self') {
      const a = this.state.agents[actorId];
      const hasCareer = !!a?.career;
      return [
        e('phone_inviteOver', 'Invite Over', 'phone', 'Phone'),
        e('phone_throwParty', 'Throw a Party', 'party', 'Phone', !this.state.party, this.state.party ? 'A party is already underway' : null),
        e('phone_orderPizza', 'Order Brain Pizza', 'pizza', 'Phone', this.state.household.funds >= 35, this.state.household.funds >= 35 ? null : 'Not enough money', 35),
        e('phone_findJob', 'Get a Job', 'work', 'Phone', !hasCareer, hasCareer ? 'Already employed' : null),
        e('phone_quitJob', 'Quit Job', 'work', 'Phone', hasCareer, hasCareer ? null : 'Not employed'),
        e('phone_callInSick', 'Call in Sick', 'sad', 'Phone', hasCareer, hasCareer ? null : 'Not employed'),
      ];
    }
    if (target.kind === 'object') {
      return [
        e('home_cook', 'Cook…', 'plate', null, true, null, null, [
          e('home_cook', 'Synthetic Brain Loaf', 'brain', null, true, null, 12),
          e('home_cook', 'Cerebellum Stew', 'plate', null, true, null, 20),
          e('home_cook', 'Frontal Lobe Lasagna', 'plate', null, true, null, 30),
          e('home_cook', 'Gourmet Medulla Flambé', 'fire', null, false, 'Needs a Cryo-Fridge 3000', 45),
        ]),
        e('home_snack', 'Grab a Brain Jerky', 'brain', null, true, null, 5),
        e('home_spray', 'Grab Preservative Spray', 'ice', null, true, null, 15),
        e('home_leftovers', 'Have Leftovers (2)', 'dish', null, true),
        e('home_putAway', 'Put Away Leftovers', 'fridge', null, false, 'Nothing to put away'),
      ];
    }
    return [
      e('social_chat', 'Groan Small Talk', 'chat', 'Friendly'),
      e('social_joke', 'Tell a Gross Joke', 'joke', 'Friendly'),
      e('social_complimentRot', 'Compliment Their Decay', 'sparkle', 'Friendly'),
      e('social_gossip', 'Gossip', 'gossip', 'Friendly', false, 'Needs Friendship 20'),
      e('social_hug', 'Cold Embrace', 'heart', 'Friendly'),
      e('social_flirt', 'Wink With Remaining Eye', 'heart', 'Romantic'),
      e('social_complimentSmell', 'Compliment Their Smell', 'rose', 'Romantic'),
      e('social_slowDance', 'Slow Dance', 'dance', 'Romantic'),
      e('social_kiss', 'Kiss', 'heart', 'Romantic', false, 'Needs Romance 40'),
      e('social_argue', 'Argue About the Smell', 'angry', 'Mean'),
      e('social_insultDecay', 'Insult Their Decay', 'skull', 'Mean'),
      e('social_askToLeave', 'Ask to Leave', 'wave', 'Mean'),
      e('social_inviteStay', 'Invite to Stay Longer', 'house', null),
      e('phone_inviteOver', 'Exchange Numbers', 'phone', null, true),
    ];
  }
  dispatch(cmd: Command): CommandResult {
    switch (cmd.type) {
      case 'buyReward': {
        const r = this.content.rewards[cmd.rewardId];
        if (!r) return { ok: false, reason: 'No such reward' };
        if (this.owned.has(r.id) && r.kind === 'trait') return { ok: false, reason: 'Already owned' };
        if (r.cost > this.aspPoints) return { ok: false, reason: 'Not enough points' };
        this.aspPoints -= r.cost;
        if (r.kind === 'trait') this.owned.add(r.id);
        return { ok: true };
      }
      case 'renameHousehold':
        this.state.household.name = cmd.name;
        return { ok: true };
      case 'markNotificationsRead':
        for (const n of this.state.notifications) n.read = true;
        return { ok: true };
      default:
        return { ok: true };
    }
  }
  serialize(): WorldState {
    return JSON.parse(JSON.stringify(this.state));
  }
  checkInvariants(): string[] {
    return [];
  }
}

function obj(id: string, defId: string, x: number, z: number): ObjectState {
  return { id, defId, placement: { kind: 'floor', x, z, rot: 0 }, value: 100, purchasedTick: 0, tint: null, condition: { broken: false, dirt: 0, burning: false, burnMinutes: 0 }, data: {}, reservedBy: {}, inUseBy: [], rev: 1 };
}

function bill(id: string, amount: number, dueTick: number, paidTick: number | null, stage = 0) {
  return { id, issuedTick: dueTick - 4320, dueTick, amount, paidTick, stage };
}

function makeNotifications(tick: number): Notification[] {
  const n = (id: number, dt: number, kind: Notification['kind'], title: string, text: string, agentId: string | null = null, read = false): Notification => ({ id, tick: tick - dt, kind, title, text, agentId, objectId: null, read });
  return [
    n(1, 7600, 'info', 'Welcome to Wormwood Heights', 'The Grimsbys have moved into 13 Hollow Lane. The previous owners left in a hurry.', null, true),
    n(2, 6200, 'money', 'Painting sold', 'Lenore sold “Self-Portrait, Mostly” for $240.', 'a4', true),
    n(3, 5800, 'skill', 'Cooking skill up', 'Mortimer reached Cooking level 4. Fewer fires, probably.', 'a1', true),
    n(4, 3100, 'decay', 'An arm fell off', 'Mortimer’s left arm detached during dinner. It’s under the table.', 'a1'),
    n(5, 2400, 'warning', 'Bill overdue', 'The utility bill is overdue. Power will be cut in 2 days.'),
    n(6, 1300, 'career', 'Promoted!', 'Ophelia is now a Senior Developer at Necro-Tech.', 'a2'),
    n(7, 640, 'romance', 'Smitten', 'Cassia can’t stop thinking about Mortimer’s remaining eye.', 't1'),
    n(8, 300, 'bad', 'Lenore crumbled', 'Lenore’s Freshness hit zero for too long. A Reanimation Kit can still bring her back.', 'a4'),
    n(9, 40, 'social', 'New friend', 'Bartholomew and Dante are now Good Friends.', 'a3'),
  ];
}

function makeChoice(tick: number): ChoiceState {
  return {
    id: 'c1',
    tick: tick - 120,
    title: 'A Client Sits Up',
    text: 'Halfway through the embalming, the “client” sits up and asks for a glass of water. Mortimer has seconds to decide how to handle it.',
    agentId: 'a1',
    options: [
      { label: 'Offer a glass of water', effect: 'perf', params: { amount: 6 }, tooltip: 'Performance +6 · Charisma xp' },
      { label: 'Calmly finish the job', effect: 'perf', params: { amount: 12 }, tooltip: 'Performance +12 · risky: −10 if it goes wrong' },
      { label: 'Run screaming', effect: 'perf', params: { amount: -8 }, tooltip: 'Performance −8 · Fun +10' },
    ],
    expiresTick: tick + 360,
    defaultOption: 0,
  };
}

// ───────────────────────────── stress=1 data ─────────────────────────────

const STRESS_MOODLET_NAMES = [
  'Lost a Limb', 'Delicious Meal', 'Family Dinner', 'Stench Nearby', 'Moonstruck', 'Slept on the Floor', 'Grossed Out', 'That Was Hilarious',
  'Promoted!', 'Butterfingers', 'Panicking', 'Food Poisoning', 'Ate Standing Up', 'Legendary Party', 'Lame Party', 'Newlyweds',
  'Back From the Dead', 'Mourning', 'Offended', 'Furious About the Smell of the Neighbour’s Compost Heap', 'Disgusted by Mess', 'Vain Glow',
  'Lovesick', 'Cold Embrace', 'Cosy Coffin', 'Rained On', 'Fresh as a Daisy', 'Reeking', 'Flies Everywhere', 'Ate Something Questionable',
];

function stressMoodlets(): MoodletView[] {
  const icons: MoodletView['icon'][] = ['limb', 'plate', 'house', 'flies', 'sparkle', 'zzz', 'disgusted', 'joke', 'trophy', 'limb', 'fire', 'sad', 'plate', 'party', 'sad', 'ring'];
  return STRESS_MOODLET_NAMES.map((label, i) => {
    const each = ((i * 7) % 23) - 11 || 3;
    const stacks = i % 5 === 0 ? 3 : 1;
    // Engine semantics (src/sim/engine/views.ts): `mood` is the total over all stacks.
    const mood = each * stacks;
    return {
      id: `stress${i}`,
      label,
      description: `${label}: a very long description that should wrap gracefully inside the tooltip without breaking the layout of anything around it.`,
      mood,
      stacks,
      icon: icons[i % icons.length],
      kind: mood > 0 ? 'good' : 'bad',
      remaining: i % 4 === 0 ? null : 15 + i * 97,
    };
  });
}

function stressRelationships(): RelationshipView[] {
  const labels = ['Best Friend', 'Spouse', 'Good Friend', 'Friend', 'Acquaintance', 'Crush', 'Disliked', 'Nemesis'];
  return Array.from({ length: 24 }, (_, i) => ({
    otherId: i < AGENTS.length ? AGENTS[i].id : `x${i}`,
    name: i % 6 === 0 ? 'Maximiliana Theodora Bellweather-Ashcombe' : `${AGENTS[i % AGENTS.length].first} ${AGENTS[i % AGENTS.length].last}`,
    friendship: ((i * 37) % 201) - 100,
    romance: i % 5 === 1 ? (i * 13) % 100 : 0,
    label: labels[i % labels.length],
    inHousehold: i < 4,
    onLot: i % 7 === 2,
  }));
}

function stressQueue(): QueueView[] {
  const items: [string, QueueView['icon'], QueueView['source']][] = [
    ['Cook Gourmet Medulla Flambé for the Whole Household and Then Some', 'plate', 'player'],
    ['Take a Shower', 'shower', 'auto'],
    ['Chat with Cassia', 'chat', 'player'],
    ['Go to Work', 'work', 'system'],
    ['Paint a Masterpiece', 'paint', 'player'],
    ['Play Chess', 'chess', 'player'],
    ['Lift Weights', 'dumbbell', 'auto'],
    ['Read a Book', 'book', 'player'],
    ['Watch TV', 'tv', 'auto'],
    ['Embalm Self', 'embalm', 'player'],
    ['Dance', 'dance', 'player'],
    ['Nap', 'zzz', 'auto'],
  ];
  return [
    { uid: 100, label: 'Stitch Back On the Left Arm at the Stitch-n-Mend Table', icon: 'stitch', active: true, progress: 0.41, cancellable: true, source: 'player' },
    ...items.map(([label, icon, source], i) => ({ uid: 101 + i, label, icon, active: false, progress: 0, cancellable: source !== 'system', source })),
  ];
}
