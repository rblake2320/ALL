/** Re-render on economy notifications (coalesced to one per frame). The facade is read fresh on every render. */
import { useEffect, useState } from 'preact/hooks';
import type { EconomyFacade } from '../../economy/facade';
import { useGame } from '../hooks';

export function useEconomy(): EconomyFacade | null {
  const game = useGame();
  const econ = (game as { economy?: EconomyFacade | null }).economy ?? null;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!econ) return;
    let raf = 0;
    const unsub = econ.subscribe(() => {
      if (raf) return;
      raf = (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number)(() => {
        raf = 0;
        setTick((n) => n + 1);
      });
    });
    return () => {
      unsub();
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    };
  }, [econ]);
  return econ;
}
