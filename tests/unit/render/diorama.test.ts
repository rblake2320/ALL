/**
 * Miniature-set look (src/render/core/diorama.ts + PostPipeline + quality + settings). Proves:
 *  1. the focus band is perfectly sharp, blur grows monotonically away from it and saturates at 1, symmetric about the line;
 *  2. the focus line stays inside its window, and null / off-screen / NaN targets fall back to the centre;
 *  3. the follow is frame-rate independent (one 100 ms step ≈ ten 10 ms steps), never overshoots, and ignores bad dt;
 *  4. strength is 0 when the setting is off or the build grid is fully up, and garbage grid levels are safe;
 *  5. presets: only high/ultra run it, and never without the composer; the setting defaults on and is a validated bool;
 *  6. the GLSL uses the same constants as the tested maths (tap count, band, ramp) and keeps the old vignette maths;
 *  7. PostPipeline: the diorama pass replaces the vignette pass (never both), switching the setting off restores the
 *     plain vignette, low quality has no composer, and garbage focus/amount values are ignored (adversarial).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DIORAMA, DioramaShader, blurPxFor, dioramaStrength, focusTarget, smoothFocus, tiltShiftAmount } from '../../../src/render/core/diorama';
import { PostPipeline, VignetteShader } from '../../../src/render/core/post';
import { QUALITY_LEVELS, qualitySettings } from '../../../src/render/core/quality';
import { DEFAULT_SETTINGS } from '../../../src/game/contracts';
import { SETTINGS_SCHEMA, sanitizeSettings } from '../../../src/game/settings';

describe('tilt-shift amount', () => {
  it('is exactly 0 inside the band and 1 far from it', () => {
    expect(DIORAMA.band).toBeGreaterThanOrEqual(0.3); // at least 60 % of the view stays sharp: the lot must stay readable
    for (const dy of [0, 0.05, DIORAMA.band - 1e-6]) {
      expect(tiltShiftAmount(0.5 + dy, 0.5)).toBe(0);
      expect(tiltShiftAmount(0.5 - dy, 0.5)).toBe(0);
    }
    expect(tiltShiftAmount(0.5 + DIORAMA.band + DIORAMA.ramp, 0.5)).toBe(1);
    expect(tiltShiftAmount(5, 0.5)).toBe(1);
  });

  it('grows monotonically with distance and is symmetric about the focus line', () => {
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const d = i / 100;
      const a = tiltShiftAmount(0.4 + d, 0.4);
      expect(a).toBeGreaterThanOrEqual(prev);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      expect(tiltShiftAmount(0.4 - d, 0.4)).toBeCloseTo(a, 12);
      prev = a;
    }
  });

  it('never returns NaN for garbage input', () => {
    for (const v of [NaN, Infinity, -Infinity, undefined as unknown as number]) {
      expect(Number.isFinite(tiltShiftAmount(v, 0.5))).toBe(true);
      expect(Number.isFinite(tiltShiftAmount(0.5, v))).toBe(true);
      expect(Number.isFinite(tiltShiftAmount(0.9, 0.5, v, v))).toBe(true);
    }
  });
});

describe('focus line', () => {
  it('stays inside its window and falls back to the centre', () => {
    expect(focusTarget(0.5)).toBe(0.5);
    expect(focusTarget(0.01)).toBe(DIORAMA.focusMin);
    expect(focusTarget(0.99)).toBe(DIORAMA.focusMax);
    for (const v of [null, undefined, NaN, Infinity, -3, 4]) expect(focusTarget(v as number)).toBe(0.5);
  });

  it('follow is frame-rate independent and never overshoots', () => {
    const one = smoothFocus(0.34, 0.66, 0.1);
    let ten = 0.34;
    for (let i = 0; i < 10; i++) ten = smoothFocus(ten, 0.66, 0.01);
    expect(ten).toBeCloseTo(one, 6);
    let f = 0.34;
    for (let i = 0; i < 2000; i++) {
      const n = smoothFocus(f, 0.66, 1 / 60);
      expect(n).toBeGreaterThanOrEqual(f);
      expect(n).toBeLessThanOrEqual(0.66);
      f = n;
    }
    expect(f).toBe(0.66); // settles exactly: no endless sub-pixel drift
  });

  it('bad dt does not move it; a huge dt is capped, not a jump past the target', () => {
    for (const dt of [0, -1, NaN, Infinity]) expect(smoothFocus(0.4, 0.6, dt)).toBe(0.4);
    const big = smoothFocus(0.4, 0.6, 1e6);
    expect(big).toBeGreaterThan(0.4);
    expect(big).toBeLessThan(0.6);
  });
});

describe('strength', () => {
  it('yields completely to build mode and to the setting', () => {
    expect(dioramaStrength(true, 0)).toBe(1);
    expect(dioramaStrength(true, 1)).toBe(0);
    expect(dioramaStrength(true, 0.25)).toBeCloseTo(0.75, 12);
    expect(dioramaStrength(false, 0)).toBe(0);
    expect(dioramaStrength('yes' as unknown as boolean, 0)).toBe(0);
    for (const g of [NaN, -5, 9, Infinity]) {
      const s = dioramaStrength(true, g);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

describe('presets and settings', () => {
  it('only high and ultra run the look, and never without the composer', () => {
    for (const l of QUALITY_LEVELS) {
      const q = qualitySettings(l);
      expect(q.diorama, l).toBe(l === 'high' || l === 'ultra');
      if (q.diorama) expect(q.post, l).toBe(true);
    }
  });

  it('the setting defaults on, is a bool in the schema, and garbage reads as the default', () => {
    expect(DEFAULT_SETTINGS.miniatureFocus).toBe(true);
    expect(SETTINGS_SCHEMA.miniatureFocus).toEqual({ t: 'bool' });
    expect(sanitizeSettings({ miniatureFocus: false }).miniatureFocus).toBe(false);
    for (const bad of ['off', 0, null, {}]) expect(sanitizeSettings({ miniatureFocus: bad }).miniatureFocus).toBe(true);
    expect(sanitizeSettings({}).miniatureFocus).toBe(true); // saves from before the setting existed
  });
});

describe('shader matches the tested maths', () => {
  it('uses the module constants and the unchanged vignette maths', () => {
    const fs = DioramaShader.fragmentShader;
    expect(fs).toContain(`i < ${DIORAMA.taps};`);
    expect(fs).toContain(`/ ${DIORAMA.taps + 1}.0`);
    expect(fs).toContain('smoothstep(uBand, uBand + uRamp, abs(vUv.y - uFocusY))');
    expect(DioramaShader.uniforms.uBand.value).toBe(DIORAMA.band);
    expect(DioramaShader.uniforms.uRamp.value).toBe(DIORAMA.ramp);
    expect(DioramaShader.uniforms.uBlurPx.value).toBe(DIORAMA.maxBlurPx);
    expect(fs).toContain('smoothstep(0.45, 1.25, length(d)) * uStrength');
    expect(VignetteShader.fragmentShader).toContain('smoothstep(0.45, 1.25, r) * uStrength');
    expect(DioramaShader.uniforms.uTint.value.equals(VignetteShader.uniforms.uTint.value)).toBe(true);
  });
});

describe('PostPipeline chain', () => {
  /** A renderer stub with just what EffectComposer and the passes touch when they are only constructed/sized. */
  function pipeline() {
    const size = new THREE.Vector2(640, 360);
    const gl = {
      getPixelRatio: () => 1,
      getSize: (v: THREE.Vector2) => v.copy(size),
      getRenderTarget: () => null,
      setRenderTarget() {},
      capabilities: { isWebGL2: true },
    } as unknown as THREE.WebGLRenderer;
    return new PostPipeline(gl, new THREE.Scene(), new THREE.PerspectiveCamera());
  }
  const names = (p: PostPipeline): string[] =>
    ((p as unknown as { composer: { passes: { material?: { name?: string }; constructor: { name: string } }[] } | null }).composer?.passes ?? []).map(
      (x) => x.material?.name || x.constructor.name,
    );

  it('high: the diorama pass replaces the vignette pass (never both)', () => {
    const p = pipeline();
    p.configure(qualitySettings('high'), 640, 360, 1);
    expect(p.enabled).toBe(true);
    expect(p.dioramaActive).toBe(true);
    const n = names(p);
    expect(n.filter((x) => x === 'AfterlifeDiorama')).toHaveLength(1);
    expect(n).not.toContain('AfterlifeVignette');
    p.dispose();
  });

  it('switching the setting off restores the plain vignette; on again restores the diorama; repeat calls do not rebuild', () => {
    const p = pipeline();
    p.configure(qualitySettings('ultra'), 800, 450, 1);
    p.setMiniature(false);
    expect(p.dioramaActive).toBe(false);
    expect(names(p)).toContain('AfterlifeVignette');
    const composer = (p as unknown as { composer: unknown }).composer;
    p.setMiniature(false);
    expect((p as unknown as { composer: unknown }).composer).toBe(composer);
    p.setMiniature(true);
    expect(p.dioramaActive).toBe(true);
    expect(names(p)).not.toContain('AfterlifeVignette');
    p.dispose();
  });

  it('low/medium: no composer, the look is never active, and the setters are harmless', () => {
    for (const l of ['low', 'medium'] as const) {
      const p = pipeline();
      p.configure(qualitySettings(l), 640, 360, 1);
      expect(p.enabled).toBe(false);
      expect(p.dioramaActive).toBe(false);
      expect(() => {
        p.setDiorama(0.4, 1);
        p.setMiniature(false);
        p.setMiniature(true);
        p.setSize(320, 200, 2);
      }).not.toThrow();
      expect(p.dioramaActive).toBe(false);
    }
  });

  it('adversarial: garbage focus/amount is ignored or clamped; resize keeps the uniforms in step', () => {
    const p = pipeline();
    p.configure(qualitySettings('high'), 640, 360, 1);
    const u = (p as unknown as { diorama: { uniforms: Record<string, { value: unknown }> } }).diorama.uniforms;
    p.setDiorama(0.4, 0.5);
    p.setDiorama(NaN, Infinity);
    expect(u.uFocusY.value).toBe(0.4);
    expect(u.uAmount.value).toBe(0.5);
    p.setDiorama(7, -3);
    expect(u.uFocusY.value).toBe(1);
    expect(u.uAmount.value).toBe(0);
    p.setSize(1000, 500, 2);
    expect(u.uAspect.value).toBe(2);
    expect((u.uTexel.value as THREE.Vector2).x).toBeCloseTo(1 / 1000, 12);
    expect((u.uTexel.value as THREE.Vector2).y).toBeCloseTo(1 / 500, 12);
    expect(u.uFocusY.value).toBe(1); // survives the resize
    expect(u.uBlurPx.value).toBeCloseTo(blurPxFor(500), 12); // radius follows the view height
    expect(blurPxFor(720)).toBe(DIORAMA.maxBlurPx);
    expect(blurPxFor(360)).toBeCloseTo(DIORAMA.maxBlurPx / 2, 12);
    for (const h of [0, -1, NaN, 1e9]) {
      expect(blurPxFor(h)).toBeGreaterThan(0);
      expect(blurPxFor(h)).toBeLessThanOrEqual(DIORAMA.maxBlurPx * 3);
    }
    p.dispose();
  });
});
