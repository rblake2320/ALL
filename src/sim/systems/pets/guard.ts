/**
 * W-013 Guard trait (docs/DESIGN_SURVIVAL_PETS_SAVES.md §3): a Guard pet that is looked after barks at the Repo Ghoul
 * and holds it off. When the ghoul is due (the Repo Ghoul system asks `guardDelaysRepo` before it sends anybody), the
 * pet charges to the gate, barks, and the ghoul backs off for GUARD_HOLD_MIN game minutes; this works at most
 * GUARD_MAX_HOLDS times for one debt, then the ghoul comes anyway (a pet buys time, it does not cancel a bill). A
 * neglected pet (average need under NEGLECT_AVG) or any other trait does nothing.
 *
 * State is two world flags (save-safe) plus the pet's own `guardUntil` (gate duty, saved with the pet).
 */
import type { SimContext } from '../../contracts';
import { careTier } from '../../../shared/livingThings';
import { petCare } from './encounters';
import { ticksOf } from './motion';

export const GUARD_HOLD_MIN = 12 * 60;
export const GUARD_MAX_HOLDS = 2;
const FLAG_UNTIL = 'petGuardUntil';
const FLAG_HOLDS = 'petGuardHolds';

const flagNum = (ctx: SimContext, k: string): number => {
  const v = ctx.state.flags?.[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
};

/** Ask before sending the Repo Ghoul: true = a Guard pet is holding it off (do not dispatch now). */
export function guardDelaysRepo(ctx: SimContext): boolean {
  const ps = ctx.state.pets;
  if (!ps) return false;
  // the benefit follows the care tier (living-things.md): none = nothing, half = one hold, full = the full allowance
  const guard = [...ps.pets].filter((p) => p.trait === 'guard' && careTier(petCare(p)) !== 'none').sort((a, b) => petCare(b) - petCare(a) || (a.id < b.id ? -1 : 1))[0];
  if (!guard) return false;
  const maxHolds = careTier(petCare(guard)) === 'full' ? GUARD_MAX_HOLDS : 1;
  const tick = ctx.state.tick;
  if (tick < flagNum(ctx, FLAG_UNTIL)) return true; // still holding it off
  const holds = flagNum(ctx, FLAG_HOLDS);
  if (holds >= maxHolds) return false;
  const until = tick + ticksOf(GUARD_HOLD_MIN);
  ctx.state.flags[FLAG_UNTIL] = until;
  ctx.state.flags[FLAG_HOLDS] = holds + 1;
  guard.guardUntil = tick + ticksOf(20); // gate duty: it runs to the gate and barks for a while
  guard.busyUntil = 0;
  ctx.emit({ type: 'sfx', id: 'bark', pos: { x: guard.pos.x, z: guard.pos.z } });
  ctx.notify({
    kind: 'good',
    title: `${guard.name} barks at the Repo Ghoul`,
    text: `The Repo Ghoul turned up at the gate. ${guard.name} charged at it, barking, and it backed off for now. It will be back${holds + 1 >= maxHolds ? ' and ' + guard.name + ' cannot hold it off again' : ''}.`,
  });
  return true;
}

/** The ghoul really is being sent: the next debt starts with a fresh allowance of holds. */
export function guardClear(ctx: SimContext): void {
  if (ctx.state.flags) {
    delete ctx.state.flags[FLAG_UNTIL];
    delete ctx.state.flags[FLAG_HOLDS];
  }
}
