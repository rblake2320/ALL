/** Build/buy cost label that follows the mouse (game.buildPreviewLabel, e.g. "$45 · 3 walls" / "Can't place …"). */
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { cursorLabelPos } from '../lib/layout';
import { useGame } from '../parts/hooks';
import { Icon } from '../parts/icons';
import './overlay.css';

const ERROR_RE = /\b(can't|cannot|can not|not enough|blocked|invalid|no room|must|too (?:close|far|big|small)|overlap|outside)\b|can’t/i;

/** Last known pointer position (shared so a remounted label appears in place) and whether it is over a HUD panel. */
const pointer = { x: -1, y: -1, overUi: false };
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointermove',
    (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      const t = e.target as Element | null;
      pointer.overUi = !!(t && typeof t.closest === 'function' && t.closest('.ui-interactive, .ui-modal-layer'));
    },
    { passive: true, capture: true },
  );
}

export function isErrorLabel(label: string): boolean {
  return ERROR_RE.test(label);
}

export function CursorLabel() {
  const game = useGame();
  const label = typeof game.buildPreviewLabel === 'string' && game.buildPreviewLabel.trim() ? game.buildPreviewLabel : null;
  const ref = useRef<HTMLDivElement>(null);
  const place = () => {
    const el = ref.current;
    if (!el) return;
    // The label describes what a click in the WORLD would do: hide it while the pointer is over a HUD panel.
    if (pointer.x < 0 || pointer.overUi) {
      el.style.visibility = 'hidden';
      return;
    }
    const p = cursorLabelPos(pointer, { w: el.offsetWidth, h: el.offsetHeight }, { w: window.innerWidth, h: window.innerHeight });
    el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    el.style.visibility = 'visible';
  };
  useLayoutEffect(place);
  useEffect(() => {
    const on = () => place();
    window.addEventListener('pointermove', on, { passive: true });
    return () => window.removeEventListener('pointermove', on);
  }, []);
  if (!label) return null;
  const err = isErrorLabel(label);
  return (
    <div ref={ref} class={`hud-cursorlabel${err ? ' is-error' : ''}`} role="status" aria-live="polite">
      <Icon name={err ? 'warning' : 'money'} size="0.875rem" />
      <span>{label}</span>
    </div>
  );
}
