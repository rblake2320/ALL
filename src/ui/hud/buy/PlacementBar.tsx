/**
 * Placement bar (W-116, D-062): shown while a catalog item (or an eyedropper copy) is being placed. Names the item and
 * its price, says what a click does ("Click to place · Shift+click to keep placing", or the touch wording), offers the
 * touch "Place another" toggle, and a prominent Done that ends placement and returns to the catalog (Esc does too).
 * A click places ONE item and ends placement by itself — the Sims convention — so a stray second click never buys a
 * second copy.
 */
import { useEffect, useState } from 'preact/hooks';
import { formatMoney } from '../lib/format';
import { usePhoneLayout } from '../lib/phoneLayout';
import { safe } from '../lib/safe';
import { Button, Toggle } from '../parts/controls';
import { useGame } from '../parts/hooks';
import { Icon } from '../parts/icons';
import { ht } from '../strings';

const COARSE = '(pointer: coarse)';

/** Touch-first input (phone layout or a coarse primary pointer): the "Place another" toggle replaces Shift. */
export function useTouchPlacement(): boolean {
  const { phone } = usePhoneLayout();
  const [coarse, setCoarse] = useState(() => {
    try {
      return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(COARSE).matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia(COARSE);
    } catch {
      return undefined;
    }
    const on = () => setCoarse(!!mq?.matches);
    mq.addEventListener?.('change', on);
    return () => mq?.removeEventListener?.('change', on);
  }, []);
  return phone || coarse;
}

export function PlacementBar() {
  const game = useGame();
  const touch = useTouchPlacement();
  const buy = game.buy;
  const defId = buy.placingDefId;
  if (!defId || buy.movingObjectId) return null;
  const def = safe('placement.def', () => game.sim?.content.objects[defId] ?? null, null);
  const name = def && typeof def.name === 'string' ? def.name : defId;
  const price = def && Number.isFinite(def.price) ? def.price : 0;
  return (
    <div class="hud-placebar ui-panel ui-interactive" role="group" aria-label={ht('buy.bar.label', { name })} data-hud-region="85" data-testid="placement-bar">
      <span class="hud-placebar__icon" aria-hidden="true">
        <Icon name="plus" size="1.125rem" />
      </span>
      <div class="hud-placebar__text">
        <div class="hud-placebar__title">
          <span class="u-eyebrow">{ht('buy.placing')}</span>
          <span class="hud-placebar__name u-ellipsis">{name}</span>
          <span class="hud-placebar__price u-num">{formatMoney(price)}</span>
        </div>
        <div class="hud-placebar__hint" data-testid="placement-hint">
          {touch ? ht(buy.keepPlacing ? 'buy.bar.hint.touchKeep' : 'buy.bar.hint.touch') : ht('buy.bar.hint')}
        </div>
      </div>
      {touch && (
        <span class="hud-placebar__keep">
          <Toggle
            checked={buy.keepPlacing}
            label={ht('buy.bar.another')}
            onChange={(v) => {
              game.setKeepPlacing(v);
              game.playUi('uiToggle');
            }}
          />
          <span aria-hidden="true">{ht('buy.bar.another')}</span>
        </span>
      )}
      <Button
        class="hud-placebar__done"
        variant="primary"
        icon="check"
        label={ht('buy.bar.done')}
        kbd={touch ? undefined : 'Esc'}
        data-testid="placement-done"
        onClick={() => {
          game.finishPlacing();
          game.playUi('uiClick');
        }}
      />
    </div>
  );
}
