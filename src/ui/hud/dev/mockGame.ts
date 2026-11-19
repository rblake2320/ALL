/**
 * DEV ONLY — mock GameController + renderer + audio for the UI-HUD harness. Every controller method mutates
 * local state and notifies subscribers, so the HUD can be clicked through end to end without a real game.
 */
import { DEFAULT_SETTINGS, type BuildTool, type BuyState, type DialogId, type GameController, type OpenMenu, type Settings, type Toast } from '../../../game/contracts';
import type { BubbleAnchor, CameraState, Perspective, RendererAPI, ViewMode, WallMode, PreviewStage } from '../../../render/contracts';
import type { AudioAPI, AudioVolumes } from '../../../audio/contracts';
import type { MenuEntry } from '../../../sim/contracts';
import type { AgentId, Speed, TargetRef } from '../../../sim/types';
import { MockSim } from './mockSim';
import type { HarnessParams } from './params';
import { thumbSvg } from './thumbArt';

/** Where each on-lot agent's head is, as a fraction of the viewport (the backdrop draws figures there too). */
export const ANCHORS: Record<string, { fx: number; fy: number; scale: number }> = {
  a1: { fx: 0.47, fy: 0.43, scale: 1.0 },
  a3: { fx: 0.69, fy: 0.5, scale: 0.86 },
  t1: { fx: 0.575, fy: 0.37, scale: 0.94 },
  t2: { fx: 0.355, fy: 0.5, scale: 0.92 },
};

class MockRenderer implements RendererAPI {
  constructor(private p: HarnessParams, private live: () => boolean) {}
  async init() {}
  loadProgress() {
    return 1;
  }
  attach() {}
  frame() {}
  consumeEvents() {}
  resize() {}
  setQuality() {}
  setPixelRatio() {}
  setViewMode() {}
  setWallMode() {}
  getWallMode(): WallMode {
    return 'cutaway';
  }
  rotateCamera() {}
  orbit() {}
  zoom() {}
  pan() {}
  panWorld() {}
  focus() {}
  follow() {}
  getCamera(): CameraState {
    return { target: { x: 15, z: 15 }, yaw: 0, distance: 20, pitch: 0.8 };
  }
  setCamera() {}
  pick() {
    return { kind: 'none' } as const;
  }
  pickGrid() {
    return null;
  }
  worldToScreen() {
    return { x: 0, y: 0, visible: false };
  }
  bubbleAnchors(): BubbleAnchor[] {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const t = this.live() ? performance.now() / 1000 : 0;
    return Object.entries(ANCHORS).map(([agentId, a], i) => ({
      agentId,
      x: a.fx * w + Math.sin(t * 0.7 + i) * 6,
      y: a.fy * h + Math.sin(t * 1.9 + i * 2) * 2,
      visible: true,
      scale: a.scale,
    }));
  }
  setSelection() {}
  setHover() {}
  setPlacementGhost() {}
  setBuildOverlay() {}
  setHiddenObject() {}
  thumbnail(modelId: string, tint?: string | null): Promise<string> {
    let h = 0;
    for (let i = 0; i < modelId.length; i++) h = (h * 31 + modelId.charCodeAt(i)) | 0;
    const delay = 120 + (Math.abs(h) % 380);
    if (this.p.thumbs === 'fail' && Math.abs(h) % 3 === 0) return new Promise((_, rej) => setTimeout(() => rej(new Error('no model')), delay));
    if (this.p.thumbs === 'slow' && Math.abs(h) % 2 === 0) return new Promise(() => undefined);
    return new Promise((res) => setTimeout(() => res(thumbSvg(modelId, tint ?? null)), delay));
  }
  createPreview(): PreviewStage {
    return { setAppearance() {}, setLimbs() {}, setAnim() {}, setExpression() {}, setYaw() {}, resize() {}, dispose() {} };
  }
  snapshot() {
    return '';
  }
  fps() {
    return 58;
  }
  dispose() {}
}

const VOLUMES: AudioVolumes = { ...DEFAULT_SETTINGS.volumes };
const mockAudio: AudioAPI = {
  unlock: async () => undefined,
  unlocked: true,
  setVolumes: () => undefined,
  getVolumes: () => VOLUMES,
  setMuted: () => undefined,
  setDucked: () => undefined,
  sfx: () => undefined,
  loop: () => undefined,
  stopAllLoops: () => undefined,
  voice: () => undefined,
  music: () => undefined,
  setGameSpeed: () => undefined,
  setAmbience: () => undefined,
  dispose: () => undefined,
};

const TOASTS: Omit<Toast, 'id' | 'createdAt'>[] = [
  { kind: 'career', title: 'Promoted!', text: 'Ophelia is now a Senior Developer at Necro-Tech. +$36/h', agentId: 'a2', objectId: null },
  { kind: 'warning', title: 'Bill overdue', text: 'Pay the $212 utility bill within 2 days or the power goes off.', agentId: null, objectId: 'o1' },
  { kind: 'decay', title: 'An arm fell off', text: 'Mortimer’s left arm detached. It’s under the dinner table.', agentId: 'a1', objectId: null },
  { kind: 'romance', title: 'Smitten', text: 'Cassia can’t stop thinking about Mortimer’s remaining eye.', agentId: 't1', objectId: null },
  { kind: 'money', title: 'Painting sold', text: '“Self-Portrait, Mostly” fetched $240.', agentId: null, objectId: null },
  { kind: 'skill', title: 'Cooking skill up', text: 'Mortimer reached Cooking level 4.', agentId: 'a1', objectId: null },
  { kind: 'good', title: 'Legendary Party!', text: 'The guests will be talking about this one for decades.', agentId: null, objectId: null },
  { kind: 'social', title: 'New friend', text: 'Bartholomew and Dante are now Good Friends.', agentId: 'a3', objectId: null },
];

const STRESS_TOASTS: Omit<Toast, 'id' | 'createdAt'>[] = [
  { kind: 'decay', title: 'Bartholomew-Ignatius Grimsby-Featherstonehaugh lost his left arm during the Legendary Party', text: 'It rolled under the Big-Screen Séance TV. Somebody should probably fetch it before the Repo Ghoul does, and before the guests notice anything unusual about the punch.', agentId: 'a5', objectId: null },
  { kind: 'money', title: 'Lottery ticket!', text: 'A lottery ticket in the mail paid out $9,999,999. The household is, briefly, the richest corpse on the block.', agentId: null, objectId: null },
  { kind: 'warning', title: 'Final notice', text: 'Pay $1,234,567 in overdue bills within 2 days or the power goes off.', agentId: null, objectId: 'o1' },
  ...TOASTS,
];

export class MockController implements GameController {
  version = 0;
  readonly appVersion = 'dev';
  readonly lotTemplates: GameController['lotTemplates'] = [
    { id: 'starter', name: 'Fixer-Upper', description: 'A drafty starter crypt with a working fridge.', startingFunds: 6500 },
    { id: 'empty', name: 'Empty Plot', description: 'Bare earth and big dreams.', startingFunds: 22000 },
  ];
  readonly gameOverReason = null;
  readonly dialogOptions = null;
  private listeners = new Set<() => void>();
  readonly screen = 'game' as const;
  readonly loadingProgress = 1;
  readonly loadingLabel = '';
  readonly fatalError = null;
  readonly caz = null;
  lastSaveLabel: string | null = 'Saved 12 min ago';
  lastSavedAt: number | null = Date.now() - 12 * 60_000;
  lastSaveFailed = false;
  saving = false;
  readonly canQuitApp = false;
  sim: MockSim;
  renderer: RendererAPI;
  audio = mockAudio;
  mode: ViewMode;
  speed: Speed;
  selectedAgentId: AgentId | null;
  wallMode: WallMode = 'cutaway';
  perspective: Perspective = 'overview';
  menu: OpenMenu | null = null;
  buy: BuyState;
  buildTool: BuildTool;
  canUndo = true;
  canRedo = false;
  dialog: DialogId;
  toasts: Toast[] = [];
  bubbles: GameController['bubbles'] = [];
  buildPreviewLabel: string | null = null;
  hint: GameController['hint'] = null;
  settings: Settings;
  fps = 58;
  hoverLabel: string | null = null;
  gridHover = null;
  log: string[] = [];
  private toastSeq = 100;

  constructor(private p: HarnessParams) {
    this.sim = new MockSim({ params: p });
    this.renderer = new MockRenderer(p, () => p.live);
    this.mode = p.mode;
    this.speed = p.speed;
    this.selectedAgentId = p.select;
    this.dialog = p.dialog;
    this.saving = p.saving;
    if (p.saveFailed) {
      this.lastSaveFailed = true;
      this.lastSaveLabel = 'Save failed';
    }
    this.settings = { ...DEFAULT_SETTINGS, uiScale: p.scale, reduceMotion: p.reduceMotion, colorblindNeeds: p.colorblind, showFps: p.fps };
    this.buy = { placingDefId: p.placing, movingObjectId: p.moving ? 'o2' : null, rot: 0, tint: p.tint, category: p.category, hoverObjectId: p.hoverObj ? 'o4' : null, keepPlacing: false, lastDefId: p.placing };
    this.buildTool = this.toolFromParams();
    const now = performance.now();
    this.toasts = (p.stress ? STRESS_TOASTS : TOASTS).slice(0, p.toasts).map((t, i) => ({ ...t, id: i + 1, createdAt: now - i * 400 }));
    if (p.bubbles && p.mode === 'live') {
      this.bubbles = [
        { key: 1, agentId: 'a1', icon: 'tv', style: 'thought', positive: true, until: Infinity },
        { key: 2, agentId: 'a1', icon: 'brain', style: 'thought', positive: false, until: Infinity },
        { key: 3, agentId: 't1', icon: 'heart', style: 'speech', positive: true, until: Infinity },
        { key: 4, agentId: 't2', icon: 'joke', style: 'speech', positive: true, until: Infinity },
        { key: 5, agentId: 'a3', icon: 'zzz', style: 'thought', positive: true, until: Infinity },
        { key: 6, agentId: 't2', icon: 'angry', style: 'shout', positive: false, until: Infinity },
      ];
    }
    if (p.menu) this.menu = this.makeMenu(p.menu);
    if (p.hint) {
      this.hint = {
        id: 'tut_freshness',
        title: p.hint === 'needs' ? 'Mind the Freshness' : p.hint === 'speed' ? 'Time waits for no zombie' : 'Welcome to Wormwood Heights',
        text:
          p.hint === 'needs'
            ? 'Freshness never fully recovers — Vitality is its ceiling. Chill-Rest coffins and ice baths keep limbs attached.'
            : p.hint === 'speed'
              ? 'Pause to plan, then speed things up. Ultra speed unlocks while everyone is asleep or at work.'
              : 'Click a zombie to see what they need, then click anything in the house to tell them what to do.',
        anchor: p.hint === 'center' ? null : p.hint,
      };
    }
    this.buildPreviewLabel = p.label ?? (p.mode === 'build' ? (p.tool === 'wall' ? '$45 · 3 walls' : p.tool === 'floor' ? '$32 · 4 tiles' : p.tool === 'paintWall' ? '$24 · 6 wall sides' : null) : p.mode === 'buy' && p.placing ? '$450' : null);
  }

  private toolFromParams(): BuildTool {
    switch (this.p.tool) {
      case 'room':
        return { kind: 'room', floor: 'floor_planks_worn', wallStyle: 'wall_plaster_bone' };
      case 'floor':
        return { kind: 'floor', styleId: 'floor_checker_moss' };
      case 'paintWall':
        return { kind: 'paintWall', styleId: 'wall_damask_crimson', wholeRoom: this.p.wholeRoom };
      case 'door':
        return { kind: 'door', defId: 'door_crypt' };
      case 'window':
        return { kind: 'window', defId: 'window_gothic' };
      case 'deleteWall':
      case 'eyedropper':
      case 'select':
        return { kind: this.p.tool } as BuildTool;
      default:
        return { kind: 'wall', style: 'wall_stripes_plum' };
    }
  }

  private makeMenu(kind: 'social' | 'fridge'): OpenMenu {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (kind === 'fridge') {
      const target: TargetRef = { kind: 'object', id: 'o3' };
      return { actorId: 'a1', target, title: 'Humming Fridge', entries: this.sim.menu('a1', target), x: Math.round(w * 0.3), y: Math.round(h * 0.3) };
    }
    const target: TargetRef = { kind: 'agent', id: 't1' };
    return { actorId: 'a1', target, title: 'Cassia Morrow', entries: this.sim.menu('a1', target), x: Math.round(w * 0.575 + 24), y: Math.round(h * 0.37 + 40) };
  }

  private emit(what?: string) {
    if (what) this.log.push(what);
    this.version++;
    for (const l of [...this.listeners]) l();
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get content() {
    return this.sim.content;
  }
  async boot() {}
  dispose() {}
  goto() {}
  beginNewGame() {}
  updateCaz() {}
  updateCazMember() {}
  addCazMember() {}
  removeCazMember() {}
  randomizeCazMember() {}
  validateCaz() {
    return [];
  }
  validateCazDetailed() {
    return [];
  }
  async startGame() {}
  createCazPreview(canvas: HTMLCanvasElement) {
    return this.renderer.createPreview(canvas);
  }
  async listSaves() {
    return [];
  }
  async saveGame() {
    this.saving = true;
    this.emit('saveGame');
    await new Promise((r) => setTimeout(r, 900));
    this.saving = false;
    this.lastSaveLabel = 'Saved just now';
    this.emit();
    return { ok: false as const, error: 'mock', code: 'io' as const };
  }
  async loadGame() {
    return { ok: false as const, error: 'mock', code: 'io' as const };
  }
  async continueLatest() {
    return false;
  }
  async deleteSave() {}
  async exportSave() {}
  async importSave() {
    return { ok: false as const, error: 'mock', code: 'io' as const };
  }
  async quitToMenu() {}
  quitApp() {}

  setMode(mode: ViewMode) {
    this.mode = mode;
    this.menu = null;
    this.emit(`setMode:${mode}`);
  }
  setSpeed(speed: Speed) {
    this.speed = speed;
    this.emit(`setSpeed:${speed}`);
  }
  get ultraAllowed(): boolean {
    return this.sim.household().every((m) => m.presence !== 'onLot' || this.sim.agent(m.id)?.anim === 'sleep');
  }
  rotateCamera(dir: 1 | -1) {
    this.emit(`rotateCamera:${dir}`);
  }
  focusObject(id: string) {
    this.emit(`focusObject:${id}`);
  }
  setAutoPurchases(value: 'off' | 'unlimited' | number) {
    const r = this.sim.dispatch({ type: 'setAutoPurchases', value });
    this.emit(`setAutoPurchases:${value}`);
    return r;
  }
  frameObject(id: string) {
    this.emit(`frameObject:${id}`);
    return true;
  }
  readonly storyTarget = null;
  questAction(_ref: import('../../../game/questGo').QuestRowRef): import('../../../game/questGo').QuestGoResult {
    return { kind: 'blocked', reason: 'Mock world', code: 'invalid', key: 'none' };
  }
  questGo(ref: import('../../../game/questGo').QuestRowRef): import('../../../game/questGo').QuestGoResult {
    this.emit(`questGo:${ref.source}:${ref.id}`);
    return this.questAction(ref);
  }
  job(cmd: import('../../../sim/contracts').JobCommand) {
    const r = this.sim.dispatch({ ...cmd, type: 'job' } as import('../../../sim/contracts').Command);
    this.emit(`job:${cmd.action}`);
    return r;
  }
  pet(cmd: import('../../../sim/contracts').PetCommand) {
    const r = this.sim.dispatch({ ...cmd, type: 'pet' } as import('../../../sim/contracts').Command);
    this.emit(`pet:${cmd.action}`);
    return r;
  }
  home(cmd: import('../../../sim/contracts').HomeCommand) {
    const r = this.sim.dispatch({ ...cmd, type: 'home' } as import('../../../sim/contracts').Command);
    this.emit(`home:${cmd.action}`);
    return r;
  }
  buyReward(agentId: string, rewardId: string) {
    const r = this.sim.dispatch({ type: 'buyReward', agentId, rewardId });
    this.emit(`buyReward:${rewardId}`);
    return r;
  }
  renameHousehold(name: string) {
    const r = this.sim.dispatch({ type: 'renameHousehold', name });
    this.emit('renameHousehold');
    return r;
  }
  markNotificationsRead() {
    this.sim.dispatch({ type: 'markNotificationsRead' });
    this.emit('markNotificationsRead');
  }
  togglePause() {
    this.speed = this.speed === 0 ? 1 : 0;
    this.emit('togglePause');
  }
  selectAgent(id: AgentId | null, focus?: boolean) {
    this.selectedAgentId = id;
    this.emit(`selectAgent:${id}${focus ? ':focus' : ''}`);
  }
  cycleSelection(dir: 1 | -1 = 1) {
    const ids = this.sim.household().map((m) => m.id);
    if (ids.length === 0) return;
    const i = this.selectedAgentId ? ids.indexOf(this.selectedAgentId) : -1;
    this.selectedAgentId = ids[(((i + dir) % ids.length) + ids.length) % ids.length];
    this.emit(`cycleSelection:${dir}`);
  }
  setWallMode(mode: WallMode) {
    this.wallMode = mode;
    this.emit(`setWallMode:${mode}`);
  }
  cycleWallMode() {
    const order: WallMode[] = ['up', 'cutaway', 'down'];
    this.setWallMode(order[(order.indexOf(this.wallMode) + 1) % 3]);
  }
  setPerspective(p: Perspective) {
    this.perspective = p;
    this.emit(`setPerspective:${p}`);
  }
  cyclePerspective() {
    const order: Perspective[] = ['overview', 'shoulder', 'firstPerson'];
    this.setPerspective(order[(order.indexOf(this.perspective) + 1) % 3]);
  }
  openMenuFor(target: TargetRef, x: number, y: number) {
    this.menu = { actorId: this.selectedAgentId ?? 'a1', target, title: 'Something', entries: this.sim.menu('a1', target), x, y };
    this.emit();
  }
  closeMenu() {
    this.menu = null;
    this.emit('closeMenu');
  }
  chooseMenuEntry(entry: MenuEntry, child?: MenuEntry) {
    this.log.push(`choose:${entry.interactionId}${child ? `>${child.label}` : ''}`);
    this.menu = null;
    this.emit();
  }
  cancelQueueItem(uid: number) {
    this.emit(`cancel:${uid}`);
  }
  phone(action: string, params?: Record<string, string | number | boolean>) {
    this.pushToast({ kind: 'info', title: 'Calling…', text: `${action}${params ? ' ' + JSON.stringify(params) : ''}`, agentId: null, objectId: null });
    this.emit(`phone:${action}:${JSON.stringify(params ?? {})}`);
  }
  setBuyCategory(category: string) {
    this.buy = { ...this.buy, category };
    this.emit(`setBuyCategory:${category}`);
  }
  startPlacing(defId: string, tint?: string | null) {
    this.buy = { ...this.buy, placingDefId: defId, movingObjectId: null, tint: tint ?? null };
    this.buildPreviewLabel = `$${this.sim.content.objects[defId]?.price ?? 0}`;
    this.emit(`startPlacing:${defId}:${tint ?? ''}`);
  }
  pickUpObject(objectId: string) {
    this.buy = { ...this.buy, movingObjectId: objectId, placingDefId: null };
    this.emit();
  }
  rotatePlacement(dir: 1 | -1) {
    this.buy = { ...this.buy, rot: (((this.buy.rot + dir) % 4) + 4) % 4 as BuyState['rot'] };
    this.emit(`rotate:${dir}`);
  }
  setPlacementTint(tint: string | null) {
    this.buy = { ...this.buy, tint };
    this.emit(`tint:${tint}`);
  }
  cancelPlacement() {
    this.buy = { ...this.buy, placingDefId: null, movingObjectId: null, tint: null };
    this.buildPreviewLabel = null;
    this.emit('cancelPlacement');
  }
  finishPlacing() {
    this.cancelPlacement();
    this.emit('finishPlacing');
  }
  setKeepPlacing(on: boolean) {
    this.buy = { ...this.buy, keepPlacing: on };
    this.emit(`keepPlacing:${on}`);
  }
  sellObject(id: string) {
    this.buy = { ...this.buy, movingObjectId: null };
    this.emit(`sell:${id}`);
  }
  setBuildTool(tool: BuildTool) {
    this.buildTool = tool;
    this.emit(`setBuildTool:${JSON.stringify(tool)}`);
  }
  applyBuild() {
    return true;
  }
  undo() {
    this.emit('undo');
  }
  redo() {
    this.emit('redo');
  }
  openDialog(d: DialogId) {
    this.dialog = d;
    this.emit(`openDialog:${d}`);
  }
  closeDialog() {
    this.dialog = null;
    this.emit('closeDialog');
  }
  dismissToast(id: number) {
    const before = this.toasts.length;
    this.toasts = this.toasts.filter((t) => t.id !== id);
    if (this.toasts.length !== before) this.emit(`dismissToast:${id}`);
  }
  pushToast(t: Omit<Toast, 'id' | 'createdAt'>) {
    this.toasts = [...this.toasts, { ...t, id: ++this.toastSeq, createdAt: performance.now() }];
    this.emit();
  }
  resolveChoice(choiceId: string, option: number) {
    this.sim.state.choices = this.sim.state.choices.filter((c) => c.id !== choiceId);
    this.emit(`resolveChoice:${choiceId}:${option}`);
  }
  dismissHint(id: string, never?: boolean) {
    this.hint = null;
    this.emit(`dismissHint:${id}:${!!never}`);
  }
  updateSettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch };
    this.emit(`updateSettings:${JSON.stringify(patch)}`);
  }
  resetSettings() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.emit();
  }
  playUi() {}
  diagnostics() {
    return 'mock';
  }

  /**
   * Controller-style hotkeys (harness `hotkeys=1`) with the SAME ownership rule as the real controller
   * (src/game/input/keyboard.ts): skip events that are defaultPrevented, come from editable targets or from inside a
   * UI-owned layer ([role=menu|menubar|dialog|alertdialog], [aria-modal]), or are Space/Enter on a button-like
   * target. Digit0–4 set the speed; Tab / Shift+Tab cycle the zombie (preventDefault, like the controller); Escape closes
   * the interaction menu, else opens the pause menu.
   */
  installHotkeys(): () => void {
    const owned = '[role="menu"], [role="menubar"], [role="dialog"], [role="alertdialog"], [aria-modal="true"]';
    const editable = 'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="slider"], [role="spinbutton"], [role="combobox"], [role="listbox"], [data-keys="capture"]';
    const activation = 'button, a, summary, [role="button"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="switch"], [role="option"]';
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as Element | null;
      if (t && typeof t.closest === 'function') {
        if (t.closest(editable) || t.closest(owned)) return;
        if ((e.code === 'Space' || e.code === 'Enter') && t.closest(activation)) return;
      }
      if (e.code === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        // KEYMAP cycleZombie (shift-agnostic: Shift+Tab goes backwards)
        e.preventDefault();
        this.cycleSelection(e.shiftKey ? -1 : 1);
        return;
      }
      const digit = /^Digit([0-4])$/.exec(e.code);
      if (digit) {
        e.preventDefault();
        this.log.push(`hotkey:${e.code}`);
        this.setSpeed(Number(digit[1]) as Speed);
        return;
      }
      if (e.code === 'Escape' && !e.repeat) {
        e.preventDefault();
        this.log.push('hotkey:Escape');
        if (this.menu) this.closeMenu();
        else this.openDialog('pause');
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }

  /** Harness helpers (window.__hud). */
  advance(ticks: number) {
    this.sim.state.tick += Math.max(0, Math.round(ticks));
    this.emit();
  }
  addFunds(delta: number) {
    this.sim.state.household.funds = Math.max(0, this.sim.state.household.funds + delta);
    this.emit(`funds:${delta}`);
  }
  /** Replace the live bubble list (bubble enter/exit checks). */
  setBubbles(list: GameController['bubbles']) {
    this.bubbles = list;
    this.emit('bubbles');
  }
}
