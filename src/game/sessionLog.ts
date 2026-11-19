/**
 * Playtest session log service (W-117, docs/systems/session-log.md): the controller-side glue between the game and
 * the pure recorder in src/feedback/sessionLog.ts. Exposed to the UI as `game.sessionLog` (SessionLogFacade).
 *
 * READ-ONLY with respect to the world: it taps the W-110 EventTrail (screens, modes, speeds, dialogs, keys, errors),
 * observes player commands AFTER GameSession.dispatch applied them (funds read before/after), reads drained SimEvents
 * and samples state once per in-game hour. It never dispatches, never steps, never draws from the sim RNG or the game
 * env's random stream (session ids come from the platform CSPRNG directly), so recording on vs off gives byte-identical
 * saves (tests/unit/feedback/sessionLog.game.test.ts).
 *
 * Storage: the existing crash-safe ProfileStore (checksummed records, previous good copy rotated to :bak, atomic
 * backend writes) through the coalescing ProfileWriter — no new store. Three ring slots `slog-a|b|c` (one session
 * each; the newest overwrites the oldest) + `slog-index` ({ enabled: true | false | null }). The live session is
 * written at most every PERSIST_MS, on tab hide / pagehide / quit, and when it ends. A crash keeps the last write.
 *
 * Consent / age (E10+, COPPA): nothing leaves the device — there is no network code. The setting defaults ON for an
 * answered 13+ profile and OFF for under-13. While the age question is unanswered, events are held in memory only
 * (never written); an answered under-13 discards them, an answered 13+ keeps them. Under-13 (if a parent switches
 * it on) can only copy the text — no file export.
 */
import { jobCategory } from '../shared/jobs';
import type { Command, CommandResult, SimEvent, SimulationAPI } from '../sim/contracts';
import type { ProfileStore } from '../persistence/contracts';
import type { Core } from './core';
import type { GameSession } from './session';
import { ALL_QUESTS } from '../sim/content/quests';
import { TICKS_PER_HOUR } from '../sim/types';
import { BUILD_SHA } from '../feedback/build';
import { reportBracket } from '../feedback/form';
import { SessionRecorder, cryptoU32, failureCode, fromStored, newSessionId, toStored, utcDate, type CommandRecord, type SessionLog, type SessionPlatform } from '../feedback/sessionLog';
import { summarizeSession } from '../feedback/sessionSummary';
import { isPhoneLayout, orientationOf } from '../ui/hud/lib/phoneLayout';
import { utf8Encode } from '../persistence/bytes';
import { GAME_VERSION } from './version';

export const SESSION_SLOT_KEYS = ['slog-a', 'slog-b', 'slog-c'] as const;
export const SESSION_INDEX_KEY = 'slog-index';
export const SESSIONS_KEPT = SESSION_SLOT_KEYS.length;
export const PERSIST_MS = 10_000;
export const FPS_SAMPLE_MS = 30_000;
const POLL_MS = 5_000;
export const SESSION_FILE_EXTENSION = '.alsession.txt';

export interface SessionListEntry {
  id: string;
  date: string;
  current: boolean;
  durationMs: number;
  events: number;
}

/** What the UI may use (game.sessionLog). */
export interface SessionLogFacade {
  /** Recording right now (setting, or the age default). */
  readonly enabled: boolean;
  /** The player's explicit choice; null = follow the age default. */
  readonly choice: boolean | null;
  /** Answered 13+ (false = under-13 or not answered yet). */
  readonly teenOrAdult: boolean;
  setEnabled(on: boolean): void;
  /** Delete every stored session on this device and start the current one afresh. */
  clear(): Promise<void>;
  /** Stored sessions, newest first (the current one included while recording). */
  list(): Promise<SessionListEntry[]>;
  /** Text report of a session (default: the current one, else the newest stored). */
  summary(id?: string): Promise<string | null>;
  /** File export offered (desktop / top-level page, 13+ only). Clipboard is always the primary path. */
  readonly canSaveFile: boolean;
  saveFile(id?: string): Promise<boolean>;
}

interface Stored {
  slot: (typeof SESSION_SLOT_KEYS)[number];
  log: SessionLog;
}

const QUEST_DEFS = new Map(ALL_QUESTS.map((q) => [q.id, q]));

function stepIdOf(questId: string, index: number): string {
  const d = QUEST_DEFS.get(questId);
  const s = d?.steps?.[index];
  return s && typeof s.id === 'string' ? s.id : `s${index}`;
}

function arcOf(questId: string): string {
  const d = QUEST_DEFS.get(questId);
  return d && typeof d.arc === 'string' ? d.arc : d?.category ?? 'none';
}

/** Funds-event reasons the PLAYER causes (Buy/Build/undo/redo): already counted from the command itself. */
const PLAYER_REASON = /^(Bought |Build: |Walls$|Undo|Redo)/;

function safe<T>(fn: () => T, fallback: T): T {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

export class SessionLogService implements SessionLogFacade {
  /** True while clear() is tombstoning the slots: persist() waits (it would write into a slot being cleared). */
  private clearing = false;
  private rec: SessionRecorder;
  private stored: Stored[] = [];
  private slot: Stored['slot'] | null = null;
  private loaded = false;
  private explicit: boolean | null = null;
  private lastPersist = 0;
  private persistedRev = -1;
  private lastFrame: number | null = null;
  private lastFps = 0;
  private lastPoll = 0;
  private lastHour: number | null = null;
  private lastLevel = '';
  private lastSegment = '';
  private session: GameSession | null = null;
  private labelToIx: Map<string, string> | null = null;
  private notableAt = new Map<string, number>();
  private readonly detachers: (() => void)[] = [];
  private initPromise: Promise<void> | null = null;
  /** Lot / difficulty picked in CAZ, captured when the loading screen starts (CAZ state is cleared on entry). */
  private pendingCaz: { lot: string; difficulty: string } | null = null;

  constructor(private readonly c: Core) {
    this.rec = this.fresh('boot');
    c.trail.listen((k, v) => this.onTrail(k, v));
  }

  // ───────────────────────────── state / consent ─────────────────────────────

  private bracket(): unknown {
    return safe(() => this.c.economy?.age?.bracket ?? 'unknown', 'unknown');
  }

  get teenOrAdult(): boolean {
    return reportBracket(this.bracket()) === '13plus';
  }

  /** Age not answered yet (and no explicit choice): record to memory only. */
  private get pending(): boolean {
    return this.explicit === null && safe(() => this.bracket() === 'unknown', true);
  }

  get choice(): boolean | null {
    return this.explicit;
  }

  get enabled(): boolean {
    return this.explicit ?? this.teenOrAdult;
  }

  private get recording(): boolean {
    return this.enabled || this.pending;
  }

  get canSaveFile(): boolean {
    if (!this.teenOrAdult) return false;
    const env = this.c.env;
    if (safe(() => env.native() !== null, false)) return true;
    // Embedded pages (the claude.ai artifact viewer, iframes) block downloads: the clipboard is the way out there.
    const w = env.window;
    return safe(() => !!w && w.self === w.top, false);
  }

  setEnabled(on: boolean): void {
    const v = on === true;
    const was = this.enabled;
    this.explicit = v;
    void this.c.profileWriter.write(SESSION_INDEX_KEY, { v: 1, enabled: v });
    if (v && !was) this.rec = this.fresh('enabled');
    if (!v) this.rec.end('disabled');
    this.c.notifier.notifyNow();
  }

  async clear(): Promise<void> {
    await this.init();
    // The tombstone alone rotates the full previous record into `profile:<slot>:bak`, where a later launch with an
    // unreadable primary would restore it: free the bytes on the backend too (backup first), as the feedback outbox does.
    const backend = safe(() => this.c.saves.backend ?? null, null);
    // Drop the live session BEFORE the awaits below, and hold persist() off until they are done: a pagehide flush or
    // the 10 s tick during the loop would otherwise write the cleared session (or the new one) into a slot about to be
    // tombstoned.
    this.stored = [];
    this.slot = null;
    this.rec = this.fresh('cleared');
    this.persistedRev = -1;
    this.clearing = true;
    try {
      for (const k of SESSION_SLOT_KEYS) {
        // Twice: the first write rotates the full record into the backup, the second rotates the tombstone over it.
        // This works on whatever backend the profile store uses (one boot path gives the save manager a different one,
        // where the removes below would miss).
        await this.c.profileWriter.write(k, null);
        await this.c.profileWriter.write(k, null);
        if (!backend) continue;
        try {
          await backend.remove(`profile:${k}:bak`);
          await backend.remove(`profile:${k}`); // only once the backup is gone: a lone backup would be restored
        } catch (err) {
          this.c.report('sessionLog.clear', err);
        }
      }
    } finally {
      this.clearing = false;
    }
    this.c.notifier.notifyNow();
  }

  /** Load the setting and the stored sessions (idempotent). Events recorded meanwhile are kept. */
  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const profile: ProfileStore = this.c.profile;
      try {
        const idx = await profile.load<unknown>(SESSION_INDEX_KEY, null);
        const e = idx && typeof idx === 'object' ? (idx as { enabled?: unknown }).enabled : undefined;
        this.explicit = e === true ? true : e === false ? false : null;
      } catch (err) {
        this.c.report('sessionLog.load', err);
      }
      const out: Stored[] = [];
      for (const slot of SESSION_SLOT_KEYS) {
        try {
          const raw = await profile.load<unknown>(slot, null);
          const log = raw === null ? null : fromStored(raw);
          if (log && log.header.id !== this.rec.id) out.push({ slot, log });
        } catch (err) {
          this.c.report('sessionLog.load', err);
        }
      }
      out.sort((a, b) => a.log.header.seq - b.log.header.seq);
      this.stored = out;
      this.loaded = true;
    })();
    return this.initPromise;
  }

  // ───────────────────────────── session lifecycle ─────────────────────────────

  private platform(): SessionPlatform {
    const env = this.c.env;
    const vp = safe(() => env.viewport(), { width: 0, height: 0 });
    const w = env.window;
    const coarse = safe(() => !!w && typeof w.matchMedia === 'function' && w.matchMedia('(pointer: coarse)').matches, false);
    return {
      segment: isPhoneLayout(vp.width, vp.height, coarse) ? 'phone' : 'desktop',
      orient: orientationOf(vp.width, vp.height),
      viewport: `${Math.round(vp.width) || 0}x${Math.round(vp.height) || 0}`,
      dpr: safe(() => env.devicePixelRatio(), 1),
      shell: safe(() => env.native() !== null, false) ? 'desktop' : 'web',
      touch: coarse,
    };
  }

  private graphics() {
    const g = this.c.rendererReady ? safe(() => this.c.renderer.graphicsInfo?.() ?? null, null) : null;
    return { setting: String(this.c.settings.quality), level: g ? String(g.level) : 'unknown', gpuKind: g?.auto ? String(g.auto.gpuKind) : 'unknown', ceiling: g?.auto ? String(g.auto.ceiling) : 'unknown' };
  }

  private fresh(entry: string, withScreen = true): SessionRecorder {
    const r = new SessionRecorder(
      {
        id: newSessionId(cryptoU32),
        seq: 0,
        date: utcDate(safe(() => this.c.env.wallNow(), 0)),
        build: BUILD_SHA,
        version: GAME_VERSION,
        bracket: this.teenOrAdult ? '13plus' : 'under13',
        platform: this.platform(),
        graphics: this.graphics(),
      },
      () => this.c.env.now(),
    );
    r.push('start', entry);
    if (withScreen && this.c.screen !== 'boot') r.push('screen', this.c.screen);
    this.slot = null;
    this.persistedRev = -1;
    this.lastHour = null;
    this.lastLevel = '';
    this.lastSegment = '';
    return r;
  }

  /** End the current session and start a new one (new game / another world). */
  private roll(entry: string, reason: string, withScreen = true): void {
    this.rec.end(reason);
    this.persist(true);
    this.rec = this.fresh(entry, withScreen);
  }

  private onTrail(kind: string, value: string): void {
    if (!this.recording) return;
    // A second world in the same app run (New Game again, Load from the pause menu) starts a new session.
    if (kind === 'screen' && (value === 'newGame' || value === 'caz') && this.rec.hasWorld) this.roll('newGame', 'newGame', false);
    if (kind === 'screen' && value === 'loading') {
      const caz = this.c.caz;
      this.pendingCaz = caz ? { lot: String(caz.lotTemplate), difficulty: String(caz.difficulty) } : null;
      if (caz) this.rec.push('log', `caz.members:${Array.isArray(caz.members) ? caz.members.length : 0}`);
    }
    if (kind === 'mode' || kind === 'speed' || kind === 'dialog' || kind === 'key') this.rec.input();
    this.rec.trail(kind, value);
  }

  private enterWorld(s: GameSession): void {
    if (this.rec.hasWorld) this.roll(s.loadedFrom ? 'continue' : 'newGame', 'newWorld');
    const st = safe(() => s.sim.state, null);
    const caz = s.loadedFrom ? null : this.pendingCaz;
    this.pendingCaz = null;
    this.rec.setWorld({
      kind: s.loadedFrom ? 'load' : 'new',
      lot: s.loadedFrom ? 'saved' : (caz?.lot ?? 'unknown'),
      difficulty: String(safe(() => st?.settings?.difficulty ?? caz?.difficulty, 'unknown')),
      arc: String(safe(() => st?.flags?.storyArc, 'none')),
    });
    const r = this.rec;
    r.header.platform = this.platform();
    r.header.graphics = this.graphics();
    r.header.bracket = this.teenOrAdult ? '13plus' : 'under13';
    this.seedQuests(s.sim);
    s.setCommandObserver((cmd) => this.observe(s, cmd));
  }

  /**
   * Quests already active when a world is entered (the first story beat starts at world creation; a loaded world is
   * mid-arc) enter the funnel at that moment.
   */
  seedQuests(sim: SimulationAPI): void {
    if (!this.recording) return;
    const st = safe(() => sim.state, null);
    for (const q of safe(() => st?.quests?.active ?? [], [])) {
      if (!q || typeof q.questId !== 'string') continue;
      this.rec.questOn(q.questId, arcOf(q.questId));
      this.rec.stepOn(q.questId, arcOf(q.questId), q.stepIndex, stepIdOf(q.questId, q.stepIndex), st?.tick);
    }
  }

  // ───────────────────────────── inputs from the game ─────────────────────────────

  /** Any raw player input (pointer / key / wheel / touch on the page). */
  input(): void {
    if (this.recording) this.rec.input();
  }

  /** A click/tap on the world: `productive` = it changed something (selection, menu, command, tool state). */
  /** W-123: a quest row's Go (step key = quest/step or task ids; kind = queue | mode | missing | blocked). */
  questGo(stepKey: string, kind: string): void {
    if (this.recording) this.rec.questGo(stepKey, kind);
  }

  worldClick(mode: string, productive: boolean, reason: string): void {
    if (this.recording) this.rec.click(mode, productive, reason);
  }

  /** A control that refused (locked item, Ultra while someone is awake). */
  locked(what: string): void {
    if (this.recording) this.rec.click('locked', false, `locked:${what}`);
  }

  private observe(s: GameSession, cmd: Command): ((r: CommandResult) => void) | null {
    if (!this.recording || this.session !== s) return null;
    const st = safe(() => s.sim.state, null);
    if (!st) return null;
    const defOf = (id: unknown): string | undefined => (typeof id === 'string' ? safe(() => st.objects?.[id]?.defId, undefined) : undefined);
    const fundsBefore = safe(() => st.household.funds, NaN);
    const g = safe(() => st.tick, NaN);
    let rec: Omit<CommandRecord, 'ok'> | null = null;
    switch (cmd.type) {
      case 'queue': {
        const t = cmd.target;
        const target = t?.kind === 'object' ? (defOf(t.id) ?? 'object') : (t?.kind ?? 'none');
        rec = { type: 'queue', id: cmd.interactionId, target };
        break;
      }
      case 'cancel':
        rec = { type: 'cancel' };
        break;
      case 'build': {
        const b = cmd.cmd;
        if (b.type === 'buy' || b.type === 'buyWallItem' || b.type === 'buyOpening') rec = { type: 'buy', id: b.defId };
        else if (b.type === 'sell') rec = { type: 'sell', id: defOf(b.objectId) ?? 'object' };
        else if (b.type === 'move' || b.type === 'moveWallItem' || b.type === 'moveOpening') rec = { type: 'move', id: defOf(b.objectId) ?? 'object' };
        else rec = { type: 'build', id: b.type };
        break;
      }
      case 'undo':
      case 'redo':
        rec = { type: cmd.type };
        break;
      case 'choice':
        rec = { type: 'choice', id: `option${Number.isInteger(cmd.option) ? cmd.option : 0}` };
        break;
      case 'buyReward':
        rec = { type: 'reward', id: cmd.rewardId };
        break;
      case 'renameHousehold':
        rec = { type: 'rename' }; // never the name
        break;
      case 'quest':
        rec = { type: 'quest', id: `${cmd.action}:${cmd.questId}` };
        break;
      case 'cheat':
        rec = { type: 'cheat' }; // never the typed code
        break;
      default:
        return null; // setSettings / endBuildSession / markNotificationsRead: not player world actions
    }
    const r0 = rec;
    return (result) => {
      const fundsAfter = safe(() => s.sim.state.household.funds, NaN);
      const ok = result?.ok === true;
      // W-131: WHY a command was refused, as a closed code (the sim's reason text is never stored)
      const code = ok ? undefined : failureCode(result && !result.ok ? (result as { reason?: unknown }).reason : undefined);
      this.rec.command({ ...r0, ok, code, fundsBefore, fundsAfter, g });
    };
  }

  /** Drained events of the PLAYED world (frame.ts), types and content ids only. */
  simEvents(sim: SimulationAPI, events: readonly SimEvent[]): void {
    if (!this.recording) return;
    const r = this.rec;
    const tick = safe(() => sim.state.tick, NaN);
    for (const e of events) {
      if (!e || typeof e !== 'object') continue;
      switch (e.type) {
        case 'questStarted':
          r.questOn(e.questId, arcOf(e.questId));
          r.stepOn(e.questId, arcOf(e.questId), 0, stepIdOf(e.questId, 0), tick);
          break;
        case 'questProgress':
          if (e.stepDone) {
            r.stepDone(e.questId, typeof e.stepId === 'string' ? e.stepId : stepIdOf(e.questId, e.stepIndex), tick);
            const def = QUEST_DEFS.get(e.questId);
            const next = e.stepIndex + 1;
            if (def && next < def.steps.length) r.stepOn(e.questId, arcOf(e.questId), next, stepIdOf(e.questId, next), tick);
          }
          break;
        case 'questCompleted':
          r.questDone(e.questId, safe(() => e.grant.bones, 0), tick);
          break;
        case 'job':
          // W-124: category ids only (closed vocabulary from src/shared/jobs.ts), never names / targets / reasons
          if ((e.what === 'assign' || e.what === 'done' || e.what === 'blocked') && jobCategory(e.category)) r.job(e.what, e.category);
          break;
        case 'interactionCompleted':
          // idle fidgets (wander / stretch / groan …) fold into one bucket: they would drown the real choices
          if (e.source === 'auto' && e.household) r.autoInteraction(/^engine_idle_/.test(e.interactionId) ? 'engine_idle' : e.interactionId, tick);
          // W-131: the player's own orders that finished (so a report shows ordered vs done)
          else if (e.source === 'player' && e.household) r.order('done', 'player', e.interactionId, 'ok', tick);
          break;
        case 'orderDropped':
          if (e.source !== 'auto') r.order('drop', e.source, e.interactionId, e.cause, tick);
          break;
        case 'interactionNoEffect':
          // "it finished but nothing happened": recorded as a failure with its own closed code
          r.order('fail', e.source, e.interactionId, 'noEffect', tick);
          break;
        case 'stuckMessCleared':
          // the recovery's evidence lands in the log BEFORE the target was cleared (the sim emits it first)
          this.notable('stuckMessCleared', tick);
          r.order('drop', 'player', `recover:${e.defId}`, `fails${Math.min(9, Math.max(0, Math.round(e.fails)))}`, tick);
          break;
        case 'funds':
          if (e.delta < 0 && typeof e.reason === 'string' && !PLAYER_REASON.test(e.reason)) {
            const cat = this.spendCategory(sim, e.reason);
            r.simSpend(cat, -e.delta, tick);
            if (cat === 'theft') this.notable('theft', tick);
          }
          break;
        case 'notify': {
          const kind = safe(() => sim.state.notifications.find((n) => n && n.id === e.id)?.kind, undefined);
          this.notable(`notify.${typeof kind === 'string' ? kind : 'unknown'}`, tick);
          break;
        }
        case 'fx':
          if (e.kind === 'fire' || e.kind === 'smoke') this.notable(`fx.${e.kind}`, tick, 10_000);
          break;
        case 'skillUp':
        case 'promotion':
        case 'milestone':
        case 'gameOver':
        case 'choice':
        case 'agentSpawned':
          this.notable(e.type, tick);
          break;
        case 'interactionFailed':
          this.notable(e.type, tick);
          // W-131: which order failed and why (closed code), not just "something failed"
          if (typeof e.interactionId === 'string') r.order('fail', typeof e.source === 'string' ? e.source : 'player', e.interactionId, failureCode(e.reason), tick);
          break;
        default:
          break;
      }
    }
  }

  private notable(type: string, tick: number, cooldownMs = 0): void {
    const now = this.rec.elapsed();
    const last = this.notableAt.get(type);
    if (cooldownMs > 0 && last !== undefined && now - last < cooldownMs) return;
    this.notableAt.set(type, now);
    this.rec.notable(type, tick);
  }

  /** Map a funds reason to a CLOSED category (the reason text itself is never stored). */
  private spendCategory(sim: SimulationAPI, reason: string): string {
    if (/^Groceries/.test(reason)) return 'groceries';
    if (/^Utility bill/.test(reason)) return 'bill';
    if (/theft/i.test(reason)) return 'theft';
    if (/pizza/i.test(reason)) return 'pizza';
    if (!this.labelToIx) {
      const m = new Map<string, string>();
      for (const [id, d] of Object.entries(safe(() => sim.content?.interactions ?? {}, {}))) if (d && typeof d.label === 'string' && !m.has(d.label)) m.set(d.label, id);
      this.labelToIx = m;
    }
    const ix = this.labelToIx.get(reason);
    return ix ? `ix:${ix}` : 'other';
  }

  /** Per frame (frame.ts): world entry, stall clock, hourly samples, fps / quality polls, periodic persistence. */
  frame(now: number): void {
    const c = this.c;
    // Switched off, or the age question answered under-13 while events were held in memory only: they are dropped.
    if (this.loaded && !this.recording && !this.rec.ended) {
      this.rec = this.fresh('disabled');
      this.rec.end('disabled');
    }
    if (!this.recording) {
      this.lastFrame = now;
      return;
    }
    const s = c.session;
    if (s !== this.session) {
      this.session = s;
      if (s) c.guard('sessionLog.world', () => this.enterWorld(s));
    }
    const dt = this.lastFrame === null ? 0 : now - this.lastFrame;
    this.lastFrame = now;
    const inGame = c.inGame();
    this.rec.idleTick(dt, inGame && c.play.effectiveSpeed > 0 && c.play.dialog === null && !c.hidden);
    if (inGame && s) {
      const st = safe(() => s.sim.state, null);
      const tick = st?.tick;
      if (typeof tick === 'number' && Number.isFinite(tick)) {
        const hour = Math.floor(tick / TICKS_PER_HOUR);
        if (hour !== this.lastHour) {
          this.lastHour = hour;
          this.hourSample(s.sim, tick);
        }
      }
      if (now - this.lastFps >= FPS_SAMPLE_MS) {
        this.lastFps = now;
        if (c.fps > 0) this.rec.fps(c.fps);
      }
    }
    if (now - this.lastPoll >= POLL_MS) {
      this.lastPoll = now;
      const g = this.graphics();
      if (g.level !== 'unknown' && g.level !== this.lastLevel) {
        this.lastLevel = g.level;
        this.rec.quality(g.level);
      }
      const p = this.platform();
      const seg = `${p.segment}.${p.orient}`;
      if (seg !== this.lastSegment) {
        if (this.lastSegment) this.rec.push('log', `segment:${seg}`);
        this.lastSegment = seg;
      }
    }
    if (now - this.lastPersist >= PERSIST_MS) this.persist(false);
  }

  private hourSample(sim: SimulationAPI, tick: number): void {
    const st = sim.state;
    const funds = safe(() => st.household.funds, 0);
    let lowId: string | null = null;
    let low = Infinity;
    for (const id of safe(() => st.household.memberIds ?? [], [] as string[])) {
      const a = safe(() => st.agents[id], undefined);
      if (!a || a.presence !== 'onLot' || !a.needs) continue;
      for (const [k, v] of Object.entries(a.needs)) {
        if (typeof v === 'number' && Number.isFinite(v) && v < low) {
          low = v;
          lowId = k;
        }
      }
    }
    this.rec.hourSample(tick, funds, lowId, Number.isFinite(low) ? low : null);
  }

  // ───────────────────────────── persistence ─────────────────────────────

  /** Write the live session (when it changed) to its ring slot. Never while the age question is open. */
  persist(force: boolean): void {
    this.lastPersist = safe(() => this.c.env.now(), 0);
    if (!this.loaded || !this.enabled || this.pending || this.clearing) return;
    if (!force && this.rec.revision === this.persistedRev) return;
    if (this.rec.eventCount === 0) return;
    if (this.slot === null) {
      const used = new Set(this.stored.map((x) => x.slot));
      const free = SESSION_SLOT_KEYS.find((k) => !used.has(k));
      if (free) this.slot = free;
      else {
        const oldest = this.stored.shift()!;
        this.slot = oldest.slot;
      }
      this.rec.header.seq = this.stored.reduce((mx, x) => Math.max(mx, x.log.header.seq), 0) + 1;
    }
    this.persistedRev = this.rec.revision;
    const log = this.rec.toLog();
    const slot = this.slot;
    void this.c.profileWriter.write(slot, toStored(log));
    // keep the in-memory ring in step (an ended session moves into the stored list)
    if (this.rec.ended) {
      this.stored = this.stored.filter((x) => x.slot !== slot);
      this.stored.push({ slot, log });
      this.slot = null;
    }
  }

  /** Tab hidden / page hide / quit / dispose: write now. */
  flush(end?: string): void {
    if (end) this.rec.end(end);
    this.persist(true);
  }

  /** Install page-level input + lifecycle listeners (pointer / key / wheel / touch reset the idle clock). */
  attach(win: Window | null, doc: Document | null): () => void {
    if (!win) return () => {};
    const onInput = () => this.input();
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
      win.addEventListener(type, onInput, opts);
      this.detachers.push(() => win.removeEventListener(type, onInput, opts));
    }
    const onHide = () => this.flush('pagehide');
    const onShow = (e: Event) => {
      if ((e as PageTransitionEvent).persisted && this.recording) this.rec = this.fresh('resume');
    };
    win.addEventListener('pagehide', onHide);
    win.addEventListener('pageshow', onShow);
    this.detachers.push(() => win.removeEventListener('pagehide', onHide), () => win.removeEventListener('pageshow', onShow));
    if (doc) {
      const onVis = () => {
        if (doc.visibilityState === 'hidden') this.flush();
      };
      doc.addEventListener('visibilitychange', onVis);
      this.detachers.push(() => doc.removeEventListener('visibilitychange', onVis));
    }
    return () => {
      for (const d of this.detachers.splice(0)) d();
    };
  }

  // ───────────────────────────── export ─────────────────────────────

  private currentLog(): SessionLog | null {
    return this.recording && !(this.rec.ended && this.rec.eventCount <= 1) ? this.rec.toLog() : null;
  }

  async list(): Promise<SessionListEntry[]> {
    await this.init();
    const out: SessionListEntry[] = [];
    const cur = this.currentLog();
    const entry = (l: SessionLog, current: boolean): SessionListEntry => ({ id: l.header.id, date: l.header.date, current, durationMs: l.endedMs ?? l.lastT, events: l.events.length });
    if (cur) out.push(entry(cur, true));
    for (const s of [...this.stored].reverse()) if (!cur || s.log.header.id !== cur.header.id) out.push(entry(s.log, false));
    return out.slice(0, SESSIONS_KEPT + 1);
  }

  private async find(id?: string): Promise<SessionLog | null> {
    await this.init();
    const cur = this.currentLog();
    if (!id) return cur ?? this.stored[this.stored.length - 1]?.log ?? null;
    if (cur && cur.header.id === id) return cur;
    return this.stored.find((s) => s.log.header.id === id)?.log ?? null;
  }

  async summary(id?: string): Promise<string | null> {
    const log = await this.find(id);
    if (!log) return null;
    try {
      return summarizeSession(log);
    } catch (e) {
      this.c.report('sessionLog.summary', e);
      return null;
    }
  }

  /** Raw log for tests / tools (never shown to the UI as JSON). */
  async log(id?: string): Promise<SessionLog | null> {
    return this.find(id);
  }

  async saveFile(id?: string): Promise<boolean> {
    if (!this.canSaveFile) return false;
    const log = await this.find(id);
    if (!log) return false;
    const text = summarizeSession(log);
    try {
      return this.c.env.download(`afterlife-session-${log.header.date}-${log.header.id}${SESSION_FILE_EXTENSION}`, utf8Encode(text), 'text/plain');
    } catch (e) {
      this.c.report('sessionLog.saveFile', e);
      return false;
    }
  }

  /** Probe for "did this click change anything" (controller click wrapper). */
  static clickProbe(c: Core): string {
    const p = c.play;
    const b = safe(() => c.input.buy.view(), null);
    return [c.session?.mutationCount ?? -1, p.menu ? 1 : 0, p.selectedAgentId ?? '', p.mode, p.dialog ?? '', b?.placingDefId ?? '', b?.movingObjectId ?? '', safe(() => c.input.build.tool.kind, '')].join('|');
  }

  /** Why a click did nothing (closed vocabulary). */
  static clickReason(c: Core, mode: string): string {
    if (mode === 'live') return c.play.selectedAgentId ? 'live:nothing' : 'live:noSelection';
    if (mode === 'buy') return safe(() => (c.input.buy.view().placingDefId || c.input.buy.view().movingObjectId ? 'buy:refused' : 'buy:empty'), 'buy:none');
    return `${mode}:none`;
  }
}
