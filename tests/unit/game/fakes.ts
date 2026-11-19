/**
 * Test doubles for the GAME module: a manual-clock environment, recording renderer/audio fakes, an in-memory
 * SaveManager with gates/failure injection, a raw ProfileStore, and a small but contract-complete fake simulation.
 */
import { Vector3 } from 'three';
import type { GameEnv, TimerHandle } from '../../../src/game/env';
import type { CameraState, PickResult, PlacementGhost, BuildOverlay, PreviewStage, RendererAPI, QualityLevel, ViewMode, WallMode } from '../../../src/render/contracts';
import type { AudioAPI, AudioVolumes, SpatialHint } from '../../../src/audio/contracts';
import type { LoadResult, NativeBridge, ProfileStore, SaveManager, SaveMeta, SaveResult, SaveSlotInfo, StorageBackend } from '../../../src/persistence/contracts';
import type {
  BuildCommand,
  BuildPreview,
  BuildService,
  Command,
  CommandResult,
  ContentRegistry,
  InteractionDef,
  LotTemplate,
  MenuEntry,
  NewGameOptions,
  ObjectDef,
  PlacementResult,
  SimEvent,
  SimulationAPI,
  SpatialAPI,
  TimeInfo,
} from '../../../src/sim/contracts';
import type { AgentState, ObjectState, WorldState, Vec2 } from '../../../src/sim/types';
import { NEED_IDS, SAVE_SCHEMA_VERSION, SKILL_IDS } from '../../../src/sim/types';
import { timeInfo } from '../../../src/sim/time';
import { defaultAppearance, intactLimbs } from '../../../src/shared/appearance';
import { PHYSICAL_BY_ID } from '../../../src/shared/catalog';
import type { SimModule } from '../../../src/game/simTypes';
import { GDD_ASPIRATIONS, GDD_TRAITS, FALLBACK_FIRST_NAMES, FALLBACK_LAST_NAMES } from '../../../src/game/gddCatalog';

// ───────────────────────────── environment ─────────────────────────────

interface Timer {
  id: number;
  at: number;
  cb: () => void;
  every: number | null;
}

export class FakeEnv implements GameEnv {
  t = 1000;
  wall = Date.UTC(2026, 10, 5, 12, 0, 0);
  readonly frames = new Map<number, (t: number) => void>();
  private nextFrameId = 1;
  private timers: Timer[] = [];
  private nextTimerId = 1;
  randoms: number[] = [];
  private seq = 0x9e3779b9;
  window: Window | null = null;
  document: Document | null = null;
  size = { width: 1280, height: 720 };
  downloads: { filename: string; data: Uint8Array; mime: string }[] = [];
  nativeBridge: NativeBridge | null = null;
  rafEnabled = true;
  reducedMotion = false;
  reencode: ((dataUrl: string, quality: number) => Promise<string | null>) | null = null;

  now(): number {
    return this.t;
  }
  wallNow(): number {
    return this.wall;
  }
  requestFrame(cb: (t: number) => void): number | null {
    if (!this.rafEnabled) return null;
    const id = this.nextFrameId++;
    this.frames.set(id, cb);
    return id;
  }
  cancelFrame(id: number): void {
    this.frames.delete(id);
  }
  setTimeout(cb: () => void, ms: number): TimerHandle {
    const id = this.nextTimerId++;
    this.timers.push({ id, at: this.t + Math.max(0, ms || 0), cb, every: null });
    return id;
  }
  clearTimeout(h: TimerHandle): void {
    this.timers = this.timers.filter((t) => t.id !== h);
  }
  setInterval(cb: () => void, ms: number): TimerHandle {
    const id = this.nextTimerId++;
    this.timers.push({ id, at: this.t + Math.max(1, ms || 1), cb, every: Math.max(1, ms || 1) });
    return id;
  }
  clearInterval(h: TimerHandle): void {
    this.clearTimeout(h);
  }
  randomU32(): number {
    const q = this.randoms.shift();
    if (q !== undefined) return q >>> 0;
    this.seq = (Math.imul(this.seq, 1664525) + 1013904223) >>> 0;
    return this.seq;
  }
  viewport(): { width: number; height: number } {
    return { ...this.size };
  }
  devicePixelRatio(): number {
    return 1.5;
  }
  userAgent(): string {
    return 'vitest-fake-agent';
  }
  native(): NativeBridge | null {
    return this.nativeBridge;
  }
  download(filename: string, data: Uint8Array, mime: string): boolean {
    this.downloads.push({ filename, data, mime });
    return true;
  }
  async reencodeJpeg(dataUrl: string, quality: number): Promise<string | null> {
    return this.reencode ? this.reencode(dataUrl, quality) : null;
  }
  prefersReducedMotion(): boolean {
    return this.reducedMotion;
  }

  get pendingTimers(): number {
    return this.timers.length;
  }

  /** Advance the clock, firing due timers in time order. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (let guard = 0; guard < 100_000; guard++) {
      const due = this.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.t = Math.max(this.t, due.at);
      if (due.every !== null) due.at += due.every;
      else this.timers = this.timers.filter((t) => t !== due);
      due.cb();
    }
    this.t = end;
    this.wall += ms;
  }

  /** Advance by `ms` and run every animation-frame callback that was pending. */
  frame(ms = 16): void {
    this.advance(ms);
    const cbs = Array.from(this.frames.entries());
    this.frames.clear();
    for (const [, cb] of cbs) cb(this.t);
  }
}

/** Let pending promise chains settle. */
export async function flush(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

// ───────────────────────────── renderer / audio ─────────────────────────────

export interface Call {
  name: string;
  args: unknown[];
}

export class FakeRenderer implements RendererAPI {
  calls: Call[] = [];
  progress = 1;
  attached: SimulationAPI | null = null;
  pickResult: PickResult = { kind: 'none' };
  pickFn: ((x: number, y: number, opts?: { agents?: boolean; objects?: boolean; walls?: boolean; tiles?: boolean }) => PickResult) | null = null;
  gridResult: ReturnType<RendererAPI['pickGrid']> = null;
  camera: CameraState = { target: { x: 15, z: 15 }, yaw: 0, distance: 14, pitch: 0.7 };
  failInit = false;
  failFrame = false;
  snapshotValue = 'data:image/png;base64,AAAA';
  ghost: PlacementGhost | null = null;
  overlay: BuildOverlay | null = null;
  hidden: string | null = null;
  consumed: SimEvent[][] = [];
  previewsCreated = 0;
  frameCount = 0;

  private rec(name: string, args: unknown[]): void {
    this.calls.push({ name, args });
  }
  count(name: string): number {
    return this.calls.filter((c) => c.name === name).length;
  }
  last(name: string): Call | undefined {
    for (let i = this.calls.length - 1; i >= 0; i--) if (this.calls[i].name === name) return this.calls[i];
    return undefined;
  }

  async init(canvas: HTMLCanvasElement, opts: { quality: QualityLevel; pixelRatio: number }): Promise<void> {
    this.rec('init', [canvas, opts]);
    if (this.failInit) throw new Error('WebGL unavailable');
  }
  loadProgress(): number {
    return this.progress;
  }
  attach(sim: SimulationAPI | null): void {
    this.rec('attach', [sim]);
    this.attached = sim;
  }
  frame(alpha: number, dt: number): void {
    this.rec('frame', [alpha, dt]);
    this.frameCount++;
    if (this.failFrame) throw new Error('context lost');
  }
  consumeEvents(events: SimEvent[]): void {
    this.consumed.push(events.slice());
  }
  resize(w: number, h: number): void {
    this.rec('resize', [w, h]);
  }
  setPixelRatio(r: number): void {
    this.rec('setPixelRatio', [r]);
  }
  setQuality(q: QualityLevel): void {
    this.rec('setQuality', [q]);
  }
  setReduceMotion(on: boolean): void {
    this.rec('setReduceMotion', [on]);
  }
  /** W-136: what the fake renderer is showing; `drawable` = agents it can attach a close view to (null = any). */
  perspective: 'overview' | 'shoulder' | 'firstPerson' = 'overview';
  perspectiveAgent: string | null = null;
  drawable: Set<string> | null = null;
  setPerspective(mode: 'overview' | 'shoulder' | 'firstPerson', agentId: string | null, instant?: boolean): 'overview' | 'shoulder' | 'firstPerson' {
    this.rec('setPerspective', [mode, agentId, instant]);
    const ok = mode !== 'overview' && typeof agentId === 'string' && (this.drawable === null || this.drawable.has(agentId));
    this.perspective = ok ? mode : 'overview';
    this.perspectiveAgent = ok ? agentId : null;
    return this.perspective;
  }
  getPerspective(): 'overview' | 'shoulder' | 'firstPerson' {
    return this.perspective;
  }
  setViewMode(m: ViewMode): void {
    this.rec('setViewMode', [m]);
  }
  setWallMode(m: WallMode): void {
    this.rec('setWallMode', [m]);
  }
  getWallMode(): WallMode {
    return 'cutaway';
  }
  rotateCamera(steps: number): void {
    this.rec('rotateCamera', [steps]);
  }
  orbit(dy: number, dp: number): void {
    this.rec('orbit', [dy, dp]);
  }
  zoom(d: number): void {
    this.rec('zoom', [d]);
  }
  pan(dx: number, dy: number): void {
    this.rec('pan', [dx, dy]);
  }
  panWorld(dx: number, dz: number): void {
    this.rec('panWorld', [dx, dz]);
  }
  focus(target: Vec2 | string, instant?: boolean): void {
    this.rec('focus', [target, instant]);
  }
  follow(id: string | null): void {
    this.rec('follow', [id]);
  }
  getCamera(): CameraState {
    return { ...this.camera, target: { ...this.camera.target } };
  }
  setCamera(state: Partial<CameraState>, instant?: boolean): void {
    this.rec('setCamera', [state, instant]);
  }
  pick(x: number, y: number, opts?: { agents?: boolean; objects?: boolean; walls?: boolean; tiles?: boolean }): PickResult {
    this.rec('pick', [x, y, opts]);
    return this.pickFn ? this.pickFn(x, y, opts) : this.pickResult;
  }
  pickGrid(x: number, y: number): ReturnType<RendererAPI['pickGrid']> {
    this.rec('pickGrid', [x, y]);
    return this.gridResult;
  }
  worldToScreen(x: number, _y: number, z: number): { x: number; y: number; visible: boolean } {
    return { x: 640 + (x - this.camera.target.x) * 40, y: 360 + (z - this.camera.target.z) * 20, visible: Math.abs(x - this.camera.target.x) < 16 };
  }
  bubbleAnchors() {
    return [];
  }
  setSelection(id: string | null): void {
    this.rec('setSelection', [id]);
  }
  setHover(t: unknown): void {
    this.rec('setHover', [t]);
  }
  setPlacementGhost(g: PlacementGhost | null): void {
    this.rec('setPlacementGhost', [g]);
    this.ghost = g;
  }
  setBuildOverlay(o: BuildOverlay | null): void {
    this.rec('setBuildOverlay', [o]);
    this.overlay = o;
  }
  setHiddenObject(id: string | null): void {
    this.rec('setHiddenObject', [id]);
    this.hidden = id;
  }
  async thumbnail(): Promise<string> {
    return 'data:image/png;base64,AA';
  }
  createPreview(): PreviewStage {
    this.previewsCreated++;
    const self = this;
    return {
      setAppearance: (a) => self.rec('preview.setAppearance', [a]),
      setLimbs: () => undefined,
      setAnim: () => undefined,
      setExpression: () => undefined,
      setYaw: () => undefined,
      resize: () => undefined,
      dispose: () => self.rec('preview.dispose', []),
    };
  }
  snapshot(w: number, h: number): string {
    this.rec('snapshot', [w, h]);
    return this.snapshotValue;
  }
  fps(): number {
    return 59.6;
  }
  dispose(): void {}
}

export class FakeAudio implements AudioAPI {
  calls: Call[] = [];
  unlocked = false;
  private vol: AudioVolumes = { master: 1, music: 1, sfx: 1, voice: 1, ambient: 1, ui: 1 };
  private rec(name: string, args: unknown[]): void {
    this.calls.push({ name, args });
  }
  named(name: string): Call[] {
    return this.calls.filter((c) => c.name === name);
  }
  sfxIds(): string[] {
    return this.named('sfx').map((c) => c.args[0] as string);
  }
  async unlock(): Promise<void> {
    this.unlocked = true;
  }
  setVolumes(v: Partial<AudioVolumes>): void {
    this.rec('setVolumes', [v]);
    this.vol = { ...this.vol, ...v };
  }
  getVolumes(): AudioVolumes {
    return { ...this.vol };
  }
  setMuted(m: boolean): void {
    this.rec('setMuted', [m]);
  }
  setDucked(d: boolean): void {
    this.rec('setDucked', [d]);
  }
  sfx(id: string, opts?: { spatial?: SpatialHint; pitch?: number; volume?: number }): void {
    this.rec('sfx', [id, opts]);
  }
  loop(key: string, id: string, on: boolean, spatial?: SpatialHint): void {
    this.rec('loop', [key, id, on, spatial]);
  }
  stopAllLoops(): void {
    this.rec('stopAllLoops', []);
  }
  voice(seed: number, pitch: number, emotion: string, ms: number, spatial?: SpatialHint): void {
    this.rec('voice', [seed, pitch, emotion, ms, spatial]);
  }
  music(mood: string): void {
    this.rec('music', [mood]);
  }
  setGameSpeed(s: number): void {
    this.rec('setGameSpeed', [s]);
  }
  setAmbience(o: { night: boolean; indoor: boolean }): void {
    this.rec('setAmbience', [o]);
  }
  dispose(): void {}
}

// ───────────────────────────── persistence ─────────────────────────────

/** SaveManager.save options exactly as the contract declares them (autosave, playMinutes, waitForLock). */
export type SaveOpts = NonNullable<Parameters<SaveManager['save']>[4]>;

export class FakeSaves implements SaveManager {
  backend: StorageBackend = {
    id: 'memory',
    durable: true,
    available: async () => true,
    read: async () => null,
    write: async () => undefined,
    remove: async () => undefined,
    list: async () => [],
    quota: async () => null,
  };
  slots = new Map<string, { world: WorldState; info: SaveSlotInfo; migrated?: string[] }>();
  saveCalls: { slotId: string; name: string; meta: SaveMeta; opts?: SaveOpts; tick: number }[] = [];
  concurrent = 0;
  maxConcurrent = 0;
  failSaves = 0;
  /** The next N save() calls never settle (hung storage). */
  hangSaves = 0;
  throwOnSave = false;
  loadOverride: ((slotId: string) => LoadResult) | null = null;
  private gate: Promise<void> | null = null;
  private release: (() => void) | null = null;
  now = 0;

  hold(): () => void {
    this.gate = new Promise((r) => (this.release = r));
    return () => {
      const r = this.release;
      this.gate = null;
      this.release = null;
      r?.();
    };
  }

  async listSlots(): Promise<SaveSlotInfo[]> {
    return Array.from(this.slots.values()).map((s) => s.info);
  }
  async save(slotId: string, name: string, world: WorldState, meta: SaveMeta, opts?: SaveOpts): Promise<SaveResult> {
    this.concurrent++;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent);
    try {
      this.saveCalls.push({ slotId, name, meta, opts, tick: world.tick });
      if (this.hangSaves > 0) {
        this.hangSaves--;
        await new Promise<never>(() => undefined);
      }
      if (this.gate) await this.gate;
      if (this.throwOnSave) throw new Error('disk exploded');
      if (this.failSaves > 0) {
        this.failSaves--;
        return { ok: false, error: 'Disk full', code: 'quota' };
      }
      const info: SaveSlotInfo = {
        slotId,
        name,
        savedAt: new Date(Date.UTC(2026, 10, 5, 12, 0, 0) + this.now++ * 1000).toISOString(),
        createdAt: new Date(Date.UTC(2026, 10, 5)).toISOString(),
        playMinutes: opts?.playMinutes ?? 0,
        meta,
        isAutosave: opts?.autosave === true,
        recoveredFromBackup: false,
        bytes: 100,
      };
      this.slots.set(slotId, { world: JSON.parse(JSON.stringify(world)) as WorldState, info });
      return { ok: true, info };
    } finally {
      this.concurrent--;
    }
  }
  async load(slotId: string): Promise<LoadResult> {
    if (this.loadOverride) return this.loadOverride(slotId);
    const s = this.slots.get(slotId);
    if (!s) return { ok: false, error: 'Save not found', code: 'not_found' };
    return { ok: true, world: JSON.parse(JSON.stringify(s.world)) as WorldState, info: { ...s.info }, warnings: [], ...(s.migrated ? { migrated: [...s.migrated] } : {}) };
  }
  async remove(slotId: string): Promise<void> {
    this.slots.delete(slotId);
  }
  async exportSlot(slotId: string): Promise<{ filename: string; data: Uint8Array } | null> {
    const s = this.slots.get(slotId);
    return s ? { filename: `CON.json`, data: new TextEncoder().encode(JSON.stringify(s.world)) } : null;
  }
  async importFile(data: Uint8Array): Promise<LoadResult & { slotId?: string }> {
    try {
      const world = JSON.parse(new TextDecoder().decode(data)) as WorldState;
      const meta: SaveMeta = { householdName: 'Imported', memberNames: [], day: 1, timeLabel: '', funds: 0, lotValue: 0, thumbnail: null };
      const r = await this.save('import-1', 'Imported', world, meta);
      if (!r.ok) return { ok: false, error: r.error, code: 'io' };
      return { ok: true, world, info: r.info, warnings: [], slotId: 'import-1' };
    } catch {
      return { ok: false, error: 'Corrupt file', code: 'corrupt' };
    }
  }
  async latest(): Promise<SaveSlotInfo | null> {
    const all = await this.listSlots();
    return all.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))[0] ?? null;
  }
}

export class FakeProfile implements ProfileStore {
  data = new Map<string, unknown>();
  saves: { key: string; value: unknown }[] = [];
  failLoad = false;
  async load<T>(key: string, fallback: T): Promise<T> {
    if (this.failLoad) throw new Error('profile unreadable');
    return this.data.has(key) ? (this.data.get(key) as T) : fallback;
  }
  async save<T>(key: string, value: T): Promise<void> {
    this.saves.push({ key, value });
    this.data.set(key, value);
  }
}

// ───────────────────────────── simulation ─────────────────────────────

export function makeAgent(id: string, firstName: string, over: Partial<AgentState> = {}): AgentState {
  const needs = Object.fromEntries(NEED_IDS.map((n) => [n, 80])) as AgentState['needs'];
  const skills = Object.fromEntries(SKILL_IDS.map((s) => [s, { level: 0, xp: 0 }])) as AgentState['skills'];
  return {
    id,
    role: 'household',
    presence: 'onLot',
    firstName,
    lastName: 'Rotwell',
    appearance: defaultAppearance(),
    traits: ['cheerful', 'clumsy', 'vain'],
    rewardTraits: [],
    aspiration: 'tycoon',
    aspirationMilestones: [],
    aspirationPoints: 0,
    needs,
    vitality: 100,
    moodlets: [],
    skills,
    career: null,
    limbs: intactLimbs(),
    pos: { x: 10.5, z: 10.5 },
    prevPos: { x: 10.5, z: 10.5 },
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
    voiceSeed: 4242,
    createdTick: 0,
    occupation: null,
    ...over,
  };
}

export function makeObject(id: string, defId: string, over: Partial<ObjectState> = {}): ObjectState {
  return {
    id,
    defId,
    placement: { kind: 'floor', x: 5, z: 5, rot: 0 },
    value: 100,
    purchasedTick: 0,
    tint: null,
    condition: { broken: false, dirt: 0, burning: false, burnMinutes: 0 },
    data: {},
    reservedBy: {},
    inUseBy: [],
    rev: 0,
    ...over,
  };
}

export function makeWorld(opts: { seed?: number; householdName?: string; members?: string[] } = {}): WorldState {
  const names = opts.members ?? ['Mortimer', 'Ghoulia'];
  const agents: Record<string, AgentState> = {};
  const memberIds: string[] = [];
  names.forEach((n, i) => {
    const id = `a${i + 1}`;
    agents[id] = makeAgent(id, n, { pos: { x: 10.5 + i, z: 10.5 } });
    memberIds.push(id);
  });
  agents.a99 = makeAgent('a99', 'Visitor', { role: 'townie', visit: { arrivedTick: 0, leaveTick: 999, reason: 'invited', welcomed: true, leaving: false } });
  const width = 30;
  const depth = 30;
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    seed: opts.seed ?? 0xabc,
    rng: { a: 1, b: 2, c: 3, d: 4 },
    tick: 0,
    nextId: 200,
    household: { name: opts.householdName ?? 'Rotwell', funds: 6500, memberIds, bills: [], utilitiesOn: true, repoDispatchedDay: null, txLog: [] },
    lot: {
      width,
      depth,
      buildable: { x0: 1, z0: 1, x1: 29, z1: 27 },
      sidewalkZ: 28,
      entryPoints: [{ x: 0.5, z: 28.5 }],
      walls: { 'h:8:8': { paint: ['wall_plaster_bone', 'wall_exterior_siding'], openingId: null } },
      floors: Array.from({ length: width * depth }, (_, i) => (i === 9 * width + 9 ? 'floor_planks_worn' : null)),
      version: 1,
      wallVersion: 1,
      floorVersion: 1,
    },
    agents,
    objects: { o1: makeObject('o1', 'fridge_humming'), o2: makeObject('o2', 'painting_greatgrand', { placement: { kind: 'wall', edge: 'h:8:8', side: 1 } }) },
    relationships: {},
    notifications: [],
    choices: [],
    party: null,
    flags: {},
    stats: { counters: {}, agent: {} },
    settings: { autonomy: 'full', difficulty: 'normal', visitorsEnabled: true },
    gameOver: false,
  };
}

function objectDef(id: string, interactions: string[] = []): ObjectDef {
  const spec = PHYSICAL_BY_ID[id];
  return { ...spec, interactions, env: 0, depreciation: 0.15, breakChance: 0, sellable: true, params: {} };
}

function phone(id: string, action: string): InteractionDef {
  return { id, label: id, group: 'Phone', icon: 'phone', targetKind: 'self', tags: ['phone'], params: { action } };
}

export function makeContent(): ContentRegistry {
  const interactions: Record<string, InteractionDef> = {
    engine_goHere: { id: 'engine_goHere', label: 'Go Here', icon: 'house', targetKind: 'tile' },
    home_fridge_snack: { id: 'home_fridge_snack', label: 'Grab Brain Jerky', icon: 'fridge', targetKind: 'object' },
    phone_orderPizza: phone('phone_orderPizza', 'pizza'),
    phone_inviteOver: phone('phone_inviteOver', 'invite'),
    phone_findJob: phone('phone_findJob', 'findJob'),
    social_chat: { id: 'social_chat', label: 'Chat', icon: 'chat', targetKind: 'agent' },
  };
  const traits = Object.fromEntries(
    GDD_TRAITS.map((t) => [t.id, { id: t.id, name: t.name, description: t.description, icon: 'star' as const, conflicts: t.conflicts.slice(), reward: false }]),
  );
  traits.wellPreserved = { id: 'wellPreserved', name: 'Well Preserved', description: '', icon: 'star', conflicts: [], reward: true };
  const aspirations = Object.fromEntries(GDD_ASPIRATIONS.map((a) => [a.id, { id: a.id, name: a.name, description: a.description, icon: 'trophy' as const, milestones: [{ id: 'm1', label: '$5,000 funds', points: 250, condition: { kind: 'x', params: {} } }] }]));
  return {
    objects: {
      fridge_humming: objectDef('fridge_humming', ['home_fridge_snack']),
      chair_creaky: objectDef('chair_creaky'),
      sofa_moldy: objectDef('sofa_moldy'),
      painting_greatgrand: objectDef('painting_greatgrand'),
      door_splintered: objectDef('door_splintered'),
      item_meal: objectDef('item_meal'),
    },
    interactions,
    moodlets: {},
    traits,
    skills: Object.fromEntries(SKILL_IDS.map((s) => [s, { id: s, name: s === 'cooking' ? 'Cooking' : s, description: '', icon: 'star' as const, xpPerLevel: [] as number[] }])) as unknown as ContentRegistry['skills'],
    careers: {},
    aspirations,
    rewards: {},
    recipes: {},
    lifeEvents: [],
    names: { first: FALLBACK_FIRST_NAMES.slice(), last: FALLBACK_LAST_NAMES.slice(), occupations: [] },
    stagesOf: () => [],
  };
}

const OK_PLACE: PlacementResult = { ok: true, tiles: [{ x: 5, z: 5 }], blockedSlots: [], cost: 120 };

export class FakeSim implements SimulationAPI {
  state: WorldState;
  content: ContentRegistry;
  repairWarnings: string[] = [];
  events: SimEvent[] = [];
  dispatched: Command[] = [];
  steps = 0;
  faultList: { tick: number; where: string; message: string }[] = [];
  menuEntries: MenuEntry[] = [{ interactionId: 'home_fridge_snack', label: 'Grab Brain Jerky', group: null, icon: 'fridge', available: true, reason: null, cost: 5, params: {} }];
  menuCalls: { actorId: string; target: unknown }[] = [];
  dispatchImpl: (cmd: Command) => CommandResult = () => ({ ok: true });
  stepImpl: (() => void) | null = null;
  placeResult: PlacementResult = OK_PLACE;
  previewResult: BuildPreview = { ok: true, cost: 45 };
  previews: BuildCommand[] = [];
  undoable = false;
  redoable = false;
  serializeCount = 0;
  billsOverdue = 0;
  billsOutstanding = 0;
  partyActive = false;
  timeOverride: Partial<TimeInfo> = {};

  constructor(world: WorldState, content: ContentRegistry = makeContent()) {
    this.state = world;
    this.content = content;
  }

  readonly spatial: SpatialAPI = {
    width: () => this.state.lot.width,
    depth: () => this.state.lot.depth,
    inBounds: (x, z) => x >= 0 && z >= 0 && x < 30 && z < 30,
    isBuildable: () => true,
    tileIndex: (x, z) => z * 30 + x,
    tileOf: (p) => ({ x: Math.floor(p.x), z: Math.floor(p.z) }),
    isWalkable: () => true,
    canStep: () => true,
    roomAt: () => 1,
    rooms: () => [{ id: 1, indoor: true, tiles: [8 * 30 + 8, 8 * 30 + 9, 9 * 30 + 8, 9 * 30 + 9] }],
    isIndoor: (x, z) => x >= 8 && x <= 9 && z >= 8 && z <= 9,
    distanceField: () => ({ dist: new Float32Array(0), parent: new Int32Array(0), originIndex: 0, version: 0 }),
    findPath: () => null,
    nearestWalkable: () => null,
    objectTiles: () => [],
    objectsAt: () => [],
    resolveSlots: () => [],
    surfacePoints: () => [],
    freeSurfaceNear: () => null,
    objectCenter: (o) => (o.placement.kind === 'floor' ? { x: o.placement.x + 0.5, z: o.placement.z + 0.5 } : { x: 8.5, z: 8 }),
    roomEnvironment: () => 0,
    checkPlace: () => this.placeResult,
    checkWallItem: () => this.placeResult,
    checkOpening: () => this.placeResult,
    invalidate: () => undefined,
  };

  readonly build: BuildService = {
    preview: (cmd) => {
      this.previews.push(cmd);
      // Like the real planner: placement commands run the spatial check first (a throwing check throws here too),
      // then the funds rule (previewResult stands in for it).
      const S = this.spatial;
      let r: PlacementResult | null = null;
      if (cmd.type === 'buy') r = S.checkPlace(cmd.defId, cmd.x, cmd.z, cmd.rot, null);
      else if (cmd.type === 'move') r = S.checkPlace('', cmd.x, cmd.z, cmd.rot, cmd.objectId);
      else if (cmd.type === 'buyWallItem') r = S.checkWallItem(cmd.defId, cmd.edge, cmd.side, null);
      else if (cmd.type === 'moveWallItem') r = S.checkWallItem('', cmd.edge, cmd.side, cmd.objectId);
      else if (cmd.type === 'buyOpening') r = S.checkOpening(cmd.defId, cmd.edge, null);
      else if (cmd.type === 'moveOpening') r = S.checkOpening('', cmd.edge, cmd.objectId);
      if (!r) return this.previewResult;
      if (!r.ok) return { ok: false, reason: r.reason ?? "Can't place here", cost: r.cost, tiles: r.tiles };
      if (!this.previewResult.ok) return { ...this.previewResult, cost: r.cost, tiles: r.tiles };
      return { ok: true, cost: r.cost, tiles: r.tiles, blockedSlots: r.blockedSlots };
    },
    apply: () => ({ ok: true, cost: 0 }),
    undo: () => true,
    redo: () => true,
    canUndo: () => this.undoable,
    canRedo: () => this.redoable,
    clearHistory: () => undefined,
  };

  step(): void {
    this.steps++;
    this.state.tick++;
    this.stepImpl?.();
  }
  dispatch(cmd: Command): CommandResult {
    this.dispatched.push(cmd);
    return this.dispatchImpl(cmd);
  }
  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
  faults() {
    return this.faultList;
  }
  time(): TimeInfo {
    return { ...timeInfo(this.state.tick), ...this.timeOverride };
  }
  agent(id: string) {
    return this.state.agents[id];
  }
  object(id: string) {
    return this.state.objects[id];
  }
  summary(id: string) {
    const a = this.state.agents[id];
    if (!a) return null;
    return {
      id,
      name: `${a.firstName} ${a.lastName}`,
      firstName: a.firstName,
      role: a.role,
      presence: a.presence,
      moodBand: 'fine' as const,
      mood: 0,
      criticalNeed: null,
      activity: a.active ? 'Busy' : null,
      activityIcon: null,
      isVisitor: a.visit !== null,
      appearance: a.appearance,
    };
  }
  household() {
    return this.state.household.memberIds.map((id) => this.summary(id)!).filter(Boolean);
  }
  onLotSummaries() {
    return Object.keys(this.state.agents).map((id) => this.summary(id)!);
  }
  menu(actorId: string, target: unknown): MenuEntry[] {
    this.menuCalls.push({ actorId, target });
    return this.menuEntries;
  }
  queueView() {
    return [];
  }
  needs() {
    return [];
  }
  mood() {
    return { value: 0, band: 'fine' as const, label: 'Fine', contributors: [] };
  }
  moodlets() {
    return [];
  }
  skills() {
    return [];
  }
  career() {
    return null;
  }
  relationships() {
    return [];
  }
  aspiration() {
    return null;
  }
  bills() {
    return { outstanding: this.billsOutstanding, overdue: this.billsOverdue, nextDueLabel: null, utilitiesOn: true, bills: [] };
  }
  objectView(id: string) {
    const o = this.state.objects[id];
    if (!o) return null;
    const def = this.content.objects[o.defId];
    return { id, defId: o.defId, name: def?.name ?? o.defId, description: '', value: o.value, sellValue: Math.round(o.value * 0.85), broken: false, powered: true, inUse: false, detail: null };
  }
  townies() {
    return [];
  }
  careersAvailable() {
    return [];
  }
  party() {
    return this.partyActive ? { active: true, score: 50, endsLabel: 'later', guests: 3 } : null;
  }
  lotValue(): number {
    return 12345.6;
  }
  serialize(): WorldState {
    this.serializeCount++;
    return JSON.parse(JSON.stringify(this.state)) as WorldState;
  }
  checkInvariants(): string[] {
    return [];
  }
}

export const LOTS: LotTemplate[] = [
  { id: 'starter', name: 'Fixer-Upper', description: 'A starter home', startingFunds: 6500 },
  { id: 'empty', name: 'Empty Plot', description: 'Bare dirt', startingFunds: 22000 },
];

export class FakeSimModule implements SimModule {
  worlds: NewGameOptions[] = [];
  sims: FakeSim[] = [];
  failCreateWorld = false;
  failCreateSim = false;
  failContent = false;
  readonly LOT_TEMPLATES = LOTS;
  configure: ((sim: FakeSim) => void) | null = null;

  createNewWorld(opts: NewGameOptions): WorldState {
    this.worlds.push(JSON.parse(JSON.stringify(opts)) as NewGameOptions);
    if (this.failCreateWorld) throw new Error('lot template missing');
    return makeWorld({ seed: opts.seed, householdName: opts.householdName, members: opts.members.map((m) => m.firstName) });
  }
  createSimulation(state: WorldState): SimulationAPI {
    if (this.failCreateSim) throw new Error('corrupt world');
    const sim = new FakeSim(state);
    this.configure?.(sim);
    this.sims.push(sim);
    return sim;
  }
  loadContent(): ContentRegistry {
    if (this.failContent) throw new Error('content broken');
    return makeContent();
  }
}

export function point(x = 0, y = 0, z = 0): Vector3 {
  return new Vector3(x, y, z);
}
