/**
 * The economy facade the UI reads (exposed as `GameController.economy`). The UI never touches the ledger, storage or
 * wallet directly — only this interface (same rule as GameController: docs/CONTRACTS.md).
 */
import type { StoreSku, WalletView } from '../shared/economy';
import type { AgeProfile, PurchaseBlock } from './age';
import type { BuyLock } from './catalog';
import type { StoreTabId } from './analytics';

export interface DailyTaskView {
  id: string;
  title: string;
  progress: number;
  target: number;
  bones: number;
  done: boolean;
}

export interface DailyView {
  day: string | null;
  tasks: DailyTaskView[];
  streak: number;
  weekly: DailyTaskView | null;
  /** The device clock is earlier than a day already played: tasks stay as they were. */
  clockRollback: boolean;
}

/** A story/sim quest as the HUD shows it (read from the sim when its quest system provides views). */
export interface QuestView {
  id: string;
  title: string;
  /** Current step text (or a summary). */
  step: string;
  progress: number;
  target: number;
  bones: number;
  done: boolean;
  /** Story-arc quests (W-113 Act 1): the beat's short narrative line. Absent for classic/neighbourhood quests. */
  beat?: string;
  /** Current step id (W-116: "Show me" matches it against the story target). */
  stepId?: string;
  /** W-116: the current step was credited from something already done since the arc began ("Already done — nice"). */
  credited?: boolean;
}

export interface EconomyToast {
  id: number;
  title: string;
  text: string;
  bones: number;
  createdAt: number;
}

export type UnlockResult =
  | { ok: true; skuId: string; spent: number }
  | { ok: false; code: 'owned' | 'insufficient' | 'blocked' | 'notForBones' | 'unknown' | 'error' | 'comingSoon'; message: string; block?: PurchaseBlock };

export interface SkuState {
  sku: StoreSku;
  owned: boolean;
  /** Effective Bones price (bundles: unowned parts only); undefined for GG/real-money SKUs. */
  priceBones?: number;
  /** Why it can't be bought right now (null = buyable). */
  block: PurchaseBlock | 'insufficient' | 'owned' | 'comingSoon' | null;
}

export interface EconomyFacade {
  readonly version: number;
  subscribe(fn: () => void): () => void;
  readonly ready: boolean;
  readonly wallet: WalletView;
  /** Ledger problems found at load (empty when healthy) — shown in the store. */
  readonly ledgerIssues: readonly string[];

  readonly age: AgeProfile;
  /** First-run gate: true until a year of birth was answered. */
  readonly needsAgeGate: boolean;
  answerAgeGate(year: number | string): 'ok' | 'invalid' | 'locked';
  /** Teen cap: needs the ParentGate (fails closed offline → 'parentRequired'). */
  setSpendCap(cents: number): Promise<'ok' | 'parentRequired'>;
  readonly analyticsConsent: boolean;
  setAnalyticsConsent(on: boolean): void;

  /** Buy-mode lock state for an object def. */
  buyLock(defId: string): BuyLock;
  isUsable(contentId: string): boolean;
  skuState(skuId: string): SkuState | null;
  unlock(skuId: string): Promise<UnlockResult>;
  /** GG / real-money SKUs: always "Sign in to buy (coming soon)" in this build. */
  purchaseGG(skuId: string): Promise<{ ok: false; block: PurchaseBlock | 'unavailable'; message: string } | { ok: true }>;

  readonly daily: DailyView;
  readonly quests: readonly QuestView[];
  readonly toasts: readonly EconomyToast[];
  dismissToast(id: number): void;

  /** Where the store should open (tab + highlighted SKU), set by "unlock in store" links. */
  readonly storeFocus: { tab: StoreTabId; skuId: string | null };
  focusStore(tab: StoreTabId, skuId?: string | null, source?: 'menu' | 'hud' | 'buyLock' | 'hotkey'): void;
  trackTab(tab: StoreTabId): void;
}
