/** FPS meter (settings.showFps): controller fps (falls back to a local frame counter) + a 60-sample sparkline. */
import { useRef } from 'preact/hooks';
import { isNum } from '../lib/format';
import { useGameStatic, useRafLoop } from '../parts/hooks';
import { ht } from '../strings';
import './overlay.css';

const SAMPLES = 60;

export function FpsOverlay() {
  const game = useGameStatic();
  const text = useRef<HTMLSpanElement>(null);
  const path = useRef<SVGPathElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const buf = useRef<number[]>([]);
  const acc = useRef({ frames: 0, t: 0, last: 0 });
  useRafLoop((dt, now) => {
    const a = acc.current;
    a.frames++;
    a.t += dt;
    if (now - a.last < 250) return;
    a.last = now;
    const local = a.t > 0 ? a.frames / a.t : 0;
    a.frames = 0;
    a.t = 0;
    const fps = isNum(game.fps) && game.fps > 0 ? game.fps : local;
    const b = buf.current;
    b.push(fps);
    if (b.length > SAMPLES) b.shift();
    if (text.current) text.current.textContent = ht('fps.label', { fps: Math.round(fps) });
    if (root.current) root.current.dataset.tone = fps >= 50 ? 'good' : fps >= 30 ? 'warm' : 'bad';
    if (path.current && b.length > 1) {
      const max = 75;
      const d = b.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (SAMPLES - 1)) * 60).toFixed(1)} ${(18 - (Math.min(max, v) / max) * 16).toFixed(1)}`).join('');
      path.current.setAttribute('d', d);
    }
  });
  return (
    <div ref={root} class="hud-fps" data-tone="good" aria-hidden="true">
      <span ref={text} class="hud-fps__text u-num">
        {ht('fps.label', { fps: '—' })}
      </span>
      <svg viewBox="0 0 60 20" class="hud-fps__spark">
        <path d="M0 10 L60 10" class="hud-fps__mid" />
        <path ref={path} d="" class="hud-fps__line" />
      </svg>
    </div>
  );
}
