/**
 * W-039 Auto quality + D-025 pixel-ratio precedence (pure modules: render/core/autoQuality.ts, render/core/quality.ts).
 * GPU strings below are the real formats browsers report (Chrome/Edge via ANGLE on D3D11 / Metal / Vulkan,
 * Firefox Mesa / masked, Safari).
 */
import { describe, expect, it } from 'vitest';
import {
  AutoQualityGovernor, FRAME_BUDGET_MS, MAX_SAMPLE_MS, MIN_WINDOW_FRAMES, PROBE_MS, PROBE_WARMUP_MS, WATCH_WARMUP_MS,
  WATCH_WINDOW_MS, AUTO_LEVELS, classifyGpu, isAutoLevel, minLevel, p95, probeDecision, resolveQuality, stepDown,
} from '../../../src/render/core/autoQuality';
import type { AutoLevel } from '../../../src/render/core/autoQuality';
import { effectivePixelRatio, internalResolution } from '../../../src/render/core/quality';

describe('GPU tier heuristics (WEBGL_debug_renderer_info)', () => {
  const TABLE: [string, string, AutoLevel, string][] = [
    // software -> low
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'Google Inc. (Google)', 'low', 'software'],
    ['Google SwiftShader', 'Google Inc.', 'low', 'software'],
    ['llvmpipe (LLVM 15.0.6, 256 bits)', 'Mesa', 'low', 'software'],
    ['ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (Microsoft)', 'low', 'software'],
    // integrated AMD -> low (Sol W-022 adapter: Radeon(TM) Graphics, device 0x13C0)
    ['ANGLE (AMD, AMD Radeon(TM) Graphics (0x000013C0) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (AMD)', 'low', 'integrated'],
    ['ANGLE (AMD, AMD Radeon 780M Graphics (0x000015BF) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (AMD)', 'low', 'integrated'],
    ['AMD Radeon Vega 8 Graphics', 'ATI Technologies Inc.', 'low', 'integrated'],
    // integrated Intel -> low
    ['ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (Intel)', 'low', 'integrated'],
    ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (Intel)', 'low', 'integrated'],
    ['Mesa Intel(R) UHD Graphics 620 (KBL GT2)', 'Intel', 'low', 'integrated'],
    ['ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (Intel)', 'low', 'integrated'],
    // discrete Intel Arc -> high
    ['ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (Intel)', 'high', 'discrete'],
    // Apple
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', 'Google Inc. (Apple)', 'medium', 'apple'],
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)', 'Google Inc. (Apple)', 'high', 'apple'],
    ['Apple M2 Pro', 'Apple', 'high', 'apple'],
    ['Apple GPU', 'Apple Inc.', 'medium', 'apple'],
    // mobile -> low
    ['Mali-G78 MC20', 'ARM', 'low', 'mobile'],
    ['Adreno (TM) 650', 'Qualcomm', 'low', 'mobile'],
    ['Apple A15 GPU', 'Apple Inc.', 'low', 'mobile'],
    // NVIDIA
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 (0x00002B85) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (NVIDIA)', 'high', 'discrete'],
    ['ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (NVIDIA)', 'high', 'discrete'],
    ['NVIDIA GeForce GTX 1050 Ti/PCIe/SSE2', 'NVIDIA Corporation', 'medium', 'discrete'],
    ['ANGLE (NVIDIA, NVIDIA GeForce MX250 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (NVIDIA)', 'low', 'discrete'],
    ['NVIDIA GeForce 940MX', 'NVIDIA Corporation', 'low', 'discrete'],
    ['NVIDIA GeForce GT 1030', 'NVIDIA Corporation', 'low', 'discrete'],
    // AMD discrete
    ['ANGLE (AMD, AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (AMD)', 'high', 'discrete'],
    ['AMD Radeon Pro 5500M OpenGL Engine', 'ATI Technologies Inc.', 'medium', 'discrete'],
    // masked / unknown -> medium
    ['WebKit WebGL', 'WebKit', 'medium', 'unknown'],
    ['', '', 'medium', 'unknown'],
  ];

  it.each(TABLE)('%s -> %s', (renderer, vendor, tier, kind) => {
    const c = classifyGpu(renderer, vendor);
    expect({ tier: c.tier, kind: c.kind }).toEqual({ tier, kind });
  });

  it('is total and never picks ultra', () => {
    for (const v of [null, undefined, 42, {}, [], 'x'.repeat(100_000), '\u0000', NaN]) {
      const c = classifyGpu(v, v);
      expect(['low', 'medium', 'high']).toContain(c.tier);
    }
    // a 100 kB hostile string is truncated, not regex-bombed
    const t0 = Date.now();
    classifyGpu('radeon '.repeat(20_000), 'intel '.repeat(20_000));
    expect(Date.now() - t0).toBeLessThan(200);
  });
});

describe('probe decision (first run, ~3 s)', () => {
  it('keeps the ceiling within budget, drops one level up to 50 ms, two beyond; never above the ceiling', () => {
    expect(probeDecision('high', 16)).toBe('high');
    expect(probeDecision('high', FRAME_BUDGET_MS)).toBe('high');
    expect(probeDecision('high', 34)).toBe('medium');
    expect(probeDecision('high', 50)).toBe('medium');
    // Sol W-022 AMD iGPU: High p95 72.8 ms, Medium p95 54.5 ms -> Low either way
    expect(probeDecision('high', 72.8)).toBe('low');
    expect(probeDecision('medium', 54.5)).toBe('low');
    expect(probeDecision('medium', 40)).toBe('low');
    expect(probeDecision('low', 500)).toBe('low');
    expect(probeDecision('medium', 5)).toBe('medium'); // fast frames never upgrade past the tier
  });

  it('nothing measured keeps the tier; garbage ceilings read as medium', () => {
    expect(probeDecision('high', NaN)).toBe('high');
    expect(probeDecision('low', -1)).toBe('low');
    expect(probeDecision('ultra' as AutoLevel, 10)).toBe('medium');
  });

  it('p95 is nearest-rank over finite positive samples', () => {
    expect(p95([])).toBeNaN();
    expect(p95([NaN, -1, 0])).toBeNaN();
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(p95(xs)).toBe(95);
    expect(p95([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 200])).toBe(10);
    expect(p95([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 200, 200])).toBe(200);
  });
});

/** Feed `ms` of frames of `frameMs` each; returns every level change. */
function run(g: AutoQualityGovernor, ms: number, frameMs: number): AutoLevel[] {
  const out: AutoLevel[] = [];
  for (let t = 0; t < ms; t += frameMs) {
    const r = g.sample(frameMs);
    if (r) out.push(r);
  }
  return out;
}

describe('governor: probe -> watch, downgrade hysteresis', () => {
  it('first run probes at the ceiling for ~3 s after the warm-up, then settles', () => {
    const g = new AutoQualityGovernor('high');
    expect(g.state()).toMatchObject({ level: 'high', phase: 'probe' });
    // warm-up frames (shader compiles) are never judged, however slow
    expect(run(g, PROBE_WARMUP_MS - 1, 200)).toEqual([]);
    expect(run(g, PROBE_MS - 100, 70)).toEqual([]);
    expect(g.state().phase).toBe('probe');
    expect(run(g, 300, 70)).toEqual(['low']); // p95 70 ms > 50 -> two steps
    expect(g.state()).toMatchObject({ level: 'low', phase: 'watch', downgrades: 0 });
    expect(g.state().lastP95).toBe(70);
  });

  it('a fast probe keeps the ceiling and never upgrades afterwards', () => {
    const g = new AutoQualityGovernor('medium');
    expect(run(g, PROBE_WARMUP_MS + PROBE_MS + 100, 8)).toEqual([]);
    expect(g.state()).toMatchObject({ level: 'medium', phase: 'watch' });
    expect(run(g, 120_000, 4)).toEqual([]); // two minutes at 250 fps: still medium
    expect(g.current).toBe('medium');
  });

  it('runtime: one level down only after a full 10 s window with p95 > 33 ms', () => {
    const g = new AutoQualityGovernor('high', 'high'); // stored result: no probe
    expect(g.state().phase).toBe('watch');
    expect(run(g, WATCH_WARMUP_MS, 100)).toEqual([]); // warm-up ignored
    expect(run(g, WATCH_WINDOW_MS - 200, 40)).toEqual([]); // 9.8 s of 40 ms frames: not yet
    expect(run(g, 400, 40)).toEqual(['medium']);
    expect(g.state()).toMatchObject({ level: 'medium', downgrades: 1 });
  });

  it('short stutters do not downgrade (p95, not max); a sustained tail does', () => {
    const g = new AutoQualityGovernor('high', 'high');
    run(g, WATCH_WARMUP_MS, 16);
    const changes: AutoLevel[] = [];
    // 10 s at 60 fps with a 120 ms hitch every 2 s (5 hitches of ~600 frames < 5 %)
    for (let i = 0; i < 620; i++) {
      const r = g.sample(i % 120 === 0 ? 120 : 16);
      if (r) changes.push(r);
    }
    expect(changes).toEqual([]);
    expect(g.state().lastP95).toBe(16);
    // now 10 % of frames at 45 ms: p95 is in the tail -> downgrade
    for (let i = 0; i < 700; i++) {
      const r = g.sample(i % 10 === 0 ? 45 : 16);
      if (r) changes.push(r);
    }
    expect(changes).toEqual(['medium']);
  });

  it('no oscillation: after a downgrade the next window needs its own warm-up + 10 s, and good frames never step up', () => {
    const g = new AutoQualityGovernor('high', 'high');
    run(g, WATCH_WARMUP_MS, 16);
    const seq: AutoLevel[] = [];
    // slow everywhere: high -> medium -> low, one level per window, then stays at low
    seq.push(...run(g, 60_000, 50));
    expect(seq).toEqual(['medium', 'low']);
    // the second downgrade could only happen after warm-up + a full window at medium
    const g2 = new AutoQualityGovernor('high', 'high');
    run(g2, WATCH_WARMUP_MS, 16);
    run(g2, WATCH_WINDOW_MS + 50, 50); // -> medium
    expect(g2.current).toBe('medium');
    expect(run(g2, WATCH_WARMUP_MS + WATCH_WINDOW_MS - 200, 50)).toEqual([]);
    // alternating good / bad windows: monotonic, never back up
    const g3 = new AutoQualityGovernor('high', 'high');
    run(g3, WATCH_WARMUP_MS, 16);
    const levels: AutoLevel[] = [g3.current];
    for (let w = 0; w < 12; w++) {
      run(g3, WATCH_WINDOW_MS + WATCH_WARMUP_MS + 100, w % 2 ? 10 : 45);
      levels.push(g3.current);
    }
    for (let i = 1; i < levels.length; i++) expect(['low', 'medium', 'high'].indexOf(levels[i])).toBeLessThanOrEqual(['low', 'medium', 'high'].indexOf(levels[i - 1]));
    expect(g3.current).toBe('low');
  });

  it('stored result is clamped to the GPU ceiling (a weaker GPU never inherits a higher level)', () => {
    expect(new AutoQualityGovernor('low', 'high').current).toBe('low');
    expect(new AutoQualityGovernor('high', 'medium').current).toBe('medium');
    expect(new AutoQualityGovernor('high', 'bogus' as AutoLevel).state().phase).toBe('probe');
  });

  it('pauses (> 5 s gaps), garbage samples and interrupts never count as frames', () => {
    const g = new AutoQualityGovernor('high', 'high');
    run(g, WATCH_WARMUP_MS, 16);
    for (const v of [NaN, -5, 0, Infinity, MAX_SAMPLE_MS + 1, 60_000]) expect(g.sample(v)).toBeNull();
    // the gap restarted the warm-up: 9 s of slow frames after it are not a judged window yet
    expect(run(g, WATCH_WARMUP_MS + WATCH_WINDOW_MS - 1000, 50)).toEqual([]);
    g.interrupt();
    expect(run(g, WATCH_WARMUP_MS + WATCH_WINDOW_MS - 1000, 50)).toEqual([]);
    expect(g.current).toBe('high');
  });

  it('a window with too few frames is judged by its worst frame (a 2 fps machine still steps down)', () => {
    const g = new AutoQualityGovernor('medium');
    run(g, PROBE_WARMUP_MS, 100);
    const n = Math.ceil(PROBE_MS / 500);
    expect(n).toBeLessThan(MIN_WINDOW_FRAMES);
    expect(run(g, PROBE_MS + 1, 500)).toEqual(['low']);
  });

  it('software-rasteriser frames (~600 ms-2 s each, SwiftShader in headless Chromium) are judged, not dropped as pauses', () => {
    const g = new AutoQualityGovernor('medium');
    const changes = run(g, PROBE_WARMUP_MS + PROBE_MS + 2000, 1500);
    expect(changes).toEqual(['low']);
    expect(g.state()).toMatchObject({ phase: 'watch', lastP95: 1500 });
  });

  it('stepDown / resolveQuality', () => {
    expect(stepDown('high')).toBe('medium');
    expect(stepDown('high', 5)).toBe('low');
    expect(stepDown('low')).toBe('low');
    expect(resolveQuality('ultra', 'low')).toBe('ultra'); // an explicit choice always wins
    expect(resolveQuality('auto', 'low')).toBe('low');
    expect(resolveQuality('auto', null)).toBe('medium');
    expect(resolveQuality('garbage', 'high')).toBe('high');
  });

  it('adversarial: NaN / Infinity / negative steps never index outside the level list; junk auto levels read as medium', () => {
    for (const st of [NaN, Infinity, -Infinity, -3, 0, 0.9]) expect(stepDown('high', st), String(st)).toBe('high');
    expect(stepDown('medium', 1.9)).toBe('low');
    expect(resolveQuality('auto', 'ultra' as unknown as AutoLevel)).toBe('medium');
    expect(resolveQuality(undefined, 'potato' as unknown as AutoLevel)).toBe('medium');
  });

  it('W-107 extension point: one ordered level list drives isAutoLevel / stepDown / minLevel (Ultra not in it yet)', () => {
    expect([...AUTO_LEVELS]).toEqual(['low', 'medium', 'high']);
    for (const v of ['ultra', 'auto', 'High', '', null, undefined, 1, {}, 'toString', '__proto__']) expect(isAutoLevel(v), String(v)).toBe(false);
    for (let i = 0; i < AUTO_LEVELS.length; i++) {
      expect(isAutoLevel(AUTO_LEVELS[i])).toBe(true);
      expect(stepDown(AUTO_LEVELS[i])).toBe(AUTO_LEVELS[Math.max(0, i - 1)]);
      for (let j = 0; j < AUTO_LEVELS.length; j++) expect(minLevel(AUTO_LEVELS[i], AUTO_LEVELS[j])).toBe(AUTO_LEVELS[Math.min(i, j)]);
    }
  });
});

describe('D-025: pixel ratio precedence and Ultra internal resolution', () => {
  it('unset Pixel Ratio: Ultra supersamples a 1x display to 1.5 (1080p -> 2880 x 1620)', () => {
    const pr = effectivePixelRatio('ultra', 1, 1920, 1080);
    expect(pr).toBe(1.5);
    expect(internalResolution(1920, 1080, pr)).toEqual({ width: 2880, height: 1620 });
    expect(effectivePixelRatio('high', 1, 1920, 1080)).toBe(1);
    expect(effectivePixelRatio('low', 2, 1920, 1080)).toBe(1); // Low caps the auto ratio at 1
  });

  it('explicit Pixel Ratio always wins over every preset (both the Ultra minimum and the Low maximum)', () => {
    for (const q of ['low', 'medium', 'high', 'ultra'] as const) {
      for (const r of [0.5, 1, 1.5, 2]) expect(effectivePixelRatio(q, r, 1920, 1080, true), `${q} @ ${r}`).toBe(r);
    }
    expect(internalResolution(1920, 1080, effectivePixelRatio('ultra', 1, 1920, 1080, true))).toEqual({ width: 1920, height: 1080 });
    // clamped to 0.5..4; garbage reads as 1
    expect(effectivePixelRatio('ultra', 9, 100, 100, true)).toBe(4);
    expect(effectivePixelRatio('ultra', NaN, 1920, 1080, true)).toBe(1);
  });

  it('4K: the 16.7 Mpx buffer cap applies to auto and explicit alike', () => {
    const auto = effectivePixelRatio('ultra', 1, 3840, 2160);
    const res = internalResolution(3840, 2160, auto);
    expect(res.width * res.height).toBeLessThanOrEqual(16_777_216);
    expect(auto).toBeLessThan(1.5);
    const ex = effectivePixelRatio('low', 2, 3840, 2160, true);
    expect(internalResolution(3840, 2160, ex).width * internalResolution(3840, 2160, ex).height).toBeLessThanOrEqual(16_777_216);
  });

  it('internalResolution is total', () => {
    expect(internalResolution(NaN, -1, 2)).toEqual({ width: 0, height: 0 });
    expect(internalResolution(100, 50, NaN)).toEqual({ width: 100, height: 50 });
  });
});
