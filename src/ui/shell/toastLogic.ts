/**
 * Pure toast-host logic for the shell (screens without the HUD). The controller keeps raising toasts on the main
 * menu (import/export results, failed loads, deletes); without a host they were invisible there and later popped up
 * stale inside the HUD. Total functions: garbage in, sane output.
 */
import type { Toast } from '../../game/contracts';

/** Visible lifetime of an unhovered shell toast (matches the HUD's ~6 s). */
export const SHELL_TOAST_MS = 6000;
/** Max toasts on screen at once (the rest wait their turn). */
export const SHELL_TOAST_MAX = 3;

const KINDS = new Set(['info', 'good', 'bad', 'warning', 'money', 'career', 'social', 'decay', 'romance', 'skill']);

/** Sanitised, de-duplicated toasts, newest first, at most `max`. */
export function selectShellToasts(list: readonly unknown[] | null | undefined, max = SHELL_TOAST_MAX): Toast[] {
  if (!Array.isArray(list)) return [];
  const limit = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : SHELL_TOAST_MAX;
  const seen = new Set<number>();
  const out: { t: Toast; order: number }[] = [];
  list.forEach((raw, order) => {
    if (!raw || typeof raw !== 'object') return;
    const r = raw as Partial<Toast>;
    if (typeof r.id !== 'number' || !Number.isFinite(r.id) || seen.has(r.id)) return;
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    const text = typeof r.text === 'string' ? r.text.trim() : '';
    if (!title && !text) return;
    seen.add(r.id);
    out.push({
      order,
      t: {
        id: r.id,
        kind: (typeof r.kind === 'string' && KINDS.has(r.kind) ? r.kind : 'info') as Toast['kind'],
        title: title || text,
        text: title ? text : '',
        agentId: typeof r.agentId === 'string' ? r.agentId : null,
        objectId: typeof r.objectId === 'string' ? r.objectId : null,
        createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : 0,
      },
    });
  });
  // Newest first: createdAt, then list order (controllers append, so later = newer).
  out.sort((a, b) => b.t.createdAt - a.t.createdAt || b.order - a.order);
  return out.slice(0, limit).map((x) => x.t);
}

export interface ToastClockResult {
  /** Remaining visible milliseconds per toast id still on screen. */
  next: Record<number, number>;
  /** Ids whose time ran out (dismiss them). */
  expired: number[];
}

/**
 * Advance per-toast lifetimes by `elapsedMs` for the visible ids. Paused ids (hovered/focused) keep their time;
 * ids seen for the first time start at `lifetimeMs` (no time is charged before they were on screen); ids no longer
 * visible are forgotten. Negative/NaN elapsed counts as 0 and huge jumps (a throttled background tab) are capped
 * at one lifetime.
 */
export function tickToastClocks(
  prev: Readonly<Record<number, number>> | null | undefined,
  visibleIds: readonly number[],
  elapsedMs: number,
  paused: ReadonlySet<number> | boolean,
  lifetimeMs = SHELL_TOAST_MS,
): ToastClockResult {
  const life = Number.isFinite(lifetimeMs) && lifetimeMs > 0 ? lifetimeMs : SHELL_TOAST_MS;
  const dt = Number.isFinite(elapsedMs) && elapsedMs > 0 ? Math.min(elapsedMs, life) : 0;
  const next: Record<number, number> = {};
  const expired: number[] = [];
  const ids = Array.isArray(visibleIds) ? visibleIds : [];
  for (const id of ids) {
    if (typeof id !== 'number' || !Number.isFinite(id) || Object.prototype.hasOwnProperty.call(next, id)) continue;
    const known = !!prev && Object.prototype.hasOwnProperty.call(prev, id);
    const had = known && Number.isFinite(prev[id]) ? prev[id] : life;
    const isPaused = paused === true || (paused instanceof Set && paused.has(id));
    // A toast seen for the first time has not been on screen yet: its clock starts now.
    const left = isPaused || !known ? had : had - dt;
    if (left <= 0) expired.push(id);
    else next[id] = Math.min(life, left);
  }
  return { next, expired };
}
