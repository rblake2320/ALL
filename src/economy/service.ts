/**
 * EconomyService — the profile-level economy (docs/MONETIZATION.md): Bones ledger, grants, daily tasks, unlocks, GG
 * wallet seam, age gate, analytics policy. Implements EconomyFacade (what the UI reads) plus the game-layer hooks the
 * controller calls each frame. Every public method is a fault barrier (never throws / never rejects).
 *
 * Grants pipeline: sim events (questCompleted, milestone, promotion, skillUp) + daily/weekly/streak + reconciliation of
 * the world's recorded quest grants → a serial queue → `LedgerStore.append` (idempotent by key, cross-window locked).
 * `duplicate` answers are the expected outcome of replays/reloads and are silent; a toast appears only for an entry
 * that was actually written. Transient storage failures are retried with backoff; nothing is lost on a crash because
 * every source can be re-derived (world grants record, daily state) and re-requested on the next start.
 *
 * Grant eligibility is decided by the PROFILE, never by the save (security review 2026-11-05, H-1; grantPolicy.ts):
 * one-time quest grants are keyed per profile, repeatable world grants are capped per profile per day, and only worlds
 * this profile created (worldRegistry.ts: `registerNewWorld`) have their recorded grants reconciled; imported worlds
 * (`noteImportedWorld`) are never reconciled and their in-progress quests pay nothing when they complete.
 * Age: the stored bracket is sealed and resolved fail-closed (age.ts `resolveStoredAge`); older brackets and spend-cap
 * changes need the ParentGate, which fails closed offline (D-2 / M-2).
 */
import type { StoreSku, WalletView } from '../shared/economy';
import type { ProfileStore, StorageBackend } from '../persistence/contracts';
import type { LockProvider } from '../persistence/locks';
import { profileKeys } from '../persistence/slotKeys';
import type { SimEvent } from '../sim/contracts';
import type { DailyView, EconomyFacade, EconomyToast, QuestView, SkuState, UnlockResult } from './facade';
import {
  DEFAULT_AGE_PROFILE,
  DEFAULT_TEEN_CAP_CENTS,
  NO_PARENT_GATE,
  answerAgeGate,
  ageFromBirthYear,
  bonesBlock,
  bracketForAge,
  failClosedProfile,
  isSentinel,
  needsParentFor,
  realMoneyBlock,
  resolveStoredAge,
  sealAgeProfile,
  setSpendCap,
  type AgeProfile,
  type AgeSentinel,
  type AgeSource,
  type ParentGate,
  type PurchaseBlock,
} from './age';
import { Analytics, noopSink, type AnalyticsSink, type StoreTabId } from './analytics';
import { BODY_PREFIX, BODY_UNLOCKS_LIVE, PET_VARIANTS_LIVE, buyLockFor, isUsable, type BuyLock } from './catalog';
import { evaluateState, freshDailyState, observeEvents, rollover, sanitizeDailyState, viewTasks, dueGrants, type DailyState, type GrantDue } from './daily';
import { grantsFromEvents, reconcileGrants, worldCheated, worldKey, type WorldLike } from './grants';
import { alreadyPaid, profileGrantOf, withinDailyCap, type ProfileGrant } from './grantPolicy';
import { emptyRegistry, grantIdsInWorld, isCheated, isPreexisting, markCheated, mayReconcile, registerImported, registerNative, sanitizeRegistry, type WorldRegistry } from './worldRegistry';
import { LedgerStore, type LedgerState } from './ledgerStore';
import { ENTITLEMENT_RE } from './ledger';
import { isServerOnlyEntitlement, localEntitlements } from './entitlements';
import { bonesPriceFor, skuEntitlements } from './pricing';
import { skuById } from './skus';
import { ServerWallet, type GGWallet } from './wallet';
import { objectiveWorldOf, type ObjectiveWorld } from '../sim/systems/quests/objectives';
import { TICK_MINUTES } from '../sim/types';

export const PROFILE_KEYS = { age: 'economy-age', ageSeen: 'economy-age-seen', daily: 'economy-daily', prefs: 'economy-prefs', worlds: 'economy-worlds' } as const;
const MAX_TOASTS = 5;
const STATE_EVAL_MS = 1000;
const DAILY_SAVE_MS = 3000;
const LEDGER_RETRY_MS = 5000;
const BROADCAST = 'afterlife-lease-economy';

interface Prefs {
  analyticsConsent: boolean;
  /** Second "a bracket was decided here" marker (D-2): the age record alone going missing fails closed. */
  ageDecided?: boolean;
}

interface PendingGrant {
  key: string;
  bones: number;
  reason: string;
  entitlements?: string[];
  source: 'quest' | 'daily' | 'weekly' | 'streak' | 'achievement';
  attempts: number;
  /** Re-request from reconciliation (a toast still appears if it turns out to be newly paid). */
  quiet: boolean;
  /** World grants (quests/achievements): the profile-level key + class (grantPolicy.ts). Daily grants: absent. */
  pg?: ProfileGrant;
}

/** Minimal SimulationAPI surface the service reads (structural; works with test doubles). */
export interface SimLike {
  readonly state: WorldLike & { tick?: number; quests?: { grants?: unknown } };
  readonly content?: unknown;
  readonly spatial?: unknown;
  quests?(): unknown;
}

export interface EconomyServiceDeps {
  backend: () => Promise<StorageBackend>;
  profile: ProfileStore;
  locks?: LockProvider;
  wallet?: GGWallet | Promise<GGWallet>;
  analytics?: AnalyticsSink;
  now?: () => number;
  randomU32?: () => number;
  logger?: { warn(...a: unknown[]): void };
  /** Cross-window refresh via BroadcastChannel (default: when available). */
  broadcast?: boolean;
  /** Parent/account approval for older brackets and spend-cap changes (default: NO_PARENT_GATE — fails closed). */
  parentGate?: ParentGate;
}

export class EconomyService implements EconomyFacade {
  private _version = 0;
  private readonly listeners = new Set<() => void>();
  private readonly ledger: LedgerStore;
  private readonly now: () => number;
  private readonly log: { warn(...a: unknown[]): void };
  private readonly analyticsHub: Analytics;
  private walletImpl: GGWallet = new ServerWallet();
  private ledgerState: LedgerState | null = null;
  private ageProfile: AgeProfile = { ...DEFAULT_AGE_PROFILE };
  private ageSource: AgeSource = 'fresh';
  private ageSentinel: AgeSentinel | null = null;
  private ageWrites: Promise<void> = Promise.resolve();
  private readonly parentGate: ParentGate;
  private registry: WorldRegistry = emptyRegistry();
  /** registerNewWorld / noteImportedWorld calls that arrived before init() loaded the registry. */
  private pendingWorldOps: Array<(r: WorldRegistry) => boolean> = [];
  private registryLoaded = false;
  private prefs: Prefs = { analyticsConsent: false };
  private dailyState: DailyState;
  private clockRollback = false;
  private _ready = false;
  private initPromise: Promise<void> | null = null;
  private queue: PendingGrant[] = [];
  private draining = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private toastList: EconomyToast[] = [];
  private toastSeq = 0;
  private focus: { tab: StoreTabId; skuId: string | null } = { tab: 'featured', skuId: null };
  private lastEvalAt = -Infinity;
  private lastEvalTick: number | null = null;
  private lastDailySave = 0;
  private dailyDirty = false;
  private reconciledWorlds = new WeakSet<object>();
  private channel: BroadcastChannel | null = null;
  private questViews: QuestView[] = [];
  private disposed = false;
  private lastSim: SimLike | null = null;
  private lastLedgerRetry = -Infinity;

  constructor(private readonly deps: EconomyServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.log = deps.logger ?? console;
    this.ledger = new LedgerStore({ backend: deps.backend, profile: deps.profile, locks: deps.locks, now: this.now, logger: this.log });
    this.analyticsHub = new Analytics(deps.analytics ?? noopSink);
    this.dailyState = freshDailyState(0);
    this.parentGate = deps.parentGate ?? NO_PARENT_GATE;
  }

  // ───────────────────────── lifecycle ─────────────────────────

  init(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    try {
      if (this.deps.wallet) this.walletImpl = await this.deps.wallet;
    } catch (e) {
      this.log.warn('[economy] wallet unavailable:', e);
    }
    try {
      const pf = this.deps.profile;
      const fb: Prefs = { analyticsConsent: false };
      const pr = typeof pf.loadChecked === 'function' ? await pf.loadChecked<Prefs>(PROFILE_KEYS.prefs, fb) : { value: await pf.load<Prefs>(PROFILE_KEYS.prefs, fb), readFailed: null };
      const prefs = pr.value;
      this.prefs = { analyticsConsent: prefs.analyticsConsent === true, ...(prefs.ageDecided === true ? { ageDecided: true } : {}) };
      await this.loadAge(pr.readFailed);
      const seed = this.deps.randomU32 ? this.deps.randomU32() : Math.floor(Math.random() * 2 ** 32);
      this.dailyState = sanitizeDailyState(await this.deps.profile.load<unknown>(PROFILE_KEYS.daily, null), seed);
      if (this.dailyState.day === null) this.dailyDirty = true;
    } catch (e) {
      this.log.warn('[economy] profile unavailable:', e);
      // The age record could not be resolved at all: never fall through to 'unknown' (gate → any bracket).
      if (this.ageSource === 'fresh' && this.prefs.ageDecided === true) this.ageProfile = failClosedProfile(null);
    }
    try {
      const reg = sanitizeRegistry(await this.deps.profile.load<unknown>(PROFILE_KEYS.worlds, null));
      let dirty = false;
      for (const op of this.pendingWorldOps) dirty = op(reg) || dirty;
      this.registry = reg;
      if (dirty) void this.persist(PROFILE_KEYS.worlds, this.registry);
    } catch (e) {
      this.log.warn('[economy] world registry unavailable:', e);
    }
    this.pendingWorldOps = [];
    this.registryLoaded = true;
    this.syncAnalytics();
    this.ledgerState = await this.ledger.load();
    if (this.ledgerState.status === 'recovered' || this.ledgerState.status === 'corrupt' || this.ledgerState.status === 'unavailable') this.analyticsHub.track({ name: 'ledger_issue', status: this.ledgerState.status });
    this.rotate();
    // Re-request every daily reward the state says was earned (crash between claim and ledger write).
    for (const g of dueGrants(this.dailyState)) this.enqueue({ ...g, attempts: 0, quiet: true });
    this._ready = true;
    this.openChannel();
    this.changed();
  }

  dispose(): void {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    try {
      this.channel?.close();
    } catch {
      /* ignore */
    }
    this.channel = null;
    this.listeners.clear();
  }

  private openChannel(): void {
    if (this.deps.broadcast === false || typeof BroadcastChannel !== 'function') return;
    try {
      const ch = new BroadcastChannel(BROADCAST);
      ch.onmessage = () => void this.refreshFromStorage();
      this.channel = ch;
    } catch {
      this.channel = null;
    }
  }

  /** Re-read the ledger (another window wrote to it). */
  async refreshFromStorage(): Promise<void> {
    try {
      this.ledgerState = await this.ledger.load();
      this.changed();
    } catch (e) {
      this.log.warn('[economy] refresh failed:', e);
    }
  }

  // ───────────────────────── reactivity ─────────────────────────

  get version(): number {
    return this._version;
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed(): void {
    this._version++;
    for (const fn of [...this.listeners]) {
      try {
        fn();
      } catch (e) {
        this.log.warn('[economy] listener failed:', e);
      }
    }
  }
  get ready(): boolean {
    return this._ready;
  }

  // ───────────────────────── wallet ─────────────────────────

  get wallet(): WalletView {
    const t = this.ledgerState?.totals;
    // Local (ledger) entitlements never include server-only content, even from a hand-edited chain (§1).
    const ents = localEntitlements(t ? t.entitlements : []);
    for (const e of this.walletImpl.entitlements()) ents.add(e);
    return { trust: 'local-unverified', bones: t?.bones ?? 0, gg: this.walletImpl.balance(), entitlements: ents, ledgerOk: !this.ledgerState || this.ledgerState.status === 'ok' || this.ledgerState.status === 'empty' };
  }
  get ledgerIssues(): readonly string[] {
    return this.ledgerState?.issues ?? [];
  }
  /** For diagnostics/tests. */
  get ledgerSnapshot(): LedgerState | null {
    return this.ledgerState;
  }

  // ───────────────────────── age / prefs ─────────────────────────

  get age(): AgeProfile {
    return this.ageProfile;
  }
  get needsAgeGate(): boolean {
    return this._ready && this.ageProfile.bracket === 'unknown';
  }
  /** How the current bracket was obtained ('failClosed' = stored data was missing/damaged/unverifiable/unreadable → under-13). */
  get ageResolution(): AgeSource {
    return this.ageSource;
  }
  answerAgeGate(year: number | string): 'ok' | 'invalid' | 'locked' {
    const r = answerAgeGate(this.ageProfile, year, new Date(this.now()));
    if (!r.ok) return r.reason;
    this.applyAge(r.profile);
    return 'ok';
  }
  /**
   * The explicit age flow for a bracket change after one is set: younger moves apply directly; an OLDER bracket needs
   * the ParentGate (Phase 4 parent account). Offline there is none, so older moves are refused ('parentRequired').
   */
  async changeAgeBracket(year: number | string): Promise<'ok' | 'invalid' | 'locked' | 'parentRequired'> {
    try {
      const age = ageFromBirthYear(year, new Date(this.now()));
      if (age === null) return 'invalid';
      const next = bracketForAge(age);
      if (!needsParentFor(this.ageProfile, next)) return this.answerAgeGate(year);
      if (!this.parentGate.configured) return 'parentRequired';
      if (!(await this.parentGate.authorize({ kind: 'olderBracket', to: next }))) return 'parentRequired';
      this.applyAge({ ...this.ageProfile, bracket: next, decidedAt: new Date(this.now()).toISOString(), spendCapCents: next === 'teen' ? DEFAULT_TEEN_CAP_CENTS : this.ageProfile.spendCapCents }, true);
      return 'ok';
    } catch {
      return 'parentRequired';
    }
  }
  /** Teen spend cap: changes only with ParentGate approval (fails closed offline: 'parentRequired'). */
  async setSpendCap(cents: number): Promise<'ok' | 'parentRequired'> {
    try {
      if (!this.parentGate.configured || !(await this.parentGate.authorize({ kind: 'spendCap', cents }))) return 'parentRequired';
      this.ageProfile = setSpendCap(this.ageProfile, cents);
      this.persistAge();
      this.changed();
      return 'ok';
    } catch {
      return 'parentRequired';
    }
  }

  private applyAge(p: AgeProfile, parentApproved = false): void {
    this.ageProfile = p;
    this.ageSource = 'stored';
    this.persistAge(parentApproved);
    this.syncAnalytics();
    if (p.bracket !== 'unknown') this.analyticsHub.track({ name: 'age_gate_answered', bracket: p.bracket });
    this.changed();
  }

  private async loadAge(prefsReadFailed: boolean | null): Promise<void> {
    // loadChecked (when the store has it) reports a failed read in the SAME read, so a transient failure that a later
    // re-probe would not see still counts. A partial failure (primary unreadable, backup empty) counts too.
    const prof = this.deps.profile;
    const readOne = async (k: string): Promise<{ value: unknown; readFailed: boolean | null }> =>
      typeof prof.loadChecked === 'function' ? prof.loadChecked<unknown>(k, null) : { value: await prof.load<unknown>(k, null), readFailed: null };
    const [ra, rs] = await Promise.all([readOne(PROFILE_KEYS.age), readOne(PROFILE_KEYS.ageSeen)]);
    const record = ra.value;
    const sentinel = rs.value;
    const readFailed = ra.readFailed === true || rs.readFailed === true || prefsReadFailed === true;
    const checked = ra.readFailed !== null && rs.readFailed !== null && prefsReadFailed !== null;
    this.ageSentinel = isSentinel(sentinel) ? sentinel : null;
    const r = await resolveStoredAge({ record, sentinel, prefsDecided: this.prefs.ageDecided === true });
    this.ageProfile = r.profile;
    this.ageSource = r.source;
    if (r.source === 'failClosed') {
      this.log.warn(`[economy] ${r.reason ?? 'age data unusable'}: treating this profile as under-13 (fail closed)`);
      this.ageProfile = failClosedProfile(new Date(this.now()).toISOString());
      this.persistAge(); // sticky: re-sealed as under-13, so a later read cannot land on 'unknown'
    } else if (r.source === 'legacy' && r.profile.bracket !== 'unknown') {
      this.persistAge(); // migrate a pre-seal record: seal it and write the decided markers
    } else if (r.source === 'fresh' && desktopOnBrowserStorage(await this.deps.backend().catch(() => null))) {
      // Lead decision 2026-11-12 (finding 14, fallback variant): the desktop app keeps its age record in the saves
      // folder. A session that fell back to browser storage never read that record, so "nothing stored" here means
      // nothing: child profile for this session, nothing written (the real record resolves on the next start).
      this.log.warn('[economy] desktop session on browser storage: age record not readable, treating this profile as under-13 for this session (fail closed)');
      this.ageProfile = failClosedProfile(new Date(this.now()).toISOString());
      this.ageSource = 'failClosed';
    } else if (r.source === 'fresh' && (readFailed || (!checked && !(await this.ageStoreReadable())))) {
      // 'fresh' only says the ProfileStore returned its fallbacks, which it also does when a read FAILS. An unreadable
      // store is not a fresh install (the gate would accept any year over a record that may still be there): fail
      // closed for this session and write NOTHING, so intact records resolve normally on the next start.
      this.log.warn('[economy] age data could not be read: treating this profile as under-13 for this session (fail closed)');
      this.ageProfile = failClosedProfile(new Date(this.now()).toISOString());
      this.ageSource = 'failClosed';
    }
  }

  /** False when a stored age record (or its decided markers) cannot be READ: an I/O error, not "nothing stored". */
  private async ageStoreReadable(): Promise<boolean> {
    try {
      const backend = await this.deps.backend();
      for (const key of [PROFILE_KEYS.age, PROFILE_KEYS.ageSeen, PROFILE_KEYS.prefs]) {
        const k = profileKeys(key);
        if (!k) return false;
        await backend.read(k.primary);
        await backend.read(k.backup);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Serialised: decided markers first (sentinel + prefs), then the sealed record. Never rejects.
   * Storage is read again first, because another window may have decided a bracket since this one loaded: its salt is
   * kept, and a bracket OLDER than the stored one is written only when the ParentGate approved it (`parentApproved`).
   * Otherwise nothing is written and this window takes the stored (younger) bracket.
   */
  private persistAge(parentApproved = false): void {
    const p = { ...this.ageProfile };
    this.ageWrites = this.ageWrites.then(async () => {
      try {
        if (p.bracket !== 'unknown') {
          const [record, sentinel, prefs] = await Promise.all([
            this.deps.profile.load<unknown>(PROFILE_KEYS.age, null),
            this.deps.profile.load<unknown>(PROFILE_KEYS.ageSeen, null),
            this.deps.profile.load<Prefs>(PROFILE_KEYS.prefs, { analyticsConsent: false }),
          ]);
          if (isSentinel(sentinel)) this.ageSentinel = sentinel;
          const stored = await resolveStoredAge({ record, sentinel, prefsDecided: this.prefs.ageDecided === true || prefs.ageDecided === true });
          if (!parentApproved && needsParentFor(stored.profile, p.bracket)) {
            const mine = this.ageProfile.bracket;
            if (mine !== 'unknown' && needsParentFor(stored.profile, mine)) {
              this.ageProfile = stored.profile;
              this.ageSource = stored.source;
              this.syncAnalytics();
              this.changed();
            }
            return;
          }
          if (!this.ageSentinel) {
            this.ageSentinel = { v: 1, decided: true, salt: this.newSalt() };
            await this.deps.profile.save(PROFILE_KEYS.ageSeen, this.ageSentinel);
          }
          if (this.prefs.ageDecided !== true) {
            this.prefs = { ...this.prefs, ageDecided: true };
            await this.deps.profile.save(PROFILE_KEYS.prefs, this.prefs);
          }
        }
        if (!this.ageSentinel) return; // nothing decided yet: nothing to store
        await this.deps.profile.save(PROFILE_KEYS.age, await sealAgeProfile(p, this.ageSentinel.salt));
      } catch (e) {
        this.log.warn('[economy] could not save the age profile:', e);
      }
    });
  }

  /** Test hook: resolves when pending age-profile writes are done. */
  async ageSettled(): Promise<void> {
    await this.ageWrites;
  }

  private newSalt(): string {
    const bytes = new Uint8Array(16);
    const c = (globalThis as { crypto?: { getRandomValues?(a: Uint8Array): Uint8Array } }).crypto;
    if (c?.getRandomValues) c.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = ((this.deps.randomU32?.() ?? Math.floor(Math.random() * 2 ** 32)) >>> 0) & 0xff;
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  get analyticsConsent(): boolean {
    return this.prefs.analyticsConsent;
  }
  setAnalyticsConsent(on: boolean): void {
    this.prefs = { ...this.prefs, analyticsConsent: on === true };
    void this.persist(PROFILE_KEYS.prefs, this.prefs);
    this.syncAnalytics();
    this.changed();
  }
  private syncAnalytics(): void {
    this.analyticsHub.setPolicy({ consent: this.prefs.analyticsConsent, bracket: this.ageProfile.bracket });
  }
  get analytics(): Analytics {
    return this.analyticsHub;
  }

  private async persist<T>(key: string, value: T): Promise<void> {
    try {
      await this.deps.profile.save(key, value);
    } catch (e) {
      this.log.warn(`[economy] could not save ${key}:`, e);
    }
  }

  // ───────────────────────── catalogue / store ─────────────────────────

  buyLock(defId: string): BuyLock {
    return buyLockFor(defId, this.wallet.entitlements);
  }
  isUsable(contentId: string): boolean {
    return isUsable(contentId, this.wallet.entitlements);
  }

  skuState(skuId: string): SkuState | null {
    const sku = skuById(skuId);
    if (!sku) return null;
    const owned = this.wallet.entitlements;
    const ents = skuEntitlements(sku);
    const isOwned = ents.length > 0 && ents.every((e) => owned.has(e)) && sku.kind !== 'ggPack';
    if (sku.kind === 'body' && !BODY_UNLOCKS_LIVE) return isOwned ? { sku, owned: true, block: 'owned' } : { sku, owned: false, block: 'comingSoon' };
    if (sku.kind === 'petVariant' && !PET_VARIANTS_LIVE) return { sku, owned: false, block: 'comingSoon' };
    if (sku.priceBones !== undefined) {
      const price = bonesPriceFor(sku, owned);
      if (isOwned || price === 0) return { sku, owned: true, priceBones: 0, block: 'owned' };
      const b = bonesBlock(sku, this.ageProfile);
      return { sku, owned: false, priceBones: price, block: b ?? (price > this.wallet.bones ? 'insufficient' : null) };
    }
    if (isOwned) return { sku, owned: true, block: 'owned' };
    return { sku, owned: false, block: realMoneyBlock(sku, this.ageProfile, this.walletImpl.signedIn) };
  }

  async unlock(skuId: string): Promise<UnlockResult> {
    try {
      await this.init();
      const sku = skuById(skuId);
      if (!sku) return { ok: false, code: 'unknown', message: 'That item is not in the store.' };
      if (sku.priceBones === undefined) return { ok: false, code: 'notForBones', message: 'This item is not sold for Bones.' };
      if (sku.kind === 'body' && !BODY_UNLOCKS_LIVE) return { ok: false, code: 'comingSoon', message: 'Cast body unlocks arrive with a later update.' };
      if (sku.kind === 'petVariant' && !PET_VARIANTS_LIVE) return { ok: false, code: 'comingSoon', message: 'Undead pet looks arrive with a later update.' };
      const block = bonesBlock(sku, this.ageProfile);
      if (block) return { ok: false, code: 'blocked', block, message: block === 'ageGate' ? 'Answer the age question first.' : 'Not available for this profile.' };
      const nonce = `${this.now().toString(36)}${((this.deps.randomU32?.() ?? Math.floor(Math.random() * 2 ** 32)) >>> 0).toString(36)}`;
      let spent = 0;
      const r = await this.ledger.append((state) => {
        const owned = state.totals.entitlements;
        const price = bonesPriceFor(sku, owned);
        const ents = skuEntitlements(sku).filter((e) => !owned.has(e));
        if (price === 0 || ents.length === 0) return { fail: 'duplicate', message: 'You already own this.' };
        if (price > state.totals.bones) return { fail: 'insufficient', message: 'Not enough Bones yet.' };
        spent = price;
        return { kind: 'spend', currency: 'bones', amount: price, key: `spend:${sku.id}:${nonce}`, reason: `Unlocked ${sku.title}`, entitlements: ents };
      });
      this.ledgerState = r.state;
      this.changed();
      if (r.ok) {
        this.broadcast();
        this.analyticsHub.track({ name: 'bones_unlock', skuId: sku.id, priceBones: spent });
        return { ok: true, skuId: sku.id, spent };
      }
      if (r.code === 'duplicate') return { ok: false, code: 'owned', message: r.message };
      if (r.code === 'insufficient') return { ok: false, code: 'insufficient', message: r.message };
      return { ok: false, code: 'error', message: r.message };
    } catch (e) {
      this.log.warn('[economy] unlock failed:', e);
      return { ok: false, code: 'error', message: 'Something went wrong; nothing was spent.' };
    }
  }

  async purchaseGG(skuId: string): Promise<{ ok: false; block: PurchaseBlock | 'unavailable'; message: string } | { ok: true }> {
    const sku: StoreSku | null = skuById(skuId);
    if (!sku || (sku.priceGG === undefined && sku.priceUsdCents === undefined)) return { ok: false, block: 'unavailable', message: 'Not sold for Grave Gold.' };
    const block = realMoneyBlock(sku, this.ageProfile, this.walletImpl.signedIn);
    this.analyticsHub.track({ name: 'gg_purchase_attempt', skuId: sku.id, blocked: block ?? 'none' });
    if (block) return { ok: false, block, message: block === 'signIn' ? 'Sign in to buy (coming soon).' : 'Purchases are not available for this profile.' };
    // The same two gates the Bones path (unlock) has, before any wallet is asked to charge: a body is not sold
    // while skuState shows it as coming soon, and nothing that stays owned is sold twice (found with the dev
    // wallet: a second purchase of the same body debited again).
    if (sku.kind === 'body' && !BODY_UNLOCKS_LIVE) return { ok: false, block: 'unavailable', message: 'Cast body unlocks arrive with a later update.' };
    if (sku.kind === 'petVariant' && !PET_VARIANTS_LIVE) return { ok: false, block: 'unavailable', message: 'Undead pet looks arrive with a later update.' };
    const ents = skuEntitlements(sku);
    const owned = this.wallet.entitlements;
    if (sku.kind !== 'ggPack' && ents.length > 0 && ents.every((e) => owned.has(e))) return { ok: false, block: 'unavailable', message: 'You already own this.' };
    try {
      const r = await this.walletImpl.purchase(sku);
      this.changed();
      return r.ok ? { ok: true } : { ok: false, block: r.code === 'signInRequired' ? 'signIn' : 'unavailable', message: r.message };
    } catch {
      return { ok: false, block: 'unavailable', message: 'The store is unavailable right now.' };
    }
  }

  get storeFocus(): { tab: StoreTabId; skuId: string | null } {
    return this.focus;
  }
  focusStore(tab: StoreTabId, skuId: string | null = null, source?: 'menu' | 'hud' | 'buyLock' | 'hotkey'): void {
    this.focus = { tab, skuId };
    if (source) this.analyticsHub.track({ name: 'store_opened', source });
    this.changed();
  }
  trackTab(tab: StoreTabId): void {
    this.analyticsHub.track({ name: 'store_tab', tab });
  }

  // ───────────────────────── daily / quests views ─────────────────────────

  get daily(): DailyView {
    const v = viewTasks(this.dailyState);
    return { day: this.dailyState.day, tasks: v.tasks, streak: this.dailyState.streak, weekly: v.weekly, clockRollback: this.clockRollback };
  }
  get quests(): readonly QuestView[] {
    return this.questViews;
  }
  get toasts(): readonly EconomyToast[] {
    return this.toastList;
  }
  dismissToast(id: number): void {
    const n = this.toastList.length;
    this.toastList = this.toastList.filter((t) => t.id !== id);
    if (this.toastList.length !== n) this.changed();
  }

  /** For tests/diagnostics. */
  get dailySnapshot(): DailyState {
    return this.dailyState;
  }

  private rotate(): void {
    const r = rollover(this.dailyState, new Date(this.now()));
    this.clockRollback = r.clockRollback;
    if (r.rotated || JSON.stringify(r.state) !== JSON.stringify(this.dailyState)) {
      this.dailyState = r.state;
      this.dailyDirty = true;
    }
  }

  // ───────────────────────── game-layer hooks ─────────────────────────

  /**
   * Drained events of the PLAYED world (never the menu demo). Converts quest completions / achievements into grants
   * and feeds daily tasks. Never throws.
   */
  onSimEvents(sim: SimLike, events: readonly SimEvent[]): void {
    if (!this._ready || this.disposed || !Array.isArray(events) || events.length === 0) return;
    try {
      this.reconcileWorld(sim);
      if (this.ineligible(sim.state)) return;
      const wid = worldKey(sim.state);
      for (const g of grantsFromEvents(events, sim.state)) {
        // Progress that was already inside an imported file is not paid (only progress made here earns).
        if (isPreexisting(this.registry, wid, g.grantId)) continue;
        this.enqueueWorldGrant(g, g.grantId.includes(':milestone:') || g.grantId.includes(':promotion:') || g.grantId.includes(':skill:') ? 'achievement' : 'quest', false);
      }
      this.rotate();
      const w = this.objectiveWorld(sim);
      if (!w) return;
      const r = observeEvents(this.dailyState, events, w);
      if (r.changed) {
        this.dailyState = r.state;
        this.dailyDirty = true;
      }
      for (const g of r.due) this.enqueueDaily(g);
      this.refreshQuests(sim);
    } catch (e) {
      this.log.warn('[economy] event handling failed:', e);
    }
  }

  /** Per-frame hook for the played world: periodic state evaluation + throttled persistence. Never throws. */
  onFrame(sim: SimLike | null): void {
    if (!this._ready || this.disposed) return;
    try {
      const t = this.now();
      // Storage could not be read at start-up (I/O error): try again every few seconds until it can.
      if (this.ledgerState?.status === 'unavailable' && t - this.lastLedgerRetry >= LEDGER_RETRY_MS) {
        this.lastLedgerRetry = t;
        void this.refreshFromStorage();
      }
      if (sim && sim !== this.lastSim) {
        this.lastSim = sim;
        this.onWorldChanged();
      }
      if (sim && t - this.lastEvalAt >= STATE_EVAL_MS) {
        this.lastEvalAt = t;
        this.reconcileWorld(sim);
        this.rotate();
        const tick = typeof sim.state.tick === 'number' ? sim.state.tick : 0;
        const elapsedMin = this.lastEvalTick === null || tick < this.lastEvalTick ? 0 : (tick - this.lastEvalTick) * TICK_MINUTES;
        this.lastEvalTick = tick;
        const w = this.ineligible(sim.state) ? null : this.objectiveWorld(sim);
        if (w) {
          const r = evaluateState(this.dailyState, w, elapsedMin);
          if (r.changed) {
            this.dailyState = r.state;
            this.dailyDirty = true;
            this.changed();
          }
          for (const g of r.due) this.enqueueDaily(g);
        }
        this.refreshQuests(sim);
      }
      if (this.dailyDirty && t - this.lastDailySave >= DAILY_SAVE_MS) {
        this.lastDailySave = t;
        this.dailyDirty = false;
        void this.persist(PROFILE_KEYS.daily, this.dailyState);
      }
    } catch (e) {
      this.log.warn('[economy] frame hook failed:', e);
    }
  }

  /** A new played world (new game / load): forget per-world caches. */
  onWorldChanged(): void {
    this.lastEvalTick = null;
    this.questViews = [];
  }

  /** Flush pending state (quit / pagehide). */
  async flush(): Promise<void> {
    if (this.dailyDirty) {
      this.dailyDirty = false;
      await this.persist(PROFILE_KEYS.daily, this.dailyState);
    }
  }

  /** New game on THIS profile (lifecycle.startGame): the only worlds whose recorded grants are ever reconciled. */
  registerNewWorld(world: WorldLike | null | undefined): void {
    this.worldOp((r) => {
      const id = worldKey(world);
      return !!id && registerNative(r, id, this.now());
    });
  }

  /**
   * A world that arrived through the save importer (controller.importSave). Never reconciled, and every quest
   * instance already in progress / recorded in the file is not paid when it completes. Never throws.
   */
  noteImportedWorld(world: WorldLike | null | undefined): void {
    this.worldOp((r) => {
      const id = worldKey(world);
      return !!id && registerImported(r, id, grantIdsInWorld(world, id), this.now());
    });
  }

  /** For tests/diagnostics. */
  get worldRegistry(): WorldRegistry {
    return this.registry;
  }

  private worldOp(op: (r: WorldRegistry) => boolean): void {
    try {
      if (!this.registryLoaded) {
        this.pendingWorldOps.push(op);
        return;
      }
      if (op(this.registry)) void this.persist(PROFILE_KEYS.worlds, this.registry);
    } catch (e) {
      this.log.warn('[economy] world registry update failed:', e);
    }
  }

  /** Cheated per the save (a `true` is believed and remembered) OR per the profile's sticky record. */
  private ineligible(state: WorldLike | null | undefined): boolean {
    const id = worldKey(state);
    if (worldCheated(state)) {
      if (id && !isCheated(this.registry, id)) this.worldOp((r) => markCheated(r, id, this.now()));
      return true;
    }
    return isCheated(this.registry, id);
  }

  private enqueueWorldGrant(g: { grantId: string; bones: number; reason: string; entitlements?: string[] }, source: 'quest' | 'achievement', quiet: boolean): void {
    const pg = profileGrantOf(g, source === 'quest');
    if (!pg) return;
    this.enqueue({ key: pg.key, bones: g.bones, reason: g.reason, ...(g.entitlements ? { entitlements: g.entitlements } : {}), source, attempts: 0, quiet, pg });
  }

  private objectiveWorld(sim: SimLike): ObjectiveWorld | null {
    try {
      return objectiveWorldOf(sim as unknown as Parameters<typeof objectiveWorldOf>[0]);
    } catch {
      return null;
    }
  }

  private refreshQuests(sim: SimLike): void {
    try {
      const v = typeof sim.quests === 'function' ? (sim.quests() as { active?: unknown } | null) : null;
      const active = v && Array.isArray(v.active) ? (v.active as Record<string, unknown>[]) : [];
      const next: QuestView[] = active.slice(0, 6).map((q) => {
        const steps = Array.isArray(q.steps) ? (q.steps as Record<string, unknown>[]) : [];
        const cur = steps.find((s) => s.current === true) ?? steps[0];
        const view: QuestView = {
          id: String(q.questId ?? ''),
          title: String(q.title ?? ''),
          step: String(cur?.label ?? ''),
          progress: Number(cur?.progress ?? 0) || 0,
          target: Number(cur?.target ?? 1) || 1,
          bones: Number((q.reward as { bones?: unknown } | undefined)?.bones ?? 0) || 0,
          done: false,
        };
        // Story-arc beats (W-113) carry their narrative line; classic quests keep the compact row.
        if (typeof q.arc === 'string' && q.arc && typeof q.description === 'string' && q.description) view.beat = q.description.slice(0, 240);
        // every quest carries its current step id (W-116 Show me; W-123 the row's Go resolves that step)
        if (typeof cur?.id === 'string') view.stepId = cur.id;
        if (cur?.credited === true) view.credited = true;
        return view;
      });
      if (JSON.stringify(next) !== JSON.stringify(this.questViews)) {
        this.questViews = next;
        this.changed();
      }
    } catch {
      /* keep the previous view */
    }
  }

  /**
   * Once per world object: re-request every quest grant the world has on record (idempotent) — ONLY for a world this
   * profile created (registry 'native', never seen cheating). An imported or unknown world's record is save data
   * someone else could have written, so it is never paid (H-1).
   */
  private reconcileWorld(sim: SimLike): void {
    const st = sim.state as object | null;
    if (!st || this.reconciledWorlds.has(st)) return;
    this.reconciledWorlds.add(st);
    if (this.ineligible(sim.state) || !mayReconcile(this.registry, worldKey(sim.state))) return;
    // Amounts/entitlements come from the quest DEFINITIONS, never from the (editable) save record.
    for (const g of reconcileGrants(sim.state)) this.enqueueWorldGrant(g, 'quest', true);
  }

  private enqueueDaily(g: GrantDue): void {
    this.enqueue({ key: g.key, bones: g.bones, reason: g.reason, source: g.source, attempts: 0, quiet: false });
  }

  // ───────────────────────── grant queue ─────────────────────────

  private enqueue(g: PendingGrant): void {
    if (this.queue.some((q) => q.key === g.key)) return;
    const keys = this.ledgerState?.totals.keys;
    if (keys && (g.pg ? alreadyPaid(keys, g.pg) : keys.has(g.key))) return; // already paid (fast path; re-checked under lock)
    if (g.bones <= 0 && !(g.entitlements && g.entitlements.length)) return;
    this.queue.push(g);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0 && !this.disposed) {
        const g = this.queue[0];
        const ents = (g.entitlements ?? []).filter((e) => ENTITLEMENT_RE.test(e) && !isServerOnlyEntitlement(e));
        const req = { kind: 'grant' as const, currency: 'bones' as const, amount: g.bones, key: g.key, reason: g.reason, ...(ents.length ? { entitlements: ents } : {}) };
        const pg = g.pg;
        // World grants are checked against the ledger UNDER its cross-window lock: paid under any key (incl. legacy
        // world-scoped keys) → duplicate; repeatable and over today's profile-wide cap → capped (H-1).
        const r = await this.ledger.append(
          pg
            ? (state) => {
                if (alreadyPaid(state.totals.keys, pg)) return { fail: 'duplicate' as const, message: 'Already granted on this profile.' };
                if (pg.cls === 'repeatable' && !withinDailyCap(state.entries, this.now(), g.bones)) return { fail: 'capped' as const, message: 'Daily Bones limit for repeatable rewards reached.' };
                return req;
              }
            : req,
        );
        this.ledgerState = r.state;
        if (r.ok) {
          this.queue.shift();
          this.broadcast();
          this.analyticsHub.track({ name: 'bones_granted', source: g.source, amount: g.bones });
          this.pushToast(g);
          this.changed();
        } else if (r.code === 'io' || r.code === 'busy') {
          g.attempts++;
          if (g.attempts >= 5) {
            this.log.warn(`[economy] giving up on grant ${g.key} for now (${r.message}); it is re-requested next start`);
            this.queue.shift();
          } else {
            this.scheduleRetry(250 * 2 ** g.attempts);
            break;
          }
        } else {
          // duplicate (already paid — replay/reload), capped (profile daily limit), invalid, full: never retried.
          this.queue.shift();
          this.changed();
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private scheduleRetry(ms: number): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.drain();
    }, ms);
  }

  private pushToast(g: PendingGrant): void {
    const id = ++this.toastSeq;
    this.toastList = [...this.toastList, { id, title: g.bones > 0 ? `+${g.bones} Bones` : 'Unlocked', text: g.reason, bones: g.bones, createdAt: this.now() }].slice(-MAX_TOASTS);
  }

  private broadcast(): void {
    try {
      this.channel?.postMessage({ type: 'ledger' });
    } catch {
      /* ignore */
    }
  }

  /** Test hook: resolves when the grant queue is empty. */
  /**
   * Resolves once every queued grant has been settled (paid, refused or given up). Bounded by WALL-CLOCK time, not
   * by a poll count: a poll-count bound returned early on a loaded machine with grants still queued, so callers saw a
   * partial wallet (W-106 cap test: 440 instead of ≥ 580). Rejects instead of returning silently on timeout.
   */
  async idle(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!this.disposed && (this.queue.length > 0 || this.draining)) {
      if (Date.now() > deadline) throw new Error(`[economy] idle() timed out after ${timeoutMs} ms with ${this.queue.length} grant(s) still queued`);
      await new Promise((r) => setTimeout(r, 5));
    }
  }
}

export function isBodyContent(id: string): boolean {
  return id.startsWith(BODY_PREFIX);
}

/** The desktop app (native bridge present) running on a backend other than its saves folder: a fallback session. */
function desktopOnBrowserStorage(backend: StorageBackend | null): boolean {
  const w = (globalThis as { window?: { afterlifeNative?: unknown } }).window;
  if (!w || w.afterlifeNative === undefined || w.afterlifeNative === null) return false;
  return !backend || backend.id !== 'electron';
}
