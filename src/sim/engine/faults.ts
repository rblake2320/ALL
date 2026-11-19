/** Fault barriers: everything that can throw inside the tick goes through here. */
import { MAX_FAULTS, SYSTEM_DISABLE_AFTER } from './constants';
import type { Engine, SystemEntry } from './types';
import { errorMessage } from './util';

export function recordFault(eng: Engine, where: string, err: unknown): void {
  const message = typeof err === 'string' ? err : errorMessage(err);
  eng.faults.push({ tick: eng.state.tick, where, message: message.slice(0, 500) });
  if (eng.faults.length > MAX_FAULTS) eng.faults.splice(0, eng.faults.length - MAX_FAULTS);
}

/** Run fn; on throw record the fault and return the fallback. */
export function guard<T>(eng: Engine, where: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (e) {
    recordFault(eng, where, e);
    return fallback;
  }
}

/** Run a system hook behind its barrier; disables the system after repeated failures. */
export function guardSystem(eng: Engine, entry: SystemEntry, hook: string, fn: () => void): void {
  if (entry.disabled) return;
  try {
    fn();
  } catch (e) {
    recordFault(eng, `system:${entry.sys.id}.${hook}`, e);
    entry.failures++;
    if (entry.failures >= SYSTEM_DISABLE_AFTER) {
      entry.disabled = true;
      try {
        eng.ctx.notify({
          kind: 'warning',
          title: 'Something in town stopped working',
          text: `The "${entry.sys.id}" system kept failing and was switched off. Saving and reloading may help.`,
        });
      } catch (e2) {
        recordFault(eng, 'faults.notify', e2);
      }
    }
  }
}
