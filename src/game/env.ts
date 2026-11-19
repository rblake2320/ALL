/**
 * Platform services the controller needs (clock, frames, timers, randomness, DOM hooks, downloads).
 * Everything that touches browser globals goes through here so the controller is testable in Node with a fake
 * environment, and so nothing reads `window`/`document` at module-import time.
 */
import type { NativeBridge } from '../persistence/contracts';

export type TimerHandle = unknown;

export interface GameEnv {
  /** Monotonic milliseconds (performance.now). */
  now(): number;
  /** Wall-clock milliseconds (Date.now) — only for human-facing "saved N min ago" labels. */
  wallNow(): number;
  /** requestAnimationFrame; returns null when frames are unavailable (the loop falls back to timers). */
  requestFrame(cb: (t: number) => void): number | null;
  cancelFrame(id: number): void;
  setTimeout(cb: () => void, ms: number): TimerHandle;
  clearTimeout(h: TimerHandle): void;
  setInterval(cb: () => void, ms: number): TimerHandle;
  clearInterval(h: TimerHandle): void;
  /** Cryptographically random uint32 (falls back to Math.random outside secure contexts). */
  randomU32(): number;
  readonly window: Window | null;
  readonly document: Document | null;
  /** CSS-pixel viewport size. */
  viewport(): { width: number; height: number };
  devicePixelRatio(): number;
  userAgent(): string;
  /** Electron preload bridge, if running in the desktop app. */
  native(): NativeBridge | null;
  /** Trigger a file download. Returns false when unsupported. */
  download(filename: string, data: Uint8Array, mime: string): boolean;
  /** Re-encode an image data URL as JPEG (for compact save thumbnails); null when unsupported. */
  reencodeJpeg(dataUrl: string, quality: number): Promise<string | null>;
  /** OS / browser "reduce motion" preference (seeds Settings.reduceMotion on first run). */
  prefersReducedMotion(): boolean;
}

function hasWindow(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export function createBrowserEnv(): GameEnv {
  const perf = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance : null;
  const win = hasWindow() ? window : null;
  const doc = hasWindow() ? document : null;
  return {
    now: () => (perf ? perf.now() : Date.now()),
    wallNow: () => Date.now(),
    requestFrame(cb) {
      if (!win || typeof win.requestAnimationFrame !== 'function') return null;
      return win.requestAnimationFrame(cb);
    },
    cancelFrame(id) {
      if (win && typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(id);
    },
    setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
    clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>),
    setInterval: (cb, ms) => globalThis.setInterval(cb, ms),
    clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof globalThis.setInterval>),
    randomU32() {
      try {
        const c = globalThis.crypto;
        if (c && typeof c.getRandomValues === 'function') {
          const buf = new Uint32Array(1);
          c.getRandomValues(buf);
          return buf[0] >>> 0;
        }
      } catch {
        /* fall through */
      }
      return Math.floor(Math.random() * 4294967296) >>> 0;
    },
    window: win,
    document: doc,
    viewport() {
      if (!win) return { width: 1280, height: 720 };
      return { width: Math.max(1, win.innerWidth || 1), height: Math.max(1, win.innerHeight || 1) };
    },
    devicePixelRatio: () => (win && Number.isFinite(win.devicePixelRatio) && win.devicePixelRatio > 0 ? win.devicePixelRatio : 1),
    userAgent: () => (typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'),
    native: () => (win && win.afterlifeNative ? win.afterlifeNative : null),
    download(filename, data, mime) {
      if (!doc || typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
      // Copy into a fresh ArrayBuffer-backed view (never a SharedArrayBuffer view) for the Blob constructor.
      const blob = new Blob([new Uint8Array(data)], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = doc.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      a.style.display = 'none';
      (doc.body ?? doc.documentElement).appendChild(a);
      try {
        a.click();
      } finally {
        a.remove();
        // Revoke later: some browsers (and Electron's will-download) read the URL asynchronously.
        globalThis.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
      return true;
    },
    async reencodeJpeg(dataUrl, quality) {
      if (!doc || typeof Image === 'undefined') return null;
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const canvas = doc.createElement('canvas');
      canvas.width = Math.max(1, img.naturalWidth);
      canvas.height = Math.max(1, img.naturalHeight);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#1d1726'; // JPEG has no alpha: matte onto the UI base colour
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL('image/jpeg', quality);
    },
    prefersReducedMotion() {
      try {
        return !!win && typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
      } catch {
        return false;
      }
    },
  };
}
