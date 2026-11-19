/**
 * Hand-built, fully valid WorldState fixtures (typed against the contract, so a contract change that
 * adds fields breaks compilation here first) plus storage fault-injection helpers.
 */
import type { SaveMeta, StorageBackend } from '../../../src/persistence/contracts';
import type { AgentState, ObjectState, WorldState } from '../../../src/sim/types';
import { SAVE_SCHEMA_VERSION } from '../../../src/sim/types';
import { defaultAppearance } from '../../../src/shared/appearance';
import { createMemoryBackend, type MemoryBackend } from '../../../src/persistence/backends/memory';
import { StorageError } from '../../../src/persistence/errors';

export function makeAgent(id: string, over: Partial<AgentState> = {}): AgentState {
  return {
    id,
    role: 'household',
    presence: 'onLot',
    firstName: 'Mort',
    lastName: 'Ician',
    appearance: defaultAppearance(),
    traits: ['clumsy', 'romantic', 'neat'],
    rewardTraits: [],
    aspiration: 'fortune',
    aspirationMilestones: ['firstPaycheck'],
    aspirationPoints: 120,
    needs: { hunger: 80, energy: 70, preservation: 60, social: 50, fun: 40, hygiene: 30 },
    vitality: 90,
    moodlets: [{ id: 'freshlyStitched', startTick: 10, endTick: 500, stacks: 1, sourceId: null }],
    skills: {
      cooking: { level: 2, xp: 15 },
      charisma: { level: 0, xp: 0 },
      mortuary: { level: 1, xp: 3.5 },
      logic: { level: 0, xp: 0 },
      creativity: { level: 0, xp: 0 },
      fitness: { level: 0, xp: 0 },
    },
    career: {
      trackId: 'graveyardShift',
      level: 2,
      performance: 12.5,
      daysAtLevel: 3,
      missedStreak: 0,
      lastShiftDay: 4,
      shiftStatus: 'done',
      shiftStartTick: null,
      moodSum: 120,
      moodSamples: 4,
      sickDaysUsed: 0,
    },
    limbs: { armL: 'ok', armR: 'prosthetic', legL: 'ok', legR: 'ok' },
    pos: { x: 5.5, z: 6.25 },
    prevPos: { x: 5.4, z: 6.25 },
    posY: 0,
    facing: 1.5,
    prevFacing: 1.4,
    path: [
      { x: 5.5, z: 6.5 },
      { x: 6.5, z: 6.5 },
    ],
    pathIndex: 1,
    queue: [
      { uid: 41, interactionId: 'home_fridge_eat', target: { kind: 'object', id: 'o7' }, params: { servings: 1 }, source: 'player', priority: 200, queuedTick: 1200 },
    ],
    active: {
      uid: 40,
      interactionId: 'home_sofa_sit',
      target: { kind: 'object', id: 'o8' },
      params: {},
      source: 'auto',
      priority: 100,
      queuedTick: 1100,
      phase: 'run',
      stage: 0,
      stageTarget: { kind: 'object', id: 'o8' },
      slot: 0,
      routeGoal: { x: 3, z: 4 },
      pose: { x: 3.5, z: 4.5, y: 0.46, facing: 0 },
      startedRunTick: 1150,
      elapsed: 12.25,
      duration: 30,
      partnerId: null,
      routeFails: 0,
      waitMinutes: 0,
      data: { comfy: true, note: null },
      canceled: false,
    },
    anim: 'sit',
    expression: 'happy',
    carrying: null,
    carryObjectId: null,
    status: {
      zeroPreservationMinutes: 0,
      passedOut: false,
      feral: false,
      autonomyCooldownUntil: 0,
      lastSocialTick: 900,
      autonomyFails: 0,
      bonePileId: null,
      crumbledTick: null,
    },
    visit: null,
    walkBy: null,
    voiceSeed: 12345,
    createdTick: 0,
    occupation: null,
    ...over,
  };
}

export function makeObject(id: string, over: Partial<ObjectState> = {}): ObjectState {
  return {
    id,
    defId: 'sofa_coffin',
    placement: { kind: 'floor', x: 3, z: 4, rot: 1 },
    value: 450,
    purchasedTick: 0,
    tint: '#6b4f8a',
    condition: { broken: false, dirt: 0.25, burning: false, burnMinutes: 0 },
    data: { quality: 3, ownerId: 'a1', fresh: true, recipeId: null },
    reservedBy: { '0': 'a1' },
    inUseBy: ['a1'],
    rev: 7,
    ...over,
  };
}

/** A small but complete, structurally valid world. `variant` changes content deterministically. */
export function makeWorld(variant = 0): WorldState {
  const width = 12;
  const depth = 10;
  const floors: (string | null)[] = new Array(width * depth).fill(null);
  for (let z = 2; z < 7; z++) for (let x = 2; x < 9; x++) floors[z * width + x] = 'floor_planks_oak';
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    seed: 1337 + variant,
    rng: { a: 0x9e3779b9, b: 0x243f6a88, c: 0xb7e15162 + variant, d: 0x3c6ef372 },
    tick: 1234 + variant * 7,
    nextId: 100,
    household: {
      name: variant % 2 === 0 ? 'The Rotworths' : 'Família Ñoño',
      funds: 1500 + variant,
      memberIds: ['a1', 'a2'],
      bills: [{ id: 'bill-1', issuedTick: 100, dueTick: 5860, amount: 120, paidTick: null, stage: 1 }],
      utilitiesOn: true,
      repoDispatchedDay: null,
      txLog: ['tx:buy:o7', 'tx:wage:a1:4'],
    },
    lot: {
      width,
      depth,
      buildable: { x0: 1, z0: 1, x1: 11, z1: 8 },
      sidewalkZ: 9,
      entryPoints: [
        { x: 0.5, z: 9.5 },
        { x: 11.5, z: 9.5 },
      ],
      walls: {
        'h:2:2': { paint: ['wall_plaster_bone', 'wall_exterior_siding'], openingId: null },
        'v:2:2': { paint: ['wall_plaster_bone', 'wall_plaster_bone'], openingId: 'o9' },
      },
      floors,
      version: 3,
      wallVersion: 2,
      floorVersion: 1,
    },
    agents: {
      a1: makeAgent('a1'),
      a2: makeAgent('a2', { firstName: 'Ghoulia', career: null, active: null, queue: [], path: null, pathIndex: 0, anim: 'idle' }),
      a3: makeAgent('a3', {
        role: 'townie',
        presence: 'offLot',
        firstName: 'Townie',
        career: null,
        active: null,
        queue: [],
        path: null,
        pathIndex: 0,
        occupation: 'Gravedigger',
        visit: { arrivedTick: 10, leaveTick: 20, reason: 'walkBy', welcomed: false, leaving: true },
      }),
    },
    objects: {
      o7: makeObject('o7', { defId: 'fridge_basic', placement: { kind: 'floor', x: 2, z: 2, rot: 0 }, reservedBy: {}, inUseBy: [] }),
      o8: makeObject('o8'),
      o9: makeObject('o9', { defId: 'door_wood', placement: { kind: 'opening', edge: 'v:2:2' }, tint: null, reservedBy: {}, inUseBy: [] }),
      o10: makeObject('o10', {
        defId: 'plate_meal',
        placement: { kind: 'loose', x: 3.2, z: 4.1, y: 0.76, parentId: 'o8', surfaceIndex: 0, facing: 0.5 },
        data: { servings: 2, quality: 0.8 },
        reservedBy: {},
        inUseBy: [],
      }),
    },
    relationships: {
      'a1|a2': {
        a: 'a1',
        b: 'a2',
        friendship: 55,
        romance: 30,
        met: true,
        partners: true,
        engaged: false,
        married: false,
        bestFriends: false,
        lastInteractionTick: 1200,
        interactions: 14,
      },
    },
    notifications: [
      { id: 50, tick: 1000, kind: 'money', title: 'Paycheck', text: 'Mort earned $120 — "nice".', agentId: 'a1', objectId: null, read: false },
    ],
    choices: [
      {
        id: 'choice-1',
        tick: 1200,
        title: 'Work event',
        text: 'Your boss wants a favour.',
        agentId: 'a1',
        options: [
          { label: 'Sure', effect: 'careerPerf', params: { amount: 5 }, tooltip: null },
          { label: 'No', effect: 'careerPerf', params: { amount: -5 }, tooltip: 'Risky' },
        ],
        expiresTick: 2000,
        defaultOption: 1,
      },
    ],
    party: null,
    flags: { fullMoonDay: 7, introDone: true, weather: 'fog' },
    stats: { counters: { mealsCooked: 3 + variant }, agent: { a1: { mealsCooked: 3 } } },
    settings: { autonomy: 'full', difficulty: 'normal', visitorsEnabled: true },
    gameOver: false,
  };
}

export function makeMeta(over: Partial<SaveMeta> = {}): SaveMeta {
  return {
    householdName: 'The Rotworths',
    memberNames: ['Mort Ician', 'Ghoulia Ician'],
    day: 5,
    timeLabel: 'Tue 08:15',
    funds: 1500,
    lotValue: 23000,
    thumbnail: null,
    ...over,
  };
}

export const silentLogger = { warn: () => undefined, error: () => undefined };

export type Op = 'read' | 'write' | 'remove' | 'list';
export interface FaultSpec {
  /** Fail the N-th (0-based) call matching `op` (and `keyIncludes`, if given). */
  op: Op;
  nth: number;
  keyIncludes?: string;
  /** 'before': throw without applying. 'after': apply, then throw. 'torn': store truncated bytes, then throw. */
  mode: 'before' | 'after' | 'torn';
  error?: () => unknown;
}

/** Memory backend wrapper with fault injection and an operation log. */
export class FaultyBackend implements StorageBackend {
  readonly id = 'memory' as const;
  readonly durable = true;
  readonly inner: MemoryBackend;
  readonly log: string[] = [];
  faults: FaultSpec[] = [];
  /** Fail the N-th operation (any kind) counted from the moment this is set. */
  failAt: { index: number; mode: FaultSpec['mode']; error?: () => unknown } | null = null;
  private opCount = 0;
  private counters = new Map<string, number>();

  arm(index: number, mode: FaultSpec['mode'], error?: () => unknown): void {
    this.failAt = { index, mode, error };
    this.opCount = 0;
  }
  active = 0;
  maxActive = 0;
  delayMs = 0;

  constructor(inner?: MemoryBackend) {
    this.inner = inner ?? createMemoryBackend();
  }

  private async gate(op: Op, key: string, apply: () => Promise<void>, data?: Uint8Array): Promise<void> {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
      this.log.push(`${op} ${key}`);
      const g = this.failAt;
      if (g && this.opCount++ === g.index) {
        this.failAt = null;
        const err = g.error ? g.error() : new Error(`injected ${g.mode} crash on ${op} ${key}`);
        if (g.mode === 'after') await apply();
        if (g.mode === 'torn' && data) await this.inner.write(key, data.slice(0, Math.floor(data.length / 2)));
        throw err;
      }
      for (const f of this.faults) {
        if (f.op !== op || (f.keyIncludes && !key.includes(f.keyIncludes))) continue;
        const ck = `${f.op}|${f.keyIncludes ?? ''}|${f.nth}`;
        const n = this.counters.get(ck) ?? 0;
        this.counters.set(ck, n + 1);
        if (n !== f.nth) continue;
        const err = f.error ? f.error() : new Error(`injected ${f.mode} fault on ${op} ${key}`);
        if (f.mode === 'after') await apply();
        if (f.mode === 'torn' && data) await this.inner.write(key, data.slice(0, Math.floor(data.length / 2)));
        throw err;
      }
      await apply();
    } finally {
      this.active--;
    }
  }

  async available() {
    return true;
  }
  async read(key: string) {
    let out: Uint8Array | null = null;
    await this.gate('read', key, async () => {
      out = await this.inner.read(key);
    });
    return out;
  }
  async write(key: string, data: Uint8Array) {
    await this.gate('write', key, () => this.inner.write(key, data), data);
  }
  async remove(key: string) {
    await this.gate('remove', key, () => this.inner.remove(key));
  }
  async list(prefix: string) {
    let out: string[] = [];
    await this.gate('list', prefix, async () => {
      out = await this.inner.list(prefix);
    });
    return out;
  }
  async quota() {
    return null;
  }
}

export function quotaError(): DOMException {
  return new DOMException('The quota has been exceeded.', 'QuotaExceededError');
}

export function storageQuotaError(): StorageError {
  return new StorageError('quota', 'disk full');
}

/** Deterministic PRNG for adversarial tests (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
