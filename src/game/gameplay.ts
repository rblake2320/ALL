/**
 * In-game interaction state behind the GameController facade: speed (with pause holds + ultra gating), view mode,
 * selection, wall mode, the live-mode interaction menu, dialogs, choice auto-pause, phone actions and build
 * commands. Every sim call goes through GameSession.dispatch (fault barrier + change counting).
 */
import { storyTargetOf, type StoryTarget } from '../shared/storyTarget';
import type { DialogId, OpenMenu, Settings, Screen } from './contracts';
import type { BuildCommand, Command, CommandResult, HomeCommand, JobCommand, MenuEntry, PetCommand, SimulationAPI } from '../sim/contracts';
import type { AgentId, EdgeKey, NotificationKind, ObjectId, Speed, TargetRef } from '../sim/types';
import type { Perspective, RendererAPI, ViewMode, WallMode } from '../render/contracts';
import type { AudioAPI } from '../audio/contracts';
import type { SfxId } from '../shared/audioIds';
import { ENGINE_INTERACTIONS } from '../sim/vocabulary';
import type { WorldRouteResult, WorldRouteTarget } from '../shared/world';
import { ROUTE_REASON_TEXT, echoTarget } from '../shared/worldRoute';
import { SpeedState, gateSpeed, isSpeed, ultraAllowed, type PauseHold } from './speed';
import type { GameSession } from './session';
import { NAME_MAX, nameProblem } from './cazState';
import { petCommandFor, petMenuFor, type PetTargetKind } from './petMenu';
import { homeMenuEntries, homeServiceOfEntry } from './homeMenu';
import { HOME_DIALOG_SERVICES, type HomeDialogService } from '../shared/homeServices';
import { isPresetHouseholdName } from './names';
import { homeRegionIdOf } from '../shared/town';

export const DIALOG_IDS: readonly Exclude<DialogId, null>[] = [
  'settings', 'saveLoad', 'pause', 'help', 'phone', 'careers', 'invite', 'rewards', 'household', 'confirmQuit', 'credits', 'diagnostics', 'store', 'feedback', 'homeService',
];
/** System dialogs pause the world and duck music; HUD dialogs (phone, careers, ...) do not. */
export const PAUSING_DIALOGS: ReadonlySet<DialogId> = new Set<DialogId>(['settings', 'saveLoad', 'pause', 'help', 'confirmQuit', 'credits', 'diagnostics', 'store', 'feedback']);
export const WALL_MODES: readonly WallMode[] = ['up', 'cutaway', 'down'];
/** W-136 cycle order: down from the overview to the shoulder, into the eyes, back up. */
export const PERSPECTIVES: readonly Perspective[] = ['overview', 'shoulder', 'firstPerson'];
export const VIEW_MODES: readonly ViewMode[] = ['live', 'buy', 'build'];

/** Synthetic menu entries handled by the controller itself (never dispatched to the sim). */
export const SELECT_ENTRY_ID = '__game_select';

export interface DialogOptions {
  returnTo?: DialogId;
  mode?: 'save' | 'load';
  /** The home services screen to show (dialog 'homeService'). */
  service?: HomeDialogService;
}

/** Validated dialog options: returnTo must be another real dialog; mode only 'save' | 'load'. */
export function sanitizeDialogOptions(d: DialogId, raw: unknown): DialogOptions | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const out: DialogOptions = {};
  if (isDialogId(o.returnTo) && o.returnTo !== d) out.returnTo = o.returnTo;
  if (o.mode === 'save' || o.mode === 'load') out.mode = o.mode;
  if (d === 'homeService' && (HOME_DIALOG_SERVICES as readonly unknown[]).includes(o.service)) out.service = o.service as HomeDialogService;
  return out.returnTo !== undefined || out.mode !== undefined || out.service !== undefined ? out : null;
}

export function isDialogId(v: unknown): v is Exclude<DialogId, null> {
  return typeof v === 'string' && (DIALOG_IDS as readonly string[]).includes(v);
}

export interface GameplayHost {
  readonly renderer: RendererAPI;
  readonly audio: AudioAPI;
  session(): GameSession | null;
  screen(): Screen;
  settings(): Settings;
  /** May the profile type names? false = child / unanswered profile: preset names only (D-3). */
  freeTextNames(): boolean;
  /** May this profile give a pet of `species` its undead look? 'locked' = sold but not unlocked, 'comingSoon' = not sold yet. */
  petVariantAccess(species: string): 'ok' | 'locked' | 'comingSoon';
  toast(kind: NotificationKind, title: string, text: string, opts?: { agentId?: AgentId | null; mergeKey?: string }): void;
  sfx(id: SfxId): void;
  report(where: string, err: unknown): void;
  changed(discrete: boolean): void;
  /** Mode changed: input handlers drop transient state. */
  onModeChanged(prev: ViewMode, next: ViewMode): void;
  /** World changed by a build command / undo: refresh ghosts and previews. */
  onWorldEdited(): void;
}

const BUILD_SFX: Partial<Record<BuildCommand['type'], SfxId>> = {
  buy: 'placeObject',
  buyWallItem: 'placeObject',
  buyOpening: 'doorPlace',
  move: 'placeObject',
  moveWallItem: 'placeObject',
  moveOpening: 'doorPlace',
  sell: 'sellObject',
  addWalls: 'wallBuild',
  removeWalls: 'wallDelete',
  room: 'wallBuild',
  floor: 'floorPaint',
  paintWall: 'wallPaint',
  paintRoom: 'wallPaint',
};

export class Gameplay {
  readonly speed = new SpeedState();
  mode: ViewMode = 'live';
  selectedAgentId: AgentId | null = null;
  wallMode: WallMode = 'cutaway';
  perspective: Perspective = 'overview';
  menu: OpenMenu | null = null;
  dialog: DialogId = null;
  dialogOptions: DialogOptions | null = null;
  hoverLabel: string | null = null;
  gridHover: { x: number; z: number; edge: EdgeKey | null } | null = null;
  buildPreviewLabel: string | null = null;
  private lastAudioSpeed: Speed | null = null;

  constructor(private readonly host: GameplayHost) {}

  private sim(): SimulationAPI | null {
    return this.host.session()?.sim ?? null;
  }

  private guard(where: string, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.host.report(where, e);
    }
  }

  // ───────────────────────────── speed ─────────────────────────────

  get effectiveSpeed(): Speed {
    return this.speed.effective;
  }

  householdMembers(sim: SimulationAPI) {
    const ids = Array.isArray(sim.state?.household?.memberIds) ? sim.state.household.memberIds : [];
    return ids.map((id) => sim.state.agents?.[id]).filter((a) => !!a);
  }

  isUltraAllowed(): boolean {
    const sim = this.sim();
    if (!sim) return false;
    try {
      return ultraAllowed(this.householdMembers(sim));
    } catch {
      return false;
    }
  }

  setSpeed(s: Speed, byPlayer = true): void {
    const session = this.host.session();
    if (!session || this.host.screen() !== 'game' || !isSpeed(s)) return;
    const before = this.speed.effective;
    const gated = gateSpeed(s, this.isUltraAllowed());
    if (gated.clamped) {
      this.host.toast('info', 'Ultra speed unavailable', 'Ultra speed only works while every zombie at home is asleep (or away at work).', { mergeKey: 'ultra' });
      this.host.sfx('uiError');
    }
    this.speed.set(gated.speed);
    if (byPlayer) session.facts.speedChanged = true;
    if (this.speed.effective !== before) this.host.sfx('speedChange');
    this.syncAudioSpeed();
    this.host.changed(true);
  }

  togglePause(): void {
    const session = this.host.session();
    if (!session || this.host.screen() !== 'game') return;
    this.speed.toggle();
    if (this.speed.effective === 4 && !this.isUltraAllowed()) this.speed.demote(3);
    session.facts.speedChanged = true;
    this.host.sfx('speedChange');
    this.syncAudioSpeed();
    this.host.changed(true);
  }

  hold(h: PauseHold): void {
    if (this.speed.addHold(h)) {
      this.syncAudioSpeed();
      this.host.changed(true);
    }
  }

  release(h: PauseHold): void {
    if (this.speed.releaseHold(h)) {
      this.syncAudioSpeed();
      this.host.changed(true);
    }
  }

  /** Per frame: drop out of ultra as soon as someone wakes up or comes home. */
  enforceUltra(): void {
    if (this.speed.chosen !== 4 || this.host.screen() !== 'game') return;
    if (this.isUltraAllowed()) return;
    this.speed.demote(3);
    this.host.toast('info', 'Back to fast speed', 'Someone is awake — ultra speed paused.', { mergeKey: 'ultra' });
    this.syncAudioSpeed();
    this.host.changed(true);
  }

  syncAudioSpeed(): void {
    const s = this.speed.effective;
    if (s === this.lastAudioSpeed) return;
    this.lastAudioSpeed = s;
    this.guard('audio.setGameSpeed', () => this.host.audio.setGameSpeed(s));
  }

  // ───────────────────────────── mode ─────────────────────────────

  setMode(m: ViewMode): void {
    const session = this.host.session();
    if (!session || this.host.screen() !== 'game' || !(VIEW_MODES as readonly string[]).includes(m)) return;
    if (m === this.mode) return;
    const prev = this.mode;
    this.mode = m;
    this.closeMenu();
    if (m === 'live') {
      // Leaving buy/build ends the build session (clears undo history) and resumes time if building paused it.
      session.dispatch({ type: 'endBuildSession' });
      this.release('build');
    } else if (prev === 'live') {
      this.hold('build');
    }
    if (m === 'buy') session.facts.enteredBuy = true;
    if (m === 'build') session.facts.enteredBuild = true;
    this.buildPreviewLabel = null;
    this.gridHover = null;
    this.hoverLabel = null;
    // Buy and Build are done from above (W-136)
    if (m !== 'live') this.setPerspective('overview');
    this.guard('renderer.setViewMode', () => this.host.renderer.setViewMode(m));
    this.host.onModeChanged(prev, m);
    this.host.sfx(m === 'live' ? 'modeLive' : m === 'buy' ? 'modeBuy' : 'modeBuild');
    this.host.changed(true);
  }

  // ───────────────────────────── selection ─────────────────────────────

  selectableIds(sim: SimulationAPI): AgentId[] {
    const ids = Array.isArray(sim.state?.household?.memberIds) ? sim.state.household.memberIds : [];
    return ids.filter((id) => {
      const a = sim.state.agents?.[id];
      return !!a && a.presence !== 'crumbled' && a.presence !== 'gone';
    });
  }

  selectAgent(id: AgentId | null, focusCamera = false, byPlayer = true): void {
    const sim = this.sim();
    if (!sim) return;
    if (id !== null && !this.selectableIds(sim).includes(id)) return;
    const changed = id !== this.selectedAgentId;
    this.selectedAgentId = id;
    if (changed) this.closeMenu();
    const session = this.host.session();
    if (byPlayer && session && id !== null) session.facts.playerSelected = true;
    this.guard('renderer.setSelection', () => this.host.renderer.setSelection(id));
    // a close view belongs to one zombie: it moves to the newly selected one, or ends when that one is not at home
    if (changed && this.perspective !== 'overview') this.applyPerspective(this.perspective);
    if (focusCamera && id !== null) {
      const a = sim.agent(id);
      if (a && a.presence === 'onLot') this.guard('renderer.focus', () => this.host.renderer.focus(id));
      else if (a && byPlayer) this.host.toast('info', `${a.firstName} isn't home`, a.presence === 'atWork' ? `${a.firstName} is at work.` : `${a.firstName} is out.`, { mergeKey: `away:${id}` });
    }
    if (changed) this.host.changed(true);
  }

  cycleSelection(dir: 1 | -1): void {
    const sim = this.sim();
    if (!sim) return;
    const ids = this.selectableIds(sim);
    if (ids.length === 0) return;
    const i = this.selectedAgentId ? ids.indexOf(this.selectedAgentId) : -1;
    const step = dir === -1 ? -1 : 1;
    const nextIndex = i < 0 ? (step > 0 ? 0 : ids.length - 1) : (i + step + ids.length) % ids.length;
    this.selectAgent(ids[nextIndex], true, true);
  }

  /** Keep the selection valid (member crumbled / moved out); prefer someone at home. */
  maintainSelection(): void {
    const sim = this.sim();
    if (!sim) return;
    const ids = this.selectableIds(sim);
    if (this.selectedAgentId && ids.includes(this.selectedAgentId)) return;
    const home = ids.find((id) => sim.state.agents[id]?.presence === 'onLot');
    this.selectAgent(home ?? ids[0] ?? null, false, false);
  }

  // ───────────────────────────── wall mode ─────────────────────────────

  setWallMode(m: WallMode): void {
    if (!(WALL_MODES as readonly string[]).includes(m)) return;
    this.wallMode = m;
    this.guard('renderer.setWallMode', () => this.host.renderer.setWallMode(m));
    this.host.changed(true);
  }

  cycleWallMode(): void {
    const i = WALL_MODES.indexOf(this.wallMode);
    this.setWallMode(WALL_MODES[(i + 1) % WALL_MODES.length]);
    this.host.sfx('uiToggle');
  }

  // ───────────────────────────── perspective (W-136) ─────────────────────────────

  /** Why a close view cannot start right now (null = it can). */
  perspectiveBlock(): 'mode' | 'noZombie' | 'away' | 'unsupported' | null {
    const sim = this.sim();
    if (!sim || !this.host.session() || this.host.screen() !== 'game') return 'noZombie';
    if (this.mode !== 'live') return 'mode';
    const a = this.selectedAgentId ? sim.agent(this.selectedAgentId) : null;
    if (!a) return 'noZombie';
    if (a.presence !== 'onLot') return 'away';
    if (typeof this.host.renderer.setPerspective !== 'function') return 'unsupported';
    return null;
  }

  setPerspective(p: Perspective): void {
    if (!(PERSPECTIVES as readonly string[]).includes(p)) return;
    if (p !== 'overview') {
      const block = this.perspectiveBlock();
      if (block !== null) {
        const sim = this.sim();
        const a = sim && this.selectedAgentId ? sim.agent(this.selectedAgentId) : null;
        if (block === 'away' && a) this.host.toast('info', `${a.firstName} isn't home`, 'That view needs a zombie who is at home.', { mergeKey: 'perspective:away' });
        else if (block === 'mode') this.host.toast('info', 'Live mode only', 'Switch to Live to look over a shoulder or through a zombie\u2019s eyes.', { mergeKey: 'perspective:mode' });
        else if (block === 'noZombie') this.host.toast('info', 'Pick a zombie first', 'Select a household member, then change the view.', { mergeKey: 'perspective:none' });
        return;
      }
    }
    this.applyPerspective(p);
  }

  /** Ask the renderer for `p` on the selected zombie and record what it actually gave. */
  private applyPerspective(p: Perspective): void {
    const r = this.host.renderer;
    const res: { now: Perspective } = { now: 'overview' };
    if (typeof r.setPerspective === 'function') {
      const wanted: Perspective = p !== 'overview' && this.perspectiveBlock() === null ? p : 'overview';
      this.guard('renderer.setPerspective', () => {
        const got = r.setPerspective!(wanted, wanted === 'overview' ? null : this.selectedAgentId);
        res.now = (PERSPECTIVES as readonly string[]).includes(got) ? got : 'overview';
      });
    }
    if (res.now === this.perspective) return;
    this.perspective = res.now;
    this.host.changed(true);
  }

  cyclePerspective(): void {
    const before = this.perspective;
    const i = PERSPECTIVES.indexOf(this.perspective);
    this.setPerspective(PERSPECTIVES[(i + 1) % PERSPECTIVES.length]);
    this.host.sfx(this.perspective !== before ? 'uiToggle' : 'uiError');
  }

  /**
   * Per frame: the renderer hands the view back by itself when the zombie stops being drawn (walked off the lot,
   * crumbled); the game follows what is on screen. Returns true when the perspective changed.
   */
  syncPerspective(): boolean {
    if (this.perspective === 'overview') return false;
    const r = this.host.renderer;
    const res: { now: Perspective } = { now: 'overview' };
    if (typeof r.getPerspective === 'function') {
      this.guard('renderer.getPerspective', () => {
        const got = r.getPerspective!();
        res.now = (PERSPECTIVES as readonly string[]).includes(got) ? got : 'overview';
      });
    }
    if (res.now === this.perspective) return false;
    this.perspective = res.now;
    this.host.changed(true);
    return true;
  }

  // ───────────────────────────── interaction menu ─────────────────────────────

  private targetTitle(sim: SimulationAPI, actorId: AgentId, target: TargetRef): string {
    switch (target.kind) {
      case 'object':
        return sim.objectView(target.id)?.name ?? 'Object';
      case 'agent':
        return sim.summary(target.id)?.name ?? 'Zombie';
      case 'self':
        return sim.agent(actorId)?.firstName ?? 'Self';
      case 'tile':
        return 'Here';
    }
  }

  openMenuFor(target: TargetRef, x: number, y: number, viewport: { width: number; height: number }): void {
    const sim = this.sim();
    const session = this.host.session();
    if (!sim || !session || this.host.screen() !== 'game' || this.mode !== 'live' || !target || typeof target !== 'object') return;
    const actorId = this.selectedAgentId;
    if (!actorId) {
      this.host.toast('info', 'Select a zombie first', 'Click one of your household zombies (or their portrait) to give orders.', { mergeKey: 'noSelection' });
      return;
    }
    const actor = sim.agent(actorId);
    if (!actor || actor.presence !== 'onLot') {
      this.host.toast('info', `${actor?.firstName ?? 'They'} can't do that now`, actor?.presence === 'atWork' ? 'Away at work.' : 'Not at home.', { mergeKey: `away:${actorId}` });
      return;
    }
    let entries: MenuEntry[] = [];
    try {
      const raw = sim.menu(actorId, target);
      entries = Array.isArray(raw) ? raw.filter((e) => e && typeof e.interactionId === 'string' && typeof e.label === 'string') : [];
    } catch (e) {
      this.host.report('sim.menu', e);
    }
    if (target.kind === 'object') entries.push(...homeMenuEntries(sim.state, target.id));
    if (target.kind === 'tile' && !entries.some((e) => e.interactionId === ENGINE_INTERACTIONS.goHere)) {
      entries.unshift({ interactionId: ENGINE_INTERACTIONS.goHere, label: 'Go Here', group: null, icon: 'house', available: true, reason: null, cost: null, params: {} });
    }
    if (target.kind === 'agent' && target.id !== actorId && this.selectableIds(sim).includes(target.id)) {
      const other = sim.agent(target.id);
      entries.unshift({ interactionId: SELECT_ENTRY_ID, label: `Control ${other?.firstName ?? 'zombie'}`, group: null, icon: 'star', available: true, reason: null, cost: null, params: { agentId: target.id } });
    }
    const title = this.targetTitle(sim, actorId, target);
    if (entries.length === 0) {
      this.host.toast('info', title, 'Nothing to do here right now.', { mergeKey: 'emptyMenu' });
      return;
    }
    const vx = Number.isFinite(x) ? Math.min(Math.max(0, x), Math.max(0, viewport.width)) : viewport.width / 2;
    const vy = Number.isFinite(y) ? Math.min(Math.max(0, y), Math.max(0, viewport.height)) : viewport.height / 2;
    this.menu = { actorId, target: { ...target }, title, entries, x: vx, y: vy };
    session.facts.menuOpened = true;
    this.host.sfx('uiOpen');
    this.host.changed(true);
  }

  /** A stray's or a household pet's click menu (W-013): rows from the world's pets block, choices go to the pets system. */
  openPetMenu(kind: PetTargetKind, id: string, x: number, y: number, viewport: { width: number; height: number }): void {
    const sim = this.sim();
    const session = this.host.session();
    if (!sim || !session || this.host.screen() !== 'game' || this.mode !== 'live' || typeof id !== 'string') return;
    const actorId = this.selectedAgentId;
    if (!actorId) {
      this.host.toast('info', 'Select a zombie first', 'Click one of your household zombies (or their portrait) to give orders.', { mergeKey: 'noSelection' });
      return;
    }
    const actor = sim.agent(actorId);
    if (!actor || actor.presence !== 'onLot' || (actor.regionId ?? homeRegionIdOf(sim.state)) !== homeRegionIdOf(sim.state)) {
      this.host.toast('info', `${actor?.firstName ?? 'They'} can't do that now`, actor?.presence === 'atWork' ? 'Away at work.' : 'Not at home.', { mergeKey: `away:${actorId}` });
      return;
    }
    const m = petMenuFor(sim.state, kind, id);
    if (!m) return;
    const vx = Number.isFinite(x) ? Math.min(Math.max(0, x), Math.max(0, viewport.width)) : viewport.width / 2;
    const vy = Number.isFinite(y) ? Math.min(Math.max(0, y), Math.max(0, viewport.height)) : viewport.height / 2;
    this.menu = { actorId, target: { kind: 'tile', x: Math.floor(m.x), z: Math.floor(m.z) }, title: m.title, entries: m.entries, x: vx, y: vy };
    this.host.sfx('uiOpen');
    this.host.changed(true);
  }

  closeMenu(): boolean {
    if (!this.menu) return false;
    this.menu = null;
    this.host.changed(true);
    return true;
  }

  /** Close the menu if its actor or target is gone. */
  validateMenu(): void {
    const m = this.menu;
    const sim = this.sim();
    if (!m) return;
    if (!sim) return void this.closeMenu();
    const actor = sim.agent(m.actorId);
    if (!actor || actor.presence !== 'onLot' || m.actorId !== this.selectedAgentId) return void this.closeMenu();
    if (m.target.kind === 'object' && !sim.object(m.target.id)) return void this.closeMenu();
    if (m.target.kind === 'agent') {
      const t = sim.agent(m.target.id);
      if (!t || t.presence !== 'onLot') this.closeMenu();
    }
  }

  chooseMenuEntry(entryArg: MenuEntry, childArg?: MenuEntry): void {
    // Re-validate NOW: the actor may have left for work, or the target burned / was repossessed / despawned since
    // the menu opened (the 500 ms upkeep may not have run yet). A stale menu closes instead of dispatching.
    this.validateMenu();
    const m = this.menu;
    const session = this.host.session();
    if (!m || !session || !entryArg || typeof entryArg !== 'object' || typeof entryArg.interactionId !== 'string') return;
    // Only entries of THIS menu (and children of that entry) may be dispatched — never a stale or forged one.
    const entry = findEntry(m.entries, entryArg);
    if (!entry) {
      this.host.report('menu.choose', new Error(`entry "${String(entryArg.interactionId)}" is not in the open menu`));
      this.host.sfx('uiError');
      this.closeMenu();
      return;
    }
    if (entry.interactionId === SELECT_ENTRY_ID) {
      const id = entry.params?.agentId;
      this.closeMenu();
      if (typeof id === 'string') this.selectAgent(id, false, true);
      return;
    }
    const homeService = homeServiceOfEntry(entry);
    if (homeService) {
      this.closeMenu();
      this.openDialog('homeService', { service: homeService });
      return;
    }
    const petCmd = petCommandFor(entry, m.actorId);
    if (petCmd) {
      if (!entry.available) {
        this.host.toast('warning', entry.label, entry.reason ?? "Can't do that right now.", { mergeKey: `menuNo:${entry.interactionId}` });
        this.host.sfx('uiError');
        this.closeMenu();
        return;
      }
      const r = session.dispatch(petCmd as never);
      if (r.ok) this.host.sfx('uiClick');
      else {
        this.host.toast('warning', entry.label, r.reason ?? "Couldn't do that.", { mergeKey: `menuFail:${entry.interactionId}` });
        this.host.sfx('uiError');
      }
      this.closeMenu();
      return;
    }
    const kids = Array.isArray(entry.children) ? entry.children : [];
    const hasChildren = kids.length > 0;
    if (hasChildren && !childArg) return; // the UI shows the child list
    let child: MenuEntry | undefined;
    if (childArg !== undefined && childArg !== null) {
      child = hasChildren ? findEntry(kids, childArg) : undefined;
      if (!child) {
        this.host.report('menu.choose', new Error(`child "${String((childArg as MenuEntry).interactionId)}" does not belong to "${entry.interactionId}"`));
        this.host.sfx('uiError');
        return;
      }
    }
    const chosen = child ?? entry;
    if (!chosen.available) {
      this.host.toast('warning', chosen.label, chosen.reason ?? "Can't do that right now.", { mergeKey: `menuNo:${chosen.interactionId}` });
      this.host.sfx('uiError');
      this.closeMenu();
      return;
    }
    const interactionId = typeof chosen.interactionId === 'string' && chosen.interactionId ? chosen.interactionId : entry.interactionId;
    const params = { ...(entry.params ?? {}), ...(child?.params ?? {}) };
    const r = session.dispatch({ type: 'queue', actorId: m.actorId, interactionId, target: m.target, params });
    if (r.ok) {
      session.facts.queuedAction = true;
      this.host.sfx('uiClick');
    } else {
      this.host.toast('warning', chosen.label, r.reason ?? "Couldn't queue that.", { mergeKey: `menuFail:${interactionId}` });
      this.host.sfx('uiError');
    }
    this.closeMenu();
  }

  cancelQueueItem(uid: number): void {
    const sim = this.sim();
    const session = this.host.session();
    if (!sim || !session || !Number.isFinite(uid)) return;
    let actorId: AgentId | null = null;
    for (const id of this.selectableIds(sim)) {
      const a = sim.state.agents[id];
      if (a && (a.active?.uid === uid || a.queue?.some((q) => q.uid === uid))) {
        actorId = id;
        break;
      }
    }
    actorId = actorId ?? this.selectedAgentId;
    if (!actorId) return;
    const r = session.dispatch({ type: 'cancel', actorId, uid });
    if (r.ok) this.host.sfx('uiClose');
    else if (r.reason) this.host.toast('warning', "Can't cancel that", r.reason, { mergeKey: 'cancelFail' });
    this.host.changed(true);
  }

  /**
   * W-025 S3 (DESIGN_WORLD_LEVELS §1.16): "walk there" to a region-local tile anywhere in the world — a map pin, a
   * keyboard choice or a tap that S5 resolved to a region. Plans first (`sim.worldRoute`), then dispatches the
   * journaled `engine_goHere` with `params.regionId`. ALWAYS returns a `WorldRouteResult` (a route, or exactly one
   * reason code), and a refusal is also shown as a toast: never a silent failure (AC-14).
   */
  walkTo(actorId: AgentId, target: WorldRouteTarget): WorldRouteResult {
    const sim = this.sim();
    const session = this.host.session();
    const echo = echoTarget(target);
    const refuse = (r: WorldRouteResult): WorldRouteResult => {
      if (!r.ok) {
        this.host.toast('warning', 'Go Here', ROUTE_REASON_TEXT[r.reason], { mergeKey: `walkTo:${r.reason}` });
        this.host.sfx('uiError');
      }
      return r;
    };
    if (!sim || !session || typeof actorId !== 'string' || !this.selectableIds(sim).includes(actorId)) return refuse({ ok: false, target: echo, reason: 'noPath' });
    let plan: WorldRouteResult;
    try {
      plan = sim.worldRoute ? sim.worldRoute(actorId, target) : { ok: false, target: echo, reason: 'noPath' };
    } catch (e) {
      this.host.report('sim.worldRoute', e);
      plan = { ok: false, target: echo, reason: 'noPath' };
    }
    if (!plan.ok) return refuse(plan);
    const r: CommandResult = session.dispatch({ type: 'queue', actorId, interactionId: ENGINE_INTERACTIONS.goHere, target: { kind: 'tile', x: plan.target.x, z: plan.target.z }, params: { regionId: plan.target.regionId } });
    if (!r.ok) return refuse(r.route ?? { ok: false, target: plan.target, reason: 'noPath' });
    session.facts.queuedAction = true;
    this.host.sfx('uiClick');
    this.host.changed(true);
    return r.route ?? plan;
  }

  /** Phone action ('pizza', 'findJob', … or a phone_* interaction id) for the selected zombie. */
  phone(action: string, params: Record<string, string | number | boolean> = {}): void {
    const sim = this.sim();
    const session = this.host.session();
    if (!sim || !session || typeof action !== 'string' || action.length === 0) return;
    const actorId = this.selectedAgentId;
    if (!actorId) {
      this.host.toast('info', 'Select a zombie first', 'Phone calls need a zombie to make them.', { mergeKey: 'noSelection' });
      return;
    }
    const interactionId = resolvePhoneInteraction(sim, action);
    if (!interactionId) {
      this.host.toast('warning', 'No signal', `The phone can't do "${action}".`, { mergeKey: `phone:${action}` });
      this.host.sfx('uiError');
      return;
    }
    const safe: Record<string, string | number | boolean> = {};
    for (const k of Object.keys(params ?? {})) {
      const v = params[k];
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) safe[k] = v;
    }
    const r = session.dispatch({ type: 'queue', actorId, interactionId, target: { kind: 'self' }, params: safe });
    if (r.ok) {
      session.facts.queuedAction = true;
      this.host.sfx('phoneDial');
    } else {
      this.host.toast('warning', 'Phone', r.reason ?? "Couldn't make that call.", { mergeKey: `phoneFail:${interactionId}` });
      this.host.sfx('uiError');
    }
    this.host.changed(true);
  }

  // ───────────────────────────── camera & command wrappers ─────────────────────────────

  /** Centre the camera on an object (a held item follows its carrier). */
  focusObject(id: ObjectId): void {
    const sim = this.sim();
    if (!sim || typeof id !== 'string') return;
    const o = sim.object(id);
    if (!o) return;
    if (o.placement.kind === 'held') {
      const carrier = o.placement.agentId;
      this.guard('renderer.focus', () => this.host.renderer.focus(carrier));
      return;
    }
    let c: { x: number; z: number } | null = null;
    try {
      c = sim.spatial.objectCenter(o);
    } catch (e) {
      this.host.report('spatial.objectCenter', e);
    }
    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.z)) return;
    const target = { x: c.x, z: c.z };
    this.guard('renderer.focus', () => this.host.renderer.focus(target));
  }

  /** W-116: see GameController.frameObject. */
  frameObject(id: ObjectId, opts?: { screen?: { x: number; y: number }; instant?: boolean }): boolean {
    const sim = this.sim();
    if (!sim || typeof id !== 'string' || !sim.object(id)) return false;
    const r = this.host.renderer;
    const screen = opts && opts.screen && Number.isFinite(opts.screen.x) && Number.isFinite(opts.screen.y) ? opts.screen : null;
    if (screen && typeof r.frameAt === 'function') {
      let p: { x: number; y: number; z: number } | null = null;
      try {
        p = typeof r.objectPoint === 'function' ? r.objectPoint(id) : null;
        if (!p) {
          const c = sim.spatial.objectCenter(sim.object(id)!);
          if (c && Number.isFinite(c.x) && Number.isFinite(c.z)) p = { x: c.x, y: 0.5, z: c.z };
        }
      } catch (e) {
        this.host.report('frameObject.point', e);
      }
      let ok = false;
      if (p) this.guard('renderer.frameAt', () => (ok = r.frameAt!(p!, screen, !!(opts && opts.instant))));
      if (ok) return true;
    }
    this.focusObject(id);
    return true;
  }

  /** W-116: the running Act 1 step's target object (pure helper over the world; never throws). */
  storyTarget(): StoryTarget | null {
    const sim = this.sim();
    if (!sim) return null;
    try {
      const objs = sim.content.objects;
      return storyTargetOf(sim.state, (d) => objs[d]?.tags);
    } catch {
      return null;
    }
  }

  private noSession(): CommandResult {
    return { ok: false, reason: 'No game in progress' };
  }

  /** W-124 (D-071): a household-job command (journaled like every dispatch; the sim validates the payload). */
  job(cmd: JobCommand): CommandResult {
    const session = this.host.session();
    if (!session || this.host.screen() !== 'game') return this.noSession();
    if (!cmd || typeof cmd !== 'object' || typeof (cmd as { action?: unknown }).action !== 'string') return { ok: false, reason: 'Invalid job' };
    const r = session.dispatch({ ...cmd, type: 'job' } as Command);
    this.host.sfx(r.ok ? (cmd.action === 'cancel' ? 'uiClick' : 'uiConfirm') : 'uiError');
    this.host.changed(true);
    return r;
  }

  pet(cmd: PetCommand): CommandResult {
    const session = this.host.session();
    if (!session || this.host.screen() !== 'game') return this.noSession();
    if (!cmd || typeof cmd !== 'object' || typeof (cmd as { action?: unknown }).action !== 'string') return { ok: false, reason: 'Invalid pet command' };
    // The undead look is a store unlock (premium, "coming soon" for now): the sim does not know entitlements, so it is checked here
    if (cmd.action === 'look' && cmd.variant === 'undead') {
      const pet = this.sim()?.state.pets?.pets.find((x) => x.id === cmd.petId);
      const access = pet ? this.host.petVariantAccess(pet.species) : 'ok';
      if (access !== 'ok') {
        const reason = access === 'comingSoon' ? 'Undead pet looks arrive with a later update.' : 'Unlock this look in the Store first.';
        this.host.toast('info', 'Undead look', reason, { mergeKey: 'petLookLocked' });
        this.host.sfx('uiError');
        return { ok: false, reason };
      }
    }
    const r = session.dispatch({ ...cmd, type: 'pet' } as Command);
    this.host.sfx(r.ok ? 'uiConfirm' : 'uiError');
    this.host.changed(true);
    return r;
  }

  home(cmd: HomeCommand): CommandResult {
    const session = this.host.session();
    if (!session || this.host.screen() !== 'game') return this.noSession();
    if (!cmd || typeof cmd !== 'object' || typeof (cmd as { action?: unknown }).action !== 'string') return { ok: false, reason: 'Invalid home command' };
    const r = session.dispatch({ ...cmd, type: 'home' } as Command);
    this.host.sfx(r.ok ? 'uiConfirm' : 'uiError');
    this.host.changed(true);
    return r;
  }

  buyReward(agentId: AgentId, rewardId: string): CommandResult {
    const session = this.host.session();
    if (!session || this.host.screen() !== 'game') return this.noSession();
    if (typeof agentId !== 'string' || typeof rewardId !== 'string' || rewardId.length === 0 || rewardId.length > 64) return { ok: false, reason: 'Unknown reward' };
    const r = session.dispatch({ type: 'buyReward', agentId, rewardId });
    this.host.sfx(r.ok ? 'milestone' : 'uiError');
    this.host.changed(true);
    return r;
  }

  /** W-116 (D-063): the household's "Autonomous purchases" setting (sim-owned, saved with the world). */
  setAutoPurchases(value: 'off' | 'unlimited' | number): CommandResult {
    const session = this.host.session();
    if (!session || this.host.screen() !== 'game') return this.noSession();
    const r = session.dispatch({ type: 'setAutoPurchases', value });
    if (!r.ok) this.host.sfx('uiError');
    this.host.changed(true);
    return r;
  }

  renameHousehold(name: string): CommandResult {
    const session = this.host.session();
    if (!session || this.host.screen() !== 'game') return this.noSession();
    const problem = nameProblem(name);
    if (problem === 'control') return { ok: false, reason: "Names can't contain control characters." };
    if (problem !== null) return { ok: false, reason: `Household names must be 1–${NAME_MAX} characters.` };
    if (!this.host.freeTextNames() && !isPresetHouseholdName(name)) {
      this.host.sfx('uiError');
      return { ok: false, reason: 'Pick a household name from the list.' };
    }
    const r = session.dispatch({ type: 'renameHousehold', name: name.trim() });
    this.host.sfx(r.ok ? 'uiConfirm' : 'uiError');
    this.host.changed(true);
    return r;
  }

  markNotificationsRead(): void {
    const session = this.host.session();
    if (!session) return;
    const unread = session.sim.state?.notifications?.some((n) => n && n.read === false) ?? false;
    if (!unread) return; // idempotent: no command (and no autosave-worthy change) when nothing is unread
    session.dispatch({ type: 'markNotificationsRead' });
    this.host.changed(false);
  }

  // ───────────────────────────── dialogs & choices ─────────────────────────────

  openDialog(d: DialogId, opts?: DialogOptions): void {
    if (d === null) return this.closeDialog();
    if (!isDialogId(d)) return;
    this.dialog = d;
    this.dialogOptions = sanitizeDialogOptions(d, opts);
    this.closeMenu();
    const pausing = PAUSING_DIALOGS.has(d);
    if (pausing && this.host.screen() === 'game') this.hold('dialog');
    else this.release('dialog');
    this.guard('audio.setDucked', () => this.host.audio.setDucked(pausing));
    this.host.sfx('uiOpen');
    this.host.changed(true);
  }

  /** Closes the open dialog — or returns to its parent when it was opened with `returnTo` (innermost layer only). */
  closeDialog(): void {
    if (this.dialog === null) return;
    const parent = this.dialogOptions?.returnTo ?? null;
    if (parent !== null && isDialogId(parent) && parent !== this.dialog) {
      this.openDialog(parent);
      return;
    }
    this.dialog = null;
    this.dialogOptions = null;
    this.release('dialog');
    this.guard('audio.setDucked', () => this.host.audio.setDucked(false));
    this.host.sfx('uiClose');
    this.host.changed(true);
  }

  /** Close every dialog layer at once (game over, teardown) — ignores `returnTo`. */
  closeAllDialogs(): void {
    if (this.dialog === null && this.dialogOptions === null) return;
    this.dialog = null;
    this.dialogOptions = null;
    this.release('dialog');
    this.guard('audio.setDucked', () => this.host.audio.setDucked(false));
    this.host.changed(true);
  }

  pendingChoices(): number {
    const c = this.sim()?.state?.choices;
    return Array.isArray(c) ? c.length : 0;
  }

  onChoiceEvent(): void {
    if (this.host.settings().autoPauseOnEvents && this.host.screen() === 'game') this.hold('choice');
  }

  resolveChoice(choiceId: string, option: number): void {
    const session = this.host.session();
    if (!session || typeof choiceId !== 'string' || !Number.isInteger(option) || option < 0) return;
    const r = session.dispatch({ type: 'choice', choiceId, option });
    if (!r.ok && r.reason) this.host.toast('warning', 'Choice', r.reason, { mergeKey: `choice:${choiceId}` });
    this.host.sfx(r.ok ? 'uiConfirm' : 'uiError');
    this.maintainChoiceHold();
    this.host.changed(true);
  }

  /** Release the choice hold once no choice is pending (resolved, expired or auto-resolved). */
  maintainChoiceHold(): void {
    if (this.speed.hasHold('choice') && this.pendingChoices() === 0) this.release('choice');
  }

  // ───────────────────────────── build ─────────────────────────────

  applyBuild(cmd: BuildCommand): boolean {
    const session = this.host.session();
    if (!session || !cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') return false;
    const r = session.dispatch({ type: 'build', cmd });
    if (r.ok) {
      const s = BUILD_SFX[cmd.type];
      if (s) this.host.sfx(s);
    } else {
      this.host.sfx('placeInvalid');
      this.host.toast('warning', "Can't do that", r.reason ?? 'That build action failed.', { mergeKey: `build:${cmd.type}:${r.reason ?? ''}` });
    }
    this.host.onWorldEdited();
    this.host.changed(true);
    return r.ok;
  }

  undo(): void {
    this.history('undo');
  }

  redo(): void {
    this.history('redo');
  }

  private history(kind: 'undo' | 'redo'): void {
    const session = this.host.session();
    if (!session || this.mode === 'live') return;
    const can = kind === 'undo' ? this.canUndo : this.canRedo;
    if (!can) {
      this.host.sfx('uiError');
      return;
    }
    const r = session.dispatch({ type: kind });
    this.host.sfx(r.ok ? 'undo' : 'uiError');
    if (!r.ok && r.reason) this.host.toast('warning', kind === 'undo' ? "Can't undo" : "Can't redo", r.reason, { mergeKey: kind });
    this.host.onWorldEdited();
    this.host.changed(true);
  }

  get canUndo(): boolean {
    const sim = this.sim();
    if (!sim || this.mode === 'live') return false;
    try {
      return sim.build.canUndo() === true;
    } catch {
      return false;
    }
  }

  get canRedo(): boolean {
    const sim = this.sim();
    if (!sim || this.mode === 'live') return false;
    try {
      return sim.build.canRedo() === true;
    } catch {
      return false;
    }
  }

  // ───────────────────────────── session lifecycle ─────────────────────────────

  /** Fresh state for a newly entered world. */
  beginSession(): void {
    this.speed.reset(1);
    this.mode = 'live';
    this.menu = null;
    this.dialog = null;
    this.dialogOptions = null;
    this.selectedAgentId = null;
    this.hoverLabel = null;
    this.gridHover = null;
    this.buildPreviewLabel = null;
    this.lastAudioSpeed = null;
    this.guard('renderer.setViewMode', () => this.host.renderer.setViewMode('live'));
    this.guard('renderer.setWallMode', () => this.host.renderer.setWallMode(this.wallMode));
    this.perspective = 'overview';
    this.guard('renderer.setPerspective', () => this.host.renderer.setPerspective?.('overview', null, true));
    this.syncAudioSpeed();
  }

  endSession(): void {
    this.menu = null;
    this.dialog = null;
    this.dialogOptions = null;
    this.selectedAgentId = null;
    this.mode = 'live';
    this.perspective = 'overview';
    this.guard('renderer.setPerspective', () => this.host.renderer.setPerspective?.('overview', null, true));
    this.hoverLabel = null;
    this.gridHover = null;
    this.buildPreviewLabel = null;
    this.speed.reset(1);
    this.guard('renderer.setSelection', () => this.host.renderer.setSelection(null));
    this.guard('renderer.setHover', () => this.host.renderer.setHover(null));
    this.guard('renderer.setViewMode', () => this.host.renderer.setViewMode('live'));
    this.guard('audio.setDucked', () => this.host.audio.setDucked(false));
  }
}

/**
 * The entry of `list` the UI meant: the same object, else a structurally identical entry (UIs may copy entries
 * when rendering). Anything else — a stale entry from an older menu, a forged one — is not found.
 */
export function findEntry(list: readonly MenuEntry[], e: MenuEntry): MenuEntry | undefined {
  if (!e || typeof e !== 'object') return undefined;
  const same = list.find((x) => x === e);
  if (same) return same;
  const sig = (x: MenuEntry): string => {
    try {
      return JSON.stringify([x.interactionId, x.label, x.params ?? {}]);
    } catch {
      return '';
    }
  };
  const want = sig(e);
  return want ? list.find((x) => x && sig(x) === want) : undefined;
}

/** Map a HUD phone action to a phone interaction id (exact id, 'phone_'+action, or params.action match). */
export function resolvePhoneInteraction(sim: SimulationAPI, action: string): string | null {
  const defs = sim.content?.interactions ?? {};
  const has = (id: string): boolean => Object.prototype.hasOwnProperty.call(defs, id);
  if (has(action) && (action.startsWith('phone_') || defs[action]?.tags?.includes('phone'))) return action;
  if (has(`phone_${action}`)) return `phone_${action}`;
  for (const id of Object.keys(defs)) {
    const d = defs[id];
    if (!d || d.hidden) continue;
    const isPhone = id.startsWith('phone_') || d.tags?.includes('phone') || d.group === 'Phone';
    if (isPhone && d.params?.action === action) return id;
  }
  return null;
}

