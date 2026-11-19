/**
 * AudioContext state plumbing for the engine: total state reads, a raced resume (autoplay-locked browsers never
 * settle), statechange subscription, and the one-shot gesture listeners that retry resume() after the browser or
 * OS suspended audio on its own (iOS interruptions, audio-device loss). Nothing here throws.
 */

/** Gestures that may resume a context the browser/OS suspended on its own. */
export const RECOVERY_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const;

/** A context's state, never throwing (hostile/closed implementations read as 'closed'). */
export function stateOf(ctx: BaseAudioContext): string {
  try {
    return String(ctx.state);
  } catch {
    return 'closed';
  }
}

/** resume(), but give up after `timeoutMs` (a locked context's promise may never settle). Never rejects. */
export async function resumeWithin(ctx: BaseAudioContext, timeoutMs: number): Promise<void> {
  const resume = (ctx as AudioContext).resume;
  if (typeof resume !== 'function') return;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      resume.call(ctx).catch(() => undefined),
      new Promise((r) => {
        timer = setTimeout(r, timeoutMs);
      }),
    ]);
  } catch {
    /* ignore */
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Fire-and-forget resume (errors swallowed). */
export function tryResume(ctx: BaseAudioContext, onDone?: (ok: boolean) => void): void {
  const resume = (ctx as AudioContext).resume;
  if (typeof resume !== 'function') return;
  try {
    void resume.call(ctx).then(
      () => onDone?.(true),
      () => onDone?.(false),
    );
  } catch {
    onDone?.(false);
  }
}

/** Fire-and-forget suspend; false if the context cannot suspend. */
export function trySuspend(ctx: BaseAudioContext): boolean {
  const suspend = (ctx as AudioContext).suspend;
  if (typeof suspend !== 'function') return false;
  try {
    void suspend.call(ctx).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** Subscribe to statechange (addEventListener, else onstatechange). Returns the unsubscribe function. */
export function watchContextState(ctx: BaseAudioContext, onChange: () => void): () => void {
  try {
    const target = ctx as BaseAudioContext & { addEventListener?: unknown; removeEventListener?: unknown };
    if (typeof target.addEventListener === 'function' && typeof target.removeEventListener === 'function') {
      ctx.addEventListener('statechange', onChange);
      return () => {
        try {
          ctx.removeEventListener('statechange', onChange);
        } catch {
          /* ignore */
        }
      };
    }
    (ctx as { onstatechange: unknown }).onstatechange = onChange;
    return () => {
      try {
        (ctx as { onstatechange: unknown }).onstatechange = null;
      } catch {
        /* ignore */
      }
    };
  } catch {
    return () => undefined;
  }
}

/**
 * Call `retry` on the next pointer/key/touch gesture (capture, passive). Returns the disarm function, or null
 * where there is no window to listen on (node, workers).
 */
export function armGestureRetry(retry: () => void): (() => void) | null {
  const g = globalThis as unknown as {
    addEventListener?: (t: string, f: () => void, o: AddEventListenerOptions) => void;
    removeEventListener?: (t: string, f: () => void, o: AddEventListenerOptions) => void;
  };
  if (typeof g.addEventListener !== 'function' || typeof g.removeEventListener !== 'function') return null;
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  try {
    for (const t of RECOVERY_EVENTS) g.addEventListener(t, retry, opts);
  } catch {
    return null;
  }
  return () => {
    for (const t of RECOVERY_EVENTS) {
      try {
        g.removeEventListener?.(t, retry, opts);
      } catch {
        /* ignore */
      }
    }
  };
}
