/**
 * Screen-reader live region for keyboard placement in Buy mode (W-064, Sol W-023 A1): announces the ghost's tile and
 * whether it can go there (with the refusal reason — collision, doorway, …), placed / rotated / cancelled.
 *
 * Kept separate from the visual CursorLabel, which follows the mouse and is hidden (so not announced) while the
 * pointer is away from the world — exactly the situation of a keyboard-only player. The region exists before its
 * first message (live regions must be in the tree first) and alternates a trailing zero-width space by sequence
 * number so an identical message ("Can't place here: …" twice) is still read again.
 */
import { useGame } from '../parts/hooks';

export function liveText(a: { seq: number; text: string } | null | undefined): string {
  if (!a || typeof a.text !== 'string' || !a.text.trim()) return '';
  return a.seq % 2 === 0 ? a.text : `${a.text}​`;
}

export function PlacementAnnouncer() {
  const game = useGame();
  return (
    <div class="u-sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="placement-live">
      {liveText(game.placementAnnouncement)}
    </div>
  );
}
