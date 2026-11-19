/**
 * W-116 story marker × reduced motion: the bobbing arrow stands still (no bob, no spin, no pulse) when the game's
 * Reduce motion setting is on OR the OS / browser prefers reduced motion; the controller pushes the setting to the
 * renderer at startup and whenever it changes.
 */
import { describe, expect, it } from 'vitest';
import { MARKER_LIFT, markerReducedMotion, prefersReducedMotion, QuestMarker } from '../../../src/render/overlays/questMarker';
import { createHarness } from '../game/controllerHarness';

const TOP = { x: 14.5, y: 1.2, z: 26.5 };
const GROUND = { x: 14.5, z: 26.5 };

function samples(still: boolean) {
  const m = new QuestMarker();
  const out: { y: number; spin: number; ring: number; halo: number }[] = [];
  for (let i = 0; i < 40; i++) {
    const t = i * 0.137;
    m.update(t, 0.5, TOP, GROUND, still);
    const g = m.group as unknown as { children: { position: { y: number }; scale: { x: number }; children?: { rotation: { y: number }; material?: { opacity: number } }[] }[] };
    const floating = g.children[0];
    const ring = g.children[1];
    out.push({ y: m.tip.y, spin: floating.children![1].rotation.y, ring: ring.scale.x, halo: floating.children![0].material!.opacity });
  }
  m.dispose();
  return out;
}

describe('quest marker × reduced motion', () => {
  it('normally it bobs, spins and pulses', () => {
    const s = samples(false).slice(10);
    expect(new Set(s.map((x) => x.y.toFixed(4))).size).toBeGreaterThan(5);
    expect(new Set(s.map((x) => x.spin.toFixed(4))).size).toBeGreaterThan(5);
    expect(new Set(s.map((x) => x.ring.toFixed(4))).size).toBeGreaterThan(5);
  });

  it('reduced motion: a static marker — same height, no spin, no pulse (after the fade-in)', () => {
    const s = samples(true).slice(10);
    for (const x of s) {
      expect(x.y).toBeCloseTo(TOP.y + MARKER_LIFT, 9);
      expect(x.spin).toBe(0);
      expect(x.ring).toBe(1);
    }
    expect(new Set(s.map((x) => x.halo.toFixed(6))).size).toBe(1);
  });

  it('either source turns it static: the game setting OR prefers-reduced-motion', () => {
    expect(markerReducedMotion(false, false)).toBe(false);
    expect(markerReducedMotion(true, false)).toBe(true);
    expect(markerReducedMotion(false, true)).toBe(true);
    expect(markerReducedMotion(true, true)).toBe(true);
    expect(markerReducedMotion(undefined, null)).toBe(false);
    expect(prefersReducedMotion({ matchMedia: (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' }) })).toBe(true);
    expect(prefersReducedMotion({ matchMedia: () => ({ matches: false }) })).toBe(false);
    expect(prefersReducedMotion({ matchMedia: () => { throw new Error('no'); } })).toBe(false);
    expect(prefersReducedMotion(null)).toBe(false);
  });

  it('the controller pushes Settings.reduceMotion to the renderer at startup and on change', async () => {
    const h = await createHarness();
    const r = h.renderer;
    expect(r.count('setReduceMotion')).toBeGreaterThanOrEqual(1);
    h.game.updateSettings({ reduceMotion: true });
    expect(r.last('setReduceMotion')?.args).toEqual([true]);
    h.game.updateSettings({ reduceMotion: false });
    expect(r.last('setReduceMotion')?.args).toEqual([false]);
  });
});
