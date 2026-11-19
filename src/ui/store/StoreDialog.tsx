/**
 * Store dialog (docs/MONETIZATION.md §3): tabs Featured · Bundles · Items · Bodies · Boosts · Season · Grave Gold.
 * Owned markers, Bones prices, every GG price with its real-money equivalent, bundle contents + sum of parts, GG/real
 * money → "Sign in to buy (coming soon)". Under-13 / spending-cap / unanswered age gate explain the real reason.
 * Accessibility: Modal (focus trap, Esc), WAI-ARIA tabs, list semantics, an aria-live status line for results.
 */
import { useEffect, useState } from 'preact/hooks';
import type { StoreSku } from '../../shared/economy';
import type { EconomyFacade, SkuState } from '../../economy/facade';
import type { StoreTabId } from '../../economy/analytics';
import { Badge, Button, Modal, Select, Tabs, TabPanel, Toggle } from '../common';
import { Icon } from '../icons';
import { useGame } from '../hooks';
import { STORE_TABS, bundleView, priceView, rateNote, skusForTab } from './model';
import { st } from './strings';
import { useEconomy } from './useEconomy';
import { AgeGateForm } from './AgeGate';
import { exactTopUp, formatCount, formatUsd } from '../../economy/pricing';
import './store.css';

const ID_BASE = 'store';
const TAB_ICON: Record<StoreTabId, Parameters<typeof Icon>[0]['name']> = {
  featured: 'star',
  bundles: 'gift',
  items: 'buy',
  bodies: 'user',
  boosts: 'lightning',
  season: 'trophy',
  gold: 'crown',
};

function BonesGlyph({ size = '1rem' }: { size?: string }) {
  return <Icon name="skull" size={size} class="st-bones-glyph" />;
}

export function StoreDialog({ onClose }: { onClose: () => void }) {
  const econ = useEconomy();
  const game = useGame();
  const focus = econ?.storeFocus ?? { tab: 'featured' as StoreTabId, skuId: null };
  const [tab, setTab] = useState<StoreTabId>(focus.tab);
  const [status, setStatus] = useState<string>('');
  useEffect(() => setTab(focus.tab), [focus.tab, focus.skuId]);
  if (!econ) return null;
  const w = econ.wallet;
  const pick = (id: string) => {
    const t = id as StoreTabId;
    setTab(t);
    econ.trackTab(t);
    game.playUi('uiTab');
  };
  const header = (
    <div class="st-balances" role="group" aria-label={st('title')}>
      <span class="st-balance" title={st('balance.bones.body')}>
        <BonesGlyph size="1.1rem" />
        <span class="u-num" data-testid="store-bones">{formatCount(w.bones)}</span>
        <span class="st-balance__label">{st('balance.bones')}</span>
      </span>
      <span class="st-balance is-gg" title={st('balance.gg.body')}>
        <Icon name="crown" size="1.1rem" />
        <span class="u-num">{w.gg === null ? st('balance.gg.signedOut') : formatCount(w.gg)}</span>
        <span class="st-balance__label">{st('balance.gg')}</span>
      </span>
    </div>
  );
  const tabs = (
    <Tabs
      idBase={ID_BASE}
      ariaLabel={st('tabs.label')}
      value={tab}
      onChange={pick}
      autoFocusSelected
      items={STORE_TABS.map((id) => ({ id, label: st(`tab.${id}`), icon: TAB_ICON[id] }))}
    />
  );
  return (
    <Modal onClose={onClose} title={st('title')} subtitle={st('subtitle')} icon="buy" size="xl" tall headerExtra={header} tabs={tabs} class="st-dialog" bodyClass="st-body">
      {econ.ledgerIssues.length > 0 && (
        <p class="st-banner is-warn" role="status">
          <Icon name="warning" size="1rem" /> {st('ledger.issue', { details: econ.ledgerIssues.join('; ') })}
        </p>
      )}
      {econ.age.bracket === 'unknown' ? (
        <div class="st-gate">
          <AgeGateForm econ={econ} />
        </div>
      ) : null}
      <TabPanel idBase={ID_BASE} value={tab}>
        <TabNote tab={tab} />
        <SkuGrid econ={econ} skus={skusForTab(tab)} highlight={focus.skuId} onStatus={setStatus} />
        {tab === 'gold' ? <ParentsPanel econ={econ} /> : null}
      </TabPanel>
      <p class="st-status" role="status" aria-live="polite" data-testid="store-status">
        {status}
      </p>
    </Modal>
  );
}

function TabNote({ tab }: { tab: StoreTabId }) {
  const key = tab === 'bodies' ? 'bodies.note' : tab === 'season' ? 'season.note' : tab === 'boosts' ? 'boosts.note' : tab === 'gold' ? 'gold.note' : null;
  if (!key) return null;
  const r = rateNote();
  return (
    <p class="st-note">
      <Icon name="info" size="0.95rem" /> {st(key)}
      {tab === 'gold' ? <> {st('gg.equivalent', { pack: r.pack, rate: r.per100 })}</> : null}
    </p>
  );
}

function SkuGrid({ econ, skus, highlight, onStatus }: { econ: EconomyFacade; skus: StoreSku[]; highlight: string | null; onStatus: (s: string) => void }) {
  if (skus.length === 0) return <p class="st-empty">{st('empty')}</p>;
  return (
    <ul class="st-grid" role="list">
      {skus.map((s) => (
        <li key={s.id}>
          <SkuCard econ={econ} sku={s} state={econ.skuState(s.id)} highlight={highlight === s.id} onStatus={onStatus} />
        </li>
      ))}
    </ul>
  );
}

function SkuCard({ econ, sku, state, highlight, onStatus }: { econ: EconomyFacade; sku: StoreSku; state: SkuState | null; highlight: boolean; onStatus: (s: string) => void }) {
  const game = useGame();
  const [busy, setBusy] = useState(false);
  const price = priceView(sku, state);
  const bundle = bundleView(sku);
  // §8: "every store page offers an exact top-up when the balance is short" (only reachable with a known GG balance).
  const ggBalance = econ.wallet.gg;
  const topUp = !owned_(state) && sku.priceGG !== undefined && ggBalance !== null ? exactTopUp(ggBalance, sku.priceGG) : null;
  const owned = state?.owned === true;
  const block = state?.block ?? null;
  const ref = (el: HTMLElement | null) => {
    if (el && highlight) el.scrollIntoView?.({ block: 'nearest' });
  };
  const unlock = async () => {
    setBusy(true);
    const r = await econ.unlock(sku.id);
    setBusy(false);
    if (r.ok) {
      game.playUi('uiConfirm');
      onStatus(st('unlock.done', { title: sku.title }));
    } else {
      game.playUi('uiError');
      onStatus(st('unlock.error', { message: r.message }));
    }
  };
  const buyGG = async () => {
    const r = await econ.purchaseGG(sku.id);
    if (!r.ok) onStatus(r.block === 'signIn' ? st('signIn.body') : r.block === 'under13' ? st('blocked.under13') : r.block === 'cap' ? st('blocked.cap') : r.block === 'ageGate' ? st('blocked.ageGate') : r.message);
  };
  let action;
  if (owned) {
    action = (
      <Badge tone="accent" icon="check" caps>
        {st('owned')}
      </Badge>
    );
  } else if (block === 'comingSoon') {
    action = <Badge tone="neutral" caps>{st('comingSoon')}</Badge>;
  } else if (price.currency === 'bones') {
    const short = block === 'insufficient' ? Math.max(0, (state?.priceBones ?? 0) - econ.wallet.bones) : 0;
    action = (
      <Button size="sm" variant="primary" disabled={block !== null || busy} loading={busy} onClick={() => void unlock()} data-testid={`unlock-${sku.id}`}>
        {block === 'insufficient' ? st('unlock.short', { amount: formatCount(short) }) : block === 'ageGate' ? st('blocked.ageGate') : st('unlock', { amount: formatCount(state?.priceBones ?? sku.priceBones ?? 0) })}
      </Button>
    );
  } else {
    const reason = block === 'under13' ? st('blocked.under13') : block === 'cap' ? st('blocked.cap') : block === 'ageGate' ? st('blocked.ageGate') : block === 'ageMin' ? st('blocked.ageMin') : null;
    action = (
      <Button size="sm" variant="secondary" icon="lock" class="is-soft-disabled" onClick={() => void buyGG()} data-testid={`buy-${sku.id}`}>
        {reason ?? st('signIn')}
      </Button>
    );
  }
  return (
    <article ref={ref} class={`st-card${owned ? ' is-owned' : ''}${highlight ? ' is-highlight' : ''}`} aria-label={owned ? st('owned.aria', { title: sku.title }) : sku.title} data-sku={sku.id}>
      <header class="st-card__head">
        <h3 class="st-card__title u-display">{sku.title}</h3>
        <span class={`st-price is-${price.currency}`} data-testid={`price-${sku.id}`}>
          {price.currency === 'bones' ? <BonesGlyph /> : price.currency === 'gg' ? <Icon name="crown" size="1rem" /> : null}
          {owned ? st('owned') : price.main}
        </span>
      </header>
      <p class="st-card__desc">{sku.description}</p>
      {sku.kind === 'ggPack' && (sku.bonusGG ?? 0) > 0 ? <p class="st-card__meta">{st('pack.bonus', { bonus: formatCount(sku.bonusGG ?? 0) })}</p> : null}
      {sku.kind === 'ggPack' && sku.firstPurchaseDouble ? <p class="st-card__meta">{st('pack.double')}</p> : null}
      {topUp ? (
        <p class="st-card__meta" data-testid={`topup-${sku.id}`}>
          {st('topup.exact', { short: formatCount(topUp.shortGG), cents: formatUsd(topUp.exactCents) })}
        </p>
      ) : null}
      {bundle ? (
        <div class="st-bundle">
          <span class="u-caps st-bundle__label">{st('bundle.contents')}</span>
          <ul class="st-bundle__list">
            {bundle.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {bundle.parts ? <p class="st-bundle__parts">{st('bundle.parts', { parts: bundle.parts })}</p> : null}
          {bundle.saving ? <p class="st-bundle__save">{st('bundle.save', { amount: bundle.saving })}</p> : null}
          {sku.priceBones !== undefined && !owned && state?.priceBones !== undefined && state.priceBones < sku.priceBones ? <p class="st-bundle__parts">{st('bundle.ownedParts')}</p> : null}
        </div>
      ) : null}
      <footer class="st-card__foot">{action}</footer>
    </article>
  );
}

const owned_ = (s: SkuState | null): boolean => s?.owned === true;

function ParentsPanel({ econ }: { econ: EconomyFacade }) {
  const age = econ.age;
  const caps = [0, 1000, 2500, 5000, 10000];
  return (
    <section class="st-parents" aria-labelledby="st-parents-title">
      <h3 id="st-parents-title" class="ui-section-title">
        {st('parents.title')}
      </h3>
      {age.bracket === 'teen' ? (
        <div class="st-parents__row">
          <div>
            <div id="st-cap-label">{st('parents.cap')}</div>
            <div class="st-parents__body">{st('parents.cap.body')}</div>
            <div id="st-cap-locked" class="st-parents__body">
              {st('parents.cap.locked')}
            </div>
          </div>
          {/* Cap changes need the parent gate (D-2/M-2); none exists offline, so the control is read-only. */}
          <Select<number> labelledBy="st-cap-label" describedBy="st-cap-locked" disabled value={caps.includes(age.spendCapCents) ? age.spendCapCents : 2500} options={caps.map((c) => ({ value: c, label: `$${(c / 100).toFixed(0)}` }))} onChange={(v) => void econ.setSpendCap(v)} />
        </div>
      ) : null}
      <div class="st-parents__row">
        <div>
          <div id="st-analytics-label">{st('parents.analytics')}</div>
          <div class="st-parents__body" id="st-analytics-body">
            {st('parents.analytics.body')}
          </div>
        </div>
        <Toggle checked={econ.analyticsConsent && age.bracket !== 'under13'} disabled={age.bracket === 'under13' || age.bracket === 'unknown'} labelledBy="st-analytics-label" describedBy="st-analytics-body" onChange={(v) => econ.setAnalyticsConsent(v)} />
      </div>
    </section>
  );
}
