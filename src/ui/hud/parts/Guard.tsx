/**
 * Error boundary for HUD regions: a panel that throws while rendering is hidden (logged once) and retried
 * after a short pause, so one broken view can never take the rest of the HUD — or the game — down.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useErrorBoundary } from 'preact/hooks';

export function Guard({ name, children, retryMs = 2000 }: { name: string; children: ComponentChildren; retryMs?: number }) {
  const [error, reset] = useErrorBoundary((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn(`[hud] ${name} failed to render`, err);
  });
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(reset, retryMs);
    return () => clearTimeout(t);
  }, [error]);
  if (error) return null;
  return <>{children}</>;
}
