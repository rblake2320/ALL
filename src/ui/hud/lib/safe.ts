/**
 * Fault containment for reads from the simulation: a view query that throws (bad id mid-update, a system bug)
 * must never take the HUD down. Errors are logged once per call site.
 */
const warned = new Set<string>();

export function safe<T>(where: string, fn: () => T, fallback: T): T {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    if (!warned.has(where)) {
      warned.add(where);
      // eslint-disable-next-line no-console
      console.warn(`[hud] ${where} failed:`, err);
    }
    return fallback;
  }
}
