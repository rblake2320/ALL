/**
 * DEV ONLY — complete mock GameController for the UI-SHELL harness: believable data and working state
 * transitions (menu → new game → CAZ → loading → game → pause/settings/saves …), in-memory saves, mock
 * renderer/audio. Not shipped.
 */
import { DEFAULT_SETTINGS, type BuildTool, type BuyState, type CazState, type DialogId, type GameController, type OpenMenu, type Screen, type Settings, type Toast } from '../../../game/contracts';
import type { SaveResult, LoadResult, SaveSlotInfo } from '../../../persistence/contracts';
import type { BuildCommand, CommandResult, ContentRegistry, MenuEntry, NewMemberSpec, SimulationAPI } from '../../../sim/contracts';
import type { AgentId, EdgeKey, ObjectId, Speed, TargetRef } from '../../../sim/types';
import type { PreviewStage, ViewMode, WallMode } from '../../../render/contracts';
import { ACCESSORIES, BOTTOM_STYLES, EYE_STYLES, HAIR_STYLES, SKIN_TONES, TOP_STYLES, defaultAppearance, type ZombieAppearance } from '../../../shared/appearance';
import type { SfxId } from '../../../shared/audioIds';
import { CLOTHES_COLORS, EYE_COLORS, FALLBACK_ASPIRATIONS, FALLBACK_TRAITS, HAIR_COLORS, MAX_MEMBERS, SHOE_COLORS } from '../data';
import { sanitizeTraits, traitBlockReason } from '../cazLogic';
import { createMockAudio, createMockRenderer, svgThumb } from './mockRender';
import { createMockSim, mockContent, MOCK_MEMBERS, STRESS_MEMBERS } from './mockSim';

const FIRST = ['Mortimer', 'Ophelia', 'Bartholomew', 'Edna', 'Cornelius', 'Winifred', 'Ambrose', 'Lavinia', 'Ignatius', 'Hester', 'Barnaby', 'Gertrude', 'Silas', 'Prudence'];
const LAST = ['Grimsby', 'Mossgrave', 'Ashworth', 'Coffinwell', 'Blackthorn', 'Mouldwick', 'Hollowell', 'Graves', 'Rotherham', 'Pallsworth'];

function rngFrom(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

export interface MockOptions {
  screen?: Screen;
  dialog?: DialogId;
  saves?: 'many' | 'one' | 'none' | 'recovered' | 'stress';
  loading?: number;
  loadingLabel?: string;
  fatal?: string | null;
  canQuit?: boolean;
  settings?: Partial<Settings>;
  caz?: 'default' | 'full' | 'errors' | 'single' | 'long';
  animateLoading?: boolean;
  lastSaveLabel?: string | null;
  /** Overflow testing: longest names, $9,999,999, 8 members, day 9,999, huge counters. */
  stress?: boolean;
  /** Seed a few toasts (shell toast host on non-game screens). */
  toasts?: boolean;
}

const STRESS_HOUSEHOLD = 'The Bartholomew-Grimsbys';

type CazIssue = ReturnType<GameController['validateCazDetailed']>[number];
type DialogOpts = { returnTo?: DialogId; mode?: 'save' | 'load' };

export class MockGame implements GameController {
  version = 1;
  readonly appVersion = '1.0.0';
  readonly content: ContentRegistry = mockContent();
  readonly lotTemplates = [
    { id: 'starter' as const, name: 'Fixer-Upper', description: 'A creaky little cottage with a working fridge, a pine coffin and only mild structural despair. Move straight in.', startingFunds: 6500 },
    { id: 'empty' as const, name: 'Empty Plot', description: 'Thirty by thirty tiles of untouched soil and a fatter wallet. Build the mausoleum of your dreams from nothing.', startingFunds: 22000 },
  ];
  gameOverReason: string | null = null;
  private _dialogOpts: DialogOpts | null = null;
  private listeners = new Set<() => void>();
  private rand = rngFrom(20261105);
  private _screen: Screen;
  private _dialog: DialogId;
  private _loadingProgress: number;
  private _loadingLabel: string;
  private _fatal: string | null;
  private _caz: CazState | null = null;
  private _sim: SimulationAPI | null = null;
  private _settings: Settings;
  private _saves: SaveSlotInfo[];
  private _mode: ViewMode = 'live';
  private _speed: Speed = 1;
  private _selected: AgentId | null = 'a1';
  private _wall: WallMode = 'cutaway';
  private _buy: BuyState = { placingDefId: null, movingObjectId: null, rot: 0, tint: null, category: 'seating', hoverObjectId: null, keepPlacing: false, lastDefId: null };
  private _buildTool: BuildTool = { kind: 'select' };
  private _toasts: Toast[] = [];
  private _lastSave: string | null;
  private _lastSavedAt: number | null = null;
  private _saving = false;
  readonly renderer = createMockRenderer();
  readonly audio = createMockAudio();
  readonly canQuitApp: boolean;
  readonly menu: OpenMenu | null = null;
  readonly bubbles: GameController['bubbles'] = [];
  readonly buildPreviewLabel: string | null = null;
  readonly hint: GameController['hint'] = null;
  readonly fps = 60;
  readonly hoverLabel: string | null = null;
  readonly gridHover: { x: number; z: number; edge: EdgeKey | null } | null = null;

  constructor(opts: MockOptions = {}) {
    this._screen = opts.screen ?? 'menu';
    this._dialog = opts.dialog ?? null;
    this._loadingProgress = opts.loading ?? 0.62;
    this._loadingLabel = opts.loadingLabel ?? (opts.stress ? 'Stitching together an unreasonably large number of very particular zombies for your afterlife…' : 'Stitching zombies together…');
    this._fatal = opts.fatal ?? null;
    this.canQuitApp = opts.canQuit ?? true;
    this._settings = { ...DEFAULT_SETTINGS, ...opts.settings, volumes: { ...DEFAULT_SETTINGS.volumes, ...(opts.settings?.volumes ?? {}) } };
    this._saves = this.seedSaves(opts.saves ?? 'many');
    // Same phrasing as the real controller (src/game/autosave.ts formatSaveLabel): a complete phrase.
    this._lastSave = opts.lastSaveLabel === undefined ? 'Saved 12 min ago' : opts.lastSaveLabel;
    this._lastSavedAt = this._lastSave && this._lastSave !== 'Save failed' ? Date.now() - 12 * 60_000 : null;
    if (this._screen === 'caz' || this._screen === 'newGame') this._caz = this.makeCaz(opts.caz ?? (opts.stress ? 'long' : 'default'));
    if (this._screen === 'game') this._sim = opts.stress ? createMockSim({ stress: true, householdName: STRESS_HOUSEHOLD, day: 9999, funds: 9_999_999 }) : createMockSim();
    if (this._screen === 'gameOver') {
      this._sim = opts.stress ? createMockSim({ gameOver: true, stress: true, householdName: STRESS_HOUSEHOLD, day: 9999, funds: 9_999_999 }) : createMockSim({ gameOver: true, day: 23, funds: 312 });
      this.gameOverReason = opts.stress
        ? 'Cornelius-Ambrose Pennyworth-Grave was the very last of the household to crumble, mid-groan, beside the cold, humming, unpaid-for fridge at 3:12 AM.'
        : 'Bartholomew was the last to crumble, mid-groan, beside the cold fridge.';
    }
    if (opts.toasts) {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      this._toasts = [
        { id: 1, kind: 'good', title: 'Save imported', text: 'Mossgrave manor (Day 27) is ready to load.', agentId: null, objectId: null, createdAt: now },
        { id: 2, kind: 'bad', title: 'Export failed', text: 'Downloads are not supported in this browser window.', agentId: null, objectId: null, createdAt: now },
      ];
    }
    if (opts.animateLoading && (this._screen === 'boot' || this._screen === 'loading')) this.animateLoading();
  }

  async boot(_canvas: HTMLCanvasElement): Promise<void> {}
  dispose(): void {
    this.listeners.clear();
  }

  // ── reactivity ──
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private notify() {
    this.version++;
    for (const fn of [...this.listeners]) fn();
  }

  // ── lifecycle ──
  get screen() {
    return this._screen;
  }
  get loadingProgress() {
    return this._loadingProgress;
  }
  get loadingLabel() {
    return this._loadingLabel;
  }
  get fatalError() {
    return this._fatal;
  }
  get caz() {
    return this._caz;
  }
  get sim() {
    return this._sim;
  }
  get settings() {
    return this._settings;
  }
  get dialog() {
    return this._dialog;
  }
  get dialogOptions() {
    return this._dialogOpts;
  }
  get ultraAllowed() {
    return false;
  }
  get mode() {
    return this._mode;
  }
  get speed() {
    return this._speed;
  }
  get selectedAgentId() {
    return this._selected;
  }
  get wallMode() {
    return this._wall;
  }
  get buy() {
    return this._buy;
  }
  get buildTool() {
    return this._buildTool;
  }
  get toasts() {
    return this._toasts;
  }
  get lastSaveLabel() {
    return this._lastSave;
  }
  /** Mirrors the controller: epoch ms of the last good save (null = never) and whether the last attempt failed. */
  get lastSavedAt() {
    return this._lastSavedAt;
  }
  get lastSaveFailed() {
    return this._lastSave === 'Save failed';
  }
  get saving() {
    return this._saving;
  }
  get canUndo() {
    return false;
  }
  get canRedo() {
    return false;
  }

  /** Harness hook: patch internals and notify. */
  _set(patch: { screen?: Screen; dialog?: DialogId; loadingProgress?: number; fatal?: string | null }) {
    if (patch.screen !== undefined) this._screen = patch.screen;
    if (patch.dialog !== undefined) this._dialog = patch.dialog;
    if (patch.loadingProgress !== undefined) this._loadingProgress = patch.loadingProgress;
    if (patch.fatal !== undefined) this._fatal = patch.fatal;
    this.notify();
  }

  goto(screen: Screen): void {
    if (screen === this._screen) return;
    if ((screen === 'newGame' || screen === 'caz') && !this._caz) this._caz = this.makeCaz('default');
    if (screen === 'menu') this._sim = null;
    this._screen = screen;
    this._dialog = null;
    this.notify();
  }
  beginNewGame(): void {
    this._caz = this.makeCaz('default');
    if (this._screen !== 'newGame') this._screen = 'caz';
    this.notify();
  }
  updateCaz(patch: Partial<CazState>): void {
    if (!this._caz) return;
    this._caz = { ...this._caz, ...patch };
    this.notify();
  }
  updateCazMember(index: number, patch: Partial<NewMemberSpec>): void {
    if (!this._caz || !this._caz.members[index]) return;
    const members = this._caz.members.slice();
    members[index] = { ...members[index], ...patch, appearance: { ...members[index].appearance, ...(patch.appearance ?? {}) } };
    this._caz = { ...this._caz, members };
    this.notify();
  }
  addCazMember(): void {
    if (!this._caz || this._caz.members.length >= MAX_MEMBERS) return;
    const m = this.randomMember(this._caz.members[0]?.lastName ?? 'Grimsby');
    this._caz = { ...this._caz, members: [...this._caz.members, m], activeIndex: this._caz.members.length };
    this.notify();
  }
  removeCazMember(index: number): void {
    if (!this._caz || this._caz.members.length <= 1) return;
    const members = this._caz.members.filter((_, i) => i !== index);
    this._caz = { ...this._caz, members, activeIndex: Math.min(this._caz.activeIndex, members.length - 1) };
    this.notify();
  }
  randomizeCazMember(index: number, what: 'all' | 'look' | 'traits' | 'name' = 'all'): void {
    if (!this._caz || !this._caz.members[index]) return;
    const cur = this._caz.members[index];
    const r = this.randomMember(cur.lastName || 'Grimsby');
    const next: NewMemberSpec = {
      firstName: what === 'all' || what === 'name' ? r.firstName : cur.firstName,
      lastName: what === 'name' ? r.lastName : cur.lastName,
      appearance: what === 'all' || what === 'look' ? r.appearance : cur.appearance,
      traits: what === 'all' || what === 'traits' ? r.traits : cur.traits,
      aspiration: what === 'all' || what === 'traits' ? r.aspiration : cur.aspiration,
    };
    this.updateCazMember(index, next);
  }
  validateCaz(): string[] {
    return this.validateCazDetailed().map((e) => e.message);
  }
  validateCazDetailed(): CazIssue[] {
    const c = this._caz;
    if (!c) return [{ memberIndex: null, field: 'householdName', message: 'No household is being created.' }];
    const errs: CazIssue[] = [];
    if (!c.householdName.trim()) errs.push({ memberIndex: null, field: 'householdName', message: 'Give your household a name.' });
    const traits = FALLBACK_TRAITS.filter((x) => !x.reward);
    c.members.forEach((m, i) => {
      const who = m.firstName.trim() || `Zombie ${i + 1}`;
      if (!m.firstName.trim()) errs.push({ memberIndex: i, field: 'firstName', message: `Zombie ${i + 1} needs a first name.` });
      if (m.traits.length !== 3) errs.push({ memberIndex: i, field: 'traits', message: `${who} needs exactly 3 traits (has ${m.traits.length}).` });
      for (const tr of m.traits) {
        const others = m.traits.filter((x) => x !== tr);
        const block = traitBlockReason(tr, others, traits);
        if (block?.kind === 'conflict' && tr < block.withId) errs.push({ memberIndex: i, field: 'traits', message: `${who}: ${tr} conflicts with ${block.withId}.` });
      }
      if (!m.aspiration) errs.push({ memberIndex: i, field: 'aspiration', message: `${who} needs an aspiration.` });
    });
    return errs;
  }
  async startGame(): Promise<void> {
    if (this.validateCaz().length) return;
    this._screen = 'loading';
    this._loadingProgress = 0.1;
    this._loadingLabel = 'Digging your plot…';
    this.notify();
    await new Promise((r) => setTimeout(r, 400));
    this._sim = createMockSim({ householdName: this._caz?.householdName, members: this._caz?.members.length });
    this._screen = 'game';
    this.notify();
  }
  createCazPreview(canvas: HTMLCanvasElement): PreviewStage {
    return this.renderer.createPreview(canvas);
  }

  // ── saves ──
  async listSaves(): Promise<SaveSlotInfo[]> {
    await new Promise((r) => setTimeout(r, 30));
    return this._saves.map((s) => ({ ...s, meta: { ...s.meta } }));
  }
  async saveGame(slotId?: string, name?: string): Promise<SaveResult> {
    this._saving = true;
    this.notify();
    await new Promise((r) => setTimeout(r, 250));
    const now = new Date().toISOString();
    // Like the real controller: no slot id = the world's single manual slot (overwritten each time).
    const id = slotId ?? 'save-0000053a';
    const meta = { householdName: this._sim?.state.household.name ?? 'The Grimsbys', memberNames: MOCK_MEMBERS.map((m) => m.first), day: this._sim?.time().day ?? 12, timeLabel: this._sim?.time().label ?? 'Thu 7:40 PM', funds: this._sim?.state.household.funds ?? 4280, lotValue: 18400, thumbnail: svgThumb('Grimsbys', 280) };
    const existing = this._saves.find((s) => s.slotId === id);
    const info: SaveSlotInfo = { slotId: id, name: name ?? existing?.name ?? 'Quick save', savedAt: now, createdAt: existing?.createdAt ?? now, playMinutes: 194, meta, isAutosave: false, recoveredFromBackup: false, bytes: 48211 };
    this._saves = [info, ...this._saves.filter((s) => s.slotId !== id)];
    this._saving = false;
    this._lastSave = 'Saved just now';
    this._lastSavedAt = Date.now();
    this.pushToast('good', 'Game saved', info.name);
    return { ok: true, info };
  }
  async loadGame(slotId: string): Promise<LoadResult> {
    const info = this._saves.find((s) => s.slotId === slotId);
    if (!info) return { ok: false, error: 'That save could not be found.', code: 'not_found' };
    await new Promise((r) => setTimeout(r, 200));
    this._sim = createMockSim({ householdName: info.meta.householdName, day: info.meta.day, funds: info.meta.funds });
    this._screen = 'game';
    this._dialog = null;
    this._dialogOpts = null;
    this.notify();
    return { ok: true, world: this._sim.state, info, warnings: [] };
  }
  async continueLatest(): Promise<boolean> {
    const latest = [...this._saves].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))[0];
    if (!latest) return false;
    return (await this.loadGame(latest.slotId)).ok;
  }
  async deleteSave(slotId: string): Promise<void> {
    await new Promise((r) => setTimeout(r, 60));
    this._saves = this._saves.filter((s) => s.slotId !== slotId);
    this.notify();
  }
  async exportSave(slotId: string): Promise<void> {
    console.info('[mock] export', slotId);
    this.pushToast('good', 'Save exported', 'Check your downloads folder.');
  }
  async importSave(file: File): Promise<LoadResult> {
    const now = new Date().toISOString();
    const info: SaveSlotInfo = { slotId: `imp-${Date.now()}`, name: file.name.replace(/\.[^.]+$/, ''), savedAt: now, createdAt: now, playMinutes: 30, meta: { householdName: 'Imported', memberNames: ['Edna'], day: 3, timeLabel: 'Wed 10:15 AM', funds: 900, lotValue: 6500, thumbnail: null }, isAutosave: false, recoveredFromBackup: false, bytes: 2048 };
    this._saves = [info, ...this._saves];
    this.pushToast('good', 'Save imported', info.name);
    return { ok: true, world: createMockSim().state, info, warnings: [] };
  }
  async quitToMenu(): Promise<void> {
    this._sim = null;
    this._dialog = null;
    this._screen = 'menu';
    this.notify();
  }
  quitApp(): void {
    console.info('[mock] quitApp');
  }

  // ── in-game ──
  setMode(mode: ViewMode): void {
    this._mode = mode;
    this.notify();
  }
  setSpeed(speed: Speed): void {
    this._speed = speed;
    this.notify();
  }
  togglePause(): void {
    this._speed = this._speed === 0 ? 1 : 0;
    this.notify();
  }
  rotateCamera(dir: 1 | -1): void {
    this.renderer.rotateCamera(dir);
  }
  focusObject(_id: ObjectId): void {}
  setAutoPurchases(_value: 'off' | 'unlimited' | number): CommandResult {
    return { ok: true };
  }
  frameObject(_id: ObjectId): boolean {
    return false;
  }
  readonly storyTarget = null;
  questAction(_ref: import('../../../game/questGo').QuestRowRef): import('../../../game/questGo').QuestGoResult {
    return { kind: 'blocked', reason: 'Mock world', code: 'invalid', key: 'none' };
  }
  questGo(ref: import('../../../game/questGo').QuestRowRef): import('../../../game/questGo').QuestGoResult {
    return this.questAction(ref);
  }
  pet(_cmd: import('../../../sim/contracts').PetCommand): CommandResult {
    return { ok: false, reason: 'Mock world' };
  }
  home(_cmd: import('../../../sim/contracts').HomeCommand): CommandResult {
    return { ok: false, reason: 'Mock world' };
  }
  job(_cmd: import('../../../sim/contracts').JobCommand): CommandResult {
    return { ok: false, reason: 'Mock world' };
  }
  buyReward(_agentId: AgentId, _rewardId: string): CommandResult {
    return { ok: false, reason: 'Not enough aspiration points' };
  }
  renameHousehold(name: string): CommandResult {
    if (this._sim) this._sim.state.household.name = name;
    this.notify();
    return { ok: true };
  }
  markNotificationsRead(): void {}
  selectAgent(id: AgentId | null): void {
    this._selected = id;
    this.notify();
  }
  cycleSelection(): void {}
  setWallMode(mode: WallMode): void {
    this._wall = mode;
    this.notify();
  }
  cycleWallMode(): void {
    this._wall = this._wall === 'up' ? 'cutaway' : this._wall === 'cutaway' ? 'down' : 'up';
    this.notify();
  }
  readonly perspective = 'overview' as const;
  setPerspective(): void {}
  cyclePerspective(): void {}
  openMenuFor(_t: TargetRef, _x: number, _y: number): void {}
  closeMenu(): void {}
  chooseMenuEntry(_e: MenuEntry, _c?: MenuEntry): void {}
  cancelQueueItem(_uid: number): void {}
  phone(_a: string): void {}
  setBuyCategory(category: string): void {
    this._buy = { ...this._buy, category };
    this.notify();
  }
  startPlacing(defId: string, tint: string | null = null): void {
    this._buy = { ...this._buy, placingDefId: defId, tint };
    this.notify();
  }
  pickUpObject(id: ObjectId): void {
    this._buy = { ...this._buy, movingObjectId: id };
    this.notify();
  }
  rotatePlacement(dir: 1 | -1): void {
    this._buy = { ...this._buy, rot: (((this._buy.rot + dir) % 4) + 4) % 4 as 0 | 1 | 2 | 3 };
    this.notify();
  }
  setPlacementTint(tint: string | null): void {
    this._buy = { ...this._buy, tint };
    this.notify();
  }
  cancelPlacement(): void {
    this._buy = { ...this._buy, placingDefId: null, movingObjectId: null };
    this.notify();
  }
  finishPlacing(): void {
    this.cancelPlacement();
  }
  setKeepPlacing(on: boolean): void {
    this._buy = { ...this._buy, keepPlacing: on };
    this.notify();
  }
  sellObject(_id: ObjectId): void {}
  setBuildTool(tool: BuildTool): void {
    this._buildTool = tool;
    this.notify();
  }
  applyBuild(_cmd: BuildCommand): boolean {
    return true;
  }
  undo(): void {}
  redo(): void {}

  // ── dialogs etc. ──
  openDialog(d: DialogId, opts?: DialogOpts): void {
    this._dialog = d;
    this._dialogOpts = d === null ? null : (opts ?? null);
    this.notify();
  }
  closeDialog(): void {
    this._dialog = null;
    this._dialogOpts = null;
    this.notify();
  }
  private toastSeq = 100;
  /** Mirrors the controller: toasts on save/import/export results (the HUD or the shell shows them). */
  private pushToast(kind: Toast['kind'], title: string, text: string) {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    this._toasts = [...this._toasts, { id: ++this.toastSeq, kind, title, text, agentId: null, objectId: null, createdAt: now }].slice(-20);
    this.notify();
  }
  dismissToast(id: number): void {
    this._toasts = this._toasts.filter((x) => x.id !== id);
    this.notify();
  }
  resolveChoice(_id: string, _o: number): void {}
  dismissHint(_id: string): void {}
  updateSettings(patch: Partial<Settings>): void {
    this._settings = { ...this._settings, ...patch, volumes: { ...this._settings.volumes, ...(patch.volumes ?? {}) } };
    this.notify();
  }
  resetSettings(): void {
    this._settings = { ...DEFAULT_SETTINGS, volumes: { ...DEFAULT_SETTINGS.volumes } };
    this.notify();
  }
  playUi(_id: SfxId): void {}
  diagnostics(): string {
    return [
      'Afterlife Lease 1.0.0 (dev harness)',
      `screen=${this._screen} dialog=${this._dialog ?? 'none'} mode=${this._mode} speed=${this._speed}`,
      `ua=${typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'}`,
      `viewport=${typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}` : 'n/a'}`,
      'renderer: mock (no WebGL) · quality=' + this._settings.quality,
      'audio: mock · unlocked=' + String(this.audio.unlocked),
      'saves: ' + this._saves.length + ' slot(s) · backend=memory',
      'sim: ' + (this._sim ? `tick=${this._sim.state.tick} agents=${Object.keys(this._sim.state.agents).length}` : 'none'),
      'faults: 0 · invariants: ok',
    ].join('\n');
  }

  // ── helpers ──
  private pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.rand() * arr.length) % arr.length];
  }
  private randomLook(): ZombieAppearance {
    return {
      ...defaultAppearance(),
      height: Math.round(this.rand() * 100) / 100,
      build: Math.round(this.rand() * 100) / 100,
      skinTone: Math.floor(this.rand() * SKIN_TONES.length),
      hairStyle: this.pick(HAIR_STYLES),
      hairColor: this.pick(HAIR_COLORS).value,
      topStyle: this.pick(TOP_STYLES),
      topColor: this.pick(CLOTHES_COLORS).value,
      bottomStyle: this.pick(BOTTOM_STYLES),
      bottomColor: this.pick(CLOTHES_COLORS).value,
      shoeColor: this.pick(SHOE_COLORS).value,
      eyeStyle: this.pick(EYE_STYLES),
      eyeColor: this.pick(EYE_COLORS).value,
      accessory: this.pick(ACCESSORIES),
      stitches: this.rand() > 0.25,
      voicePitch: Math.round(this.rand() * 100) / 100,
    };
  }
  private randomMember(lastName: string): NewMemberSpec {
    const pool = FALLBACK_TRAITS.filter((x) => !x.reward);
    const shuffled = [...pool].sort(() => this.rand() - 0.5).map((x) => x.id);
    return { firstName: this.pick(FIRST), lastName, appearance: this.randomLook(), traits: sanitizeTraits(shuffled, pool), aspiration: this.pick(FALLBACK_ASPIRATIONS).id };
  }
  private makeCaz(kind: NonNullable<MockOptions['caz']>): CazState {
    const base: NewMemberSpec[] = MOCK_MEMBERS.map((m) => ({ firstName: m.first, lastName: m.last, appearance: { ...defaultAppearance(), ...m.app }, traits: m.traits, aspiration: m.asp }));
    let members = kind === 'single' ? base.slice(0, 1) : base.slice(0, 2);
    if (kind === 'full') members = [...base, { ...this.randomMember('Grimsby'), firstName: 'Edna' }];
    if (kind === 'errors') members = [{ ...base[0], traits: ['grumpy', 'gourmand'], aspiration: null }, { ...base[1], firstName: '' }];
    if (kind === 'long') {
      members = STRESS_MEMBERS.slice(0, MAX_MEMBERS).map((m) => ({ firstName: m.first.slice(0, 16), lastName: m.last.slice(0, 16), appearance: { ...defaultAppearance(), ...m.app }, traits: m.traits, aspiration: m.asp }));
      return { members, activeIndex: 2, householdName: STRESS_HOUSEHOLD, lotTemplate: 'empty', difficulty: 'grim' };
    }
    return { members, activeIndex: 0, householdName: kind === 'errors' ? '' : 'The Grimsbys', lotTemplate: 'starter', difficulty: 'normal' };
  }
  private seedSaves(kind: NonNullable<MockOptions['saves']>): SaveSlotInfo[] {
    if (kind === 'none') return [];
    if (kind === 'stress') return this.stressSaves();
    const now = Date.now();
    const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
    const mk = (id: string, name: string, minAgo: number, household: string, day: number, time: string, funds: number, extra: Partial<SaveSlotInfo> = {}, hue = 280): SaveSlotInfo => ({
      slotId: id,
      name,
      savedAt: iso(minAgo),
      createdAt: iso(minAgo + 600),
      playMinutes: 60 + day * 17,
      meta: { householdName: household, memberNames: ['Mortimer', 'Ophelia', 'Bartholomew'].slice(0, 1 + (day % 3)), day, timeLabel: time, funds, lotValue: 18400, thumbnail: hue >= 0 ? svgThumb(household.replace('The ', ''), hue) : null },
      isAutosave: false,
      recoveredFromBackup: false,
      bytes: 40000 + day * 900,
      ...extra,
    });
    const all = [
      mk('auto-1', 'Autosave', 9, 'The Grimsbys', 12, 'Thu 7:40 PM', 4280, { isAutosave: true }, 265),
      mk('slot-a', 'Before the dinner party', 54, 'The Grimsbys', 11, 'Wed 6:05 PM', 3915, {}, 300),
      mk('slot-b', 'Bartholomew lost an arm', 60 * 26, 'The Grimsbys', 9, 'Mon 2:30 PM', 2870, kind === 'recovered' ? { recoveredFromBackup: true } : {}, 320),
      mk('slot-c', 'Mossgrave manor', 60 * 24 * 9, 'The Mossgraves', 27, 'Sat 11:10 AM', 15020, {}, -1),
    ];
    return kind === 'one' ? all.slice(0, 1) : all;
  }
  private stressSaves(): SaveSlotInfo[] {
    const now = Date.now();
    const names = [
      'Before the Legendary Moonlit Dinner Party',
      'Autosave',
      'Bartholomew-Jebb lost both arms (again!!)',
      'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
      'x',
      '',
    ];
    const out: SaveSlotInfo[] = [];
    for (let i = 0; i < 22; i++) {
      const auto = i === 1;
      out.push({
        slotId: `stress-${i}`,
        name: names[i % names.length],
        savedAt: new Date(now - (i * i + 1) * 47 * 60_000).toISOString(),
        createdAt: new Date(now - 10 * 86_400_000).toISOString(),
        playMinutes: i === 0 ? 599_999 : 60 * i + 7,
        meta: {
          householdName: i % 3 === 0 ? STRESS_HOUSEHOLD : i % 3 === 1 ? 'The Grimsbys' : '',
          memberNames: STRESS_MEMBERS.slice(0, 1 + (i % 8)).map((m) => m.first),
          day: i === 0 ? 9999 : 1 + i * 3,
          timeLabel: i % 4 === 0 ? 'Wed 11:59 PM' : 'Mon 9:00 AM',
          funds: i === 0 ? 9_999_999 : i === 4 ? 0 : 1234 * (i + 1),
          lotValue: 18400,
          thumbnail: i % 5 === 3 ? null : svgThumb(`S${i}`, 250 + ((i * 23) % 90)),
        },
        isAutosave: auto,
        recoveredFromBackup: i === 2 || i === 0,
        bytes: 40000 + i * 900,
      });
    }
    return out;
  }
  private animateLoading() {
    const t0 = performance.now();
    const labels = ['Unearthing assets…', 'Carving coffins…', 'Stitching zombies together…', 'Lighting candles…', 'Summoning the fog…'];
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 9000);
      this._loadingProgress = k;
      this._loadingLabel = labels[Math.min(labels.length - 1, Math.floor(k * labels.length))];
      this.notify();
      if (k < 1) setTimeout(step, 120);
    };
    step();
  }
}

export function createMockGame(opts: MockOptions = {}): MockGame {
  return new MockGame(opts);
}
