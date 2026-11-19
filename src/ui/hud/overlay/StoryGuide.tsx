/**
 * W-116 (D-065, owner playtest #1): on entering an Act 1 world, and whenever a new Act 1 step with a world target becomes
 * active, frame the camera so the target (mailbox, coffin, …) and its marker sit clear of every HUD panel. Renders
 * nothing. Each (world, step) is framed once — switching to Buy mode and back never re-pans. The first framing in a
 * world is instant (the opening shot); later ones pan smoothly.
 */
import { useEffect } from 'preact/hooks';
import { useGame } from '../parts/hooks';
import { frameStoryTarget } from '../lib/storyFraming';

const framed = new WeakMap<object, string>();

export function StoryGuide() {
  const game = useGame();
  const t = game.storyTarget;
  const key = t ? `${t.questId}#${t.stepId}#${t.objectId}` : '';
  const world = (game.sim?.state as object | undefined) ?? null;
  const live = game.mode === 'live';
  useEffect(() => {
    if (!key || !world || !live) return undefined;
    if (framed.get(world) === key) return undefined;
    const first = !framed.has(world);
    let raf = 0;
    let raf2 = 0;
    // two frames: the HUD panels have laid out (and the renderer has the object's bounds)
    raf = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (frameStoryTarget(game, { instant: first })) framed.set(world, key);
      });
    });
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(raf2);
    };
  }, [key, world, live]);
  return null;
}
