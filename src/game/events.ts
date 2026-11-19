/**
 * Sim event routing (sim.drainEvents() → audio / toasts / bubbles / controller callbacks). The renderer gets the
 * raw list via renderer.consumeEvents() before this runs.
 *
 * Fault barrier: each event is routed inside its own try/catch; a malformed event (unknown sfx id, missing agent,
 * NaN position) is skipped, never thrown. Flood control: after a long stall a single frame may carry hundreds of
 * ticks' worth of events, so per-frame caps bound sfx/voice triggers (one trigger per sfx id per frame), and the
 * expensive / UI-flushing callbacks (choice auto-pause, lot-changed re-validation, camera focus) run once per batch.
 *
 * Achievements: the engine reports a skill-up / promotion / aspiration milestone as a semantic event AND (same
 * tick) a notification with the richer player-facing text (kinds per contract #19: skill / career / good). Within a
 * batch they are paired per (kind, zombie): the notification's toast is shown, the semantic event adds only its
 * sting (no generic "notify" ping); a semantic event without a matching notification gets a fallback toast.
 *
 * Loops are tracked per key with their emitter (object / zombie / position). A loop stops on its own `on: false`, at
 * once when its object is removed (`objectRemoved`) or its zombie leaves the lot (`agentDespawned`) — backlog #3 —
 * and, as a fallback for emitters that vanish without an event, at the next refreshLoops(). A loop whose emitter is
 * already gone when its `on` event is routed never starts.
 * A loop silenced because its OBJECT vanished is remembered (bounded): build undo / redo (and a rolled-back build
 * command) re-insert objects under their old id while the sim still believes the loop plays — it never re-sends
 * `on` (e.g. a playing stereo sold, then the sale undone) — so the loop resumes on that object's `objectAdded`,
 * unless the sim switched it off meanwhile. Zombie loops are not remembered: a departing zombie's runs end.
 */
import { jobCategory } from '../shared/jobs';
import type { SimEvent, SimulationAPI } from '../sim/contracts';
import type { AudioAPI } from '../audio/contracts';
import type { AgentId, ObjectId, Vec2, Notification } from '../sim/types';
import { SFX_IDS, VOICE_EMOTIONS, type SfxId, type VoiceEmotion } from '../shared/audioIds';
import { computeSpatial, type SpatialSource } from './spatialAudio';
import type { BubbleBoard, ToastCenter } from './toasts';
import type { MusicEventMood } from './music';
import { en } from '../i18n/en';

export const MAX_SFX_PER_FRAME = 10;
export const MAX_VOICES_PER_FRAME = 2;
export const MAX_TRACKED_LOOPS = 32;
/** Loops silenced because their object vanished, kept in case the object comes back (oldest dropped first). */
export const MAX_SUSPENDED_LOOPS = 32;
export const DEFAULT_BUBBLE_MS = 3000;
export const MIN_BUBBLE_MS = 1500;
export const MAX_BUBBLE_MS = 6000;

const SFX_SET: ReadonlySet<string> = new Set(SFX_IDS);
const VOICE_SET: ReadonlySet<string> = new Set(VOICE_EMOTIONS);

export function isSfxId(v: unknown): v is SfxId {
  return typeof v === 'string' && SFX_SET.has(v);
}

export function isVoiceEmotion(v: unknown): v is VoiceEmotion {
  return typeof v === 'string' && VOICE_SET.has(v);
}

export interface RouterHost {
  readonly audio: AudioAPI;
  readonly renderer: SpatialSource & { focus(target: Vec2 | AgentId, instant?: boolean): void };
  viewport(): { width: number; height: number };
  now(): number;
  readonly toasts: ToastCenter;
  readonly bubbles: BubbleBoard;
  /** Game minutes per real second at the current speed (0 when paused). */
  gameMinutesPerSecond(): number;
  /** False for the menu demo world: no audio, toasts, bubbles or callbacks with UI effect. */
  interactive(): boolean;
  isSelected(agentId: AgentId): boolean;
  onChoice(choiceId: string): void;
  onGameOver(reason: string): void;
  onMusic(mood: MusicEventMood): void;
  onAgentLeft(agentId: AgentId): void;
  onObjectRemoved(objectId: ObjectId): void;
  onLotChanged(): void;
  onError(where: string, err: unknown): void;
  /** A save-worthy moment (quest completed): the controller schedules an event-driven autosave. */
  onSaveWorthy?(reason: string): void;
}

interface FrameBudget {
  sfx: number;
  sfxIds: Set<string>;
  voices: number;
  /** Semantic achievement events in this batch per `${notificationKind}|${agentId}`. */
  semantic: Map<string, number>;
  /** Engine notifications in this batch that pair with (and replace the toast of) a semantic event, per key. */
  covered: Map<string, number>;
  /** Coalesced per batch. */
  choiceId: string | null;
  lotChanged: boolean;
  focus: Vec2 | AgentId | null;
}

/** Semantic achievement event → the notification kind the engine posts for it (contract decision #19). */
const SEMANTIC_KIND: ReadonlyMap<string, Notification['kind']> = new Map<string, Notification['kind']>([
  ['skillUp', 'skill'],
  ['promotion', 'career'],
  ['milestone', 'good'],
]);

function pairKey(kind: string, agentId: unknown): string | null {
  return typeof agentId === 'string' && agentId.length > 0 ? `${kind}|${agentId}` : null;
}

interface LoopSource {
  id: SfxId;
  pos: Vec2 | null;
  agentId: AgentId | null;
  objectId: ObjectId | null;
}

type Located = { pos?: Vec2; agentId?: AgentId; objectId?: ObjectId };

function finiteVec(v: unknown): v is Vec2 {
  return !!v && typeof v === 'object' && Number.isFinite((v as Vec2).x) && Number.isFinite((v as Vec2).z);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Stable small hash so a voice without a seed still has a consistent timbre. */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function eventWorldPos(sim: SimulationAPI, ev: Located): { x: number; y: number; z: number } | null {
  if (finiteVec(ev.pos)) return { x: ev.pos.x, y: 0.8, z: ev.pos.z };
  if (typeof ev.agentId === 'string') {
    const a = sim.agent(ev.agentId);
    if (a && a.presence === 'onLot' && finiteVec(a.pos)) return { x: a.pos.x, y: 1.2, z: a.pos.z };
    return null;
  }
  if (typeof ev.objectId === 'string') {
    const o = sim.object(ev.objectId);
    if (!o) return null;
    const c = sim.spatial.objectCenter(o);
    if (finiteVec(c)) return { x: c.x, y: 0.6, z: c.z };
  }
  return null;
}

export function findNotification(sim: SimulationAPI, id: number): Notification | null {
  const list = sim.state?.notifications;
  if (!Array.isArray(list)) return null;
  for (let i = list.length - 1; i >= 0; i--) if (list[i] && list[i].id === id) return list[i];
  return null;
}

function firstName(sim: SimulationAPI, id: AgentId): string {
  const a = sim.agent(id);
  return a && typeof a.firstName === 'string' && a.firstName ? a.firstName : 'Someone';
}

function skillName(sim: SimulationAPI, skill: string): string {
  const d = sim.content?.skills?.[skill as keyof typeof sim.content.skills];
  if (d && typeof d.name === 'string') return d.name;
  return skill.length > 0 ? skill[0].toUpperCase() + skill.slice(1) : 'a skill';
}

/** Label of a quest step (W-116 credit toast), '' when unknown. Never throws. */
export function creditedStepLabel(sim: SimulationAPI, questId: string, stepId: string): string {
  try {
    const v = typeof sim.quests === 'function' ? sim.quests() : null;
    const q = v?.active.find((a) => a.questId === questId);
    const st = q?.steps.find((x) => x.id === stepId);
    if (st && typeof st.label === 'string') return st.label;
    // a fully credited quest completes at once (no longer active): arc step labels live in en.ts (story.act1.*)
    const m = /^([a-z0-9]+)_([a-zA-Z0-9]+)$/.exec(questId);
    const v2 = m ? (en as Record<string, string>)[`story.${m[1]}.${m[2]}.step.${stepId}`] : undefined;
    return typeof v2 === 'string' ? v2 : '';
  } catch {
    return '';
  }
}

function milestoneLabel(sim: SimulationAPI, aspirationId: string, milestoneId: string): { label: string; points: number | null } {
  const asp = sim.content?.aspirations?.[aspirationId];
  const m = Array.isArray(asp?.milestones) ? asp.milestones.find((x) => x && x.id === milestoneId) : undefined;
  return { label: m && typeof m.label === 'string' ? m.label : 'Milestone reached', points: m && Number.isFinite(m.points) ? m.points : null };
}

const BAD_KINDS = new Set(['bad', 'warning', 'decay']);

export class EventRouter {
  private readonly loops = new Map<string, LoopSource>();
  /** Loops silenced because their object vanished, by key (insertion order = age); see the module doc. */
  private readonly suspended = new Map<string, LoopSource>();

  get activeLoopCount(): number {
    return this.loops.size;
  }

  get suspendedLoopCount(): number {
    return this.suspended.size;
  }

  route(sim: SimulationAPI, events: readonly SimEvent[], host: RouterHost): void {
    if (!Array.isArray(events) || events.length === 0) return;
    const budget: FrameBudget = { sfx: 0, sfxIds: new Set(), voices: 0, semantic: new Map(), covered: new Map(), choiceId: null, lotChanged: false, focus: null };
    try {
      if (host.interactive()) this.pairAchievements(sim, events, budget);
    } catch (e) {
      host.onError('event:pairing', e);
    }
    for (const ev of events) {
      try {
        if (ev && typeof ev === 'object') this.routeOne(sim, ev, host, budget);
      } catch (e) {
        host.onError(`event:${(ev as { type?: unknown } | null)?.type ?? '?'}`, e);
      }
    }
    // Coalesced callbacks: one UI flush / re-validation / camera move per frame, however many events asked.
    const live = host.interactive(); // re-read: a gameOver earlier in this batch ends interactivity
    if (live && budget.choiceId !== null) this.guarded(host, 'event:choice', () => host.onChoice(budget.choiceId!));
    if (budget.lotChanged) this.guarded(host, 'event:lot', () => host.onLotChanged());
    if (live && budget.focus !== null) this.guarded(host, 'event:focus', () => host.renderer.focus(budget.focus!));
  }

  private guarded(host: RouterHost, where: string, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      host.onError(where, e);
    }
  }

  /** Pre-pass: count semantic events and the engine notifications that pair with them (see module doc). */
  private pairAchievements(sim: SimulationAPI, events: readonly SimEvent[], b: FrameBudget): void {
    for (const ev of events) {
      const kind = ev && typeof ev === 'object' && typeof ev.type === 'string' ? SEMANTIC_KIND.get(ev.type) : undefined;
      if (!kind) continue;
      const key = pairKey(kind, (ev as { agentId?: unknown }).agentId);
      if (key) b.semantic.set(key, (b.semantic.get(key) ?? 0) + 1);
    }
    if (b.semantic.size === 0) return;
    for (const ev of events) {
      if (!ev || typeof ev !== 'object' || ev.type !== 'notify') continue;
      const n = findNotification(sim, ev.id);
      const key = n ? pairKey(n.kind, n.agentId) : null;
      if (!key) continue;
      const have = b.covered.get(key) ?? 0;
      if (have < (b.semantic.get(key) ?? 0)) b.covered.set(key, have + 1);
    }
  }

  /**
   * Stop every tracked loop whose emitter matches — backlog #3: `objectRemoved` stops the loops of that object,
   * `agentDespawned` the loops of that zombie, so a sold / burned / repossessed object or a zombie who left never
   * leaves a loop playing (defence in depth: emitters are supposed to send their own `on: false`). Object loops are
   * remembered (`suspend`) in case the object comes back under its id; zombie loops are forgotten.
   */
  private stopLoopsWhere(host: RouterHost, match: (src: LoopSource) => boolean, suspend: boolean): void {
    for (const [key, src] of Array.from(this.loops)) {
      if (!match(src)) continue;
      this.loops.delete(key);
      if (suspend) this.suspend(key, src);
      this.guarded(host, 'event:loopStop', () => host.audio.loop(key, src.id, false));
    }
  }

  /** Remember a loop silenced because its object vanished (latest wins per key; oldest dropped beyond the cap). */
  private suspend(key: string, src: LoopSource): void {
    this.suspended.delete(key);
    this.suspended.set(key, src);
    while (this.suspended.size > MAX_SUSPENDED_LOOPS) {
      const oldest = this.suspended.keys().next();
      if (oldest.done) break;
      this.suspended.delete(oldest.value);
    }
  }

  /** `objectAdded`: loops silenced when this object vanished play again now that it is back under the same id. */
  private resumeLoopsOf(sim: SimulationAPI, host: RouterHost, objectId: ObjectId): void {
    for (const [key, src] of Array.from(this.suspended)) {
      if (src.objectId !== objectId || this.emitterGone(sim, src)) continue;
      this.suspended.delete(key);
      if (!this.loops.has(key) && this.loops.size >= MAX_TRACKED_LOOPS) continue;
      this.loops.set(key, src);
      this.guarded(host, 'event:loopResume', () =>
        host.audio.loop(key, src.id, true, this.spatial(sim, { pos: src.pos ?? undefined, agentId: src.agentId ?? undefined, objectId: src.objectId ?? undefined }, host)),
      );
    }
  }

  /** The loop's object no longer exists (removed; maybe re-inserted later by build undo / redo). */
  private objectGone(sim: SimulationAPI, src: LoopSource): boolean {
    return !!src.objectId && !sim.object(src.objectId);
  }

  /**
   * A loop's emitter no longer exists: its object was removed, or the zombie it belongs to is not on the lot (work,
   * crumbled, gone). Such a loop would keep playing centred at full volume (no position → no spatial attenuation).
   */
  private emitterGone(sim: SimulationAPI, src: LoopSource): boolean {
    if (this.objectGone(sim, src)) return true;
    return !!src.agentId && sim.agent(src.agentId)?.presence !== 'onLot';
  }

  /** Re-send spatial hints for running loops (camera moved / emitter moved). Drops loops whose source vanished. */
  refreshLoops(sim: SimulationAPI, host: RouterHost): void {
    if (!host.interactive()) return;
    for (const [key, src] of Array.from(this.loops)) {
      try {
        // Fallback for an emitter that vanished without an objectRemoved / agentDespawned event (or an off event).
        if (this.emitterGone(sim, src)) {
          this.loops.delete(key);
          if (this.objectGone(sim, src)) this.suspend(key, src);
          host.audio.loop(key, src.id, false);
          continue;
        }
        const p = eventWorldPos(sim, { pos: src.pos ?? undefined, agentId: src.agentId ?? undefined, objectId: src.objectId ?? undefined });
        host.audio.loop(key, src.id, true, p ? computeSpatial(p, host.renderer, host.viewport()) : undefined);
      } catch (e) {
        host.onError('event:loopRefresh', e);
      }
    }
  }

  stopAll(audio: AudioAPI): void {
    this.loops.clear();
    this.suspended.clear();
    try {
      audio.stopAllLoops();
    } catch {
      /* audio is best-effort */
    }
  }

  /**
   * Every router sound goes through the per-frame budget: at most MAX_SFX_PER_FRAME, one per id. This also merges
   * a sim 'sfx' event with the controller's own cue for the same moment (e.g. skillUp: the engine emits both an
   * sfx event and a skillUp event in the same tick).
   */
  private playSfx(host: RouterHost, budget: FrameBudget, id: SfxId, opts?: () => { spatial?: ReturnType<typeof computeSpatial>; volume?: number }): void {
    if (budget.sfx >= MAX_SFX_PER_FRAME || budget.sfxIds.has(id)) return;
    budget.sfx++;
    budget.sfxIds.add(id);
    host.audio.sfx(id, opts ? opts() : undefined);
  }

  /** Consume one pairing for (kind, agent): true when the engine's own notification already shows this event. */
  private takeCovered(b: FrameBudget, kind: string, agentId: unknown): boolean {
    const key = pairKey(kind, agentId);
    const n = key ? b.covered.get(key) ?? 0 : 0;
    if (!key || n <= 0) return false;
    b.covered.set(key, n - 1);
    return true;
  }

  private spatial(sim: SimulationAPI, ev: Located, host: RouterHost) {
    const p = eventWorldPos(sim, ev);
    return p ? computeSpatial(p, host.renderer, host.viewport()) : undefined;
  }

  private routeOne(sim: SimulationAPI, ev: SimEvent, host: RouterHost, budget: FrameBudget): void {
    const interactive = host.interactive();
    switch (ev.type) {
      case 'sfx': {
        if (!interactive || !isSfxId(ev.id)) return;
        const volume = Number.isFinite(ev.volume) ? clamp(ev.volume as number, 0, 1) : undefined;
        this.playSfx(host, budget, ev.id, () => ({ spatial: this.spatial(sim, ev, host), volume }));
        return;
      }
      case 'sfxLoop': {
        if (!interactive || !isSfxId(ev.id) || typeof ev.key !== 'string' || ev.key.length === 0) return;
        this.suspended.delete(ev.key); // the sim's own latest word on this key wins over a remembered loop
        if (ev.on) {
          const src: LoopSource = {
            id: ev.id,
            pos: finiteVec(ev.pos) ? { x: ev.pos.x, z: ev.pos.z } : null,
            agentId: typeof ev.agentId === 'string' ? ev.agentId : null,
            objectId: typeof ev.objectId === 'string' ? ev.objectId : null,
          };
          // Events are routed after the ticks that produced them: an emitter already gone (removed earlier in this
          // batch, or a zombie no longer on the lot) must not start a loop nothing would ever stop.
          if (this.emitterGone(sim, src)) {
            const prev = this.loops.get(ev.key); // this key's latest state is "not playing"
            if (prev) {
              this.loops.delete(ev.key);
              host.audio.loop(ev.key, prev.id, false);
            }
            if (this.objectGone(sim, src)) this.suspend(ev.key, src); // ...until its object comes back
            return;
          }
          if (!this.loops.has(ev.key) && this.loops.size >= MAX_TRACKED_LOOPS) return;
          this.loops.set(ev.key, src);
          host.audio.loop(ev.key, ev.id, true, this.spatial(sim, ev, host));
        } else {
          this.loops.delete(ev.key);
          host.audio.loop(ev.key, ev.id, false);
        }
        return;
      }
      case 'voice': {
        if (!interactive || !isVoiceEmotion(ev.emotion) || budget.voices >= MAX_VOICES_PER_FRAME) return;
        const a = sim.agent(ev.agentId);
        if (!a || a.presence !== 'onLot') return;
        budget.voices++;
        const ms = clamp(Number.isFinite(ev.durationMs) ? ev.durationMs : 900, 150, 6000);
        const pitch = clamp(Number.isFinite(a.appearance?.voicePitch) ? a.appearance.voicePitch : 0.5, 0, 1);
        const seed = Number.isFinite(a.voiceSeed) ? a.voiceSeed : hashSeed(a.id);
        host.audio.voice(seed, pitch, ev.emotion, ms, this.spatial(sim, { agentId: ev.agentId }, host));
        return;
      }
      case 'music':
        if (interactive) host.onMusic(ev.mood);
        return;
      case 'notify': {
        if (!interactive) return;
        const n = findNotification(sim, ev.id);
        if (!n) return;
        // De-duplicated by content only: two different skill-ups of one zombie are two toasts.
        const t = host.toasts.push({ kind: n.kind, title: n.title, text: n.text, agentId: n.agentId, objectId: n.objectId });
        const key = pairKey(n.kind, n.agentId);
        const stingCovers = key !== null && (budget.semantic.get(key) ?? 0) > 0; // the achievement's own sting plays
        if (t && !stingCovers) this.playSfx(host, budget, BAD_KINDS.has(n.kind) ? 'notifyBad' : 'notify');
        return;
      }
      case 'bubble': {
        if (!interactive || typeof ev.agentId !== 'string' || typeof ev.icon !== 'string') return;
        const mps = Math.max(1, host.gameMinutesPerSecond());
        const ms = Number.isFinite(ev.durationMin) && (ev.durationMin as number) > 0
          ? clamp(((ev.durationMin as number) * 1000) / mps, MIN_BUBBLE_MS, MAX_BUBBLE_MS)
          : DEFAULT_BUBBLE_MS;
        host.bubbles.push({ agentId: ev.agentId, icon: ev.icon, style: ev.style, positive: ev.positive !== false, until: host.now() + ms });
        return;
      }
      case 'choice':
        if (!interactive || typeof ev.choiceId !== 'string') return;
        budget.choiceId = ev.choiceId; // auto-pause + UI flush once per batch (see route())
        this.playSfx(host, budget, 'notify');
        return;
      case 'skillUp': {
        if (!interactive) return;
        if (!this.takeCovered(budget, 'skill', ev.agentId)) {
          const name = skillName(sim, String(ev.skill));
          const level = Number.isFinite(ev.level) ? ev.level : 0;
          host.toasts.push({ kind: 'skill', title: `${firstName(sim, ev.agentId)} improved ${name}`, text: `${name} is now level ${level}.`, agentId: ev.agentId });
        }
        this.playSfx(host, budget, 'skillUp');
        return;
      }
      case 'promotion': {
        if (!interactive) return;
        if (!this.takeCovered(budget, 'career', ev.agentId)) {
          const title = typeof ev.title === 'string' && ev.title ? ev.title : `level ${ev.level}`;
          host.toasts.push({ kind: 'career', title: 'Promotion!', text: `${firstName(sim, ev.agentId)} is now ${title}.`, agentId: ev.agentId });
        }
        this.playSfx(host, budget, 'promotion');
        return;
      }
      case 'milestone': {
        if (!interactive) return;
        if (!this.takeCovered(budget, 'good', ev.agentId)) {
          const m = milestoneLabel(sim, ev.aspirationId, ev.milestoneId);
          host.toasts.push({
            kind: 'good',
            title: 'Aspiration milestone',
            text: `${firstName(sim, ev.agentId)}: ${m.label}${m.points !== null ? ` (+${m.points} points)` : ''}`,
            agentId: ev.agentId,
          });
        }
        this.playSfx(host, budget, 'milestone');
        return;
      }
      case 'gameOver':
        host.onGameOver(typeof ev.reason === 'string' && ev.reason ? ev.reason : 'Rest in Pieces');
        return;
      case 'focus':
        if (!interactive) return;
        // Last one wins: a burst of focus events must not yank the camera around within one frame.
        if (typeof ev.agentId === 'string') budget.focus = ev.agentId;
        else if (finiteVec(ev.pos)) budget.focus = { x: ev.pos.x, z: ev.pos.z };
        return;
      case 'interactionFailed':
        // The engine already posts a 'bad' notification for player-sourced failures (README §7); toasting here too
        // would show every failure twice. Autonomous failures are intentionally silent.
        return;
      case 'agentDespawned':
        // Backlog #3: that zombie's loops stop now (not at the next slow-tick refresh), whatever else they track.
        if (typeof ev.agentId === 'string') this.stopLoopsWhere(host, (src) => src.agentId === ev.agentId, false);
        host.bubbles.removeAgent(ev.agentId);
        host.onAgentLeft(ev.agentId);
        return;
      case 'objectRemoved':
        // Backlog #3: every loop of the removed object stops (stereo sold mid-song, fire put out, TV repossessed).
        if (typeof ev.objectId === 'string') this.stopLoopsWhere(host, (src) => src.objectId === ev.objectId, true);
        host.onObjectRemoved(ev.objectId);
        return;
      case 'objectAdded':
        // Build undo / redo re-inserts an object under its old id: its silenced loops resume (see the module doc).
        if (interactive && typeof ev.objectId === 'string' && this.suspended.size > 0) this.resumeLoopsOf(sim, host, ev.objectId);
        return;
      case 'lot':
        budget.lotChanged = true; // previews/ghosts re-validate once per batch
        return;
      case 'questProgress': {
        // W-116 (D-061): a story step credited from something the player already did since the arc began.
        if (!interactive || !(typeof ev.credited === 'number' && ev.credited > 0)) return;
        const label = creditedStepLabel(sim, ev.questId, ev.stepId);
        host.toasts.push({ kind: 'good', title: en['story.credit.title'], text: label ? `${label} — ${en['story.credit.note']}` : en['story.credit.note'], agentId: null });
        return;
      }
      case 'questCompleted':
        // Rewards were just granted: save soon (debounced event-driven autosave, design §4.2).
        if (interactive) host.onSaveWorthy?.('quest');
        return;
      case 'job': {
        // W-124 (D-071): a household job finished (nothing left / its one real completion) or got blocked.
        if (!interactive || (ev.what !== 'done' && ev.what !== 'blocked')) return;
        const cat = jobCategory(ev.category);
        const who = firstName(sim, ev.agentId);
        if (ev.what === 'done') {
          const title = ev.reason === 'recurring' ? `${who} is done ${cat ? cat.verb : 'working'} for now` : ev.reason === 'nothing' ? `Nothing to do for ${who}` : `${who} finished ${cat ? cat.verb : 'the job'}`;
          const text = ev.reason === 'recurring' ? 'Back at it in the next daily window.' : ev.reason === 'nothing' ? `${cat ? cat.label : 'That job'}: nothing needed doing.` : `${cat ? cat.label : 'Job'} done — nothing left to do.`;
          host.toasts.push({ kind: 'good', title, text, agentId: ev.agentId, mergeKey: `job:${ev.jobId}` });
        } else {
          host.toasts.push({ kind: 'warning', title: `${who}'s ${cat ? cat.label.toLowerCase() : 'job'} is on hold`, text: typeof ev.reason === 'string' && ev.reason ? ev.reason : 'Nothing can be done right now.', agentId: ev.agentId, mergeKey: `job:${ev.jobId}` });
        }
        return;
      }
      default:
        // fx, agentSpawned, funds: renderer/HUD read them from state; nothing to route.
        return;
    }
  }
}
