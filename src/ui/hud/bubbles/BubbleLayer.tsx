/**
 * Thought / speech / shout bubbles over zombies' heads. Entries come from game.bubbles (re-rendered on controller
 * notifications); positions are written straight to the DOM every animation frame from renderer.bubbleAnchors(),
 * so following a walking zombie costs no Preact renders. Bubbles of one zombie stack upwards; removed bubbles get
 * a short exit animation.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameController } from '../../../game/contracts';
import type { BubbleAnchor } from '../../../render/contracts';
import { clamp, isNum } from '../lib/format';
import { stackIndices } from '../lib/layout';
import { remPx, useGame, useRafLoop } from '../parts/hooks';
import { Icon } from '../parts/icons';
import './bubbles.css';

type Bubble = GameController['bubbles'][number];

const EXIT_MS = 180;
/** Vertical distance between stacked bubbles, in rem. */
const STACK_REM = 3.1;

/** Last values written to a bubble element; unchanged frames write nothing (standing zombies cost no style work). */
interface Placed {
  x: number;
  y: number;
  s: number;
  z: number;
  visible: boolean;
}

let loggedFailure = false;

/**
 * Position every bubble from the renderer's anchors. Reuses `byAgent` / `placed` across frames and only touches the
 * DOM when a value moved by ≥ 0.05 px (or the visibility / stacking changed).
 */
export function placeBubbles(
  game: Pick<GameController, 'renderer'>,
  all: readonly Bubble[],
  els: ReadonlyMap<number, HTMLDivElement>,
  stack: ReadonlyMap<number, number>,
  lastSlot: ReadonlyMap<number, number>,
  byAgent: Map<string, BubbleAnchor>,
  placed: Map<number, Placed>,
): void {
  let anchors: readonly BubbleAnchor[] | null | undefined = null;
  try {
    anchors = game.renderer.bubbleAnchors();
  } catch {
    anchors = null;
  }
  byAgent.clear();
  if (Array.isArray(anchors)) for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    if (a && typeof a.agentId === 'string') byAgent.set(a.agentId, a);
  }
  const rem = remPx();
  for (let i = 0; i < all.length; i++) {
    const b = all[i];
    const el = els.get(b.key);
    if (!el) continue;
    let p = placed.get(b.key);
    if (!p) {
      p = { x: NaN, y: NaN, s: NaN, z: NaN, visible: false };
      placed.set(b.key, p);
    }
    const a = byAgent.get(b.agentId);
    if (!a || !a.visible || !isNum(a.x) || !isNum(a.y)) {
      if (p.visible || el.style.visibility !== 'hidden') el.style.visibility = 'hidden';
      p.visible = false;
      continue;
    }
    const s = clamp(isNum(a.scale) ? a.scale : 1, 0.5, 1.2);
    const idx = stack.get(b.key) ?? lastSlot.get(b.key) ?? 0;
    const x = a.x;
    const y = a.y - 6 * s - idx * STACK_REM * rem * s;
    if (!p.visible) {
      el.style.visibility = 'visible';
      p.visible = true;
    }
    if (Math.abs(x - p.x) >= 0.05 || Math.abs(y - p.y) >= 0.05 || Math.abs(s - p.s) >= 0.0005 || !(p.x === p.x)) {
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${s.toFixed(3)})`;
      p.x = x;
      p.y = y;
      p.s = s;
    }
    const z = 1000 + Math.round(a.y);
    if (z !== p.z) {
      el.style.zIndex = String(z);
      p.z = z;
    }
  }
  // forget bubbles that are gone (keeps the map from growing over a long session)
  if (placed.size > all.length) {
    for (const key of placed.keys()) if (!els.has(key)) placed.delete(key);
  }
}

export function BubbleLayer() {
  const game = useGame();
  const live = Array.isArray(game.bubbles) ? game.bubbles.filter((b) => b && isNum(b.key) && typeof b.agentId === 'string') : [];
  const [leaving, setLeaving] = useState<Bubble[]>([]);
  const prev = useRef<Bubble[]>([]);
  const els = useRef(new Map<number, HTMLDivElement>());
  /** Exit timers per bubble key. Kept outside effect cleanup: the layer re-renders ~12×/s, and a timer cleared by
   *  the next render would leave the exiting bubble (and this rAF loop) alive forever. */
  const exitTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  /** Last stack slot of every bubble, so an exiting bubble fades where it was instead of dropping onto another. */
  const lastSlot = useRef(new Map<number, number>());

  useEffect(() => {
    const keys = new Set(live.map((b) => b.key));
    const gone = prev.current.filter((b) => !keys.has(b.key) && !exitTimers.current.has(b.key));
    prev.current = live;
    if (gone.length === 0) return;
    setLeaving((l) => [...l.filter((x) => !gone.some((g) => g.key === x.key)), ...gone]);
    for (const g of gone) {
      exitTimers.current.set(
        g.key,
        setTimeout(() => {
          exitTimers.current.delete(g.key);
          lastSlot.current.delete(g.key);
          setLeaving((l) => l.filter((x) => x.key !== g.key));
        }, EXIT_MS),
      );
    }
  });
  useEffect(
    () => () => {
      for (const t of exitTimers.current.values()) clearTimeout(t);
      exitTimers.current.clear();
    },
    [],
  );

  const leavingKeys = new Set(leaving.map((b) => b.key));
  const all = [...live, ...leaving.filter((b) => !live.some((x) => x.key === b.key))];
  const stack = stackIndices(live);
  for (const [key, slot] of stack) lastSlot.current.set(key, slot);

  // Per-frame state reused across frames (no allocations in the loop beyond the transform strings it must write).
  const byAgent = useRef(new Map<string, BubbleAnchor>());
  const placed = useRef(new Map<number, Placed>());
  useRafLoop(() => {
    try {
      placeBubbles(game, all, els.current, stack, lastSlot.current, byAgent.current, placed.current);
    } catch (err) {
      // a per-frame path must never throw (it would re-throw every frame); hide rather than misplace
      if (!loggedFailure) {
        loggedFailure = true;
        console.error('[hud] bubble placement failed', err);
      }
    }
  }, all.length > 0);

  if (all.length === 0) return null;
  return (
    <div class="hud-bubbles" aria-hidden="true">
      {all.map((b) => {
        const style = b.style === 'speech' || b.style === 'shout' ? b.style : 'thought';
        return (
          <div
            key={b.key}
            ref={(el) => {
              if (el) els.current.set(b.key, el);
              else els.current.delete(b.key);
            }}
            class={`hud-bubble is-${style} ${b.positive ? 'is-pos' : 'is-neg'}${leavingKeys.has(b.key) ? ' is-leaving' : ''}`}
            style={{ visibility: 'hidden' }}
          >
            <div class="hud-bubble__inner">
              <div class="hud-bubble__body">
                <Icon name={b.icon} size="1.5rem" strokeWidth={2} />
              </div>
              {style === 'thought' ? (
                <>
                  <span class="hud-bubble__dot is-a" />
                  <span class="hud-bubble__dot is-b" />
                </>
              ) : (
                <span class="hud-bubble__tail" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
