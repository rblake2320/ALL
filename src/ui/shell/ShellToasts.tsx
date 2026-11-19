/**
 * Toast host for screens without the HUD (menu, new game, CAZ, loading, game over). In game the HUD owns toasts
 * (GameController contract); everywhere else the controller's toasts — "Save imported", "Export failed",
 * "Couldn't delete the save" — would otherwise be invisible. Top-right, newest first, max 3, ~6 s of unhovered
 * time (hover or keyboard focus pauses), rendered above dialogs so feedback for dialog actions is seen.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { useGame } from '../hooks';
import { Portal } from '../common/Portal';
import { ToastCard } from '../common/ToastCard';
import { SHELL_TOAST_MAX, SHELL_TOAST_MS, selectShellToasts, tickToastClocks } from './toastLogic';

const TICK_MS = 250;

export function ShellToasts() {
  const game = useGame();
  const visible = selectShellToasts(game.toasts, SHELL_TOAST_MAX);
  const [paused, setPaused] = useState<ReadonlySet<number>>(() => new Set());
  const [, setTick] = useState(0);
  const clocks = useRef<Record<number, number>>({});
  const live = useRef({ ids: visible.map((x) => x.id), paused });
  live.current = { ids: visible.map((x) => x.id), paused };
  const hasAny = visible.length > 0;

  useEffect(() => {
    if (!hasAny) {
      clocks.current = {};
      return;
    }
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const r = tickToastClocks(clocks.current, live.current.ids, now - last, live.current.paused, SHELL_TOAST_MS);
      last = now;
      clocks.current = r.next;
      for (const tid of r.expired) {
        try {
          game.dismissToast(tid);
        } catch {
          /* a failing controller must not take the menu down */
        }
      }
      setTick((n) => (n + 1) | 0);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [game, hasAny]);

  const pause = (id: number, on: boolean) =>
    setPaused((prev) => {
      if (prev.has(id) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Portal layer="toast">
      <section class="sh-toasts" aria-label={t('toasts.region')} aria-live="polite" aria-relevant="additions">
        {visible.map((x) => {
          const left = clocks.current[x.id];
          const remaining = typeof left === 'number' ? left / SHELL_TOAST_MS : 1;
          return (
            <div
              key={x.id}
              class="sh-toast"
              onPointerEnter={() => pause(x.id, true)}
              onPointerLeave={() => pause(x.id, false)}
              onFocusIn={() => pause(x.id, true)}
              onFocusOut={() => pause(x.id, false)}
            >
              <ToastCard kind={x.kind} title={x.title} text={x.text || undefined} remaining={remaining} onDismiss={() => game.dismissToast(x.id)} />
            </div>
          );
        })}
      </section>
    </Portal>
  );
}
