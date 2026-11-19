import { describe, expect, it } from 'vitest';
import { analyzeChannels, cosineSimilarity, envelopeFluctuation, fft, modulationCentroid, spectrogram, toDb } from '../../../src/audio/analysis';

const SR = 22050;

function sine(freq: number, seconds: number, amp = 0.5, offset = 0): Float32Array {
  const n = Math.round(SR * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR) + offset;
  return out;
}

describe('analysis', () => {
  it('fft finds a pure tone bin', () => {
    const N = 1024;
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = Math.cos((2 * Math.PI * 64 * i) / N);
    fft(re, im);
    let best = 0;
    for (let k = 1; k < N / 2; k++) if (Math.hypot(re[k], im[k]) > Math.hypot(re[best], im[best])) best = k;
    expect(best).toBe(64);
    // non power-of-two is ignored rather than throwing
    expect(() => fft(new Float64Array(10), new Float64Array(10))).not.toThrow();
  });

  it('measures a sine: peak, rms, centroid, duration', () => {
    const s = analyzeChannels([sine(1000, 1, 0.5)], SR);
    expect(s.peak).toBeCloseTo(0.5, 2);
    expect(s.rms).toBeCloseTo(0.5 / Math.SQRT2, 2);
    expect(Math.abs(s.spectralCentroid - 1000)).toBeLessThan(60);
    expect(s.activeDuration).toBeGreaterThan(0.95);
    expect(s.clipCount).toBe(0);
    expect(s.nanCount).toBe(0);
    expect(s.dcOffset).toBeLessThan(0.01);
    const sum = s.bands.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it('detects silence, DC, clipping and NaN', () => {
    const silent = analyzeChannels([new Float32Array(SR)], SR);
    expect(silent.peak).toBe(0);
    expect(silent.activeDuration).toBe(0);
    expect(silent.peakDb).toBe(-240);

    const dc = analyzeChannels([sine(200, 0.5, 0.2, 0.3)], SR);
    expect(dc.dcOffset).toBeCloseTo(0.3, 2);

    const clipped = sine(300, 0.2, 1.4).map((v) => Math.max(-1, Math.min(1, v)));
    expect(analyzeChannels([clipped], SR).clipCount).toBeGreaterThan(100);

    const bad = sine(300, 0.2, 0.5);
    bad[10] = NaN;
    bad[11] = Infinity;
    const st = analyzeChannels([bad], SR);
    expect(st.nanCount).toBe(2);
    expect(Number.isFinite(st.rms)).toBe(true);
  });

  it('finds the non-silent span inside padding', () => {
    const buf = new Float32Array(SR * 2);
    buf.set(sine(500, 0.5, 0.3), SR / 2);
    const s = analyzeChannels([buf, buf], SR);
    expect(s.activeStart).toBeGreaterThan(0.45);
    expect(s.activeStart).toBeLessThan(0.55);
    expect(s.activeDuration).toBeGreaterThan(0.45);
    expect(s.activeDuration).toBeLessThan(0.56);
  });

  it('distinguishes low vs high spectra', () => {
    const lo = analyzeChannels([sine(120, 0.5)], SR);
    const hi = analyzeChannels([sine(5000, 0.5)], SR);
    expect(cosineSimilarity(lo.bands, hi.bands)).toBeLessThan(0.1);
    expect(cosineSimilarity(lo.bands, lo.bands)).toBeCloseTo(1, 6);
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('handles empty input and bad sample rates', () => {
    const s = analyzeChannels([], NaN);
    expect(s.length).toBe(0);
    expect(s.sampleRate).toBe(44100);
    expect(Number.isFinite(s.spectralCentroid)).toBe(true);
  });

  it('spectrogram has the right shape and a ridge at the tone', () => {
    const sg = spectrogram(sine(2000, 0.5), SR, { bins: 64, fftSize: 512, hop: 256 });
    expect(sg.bins).toBe(64);
    expect(sg.db.length).toBe(sg.frames * sg.bins);
    const mid = Math.floor(sg.frames / 2);
    let best = 0;
    for (let b = 1; b < sg.bins; b++) if (sg.db[mid * sg.bins + b] > sg.db[mid * sg.bins + best]) best = b;
    const f = sg.fMin * Math.exp((Math.log(sg.fMax / sg.fMin) * (best + 0.5)) / sg.bins);
    expect(f).toBeGreaterThan(1600);
    expect(f).toBeLessThan(2500);
    for (const v of sg.db) expect(Number.isFinite(v)).toBe(true);
  });

  it('toDb floors at -240 for silence', () => {
    expect(toDb(0)).toBe(-240);
    expect(toDb(1)).toBe(0);
  });
});

describe('modulationCentroid (gust vs flutter listen-proxy)', () => {
  const sr = 8000;
  function amNoise(seconds: number, amHz: number, depth = 0.8, seed = 1): Float32Array {
    const n = Math.round(seconds * sr);
    const x = new Float32Array(n);
    let s = seed;
    for (let i = 0; i < n; i++) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      const w = (s / 4294967296) * 2 - 1;
      x[i] = w * (1 + depth * Math.sin((2 * Math.PI * amHz * i) / sr));
    }
    return x;
  }

  it('reads the AM rate of noise (slow swells vs fast flutter)', () => {
    expect(modulationCentroid(amNoise(16, 0.5), sr)).toBeLessThan(0.9);
    expect(modulationCentroid(amNoise(16, 0.5), sr)).toBeGreaterThan(0.25);
    const fast = modulationCentroid(amNoise(16, 4.8), sr);
    expect(fast).toBeGreaterThan(3.8);
    expect(fast).toBeLessThan(5.8);
  });

  it('is total on silence, short and junk input', () => {
    expect(modulationCentroid(new Float32Array(0), sr)).toBe(0);
    expect(modulationCentroid(new Float32Array(100), sr)).toBe(0);
    expect(modulationCentroid(new Float32Array(sr * 4), sr)).toBe(0);
    const nan = amNoise(4, 1);
    nan[100] = NaN;
    expect(Number.isFinite(modulationCentroid(nan, NaN))).toBe(true);
  });
});

describe('envelopeFluctuation (gust vs flutter split by timescale)', () => {
  const sr = 8000;
  function amNoise(seconds: number, amHz: number, depth: number, seed = 3): Float32Array {
    const n = Math.round(seconds * sr);
    const x = new Float32Array(n);
    let s = seed;
    for (let i = 0; i < n; i++) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      x[i] = ((s / 4294967296) * 2 - 1) * (1 + depth * Math.sin((2 * Math.PI * amHz * i) / sr));
    }
    return x;
  }

  it('slow swells land in slowStd, fast tremolo in fastStd', () => {
    const slow = envelopeFluctuation(amNoise(20, 0.25, 0.6), sr);
    const fast = envelopeFluctuation(amNoise(20, 5, 0.6), sr);
    expect(slow.slowStd).toBeGreaterThan(0.3);
    expect(slow.fastStd).toBeLessThan(0.15);
    expect(fast.fastStd).toBeGreaterThan(0.3);
    expect(fast.slowStd).toBeLessThan(0.1);
  });

  it('is total on short, silent and NaN input', () => {
    expect(envelopeFluctuation(new Float32Array(10), sr)).toEqual({ slowStd: 0, fastStd: 0 });
    expect(envelopeFluctuation(new Float32Array(sr * 5), sr)).toEqual({ slowStd: 0, fastStd: 0 });
    const x = amNoise(4, 1, 0.5);
    x[7] = NaN;
    const r = envelopeFluctuation(x, -1);
    expect(Number.isFinite(r.slowStd) && Number.isFinite(r.fastStd)).toBe(true);
  });
});
