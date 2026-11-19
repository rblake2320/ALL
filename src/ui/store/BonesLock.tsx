/** Lock chip for a Bones-tier item in Buy mode (shown until it is unlocked in the store). Renders nothing otherwise. */
import type { GameController } from '../../game/contracts';
import { Icon } from '../icons';
import { formatCount } from '../../economy/pricing';
import { st } from './strings';
import './store.css';

/** The lock sentence for a Bones-tier item ("Unlock in the store for 30 Bones"), or null when it is not locked. */
export function bonesLockText(game: GameController, defId: string): string | null {
  const lock = game.economy?.buyLock(defId);
  if (!lock || lock.state !== 'locked') return null;
  return st('locked.buy', { amount: formatCount(lock.priceBones) });
}

/**
 * `describedElsewhere`: the host control already carries the sentence (e.g. in its aria-describedby, see
 * bonesLockText), so the chip is purely visual — no duplicate screen-reader text inside a named control.
 */
export function BonesLock({ game, defId, describedElsewhere }: { game: GameController; defId: string; describedElsewhere?: boolean }) {
  const lock = game.economy?.buyLock(defId);
  if (!lock || lock.state !== 'locked') return null;
  const text = st('locked.buy', { amount: formatCount(lock.priceBones) });
  if (describedElsewhere) {
    return (
      <span class="st-lockchip" title={text} data-testid={`buylock-${defId}`} aria-hidden="true">
        <Icon name="lock" size="0.7rem" strokeWidth={2.2} />
        <Icon name="skull" size="0.7rem" class="st-bones-glyph" />
        <span class="u-num">{formatCount(lock.priceBones)}</span>
      </span>
    );
  }
  return (
    // aria-label on a plain <span> is ignored by most screen readers (generic role): the visual chip is hidden from
    // assistive tech and the full sentence is given as screen-reader-only text instead.
    <span class="st-lockchip" title={text} data-testid={`buylock-${defId}`}>
      <span aria-hidden="true">
        <Icon name="lock" size="0.7rem" strokeWidth={2.2} />
        <Icon name="skull" size="0.7rem" class="st-bones-glyph" />
        <span class="u-num">{formatCount(lock.priceBones)}</span>
      </span>
      <span class="u-sr-only">{text}</span>
    </span>
  );
}
