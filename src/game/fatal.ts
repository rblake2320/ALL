/**
 * Global error capture (window 'error' / 'unhandledrejection').
 *
 * Known-benign browser noise (ResizeObserver loop warnings, errors thrown by browser extensions) is ignored;
 * everything else is forwarded to the controller, which records it, performs an emergency save and shows the
 * crash screen. Returns an uninstall function (HMR / tests).
 */
import { describeError } from './diagnostics';

const BENIGN_MESSAGES = [/ResizeObserver loop/i, /^Script error\.?$/i];
const EXTENSION_SCHEMES = /^(chrome|moz|safari|ms-browser)-extension:\/\//i;

export function isBenignError(message: string, filename?: string | null): boolean {
  if (filename && EXTENSION_SCHEMES.test(filename)) return true;
  return BENIGN_MESSAGES.some((re) => re.test(message));
}

export type FatalSink = (err: unknown, source: 'error' | 'rejection') => void;

export function installGlobalErrorHandlers(win: Window, sink: FatalSink): () => void {
  const onError = (ev: ErrorEvent): void => {
    try {
      const err: unknown = ev.error ?? ev.message;
      const message = describeError(err);
      if (isBenignError(message, ev.filename)) return;
      sink(err ?? new Error(message), 'error');
    } catch {
      /* never let the handler itself throw */
    }
  };
  const onRejection = (ev: PromiseRejectionEvent): void => {
    try {
      const reason: unknown = ev.reason;
      if (isBenignError(describeError(reason))) return;
      sink(reason ?? new Error('Unhandled promise rejection'), 'rejection');
    } catch {
      /* ignore */
    }
  };
  win.addEventListener('error', onError);
  win.addEventListener('unhandledrejection', onRejection);
  return () => {
    win.removeEventListener('error', onError);
    win.removeEventListener('unhandledrejection', onRejection);
  };
}

/** Player-facing crash text (the technical detail goes to diagnostics). */
export function fatalMessage(err: unknown): string {
  const detail = describeError(err).slice(0, 240);
  return `Something went wrong and the game had to stop. ${detail ? `(${detail})` : ''}`.trim();
}
