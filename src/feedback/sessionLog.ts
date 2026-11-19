/**
 * Local playtest session log (W-117, docs/systems/session-log.md): what the player DID in one session, as numbers and
 * closed-vocabulary ids, so a playtest yields behavioural data (onboarding funnel, time to first action, stalls,
 * non-productive clicks, purchases, events, performance) to pair with observation and the player's own notes.
 *
 * Privacy by construction (E10+ / COPPA, D-033): every string that enters the log goes through `trailKey` (the W-110
 * EventTrail alphabet [A-Za-z0-9:._-], ≤ 64 chars) and comes from a closed vocabulary — screen / dialog / mode ids,
 * KEYMAP action names, interaction ids, object def ids, quest + step ids, sim event TYPES, fault-barrier locations.
 * The recorder has no API that takes a name, a notification text, a funds reason or anything the player typed, and no
 * persistent identifier: the session id is random per session (platform CSPRNG, never the sim RNG) and lives only as
 * long as the 3-session ring on this device. Times are ms since the session started (monotonic clock) plus the sim
 * tick; the only calendar value is the UTC date.
 *
 * Bounded: a ring of SESSION_EVENTS_MAX raw events (oldest evicted, counted in `dropped`) plus small fixed-size
 * aggregates (funnel, stalls, purchases, counters) that survive eviction, so the summary stays right in long sessions.
 * Pure: no DOM, no storage, no simulation access — src/game/sessionLog.ts feeds it and persists it.
 */
import { trailKey } from './trail';

export const SESSION_FORMAT = 'afterlife-lease-session';
export const SESSION_EVENTS_MAX = 5000;
/** No player input for this long (unpaused, in game) = a stall. */
export const STALL_MS = 60_000;
export const FUNNEL_MAX = 400;
export const LIST_MAX = 100;
/** Distinct keys per counter map (the rest fold into 'other'). */
export const KEYS_MAX = 200;

export const SESSION_KINDS = [
  'start', 'end', 'screen', 'world', 'step.on', 'step.done', 'quest.done', 'first', 'cmd', 'buy', 'build', 'mode',
  'speed', 'dialog', 'key', 'click.none', 'stall.start', 'stall.end', 'auto.ix', 'auto.spend', 'sim', 'hour', 'fps',
  'quality', 'error', 'log', 'ix.fail', 'ix.drop', 'ix.done', 'quest.go', 'job.assign', 'job.done', 'job.blocked',
] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];
const KIND_SET: ReadonlySet<string> = new Set(SESSION_KINDS);

/** One raw event. t = ms since session start; g = sim tick (in game); c = merged repeat count. */
export interface SessionEvent {
  t: number;
  k: SessionKind;
  a?: string;
  n?: number;
  m?: number;
  g?: number;
  c?: number;
}

export interface SessionPlatform {
  segment: 'desktop' | 'phone';
  orient: 'portrait' | 'landscape';
  /** CSS px, e.g. "1280x720". */
  viewport: string;
  dpr: number;
  shell: 'web' | 'desktop';
  touch: boolean;
}

export interface SessionGraphics {
  /** Quality SETTING (auto | low | …). */
  setting: string;
  /** Level being rendered. */
  level: string;
  gpuKind: string;
  ceiling: string;
}

export interface SessionHeader {
  /** Random per session ('S-' + 8 Crockford symbols); not stored anywhere but this log. */
  id: string;
  /** Order within this device's 3-session ring. */
  seq: number;
  /** UTC date only (YYYY-MM-DD). */
  date: string;
  build: string;
  version: string;
  bracket: '13plus' | 'under13';
  platform: SessionPlatform;
  graphics: SessionGraphics;
}

export interface SessionWorld {
  kind: 'new' | 'load';
  lot: string;
  difficulty: string;
  arc: string;
  /** ms since session start. */
  at: number;
}

export interface FunnelStep {
  /** `<questId>.<stepId>`. */
  step: string;
  quest: string;
  arc: string;
  index: number;
  on: number;
  done: number | null;
  /** sim tick when activated / completed. */
  g: number | null;
  gDone: number | null;
}

export interface QuestRecord {
  quest: string;
  arc: string;
  on: number;
  done: number | null;
  bones: number;
}

export interface Stall {
  /** Last input before the stall (ms). */
  from: number;
  /** Detected at (ms). */
  at: number;
  /** Next input (ms), null while still stalled. */
  to: number | null;
  /** Unpaused idle time (ms). */
  idle: number;
}

export interface SpendTotals {
  n: number;
  total: number;
  by: Record<string, { n: number; total: number }>;
}

export interface SessionAggregates {
  clicksNone: { n: number; by: Record<string, number>; at: number[] };
  stalls: Stall[];
  player: SpendTotals;
  sim: SpendTotals;
  refunds: SpendTotals;
  autoIx: Record<string, number>;
  notable: Record<string, number>;
  errors: Record<string, number>;
  fps: { n: number; sum: number; min: number; max: number };
  counts: Record<string, number>;
}

export interface SessionLog {
  format: typeof SESSION_FORMAT;
  v: 1;
  header: SessionHeader;
  world: SessionWorld | null;
  firstAction: { ms: number; type: string } | null;
  funnel: FunnelStep[];
  quests: QuestRecord[];
  agg: SessionAggregates;
  /** ms of the last event (duration). */
  lastT: number;
  endedMs: number | null;
  endReason: string | null;
  /** Raw events evicted from the ring. */
  dropped: number;
  events: SessionEvent[];
}

/** A player command as the recorder sees it: ids and numbers only (the caller maps the sim Command). */
export interface CommandRecord {
  type: 'queue' | 'cancel' | 'buy' | 'sell' | 'move' | 'build' | 'undo' | 'redo' | 'choice' | 'reward' | 'rename' | 'quest' | 'settings' | 'cheat' | 'other';
  ok: boolean;
  /** interaction id / def id / build command type / reward id / quest action. */
  id?: string;
  /** W-131: closed refusal code when ok is false (failureCode of the sim's reason; never the text). */
  code?: string;
  /** Target kind or target object def id. */
  target?: string;
  fundsBefore?: number;
  fundsAfter?: number;
  g?: number;
}

export const SESSION_ID_RE = /^S-[0-9A-HJKMNP-TV-Z]{8}$/;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SAFE = /^[A-Za-z0-9._:+x-]{0,40}$/;

/** Fresh random session id from 32-bit random words (platform CSPRNG). */
export function newSessionId(randomU32: () => number): string {
  let out = 'S-';
  for (let half = 0; half < 2; half++) {
    let n = randomU32() >>> 0;
    for (let i = 0; i < 4; i++) {
      out += CROCKFORD[n & 31];
      n >>>= 5;
    }
  }
  return out;
}

/** A CSPRNG uint32 independent of the game environment (so recording never shifts the game's random stream). */
export function cryptoU32(): number {
  try {
    const a = new Uint32Array(1);
    globalThis.crypto.getRandomValues(a);
    return a[0] >>> 0;
  } catch {
    return (Math.random() * 0x1_0000_0000) >>> 0;
  }
}

/** Closed-vocabulary value: the trail alphabet, no kind prefix. */
export function sessionKey(v: unknown): string {
  return trailKey('x', v).slice(2);
}

function safeShort(v: unknown, fallback = 'unknown'): string {
  return typeof v === 'string' && SAFE.test(v) && v.length > 0 ? v : fallback;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined;
}

export function utcDate(ms: number): string {
  try {
    return new Date(ms).toISOString().slice(0, 10);
  } catch {
    return '1970-01-01';
  }
}

export function sanitizeHeader(h: Partial<SessionHeader> & { platform?: Partial<SessionPlatform>; graphics?: Partial<SessionGraphics> }): SessionHeader {
  const p: Partial<SessionPlatform> = h.platform ?? {};
  const g: Partial<SessionGraphics> = h.graphics ?? {};
  return {
    id: typeof h.id === 'string' && SESSION_ID_RE.test(h.id) ? h.id : 'S-00000000',
    seq: num(h.seq) ?? 0,
    date: typeof h.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(h.date) ? h.date : '1970-01-01',
    build: safeShort(h.build, 'dev'),
    version: safeShort(h.version),
    bracket: h.bracket === '13plus' ? '13plus' : 'under13',
    platform: {
      segment: p.segment === 'phone' ? 'phone' : 'desktop',
      orient: p.orient === 'portrait' ? 'portrait' : 'landscape',
      viewport: typeof p.viewport === 'string' && /^\d{1,5}x\d{1,5}$/.test(p.viewport) ? p.viewport : '0x0',
      dpr: typeof p.dpr === 'number' && Number.isFinite(p.dpr) ? Math.round(p.dpr * 100) / 100 : 1,
      shell: p.shell === 'desktop' ? 'desktop' : 'web',
      touch: p.touch === true,
    },
    graphics: { setting: safeShort(g.setting), level: safeShort(g.level), gpuKind: safeShort(g.gpuKind), ceiling: safeShort(g.ceiling) },
  };
}

function emptyTotals(): SpendTotals {
  return { n: 0, total: 0, by: {} };
}

export function emptyAggregates(): SessionAggregates {
  return {
    clicksNone: { n: 0, by: {}, at: [] },
    stalls: [],
    player: emptyTotals(),
    sim: emptyTotals(),
    refunds: emptyTotals(),
    autoIx: {},
    notable: {},
    errors: {},
    fps: { n: 0, sum: 0, min: 0, max: 0 },
    counts: {},
  };
}

function bump(map: Record<string, number>, key: string, by = 1): void {
  const k = Object.prototype.hasOwnProperty.call(map, key) || Object.keys(map).length < KEYS_MAX ? key : 'other';
  map[k] = Math.min(1e9, (map[k] ?? 0) + by);
}

function addSpend(t: SpendTotals, key: string, amount: number): void {
  const a = Math.max(0, Math.round(amount));
  t.n++;
  t.total += a;
  const k = Object.prototype.hasOwnProperty.call(t.by, key) || Object.keys(t.by).length < KEYS_MAX ? key : 'other';
  const e = (t.by[k] ??= { n: 0, total: 0 });
  e.n++;
  e.total += a;
}

/** Kinds whose consecutive identical events merge into one with a count (noise kinds). */
const MERGED: ReadonlySet<SessionKind> = new Set<SessionKind>(['sim', 'error', 'auto.ix', 'key']);

export class SessionRecorder {
  private readonly start: number;
  private readonly events: SessionEvent[] = [];
  private dropped = 0;
  private lastT = 0;
  private world: SessionWorld | null = null;
  private firstAction: { ms: number; type: string } | null = null;
  private readonly funnel: FunnelStep[] = [];
  private readonly quests: QuestRecord[] = [];
  private readonly agg = emptyAggregates();
  private endedMs: number | null = null;
  private endReason: string | null = null;
  private idle = 0;
  private lastInputT = 0;
  private stalled: Stall | null = null;
  readonly header: SessionHeader;
  /** Bumped on every change (the persister writes only when it moved). */
  revision = 0;

  constructor(
    header: Partial<SessionHeader>,
    private readonly now: () => number,
    private readonly capacity = SESSION_EVENTS_MAX,
  ) {
    this.header = sanitizeHeader(header);
    this.start = now();
  }

  get id(): string {
    return this.header.id;
  }

  get ended(): boolean {
    return this.endedMs !== null;
  }

  get hasWorld(): boolean {
    return this.world !== null;
  }

  get eventCount(): number {
    return this.events.length;
  }

  /** ms since the session started. */
  elapsed(): number {
    return Math.max(0, Math.round(this.now() - this.start));
  }

  push(k: SessionKind, a?: unknown, n?: number, m?: number, g?: number): void {
    if (this.endedMs !== null || !KIND_SET.has(k)) return;
    const t = this.elapsed();
    this.lastT = t;
    this.revision++;
    const key = a === undefined ? undefined : sessionKey(a);
    const nn = num(n);
    const mm = num(m);
    const gg = num(g);
    const last = this.events[this.events.length - 1];
    if (MERGED.has(k) && last && last.k === k && last.a === key && nn === undefined && last.n === undefined) {
      last.c = Math.min(1e6, (last.c ?? 1) + 1);
      last.t = t;
      if (gg !== undefined) last.g = gg;
      return;
    }
    const e: SessionEvent = { t, k };
    if (key !== undefined) e.a = key;
    if (nn !== undefined) e.n = nn;
    if (mm !== undefined) e.m = mm;
    if (gg !== undefined) e.g = gg;
    this.events.push(e);
    if (this.events.length > this.capacity) {
      const over = this.events.length - this.capacity;
      this.events.splice(0, over);
      this.dropped += over;
    }
  }

  private count(key: string): void {
    bump(this.agg.counts, sessionKey(key));
  }

  /** Taps the W-110 EventTrail (screen / mode / speed / dialog / key / error / close …). */
  trail(kind: string, value: string): void {
    switch (kind) {
      case 'screen':
      case 'mode':
      case 'speed':
      case 'dialog':
      case 'key':
        this.push(kind, value);
        this.count(`${kind}:${value}`);
        return;
      case 'error':
        this.push('error', value);
        bump(this.agg.errors, sessionKey(value));
        return;
      case 'feedback':
        this.push('log', `feedback.${value}`);
        return;
      default:
        return;
    }
  }

  setWorld(w: Omit<SessionWorld, 'at'>): void {
    this.world = { kind: w.kind === 'load' ? 'load' : 'new', lot: sessionKey(w.lot), difficulty: sessionKey(w.difficulty), arc: sessionKey(w.arc), at: this.elapsed() };
    this.push('world', `${this.world.kind}:${this.world.lot}`, undefined, undefined, undefined);
    this.revision++;
  }

  command(c: CommandRecord): void {
    const id = c.id === undefined ? undefined : sessionKey(c.id);
    const before = num(c.fundsBefore);
    const after = num(c.fundsAfter);
    const delta = before !== undefined && after !== undefined ? before - after : 0; // > 0 = money spent
    const g = num(c.g);
    const ok = c.ok === true;
    this.input();
    switch (c.type) {
      case 'buy':
        this.push('buy', `${ok ? 'place' : 'refused'}:${id ?? 'none'}`, delta, after, g);
        if (ok) addSpend(this.agg.player, id ?? 'none', Math.max(0, delta));
        break;
      case 'sell':
      case 'move':
      case 'undo':
      case 'redo':
        this.push('buy', `${c.type}${ok ? '' : '.refused'}:${id ?? 'none'}`, delta, after, g);
        if (ok && delta < 0) addSpend(this.agg.refunds, `${c.type}:${id ?? 'none'}`, -delta);
        if (ok && delta > 0) addSpend(this.agg.player, `${c.type}:${id ?? 'none'}`, delta);
        break;
      case 'build':
        this.push('build', `${ok ? '' : 'refused.'}${id ?? 'none'}`, delta, after, g);
        if (ok && delta > 0) addSpend(this.agg.player, `build:${id ?? 'none'}`, delta);
        if (ok && delta < 0) addSpend(this.agg.refunds, `build:${id ?? 'none'}`, -delta);
        break;
      case 'queue':
        this.push('cmd', `queue${ok ? '' : `.refused.${sessionKey(c.code ?? 'other')}`}:${id ?? 'none'}${c.target ? `:${sessionKey(c.target)}` : ''}`.slice(0, 64), undefined, undefined, g);
        if (!ok) this.count(`order.refused:${sessionKey(c.code ?? 'other')}`);
        break;
      default:
        this.push('cmd', `${c.type}${ok ? '' : '.refused'}${id ? `:${id}` : ''}`, undefined, undefined, g);
        break;
    }
    this.count(`cmd:${c.type}${ok ? '' : '.refused'}`);
    if (ok && !this.firstAction && (c.type === 'queue' || c.type === 'buy')) {
      this.firstAction = { ms: this.elapsed(), type: `${c.type}:${id ?? 'none'}` };
      this.push('first', this.firstAction.type, this.firstAction.ms);
    }
  }

  /** W-123: a quest / task row's "Go" — `<step key>:<resolved kind>` (ids + the closed QuestAction kind only). */
  questGo(stepKey: string, kind: string): void {
    this.input();
    this.push('quest.go', `${stepKey}:${kind}`);
    this.count(`quest.go:${kind}`);
  }

  /**
   * W-124: a household job was assigned / finished / blocked — the job CATEGORY id only (`clean`, `play`, …): never
   * names, targets or the player-facing reason text.
   */
  job(what: 'assign' | 'done' | 'blocked', category: string): void {
    if (what === 'assign') this.input();
    const k: SessionKind = what === 'assign' ? 'job.assign' : what === 'done' ? 'job.done' : 'job.blocked';
    this.push(k, category);
    this.count(`${k}:${category}`);
  }

  /** A click / tap on the world. Non-productive ones (nothing happened) are counted with a reason. */
  click(mode: string, productive: boolean, reason?: string): void {
    this.input();
    if (productive) return;
    const r = sessionKey(reason ?? `${mode}:none`);
    const t = this.elapsed();
    const a = this.agg.clicksNone;
    a.n++;
    bump(a.by, r);
    if (a.at.length < LIST_MAX) a.at.push(t);
    this.push('click.none', r);
  }

  /** Any player input (pointer, key, wheel, command): resets the idle clock and ends a stall. */
  input(): void {
    const t = this.elapsed();
    this.lastInputT = t;
    this.idle = 0;
    const s = this.stalled;
    if (s) {
      this.stalled = null;
      s.to = t;
      this.push('stall.end', undefined, s.idle);
    }
  }

  /** Per frame: advance the idle clock by dtMs only while `eligible` (in game, unpaused, no dialog). */
  idleTick(dtMs: number, eligible: boolean): void {
    if (!eligible || !Number.isFinite(dtMs) || dtMs <= 0) return;
    this.idle += Math.min(dtMs, 5_000);
    if (this.stalled) {
      this.stalled.idle = Math.round(this.idle);
      return;
    }
    if (this.idle >= STALL_MS) {
      const s: Stall = { from: this.lastInputT, at: this.elapsed(), to: null, idle: Math.round(this.idle) };
      this.stalled = s;
      if (this.agg.stalls.length < LIST_MAX) this.agg.stalls.push(s);
      this.push('stall.start', undefined, s.idle);
    }
  }

  get stalling(): boolean {
    return this.stalled !== null;
  }

  stepOn(quest: string, arc: string, index: number, stepId: string, g?: number): void {
    const q = sessionKey(quest);
    const step = `${q}.${sessionKey(stepId)}`.slice(0, 64);
    if (this.funnel.some((f) => f.step === step && f.done === null)) return; // already active (replay / reload)
    const f: FunnelStep = { step, quest: q, arc: sessionKey(arc || 'none'), index: Math.max(0, Math.round(index) || 0), on: this.elapsed(), done: null, g: num(g) ?? null, gDone: null };
    if (this.funnel.length < FUNNEL_MAX) this.funnel.push(f);
    this.push('step.on', step, undefined, undefined, g);
  }

  stepDone(quest: string, stepId: string, g?: number): void {
    const step = `${sessionKey(quest)}.${sessionKey(stepId)}`.slice(0, 64);
    const f = this.funnel.find((x) => x.step === step && x.done === null);
    const t = this.elapsed();
    if (f) {
      f.done = t;
      f.gDone = num(g) ?? null;
    }
    this.push('step.done', step, f ? t - f.on : undefined, undefined, g);
  }

  questOn(quest: string, arc: string): void {
    const q = sessionKey(quest);
    if (this.quests.some((x) => x.quest === q && x.done === null)) return;
    if (this.quests.length < FUNNEL_MAX) this.quests.push({ quest: q, arc: sessionKey(arc || 'none'), on: this.elapsed(), done: null, bones: 0 });
  }

  questDone(quest: string, bones: number, g?: number): void {
    const q = sessionKey(quest);
    const r = this.quests.find((x) => x.quest === q && x.done === null);
    const b = Math.max(0, num(bones) ?? 0);
    if (r) {
      r.done = this.elapsed();
      r.bones = b;
    }
    this.push('quest.done', q, b, undefined, g);
  }

  autoInteraction(id: string, g?: number): void {
    const k = sessionKey(id);
    bump(this.agg.autoIx, k);
    this.push('auto.ix', k, undefined, undefined, g);
  }

  /** Money the household spent inside the sim (autonomy, interaction costs, bills, theft …), by closed category. */
  simSpend(category: string, amount: number, g?: number): void {
    const a = Math.max(0, Math.round(amount));
    if (!(a > 0)) return;
    const k = sessionKey(category);
    addSpend(this.agg.sim, k, a);
    this.push('auto.spend', k, a, undefined, g);
  }

  /**
   * W-131 order trace. `outcome` 'fail' | 'drop' | 'done'; `code` is a CLOSED reason code (never the player-facing
   * reason text); `source` player | auto | system. Stored as `<source>:<interactionId>:<code>`.
   */
  order(outcome: 'fail' | 'drop' | 'done', source: string, interactionId: string, code: string, g?: number): void {
    const key = `${sessionKey(source)}:${sessionKey(interactionId)}:${sessionKey(code)}`.slice(0, 64);
    this.count(`order.${outcome}:${sessionKey(source)}:${sessionKey(code)}`);
    this.push(outcome === 'fail' ? 'ix.fail' : outcome === 'drop' ? 'ix.drop' : 'ix.done', key, undefined, undefined, g);
  }

  notable(type: string, g?: number): void {
    const k = sessionKey(type);
    bump(this.agg.notable, k);
    this.push('sim', k, undefined, undefined, g);
  }

  hourSample(g: number, funds: number, needId: string | null, needValue: number | null): void {
    this.push('hour', needId ?? 'none', funds, needValue ?? undefined, g);
  }

  fps(v: number): void {
    if (!Number.isFinite(v) || v <= 0) return;
    const f = this.agg.fps;
    const r = Math.round(v);
    f.min = f.n === 0 ? r : Math.min(f.min, r);
    f.max = Math.max(f.max, r);
    f.sum += r;
    f.n++;
    this.push('fps', undefined, r);
  }

  quality(level: string): void {
    this.push('quality', level);
  }

  end(reason: string): void {
    if (this.endedMs !== null) return;
    this.push('end', reason);
    this.endedMs = this.elapsed();
    this.endReason = sessionKey(reason);
    this.revision++;
  }

  toLog(): SessionLog {
    return {
      format: SESSION_FORMAT,
      v: 1,
      header: { ...this.header, platform: { ...this.header.platform }, graphics: { ...this.header.graphics } },
      world: this.world ? { ...this.world } : null,
      firstAction: this.firstAction ? { ...this.firstAction } : null,
      funnel: this.funnel.map((f) => ({ ...f })),
      quests: this.quests.map((q) => ({ ...q })),
      agg: JSON.parse(JSON.stringify(this.agg)) as SessionAggregates,
      lastT: Math.max(this.lastT, this.endedMs ?? 0),
      endedMs: this.endedMs,
      endReason: this.endReason,
      dropped: this.dropped,
      events: this.events.map((e) => ({ ...e })),
    };
  }
}

// ───────────────────────────── storage form (compact tuples) + strict load ─────────────────────────────

type Tuple = [number, string, string | null, number | null, number | null, number | null, number | null];

export interface StoredSession extends Omit<SessionLog, 'events'> {
  e: Tuple[];
}

export function toStored(log: SessionLog): StoredSession {
  const { events, ...rest } = log;
  return { ...rest, e: events.map((x) => [x.t, x.k, x.a ?? null, x.n ?? null, x.m ?? null, x.g ?? null, x.c ?? null]) };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const KEY_OK = /^[A-Za-z0-9:._@-]{0,64}$/;
const okKey = (v: unknown): v is string => typeof v === 'string' && KEY_OK.test(v);
const okNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nOr = (v: unknown, d: number) => (okNum(v) ? Math.round(v) : d);
const nullableN = (v: unknown) => (okNum(v) ? Math.round(v) : null);

function cleanCounts(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v)) if (okKey(k) && okNum(x) && Object.keys(out).length < KEYS_MAX + 1) out[k] = Math.max(0, Math.round(x));
  return out;
}

function cleanTotals(v: unknown): SpendTotals {
  const t = emptyTotals();
  if (!isObj(v)) return t;
  t.n = Math.max(0, nOr(v.n, 0));
  t.total = Math.max(0, nOr(v.total, 0));
  if (isObj(v.by)) {
    for (const [k, x] of Object.entries(v.by)) {
      if (!okKey(k) || !isObj(x) || Object.keys(t.by).length > KEYS_MAX) continue;
      t.by[k] = { n: Math.max(0, nOr(x.n, 0)), total: Math.max(0, nOr(x.total, 0)) };
    }
  }
  return t;
}

/**
 * Strict re-validation of a stored session (a damaged or tampered record never reaches the summary): unknown keys are
 * dropped, every string must match the closed alphabet, every number must be finite. Returns null when unusable.
 */
export function fromStored(raw: unknown): SessionLog | null {
  if (!isObj(raw) || raw.format !== SESSION_FORMAT || raw.v !== 1 || !isObj(raw.header) || !Array.isArray(raw.e)) return null;
  if (typeof raw.header.id !== 'string' || !SESSION_ID_RE.test(raw.header.id)) return null;
  const header = sanitizeHeader(raw.header as Partial<SessionHeader>);
  const events: SessionEvent[] = [];
  for (const x of raw.e.slice(-SESSION_EVENTS_MAX)) {
    if (!Array.isArray(x) || !okNum(x[0]) || typeof x[1] !== 'string' || !KIND_SET.has(x[1])) continue;
    const e: SessionEvent = { t: Math.max(0, Math.round(x[0])), k: x[1] as SessionKind };
    if (x[2] !== null && x[2] !== undefined) {
      if (!okKey(x[2])) continue;
      e.a = x[2];
    }
    if (okNum(x[3])) e.n = Math.round(x[3]);
    if (okNum(x[4])) e.m = Math.round(x[4]);
    if (okNum(x[5])) e.g = Math.round(x[5]);
    if (okNum(x[6])) e.c = Math.round(x[6]);
    events.push(e);
  }
  const w = isObj(raw.world) ? raw.world : null;
  const world: SessionWorld | null =
    w && okKey(w.lot) && okKey(w.difficulty) && okKey(w.arc) ? { kind: w.kind === 'load' ? 'load' : 'new', lot: w.lot, difficulty: w.difficulty, arc: w.arc, at: nOr(w.at, 0) } : null;
  const fa = isObj(raw.firstAction) && okNum(raw.firstAction.ms) && okKey(raw.firstAction.type) ? { ms: Math.round(raw.firstAction.ms), type: raw.firstAction.type } : null;
  const funnel: FunnelStep[] = [];
  for (const f of Array.isArray(raw.funnel) ? raw.funnel.slice(0, FUNNEL_MAX) : []) {
    if (!isObj(f) || !okKey(f.step) || !okKey(f.quest) || !okKey(f.arc) || !okNum(f.on)) continue;
    funnel.push({ step: f.step, quest: f.quest, arc: f.arc, index: nOr(f.index, 0), on: Math.round(f.on), done: nullableN(f.done), g: nullableN(f.g), gDone: nullableN(f.gDone) });
  }
  const quests: QuestRecord[] = [];
  for (const q of Array.isArray(raw.quests) ? raw.quests.slice(0, FUNNEL_MAX) : []) {
    if (!isObj(q) || !okKey(q.quest) || !okKey(q.arc) || !okNum(q.on)) continue;
    quests.push({ quest: q.quest, arc: q.arc, on: Math.round(q.on), done: nullableN(q.done), bones: Math.max(0, nOr(q.bones, 0)) });
  }
  const ra = isObj(raw.agg) ? raw.agg : {};
  const agg = emptyAggregates();
  if (isObj(ra.clicksNone)) {
    agg.clicksNone.n = Math.max(0, nOr(ra.clicksNone.n, 0));
    agg.clicksNone.by = cleanCounts(ra.clicksNone.by);
    agg.clicksNone.at = Array.isArray(ra.clicksNone.at) ? ra.clicksNone.at.filter(okNum).slice(0, LIST_MAX).map(Math.round) : [];
  }
  if (Array.isArray(ra.stalls)) {
    for (const s of ra.stalls.slice(0, LIST_MAX)) {
      if (isObj(s) && okNum(s.from) && okNum(s.at) && okNum(s.idle)) agg.stalls.push({ from: Math.round(s.from), at: Math.round(s.at), to: nullableN(s.to), idle: Math.round(s.idle) });
    }
  }
  agg.player = cleanTotals(ra.player);
  agg.sim = cleanTotals(ra.sim);
  agg.refunds = cleanTotals(ra.refunds);
  agg.autoIx = cleanCounts(ra.autoIx);
  agg.notable = cleanCounts(ra.notable);
  agg.errors = cleanCounts(ra.errors);
  agg.counts = cleanCounts(ra.counts);
  if (isObj(ra.fps)) agg.fps = { n: Math.max(0, nOr(ra.fps.n, 0)), sum: Math.max(0, nOr(ra.fps.sum, 0)), min: Math.max(0, nOr(ra.fps.min, 0)), max: Math.max(0, nOr(ra.fps.max, 0)) };
  return {
    format: SESSION_FORMAT,
    v: 1,
    header,
    world,
    firstAction: fa,
    funnel,
    quests,
    agg,
    lastT: Math.max(0, nOr(raw.lastT, events.length ? events[events.length - 1].t : 0)),
    endedMs: nullableN(raw.endedMs),
    endReason: okKey(raw.endReason) ? raw.endReason : null,
    dropped: Math.max(0, nOr(raw.dropped, 0)),
    events,
  };
}

/**
 * W-131: map a sim reason (player-facing English text) to a CLOSED code so the log can say WHY without storing text
 * (reasons can carry names: "Barnaby left"). Unknown text maps to 'other'.
 */
const FAILURE_CODES: readonly (readonly [RegExp, string])[] = [
  [/^Already spotless|^Not full yet|^Nothing to|^Not dirty|^Already clean/i, 'nothingToDo'],
  [/^Can'?t (get|reach|go|find the way)|^No way|^Nowhere|^No room|^No free seat/i, 'noRoute'],
  [/gone|\bsold$|was removed|left$|isn['’]t here|^They are gone|^Nobody there/i, 'targetGone'],
  [/\bin use\b|^Someone else|busy|occupied/i, 'inUse'],
  [/power is out|no power/i, 'noPower'],
  [/broken/i, 'broken'],
  [/^Needs |requires|not enough|can'?t afford|\$\d/i, 'needs'],
  [/^Too (tired|hungry|sad)|exhausted|starving|feral/i, 'needLow'],
  [/^Something went wrong/i, 'fault'],
  [/^Canceled|^Interrupted/i, 'interrupted'],
  [/^Try cleaning it first|^Already clean/i, 'notStuck'],
];

export function failureCode(reason: unknown): string {
  if (typeof reason !== 'string' || !reason) return 'other';
  for (const [re, code] of FAILURE_CODES) if (re.test(reason)) return code;
  return 'other';
}
