/**
 * Buy mode catalog (bottom): category tabs (BUY_CATEGORIES), search, item grid with renderer thumbnails, price,
 * environment score and affordability; a detail card for the hovered/selected item (description, what it is
 * good for, colour variants); Sell for a picked-up object; hint bar for rotate / sell / cancel.
 * W-123: a quest row's "Needs an easel · Shop" opens it filtered (hudStore.buyFilter) to the items that satisfy the
 * step, with a chip to clear the filter; picking a tab, searching or leaving Buy mode clears it.
 */
import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { GameController } from '../../../game/contracts';
import { BUY_CATEGORIES } from '../../../shared/catalog';
import { buildCatalog, envLabel, footprintLabel, goodFor, itemsInCategory, searchCatalog, type CatalogItem } from '../lib/catalog';
import { formatMoney, inkFor, num } from '../lib/format';
import { safe } from '../lib/safe';
import { hudStore, useHudStore } from '../lib/store';
import { Badge, Button, IconButton, Kbd } from '../parts/controls';
import { useGame } from '../parts/hooks';
import { Icon } from '../parts/icons';
import { rovingKeyDown, rovingTabIndex } from '../parts/roving';
import { useHorizontalWheel, useOverflowFade } from '../parts/scroll';
import { tip } from '../parts/tooltip';
import { ht } from '../strings';
import { Thumb } from './Thumb';
import './buy.css';
import { BonesLock, bonesLockText } from '../../store/BonesLock';

/** A click synthesized from Enter / Space on a focused button (pointer clicks report detail ≥ 1). */
export function isKeyboardClick(e: object | null | undefined): boolean {
  return !!e && (e as { detail?: unknown }).detail === 0;
}

/** Move keyboard focus to the game world (the canvas), where Buy-mode placement keys are handled. */
function focusWorld(): void {
  try {
    const canvas = document.getElementById('game-canvas');
    if (canvas && typeof canvas.focus === 'function') canvas.focus({ preventScroll: true });
    else (document.activeElement as HTMLElement | null)?.blur?.();
  } catch {
    /* focus is a convenience; placement keys also work from <body> */
  }
}

export const CATEGORY_ICON: Record<string, string> = {
  seating: 'sofa',
  surfaces: 'table',
  kitchen: 'fridge',
  preservation: 'freshness',
  beds: 'coffin',
  electronics: 'tv',
  hobbies: 'paint',
  decor: 'plant',
  lighting: 'candle',
  outdoor: 'tree',
  misc: 'crate',
  doors: 'door',
  windows: 'window',
};

const NEED_GLYPH: Record<string, string> = { hunger: 'hunger', energy: 'energy', preservation: 'freshness', social: 'social', fun: 'fun', hygiene: 'hygiene' };

export function BuyCatalog() {
  const game = useGame();
  const ui = useHudStore();
  const sim = game.sim;
  const objects = sim?.content.objects;
  const items = useMemo(() => safe('buy.catalog', () => buildCatalog(objects), []), [objects]);
  const funds = num(sim?.state.household.funds);
  const buy = game.buy;
  const category = BUY_CATEGORIES.some((c) => c.id === buy.category) ? buy.category : BUY_CATEGORIES[0].id;
  const query = ui.buySearch.trim();
  const filter = !query && ui.buyFilter && Array.isArray(ui.buyFilter.defIds) && ui.buyFilter.defIds.length > 0 ? ui.buyFilter : null;
  // Catalogue tiers (docs/MONETIZATION.md §3): premium items stay hidden until entitled; Bones items show a lock.
  const econ = game.economy ?? null;
  const base = query ? searchCatalog(items, query) : filter ? filter.defIds.map((id) => items.find((it) => it.defId === id)).filter((it): it is CatalogItem => !!it) : itemsInCategory(items, category);
  const shown = base.filter((it) => !econ || econ.buyLock(it.defId).state !== 'hidden');
  // leaving Buy mode drops a quest filter (the next visit shows the normal tabs)
  useEffect(() => () => hudStore.set({ buyFilter: null }), []);
  const sellId = buy.movingObjectId ?? (buy.placingDefId ? null : buy.hoverObjectId ?? null);
  const moving = sellId ? safe('buy.moving', () => sim?.objectView(sellId) ?? null, null) : null;
  const pickedUp = !!buy.movingObjectId;
  const focusId = buy.placingDefId ?? ui.buyFocus ?? shown[0]?.defId ?? null;
  const focus = items.find((i) => i.defId === focusId) ?? null;
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  const catsRef = useRef<HTMLDivElement>(null);
  useOverflowFade(catsRef, 'x');
  useHorizontalWheel(catsRef);
  const placing = !!buy.placingDefId;
  useOverflowFade(gridRef, 'y', [category, query, shown.length, filter]);

  const pickCategory = (id: string) => {
    hudStore.set({ buySearch: '', buyFocus: null, buyFilter: null });
    game.setBuyCategory(id);
    game.playUi('uiTab');
  };
  const place = (it: CatalogItem, tint: string | null, e?: Event) => {
    if (it.price > funds) {
      game.playUi('uiError');
      return;
    }
    hudStore.set({ buyFocus: it.defId });
    game.startPlacing(it.defId, tint);
    game.playUi('uiClick');
    // Keyboard activation (Enter / Space → click with detail 0): hand focus to the world so the arrow keys move the
    // ghost and Enter places it (W-064). The live region announces the instructions; F6 comes back to the catalog.
    if (e && isKeyboardClick(e) && game.buy.placingDefId === it.defId) focusWorld();
  };

  return (
    <section class="hud-buy ui-panel ui-interactive" aria-label={ht('buy.label')} data-hint-anchor="catalog buy-catalog" data-hud-region="80">
      <header class="hud-buy__head">
        <div ref={catsRef} class="hud-cats hud-ofl-x" role="tablist" aria-label={ht('buy.label')} aria-orientation="horizontal" data-roving-group="" onKeyDown={rovingKeyDown}>
          {BUY_CATEGORIES.map((c, i) => {
            const sel = !query && !filter && c.id === category;
            return (
              <button
                type="button"
                role="tab"
                key={c.id}
                aria-selected={sel ? 'true' : 'false'}
                aria-controls="hud-buy-grid"
                tabIndex={rovingTabIndex(i, BUY_CATEGORIES.findIndex((x) => x.id === category), BUY_CATEGORIES.length)}
                aria-label={c.label}
                class={`hud-cat${sel ? ' is-active' : ''}`}
                onClick={() => pickCategory(c.id)}
                {...(sel ? {} : tip({ title: c.label, place: 'top' }))}
              >
                <Icon name={CATEGORY_ICON[c.id] ?? 'crate'} size="1.125rem" />
                {sel && <span class="hud-cat__label">{c.label}</span>}
              </button>
            );
          })}
        </div>
        <label class="ui-input-wrap hud-buy__search">
          <span class="ui-input-wrap__icon">
            <Icon name="search" size="1rem" />
          </span>
          <input
            ref={searchRef}
            class="ui-input"
            type="search"
            value={ui.buySearch}
            placeholder={ht('buy.search.placeholder')}
            aria-label={ht('buy.search')}
            data-esc-local={ui.buySearch ? '' : undefined}
            onInput={(e) => hudStore.set({ buySearch: (e.currentTarget as HTMLInputElement).value, buyFilter: null })}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && ui.buySearch) {
                e.preventDefault();
                hudStore.set({ buySearch: '' });
              }
              e.stopPropagation();
            }}
          />
          {ui.buySearch && (
            <IconButton icon="close" size="xs" label={ht('buy.search.clear')} onClick={() => { hudStore.set({ buySearch: '' }); searchRef.current?.focus(); }} />
          )}
        </label>
      </header>
      <div class="hud-buy__body">
        <div class="hud-buy__gridwrap">
          {query && <div class="hud-buy__results">{shown.length > 0 ? ht('buy.results', { count: shown.length }) : ht('buy.noResults', { query })}</div>}
          {filter && (
            <div class="hud-buy__results hud-buy__filter" data-testid="buy-quest-filter">
              <span>{ht('buy.questFilter', { need: filter.label, count: shown.length })}</span>
              <IconButton icon="close" size="xs" label={ht('buy.questFilter.clear')} onClick={() => hudStore.set({ buyFilter: null })} />
            </div>
          )}
          <ul id="hud-buy-grid" ref={gridRef} class="hud-buy__grid hud-ofl-y" role="list" aria-label={query ? ht('buy.results', { count: shown.length }) : filter ? ht('buy.questFilter', { need: filter.label, count: shown.length }) : (BUY_CATEGORIES.find((c) => c.id === category)?.label ?? category)}>
            {shown.map((it) => (
              <li key={it.defId}>
                <CatalogCard game={game} it={it} funds={funds} selected={buy.placingDefId === it.defId} focused={focusId === it.defId} onPick={(e) => place(it, ui.buyFocus === it.defId && buy.placingDefId === it.defId ? buy.tint : null, e)} />
              </li>
            ))}
          </ul>
        </div>
        {moving ? <MovingCard game={game} moving={moving} pickedUp={pickedUp} /> : focus ? <DetailCard game={game} it={focus} funds={funds} placing={buy.placingDefId === focus.defId} tint={buy.placingDefId === focus.defId ? buy.tint : null} onPlace={(tint, e) => place(focus, tint, e)} /> : null}
      </div>
      <footer class="hud-buy__hints" aria-live="polite">
        {placing || pickedUp ? (
          <>
            <span class="hud-hint">
              <Kbd>{ht('buy.hint.arrows')}</Kbd> {ht('buy.hint.move')}
            </span>
            <span class="hud-hint">
              <Kbd>Enter</Kbd> {ht('buy.hint.place')}
            </span>
            <span class="hud-hint">
              <Kbd>R</Kbd> {ht('buy.hint.rotate')}
            </span>
            <span class="hud-hint__rot">
              <IconButton icon="rotateLeft" size="xs" label={`${ht('buy.hint.rotate')} ←`} onClick={() => game.rotatePlacement(-1)} tipSpec={{ title: ht('buy.hint.rotate'), keys: 'rotateObject' }} />
              <IconButton icon="rotateRight" size="xs" label={`${ht('buy.hint.rotate')} →`} onClick={() => game.rotatePlacement(1)} tipSpec={{ title: ht('buy.hint.rotate'), keys: 'rotateObject' }} />
            </span>
            {pickedUp && (
              <span class="hud-hint">
                <Kbd>Del</Kbd> {ht('buy.hint.sell')}
              </span>
            )}
            <span class="hud-hint">
              <Kbd>{ht('buy.hint.rightClick')}</Kbd>
              <span class="hud-hint__or">/</span>
              <Kbd>Esc</Kbd> {ht('buy.hint.cancel')}
            </span>
          </>
        ) : (
          <span class="hud-hint is-idle">
            <Icon name="info" size="0.875rem" />
            {ht('buy.hint.idle')}
          </span>
        )}
      </footer>
    </section>
  );
}

/**
 * Accessible name = the card's own visible text — item name, then price (+ "Can't afford" as screen-reader text) —
 * computed from the content, never an overriding aria-label (WCAG 2.5.3, W-118: Sol's axe scan of Buy > Seating
 * flagged label-content-name-mismatch on the cards whose aria-label did not repeat their visible text). The
 * secondary metadata — environment score, power, Bones lock — is aria-hidden on the card and given as the button's
 * description instead. `name` is the name a browser computes from that content (unit + e2e tests compare it).
 */
export function catalogCardText(it: Pick<CatalogItem, 'name' | 'price' | 'env' | 'needsPower'>, affordable: boolean, lockText: string | null): { name: string; description: string } {
  const name = `${it.name} ${formatMoney(it.price)}${affordable ? '' : `, ${ht('buy.cantAfford')}`}`;
  const parts: string[] = [];
  if (it.env !== 0) parts.push(ht('buy.env', { value: envLabel(it.env) }));
  if (it.needsPower) parts.push(ht('buy.power'));
  if (lockText) parts.push(lockText);
  return { name, description: parts.join('. ') };
}

function CatalogCard({ game, it, funds, selected, focused, onPick }: { game: GameController; it: CatalogItem; funds: number; selected: boolean; focused: boolean; onPick: (e: Event) => void }) {
  const affordable = it.price <= funds;
  const text = catalogCardText(it, affordable, bonesLockText(game, it.defId));
  const descId = `hud-item-desc-${it.defId}`;
  return (
    <button
      type="button"
      class={`hud-item${selected ? ' is-selected' : ''}${focused ? ' is-focused' : ''}${affordable ? '' : ' is-poor'}`}
      aria-pressed={selected ? 'true' : 'false'}
      aria-describedby={text.description ? descId : undefined}
      onPointerEnter={() => hudStore.set({ buyFocus: it.defId })}
      onFocus={() => hudStore.set({ buyFocus: it.defId })}
      onClick={(e) => onPick(e)}
    >
      <Thumb game={game} defId={it.defId} fallbackIcon={CATEGORY_ICON[it.category] ?? 'crate'} alt="" />
      <span class="hud-item__name">{it.name}</span>{' '}
      <BonesLock game={game} defId={it.defId} describedElsewhere />
      <span class="hud-item__meta">
        <span class={`hud-item__price u-num${affordable ? '' : ' is-poor'}`}>
          {!affordable && <Icon name="lock" size="0.6875rem" strokeWidth={2.2} />}
          {formatMoney(it.price)}
          {!affordable && <span class="u-sr-only">, {ht('buy.cantAfford')}</span>}
        </span>
        {text.description && (
          <span id={descId} hidden>
            {text.description}
          </span>
        )}
        {it.env !== 0 && (
          <span class={`hud-item__env u-num ${it.env > 0 ? 'is-pos' : 'is-neg'}`} aria-hidden="true">
            <Icon name="sparkle" size="0.6875rem" />
            {envLabel(it.env)}
          </span>
        )}
      </span>
      {it.needsPower && (
        <span class="hud-item__power" aria-hidden="true">
          <Icon name="lightning" size="0.6875rem" />
        </span>
      )}
    </button>
  );
}

function DetailCard({ game, it, funds, placing, tint, onPlace }: { game: GameController; it: CatalogItem; funds: number; placing: boolean; tint: string | null; onPlace: (tint: string | null, e?: Event) => void }) {
  const gf = safe('buy.goodFor', () => goodFor(it.defId, game.sim?.content ?? null), { actions: [], needs: [], skills: [] });
  const affordable = it.price <= funds;
  const pickTint = (c: string | null) => {
    if (placing) {
      game.setPlacementTint(c);
      game.playUi('uiToggle');
    } else onPlace(c);
  };
  return (
    <aside class="hud-detail" aria-label={it.name}>
      <div class="hud-detail__media">
        <Thumb game={game} defId={it.defId} tint={tint} fallbackIcon={CATEGORY_ICON[it.category] ?? 'crate'} size="5.25rem" alt={it.name} />
        <span class={`hud-detail__price u-num${affordable ? '' : ' is-poor'}`}>{formatMoney(it.price)}</span>
        <div class="hud-detail__chips">
          {it.env !== 0 && (
            <span class={`hud-detail__chip ${it.env > 0 ? 'is-pos' : 'is-neg'}`} {...tip({ title: ht('buy.env', { value: envLabel(it.env) }), body: ht('buy.env.body') })} tabIndex={0}>
              <Icon name="sparkle" size="0.75rem" />
              {envLabel(it.env)}
            </span>
          )}
          <span class="hud-detail__chip" {...tip({ title: ht('buy.size', { size: footprintLabel(it.footprint) }) })} tabIndex={0}>
            <Icon name="floor" size="0.75rem" />
            {footprintLabel(it.footprint)}
          </span>
          {it.needsPower && (
            <span class="hud-detail__chip is-power" role="img" {...tip({ title: ht('buy.power') })} tabIndex={0} aria-label={ht('buy.power')}>
              <Icon name="lightning" size="0.75rem" />
            </span>
          )}
        </div>
      </div>
      <div class="hud-detail__info">
        <div class="hud-detail__eyebrow">
          <span class="u-eyebrow">{placing ? ht('buy.placing') : (BUY_CATEGORIES.find((c) => c.id === it.category)?.label ?? it.category)}</span>
          {!affordable && (
            <Badge tone="danger" caps>
              {ht('buy.cantAfford')}
            </Badge>
          )}
        </div>
        <h3 class="hud-detail__name u-display u-ellipsis">{it.name}</h3>
        <p class="hud-detail__desc">{it.description}</p>
        {gf.needs.length > 0 || gf.skills.length > 0 ? (
          <div class="hud-detail__good" {...(gf.actions.length ? tip({ title: ht('buy.goodFor'), body: gf.actions.join(' · ') }) : {})}>
            <span class="u-caps hud-detail__label">{ht('buy.goodFor')}</span>
            {gf.needs.slice(0, 3).map((n) => (
              <span key={n.need} class="hud-goodneed">
                <Icon name={NEED_GLYPH[n.need] ?? 'star'} size="0.8125rem" />
                {ht(`need.${n.need}`)}
              </span>
            ))}
            {gf.skills.slice(0, 2).map((sk) => (
              <span key={sk} class="hud-goodneed is-skill">
                <Icon name="skills" size="0.8125rem" />
                {ht(`skill.${sk}`)}
              </span>
            ))}
          </div>
        ) : (
          <p class="hud-detail__deco">{ht('buy.decorative')}</p>
        )}
        <div class="hud-detail__foot">
          {it.variants.length > 0 && (
            <div class="hud-detail__swatches ui-swatches" role="radiogroup" aria-label={ht('buy.colour')} data-roving-group="" data-roving-manual="" onKeyDown={rovingKeyDown}>
              <SwatchBtn color={null} selected={tint === null} tabIndex={tint === null || !it.variants.includes(tint) ? 0 : -1} label={ht('buy.colour.default')} onPick={() => pickTint(null)} />
              {it.variants.map((v, i) => (
                <SwatchBtn key={v} color={v} selected={tint === v} tabIndex={tint === v ? 0 : -1} label={ht('buy.colour.pick', { n: i + 1 })} onPick={() => pickTint(v)} />
              ))}
            </div>
          )}
          {placing ? (
            <Button size="sm" variant="ghost" icon="close" label={ht('common.cancel')} onClick={() => game.cancelPlacement()} />
          ) : (
            <Button size="sm" variant="primary" icon="plus" label={ht('buy.place')} disabled={!affordable} onClick={(e: Event) => onPlace(tint, e)} />
          )}
        </div>
      </div>
    </aside>
  );
}

function SwatchBtn({ color, selected, label, onPick, tabIndex }: { color: string | null; selected: boolean; label: string; onPick: () => void; tabIndex: number }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected ? 'true' : 'false'}
      tabIndex={tabIndex}
      aria-label={label}
      class={`ui-swatch ui-swatch--sm${color === null ? ' hud-swatch--default' : ''}`}
      style={{ '--swatch': color ?? 'linear-gradient(135deg, #e8e0c8 0 48%, #6b4f8a 52% 100%)', color: color ? inkFor(color) : '#15101c' }}
      onClick={onPick}
      {...tip({ title: label })}
    >
      <span class="ui-swatch__check" aria-hidden="true">
        <Icon name="check" size="0.75rem" strokeWidth={3} />
      </span>
    </button>
  );
}

function MovingCard({ game, moving, pickedUp }: { game: GameController; moving: NonNullable<ReturnType<NonNullable<GameController['sim']>['objectView']>>; pickedUp: boolean }) {
  return (
    <aside class="hud-detail is-moving" aria-label={moving.name}>
      <div class="hud-detail__media">
        <Thumb game={game} defId={moving.defId} fallbackIcon="crate" size="5.25rem" alt={moving.name} />
        <span class="hud-detail__price u-num is-sell">{formatMoney(moving.sellValue)}</span>
      </div>
      <div class="hud-detail__info">
        <div class="hud-detail__eyebrow">
          <span class="u-eyebrow">{pickedUp ? ht('buy.moving') : ht('buy.selected')}</span>
          {moving.broken && (
            <Badge tone="danger" caps>
              {ht('buy.broken')}
            </Badge>
          )}
        </div>
        <h3 class="hud-detail__name u-display u-ellipsis">{moving.name}</h3>
        <p class="hud-detail__desc">{moving.detail ? `${moving.detail}. ` : ''}{moving.description}</p>
        <div class="hud-detail__foot">
          {pickedUp ? (
            <Button size="sm" variant="ghost" icon="undo" label={ht('buy.cancel')} onClick={() => game.cancelPlacement()} />
          ) : (
            <Button size="sm" variant="secondary" icon="rotate" label={ht('buy.move')} onClick={() => game.pickUpObject(moving.id)} />
          )}
          <Button
            size="sm"
            variant="danger"
            icon="tag"
            label={ht('buy.sell', { amount: formatMoney(moving.sellValue) })}
            kbd={pickedUp ? 'Del' : undefined}
            data-hint-anchor="sell"
            onClick={() => {
              game.sellObject(moving.id);
              game.playUi('sellObject');
            }}
          />
        </div>
      </div>
    </aside>
  );
}
