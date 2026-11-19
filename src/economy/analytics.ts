/**
 * Analytics event schema (docs/MONETIZATION.md §7 phase 2: "consent-gated, no PII") + a no-op sink.
 *
 *  - Events are a closed union of ENUMERATED fields only: ids from our own catalogue/SKU/quest lists, counts, buckets.
 *    No names, free text, emails, device ids, IPs or precise timestamps (the sink adds a coarse UTC day at most).
 *  - Nothing is recorded without explicit opt-in consent; under-13 (or an unanswered age gate) records NOTHING, even
 *    with consent; there is no personalisation.
 *  - Phase 2 ships only the no-op sink. A real sink (Phase 4) must accept exactly these shapes.
 */
import type { AgeBracket } from '../shared/economy';

export type AnalyticsEvent =
  | { name: 'store_opened'; source: 'menu' | 'hud' | 'buyLock' | 'hotkey' }
  | { name: 'store_tab'; tab: StoreTabId }
  | { name: 'sku_viewed'; skuId: string }
  | { name: 'bones_unlock'; skuId: string; priceBones: number }
  | { name: 'gg_purchase_attempt'; skuId: string; blocked: 'signIn' | 'under13' | 'cap' | 'ageMin' | 'ageGate' | 'none' }
  | { name: 'bones_granted'; source: 'quest' | 'daily' | 'weekly' | 'streak' | 'achievement'; amount: number }
  | { name: 'age_gate_answered'; bracket: Exclude<AgeBracket, 'unknown'> }
  | { name: 'ledger_issue'; status: 'recovered' | 'corrupt' | 'unavailable' };

export type StoreTabId = 'featured' | 'bundles' | 'items' | 'bodies' | 'boosts' | 'season' | 'gold';

export interface AnalyticsSink {
  record(e: AnalyticsEvent): void;
}

export const noopSink: AnalyticsSink = { record: () => undefined };

export interface AnalyticsPolicy {
  consent: boolean;
  bracket: AgeBracket;
}

/** Keys allowed on any event (anything else is dropped before reaching a sink). */
const ALLOWED_KEYS: ReadonlySet<string> = new Set(['name', 'source', 'tab', 'skuId', 'priceBones', 'blocked', 'amount', 'bracket', 'status']);
const ID_RE = /^[a-z0-9_:]{1,64}$/;

/** Value type of field K across the event union; a field is "enumerated" when that is a closed set of string literals. */
type Field<K extends PropertyKey, E = AnalyticsEvent> = E extends Record<K, infer V> ? V : never;
type EventKey<E = AnalyticsEvent> = E extends unknown ? keyof E : never;
type EnumKey = { [K in EventKey]: string extends Field<K> ? never : Field<K> extends string ? K : never }[EventKey];
/**
 * The only strings an enumerated field may carry. Typed from the event union above, so adding, renaming or removing a
 * member there without doing the same here fails the typecheck. Free ids (skuId) are not listed and keep ID_RE.
 */
const ENUM_VALUES: { readonly [K in EnumKey]: Readonly<Record<Field<K> & string, true>> } = {
  name: { store_opened: true, store_tab: true, sku_viewed: true, bones_unlock: true, gg_purchase_attempt: true, bones_granted: true, age_gate_answered: true, ledger_issue: true },
  source: { menu: true, hud: true, buyLock: true, hotkey: true, quest: true, daily: true, weekly: true, streak: true, achievement: true },
  tab: { featured: true, bundles: true, items: true, bodies: true, boosts: true, season: true, gold: true },
  blocked: { signIn: true, under13: true, cap: true, ageMin: true, ageGate: true, none: true },
  bracket: { under13: true, teen: true, adult: true },
  status: { recovered: true, corrupt: true, unavailable: true },
};

/** Strip anything that is not part of the schema (defence in depth against a caller passing extra fields). */
export function scrub(e: AnalyticsEvent): AnalyticsEvent | null {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (!ALLOWED_KEYS.has(k)) continue;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return null;
      out[k] = Math.round(v);
    } else if (typeof v === 'string') {
      const allowed = (ENUM_VALUES as Readonly<Record<string, Readonly<Record<string, true>> | undefined>>)[k];
      if (allowed ? allowed[v] !== true : !ID_RE.test(v)) return null; // free text never passes
      out[k] = v;
    } else return null;
  }
  return out as AnalyticsEvent;
}

export class Analytics {
  constructor(
    private readonly sink: AnalyticsSink = noopSink,
    private policy: AnalyticsPolicy = { consent: false, bracket: 'unknown' },
  ) {}

  setPolicy(p: AnalyticsPolicy): void {
    this.policy = { consent: p.consent === true, bracket: p.bracket };
  }

  /** True when events may be recorded at all. */
  get enabled(): boolean {
    return this.policy.consent && (this.policy.bracket === 'teen' || this.policy.bracket === 'adult');
  }

  track(e: AnalyticsEvent): void {
    if (!this.enabled) return;
    const clean = scrub(e);
    if (!clean) return;
    try {
      this.sink.record(clean);
    } catch {
      /* analytics must never break the game */
    }
  }
}
