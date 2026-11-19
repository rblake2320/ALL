/**
 * Tutorial hint (game.hint): a callout anchored to any element carrying a matching `data-hint-anchor` token
 * (space-separated aliases, e.g. data-hint-anchor="speed speed-controls"), with a pulsing ring on the target.
 * Without an anchor (or when it is not on screen) it sits centred under the top bar.
 */
import { useLayoutEffect, useRef } from 'preact/hooks';
import { placeCallout, type Rect } from '../lib/layout';
import { PHONE_GUTTER, placeCalloutAvoiding } from '../lib/phoneLayout';
import { useEscape, useGame, useInterval } from '../parts/hooks';
import { Button } from '../parts/controls';
import { Icon } from '../parts/icons';
import { ht } from '../strings';
import './overlay.css';

function findAnchor(anchor: string | null): HTMLElement | null {
  if (!anchor || typeof document === 'undefined') return null;
  try {
    const el = document.querySelector<HTMLElement>(`[data-hint-anchor~="${CSS.escape(anchor)}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return el;
  } catch {
    return null;
  }
}

export function HintBubble() {
  const game = useGame();
  const hint = game.hint;
  const box = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLSpanElement>(null);

  const place = () => {
    const el = box.current;
    if (!el || !hint) return;
    const target = findAnchor(hint.anchor);
    const vp = { w: window.innerWidth, h: window.innerHeight };
    const size = { w: el.offsetWidth, h: el.offsetHeight };
    const r = ring.current;
    if (el.closest('.hud[data-phone]')) {
      placePhone(el, target, size, vp, r);
      return;
    }
    if (!target) {
      el.style.left = `${Math.round((vp.w - size.w) / 2)}px`;
      el.style.top = `${Math.round(Math.min(vp.h * 0.22, 140))}px`;
      el.dataset.placement = 'center';
      if (r) r.style.display = 'none';
      return;
    }
    const tr = target.getBoundingClientRect();
    const p = placeCallout({ x: tr.left, y: tr.top, w: tr.width, h: tr.height }, size, vp, 16, 10);
    el.style.left = `${Math.round(p.x)}px`;
    el.style.top = `${Math.round(p.y)}px`;
    el.dataset.placement = p.placement;
    const a = arrow.current;
    if (a) {
      if (p.placement === 'top' || p.placement === 'bottom') {
        a.style.left = `${Math.round(p.arrow - 7)}px`;
        a.style.top = '';
      } else {
        a.style.top = `${Math.round(p.arrow - 7)}px`;
        a.style.left = '';
      }
    }
    if (r) {
      r.style.display = 'block';
      r.style.left = `${Math.round(tr.left - 6)}px`;
      r.style.top = `${Math.round(tr.top - 6)}px`;
      r.style.width = `${Math.round(tr.width + 12)}px`;
      r.style.height = `${Math.round(tr.height + 12)}px`;
    }
  };
  /**
   * Phone (W-114): the tip never covers the household portraits, the selected zombie's panel (portrait + needs) or
   * the top bar — those are what the first tips talk about — nor the placement bar's Done (W-116). Anchored tips sit beside their target region; unanchored
   * ones take the free spot nearest the top centre.
   */
  const placePhone = (el: HTMLDivElement, target: HTMLElement | null, size: { w: number; h: number }, vp: { w: number; h: number }, r: HTMLDivElement | null) => {
    const rectOf = (e: Element | null): Rect | null => {
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.height > 0 ? { x: b.left, y: b.top, w: b.width, h: b.height } : null;
    };
    const hud = el.closest('.hud');
    const avoid = ['.hud-household', '.hud-agent', '.hud-topbar', '.hud-placebar'].map((sel) => rectOf(hud?.querySelector(sel) ?? null)).filter((x): x is Rect => !!x);
    const anchorRect = rectOf(target) ?? { x: vp.w / 2, y: 0, w: 0, h: 0 };
    const p = placeCalloutAvoiding(anchorRect, size, vp, avoid, 12, PHONE_GUTTER);
    el.style.left = `${Math.round(p.x)}px`;
    el.style.top = `${Math.round(p.y)}px`;
    el.dataset.placement = target ? p.placement : 'center';
    const a = arrow.current;
    if (a) {
      if (p.placement === 'top' || p.placement === 'bottom') {
        a.style.left = `${Math.round(p.arrow - 7)}px`;
        a.style.top = '';
      } else {
        a.style.top = `${Math.round(p.arrow - 7)}px`;
        a.style.left = '';
      }
    }
    if (r) {
      const tr = target ? target.getBoundingClientRect() : null;
      r.style.display = tr ? 'block' : 'none';
      if (tr) {
        r.style.left = `${Math.round(tr.left - 6)}px`;
        r.style.top = `${Math.round(tr.top - 6)}px`;
        r.style.width = `${Math.round(tr.width + 12)}px`;
        r.style.height = `${Math.round(tr.height + 12)}px`;
      }
    }
  };
  useLayoutEffect(place);
  useInterval(place, hint ? 120 : null);
  // Esc dismisses the tip like "Got it" — only while it is the top layer on screen (a dialog or the interaction menu
  // covers it; those take Esc first and the tip re-registers on top when they close).
  useEscape(
    () => {
      if (hint) game.dismissHint(hint.id);
    },
    !!hint && game.dialog === null && !game.menu,
    // stale once the controller dismissed / replaced the tip or put a dialog / menu over it
    () => !!hint && game.hint?.id === hint.id && game.dialog === null && !game.menu,
  );
  if (!hint) return null;
  // W-113 story-start card (id 'story:…'): a narrative beat, not a tip — one "Let's go" button, no "Don't show tips".
  const story = hint.id.startsWith('story:');
  return (
    <>
      <div ref={ring} class="hud-hintring" aria-hidden="true" />
      <div ref={box} class={`hud-hint-bubble ui-interactive${story ? ' hud-hint-bubble--story' : ''}`} role="dialog" aria-labelledby="hud-hint-title" aria-describedby="hud-hint-text" data-hud-region="55" data-hint-id={hint.id}>
        <span ref={arrow} class="hud-hint-bubble__arrow" aria-hidden="true" />
        <div class="hud-hint-bubble__head">
          <span class="hud-hint-bubble__icon" aria-hidden="true">
            <Icon name={story ? 'coffin' : 'candle'} size="1.125rem" />
          </span>
          <span class="u-eyebrow">{ht(story ? 'hint.story' : 'hint.label')}</span>
        </div>
        <h2 id="hud-hint-title" class="hud-hint-bubble__title u-display">
          {hint.title}
        </h2>
        <p id="hud-hint-text" class="hud-hint-bubble__text">
          {hint.text}
        </p>
        <div class="hud-hint-bubble__actions">
          {story ? null : <Button size="sm" variant="ghost" label={ht('hint.never')} onClick={() => game.dismissHint(hint.id, true)} />}
          <Button size="sm" variant="primary" icon="check" label={ht(story ? 'hint.storyGo' : 'hint.ok')} onClick={() => game.dismissHint(hint.id)} />
        </div>
      </div>
    </>
  );
}
