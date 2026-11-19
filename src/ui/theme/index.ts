/**
 * UI theme entry. Import once (App.tsx does) — Vite bundles the CSS.
 *
 *   tokens.css     design tokens (colours, type, spacing, radii, shadows, z-layers, motion, --ui-scale)
 *   base.css       reset, typography, scrollbars, focus rings, pointer-events model, utilities, reduced motion
 *   components.css Button, IconButton, Panel, Card, Tabs (incl. vertical), Badge, Kbd, Spinner, Divider, ScrollArea,
 *                  EmptyState, focus rings on accent-filled controls
 *   overlays.css   Tooltip, Modal (+ tab bar), ConfirmDialog, Toast, tables / key-value lists
 *   forms.css      TextInput, Slider, Toggle, setting rows, Select, Segmented, Swatch, choice grid
 *   meters.css     ProgressBar, NeedBar (+ colour-blind patterns), Portrait
 *
 * Root classes applied by App on <html>: `reduce-motion`, `cb-needs`, `ui-low-fx`; CSS var `--ui-scale`.
 */
import './tokens.css';
import './base.css';
import './components.css';
import './overlays.css';
import './forms.css';
import './meters.css';
import { detectBrowserZoom } from './scale';

/** Classes App toggles on <html>. Exported so HUD/dev harnesses stay in sync. */
export const ROOT_CLASSES = {
  reduceMotion: 'reduce-motion',
  colorblindNeeds: 'cb-needs',
  lowFx: 'ui-low-fx',
} as const;

/** Apply the theme-relevant subset of settings to the document (safe without a DOM). */
export function applyThemeSettings(
  s: { uiScale: number; reduceMotion: boolean; colorblindNeeds: boolean; quality?: string },
  root: HTMLElement | null = typeof document !== 'undefined' ? document.documentElement : null,
): void {
  if (!root) return;
  const scale = Number.isFinite(s.uiScale) ? Math.min(1.4, Math.max(0.8, s.uiScale)) : 1;
  root.style.setProperty('--ui-scale', String(Math.round(scale * 100) / 100));
  root.classList.toggle(ROOT_CLASSES.reduceMotion, !!s.reduceMotion);
  root.classList.toggle(ROOT_CLASSES.colorblindNeeds, !!s.colorblindNeeds);
  root.classList.toggle(ROOT_CLASSES.lowFx, s.quality === 'low');
}

/** Set --ui-zoom on <html> from the current browser zoom (see detectBrowserZoom). Returns the zoom applied. */
export function applyBrowserZoom(root: HTMLElement | null = typeof document !== 'undefined' ? document.documentElement : null, win: Window | null = typeof window !== 'undefined' ? window : null): number {
  const z = detectBrowserZoom(win);
  if (root) {
    const v = String(Math.round(z * 1000) / 1000);
    if (root.style.getPropertyValue('--ui-zoom') !== v) root.style.setProperty('--ui-zoom', v);
  }
  return z;
}

/**
 * Keep --ui-zoom current: zooming fires `resize` (the CSS viewport changes) and changes devicePixelRatio (watched
 * with a resolution media query, re-armed after every change). Returns a disposer.
 */
export function watchBrowserZoom(win: Window | null = typeof window !== 'undefined' ? window : null): () => void {
  if (!win || typeof win.addEventListener !== 'function') return () => {};
  const root = win.document?.documentElement ?? null;
  let mq: MediaQueryList | null = null;
  const onChange = () => {
    applyBrowserZoom(root, win);
    arm();
  };
  const arm = () => {
    mq?.removeEventListener?.('change', onChange);
    mq = typeof win.matchMedia === 'function' ? win.matchMedia(`(resolution: ${win.devicePixelRatio || 1}dppx)`) : null;
    mq?.addEventListener?.('change', onChange);
  };
  const onResize = () => applyBrowserZoom(root, win);
  applyBrowserZoom(root, win);
  arm();
  win.addEventListener('resize', onResize);
  return () => {
    win.removeEventListener('resize', onResize);
    mq?.removeEventListener?.('change', onChange);
  };
}
