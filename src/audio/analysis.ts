/**
 * Pure signal analysis used by the offline verification (dev board / Playwright) and unit tests:
 * peak, RMS, non-silent span, DC offset, clipping, NaN count, spectral centroid, band energies, spectrogram.
 */

export interface SignalStats {
  sampleRate: number;
  length: number;
  duration: number;
  peak: number;
  peakDb: number;
  rms: number;
  rmsDb: number;
  /** RMS over the non-silent span only. */
  activeRmsDb: number;
  /** Seconds where the 10 ms envelope exceeds the silence threshold. */
  activeStart: number;
  activeEnd: number;
  activeDuration: number;
  /** Max |mean| over channels. */
  dcOffset: number;
  /** Samples with |x| >= 0.999. */
  clipCount: number;
  nanCount: number;
  /** Energy-weighted spectral centroid (Hz) over the active span. */
  spectralCentroid: number;
  /** Normalised log-spaced band energies (sum = 1). */
  bands: number[];
  crestDb: number;
}

export const SILENCE_DB = -60;
export const BAND_COUNT = 24;
const BAND_LO = 40;
const BAND_HI = 16000;

export function toDb(x: number): number {
  return x > 1e-12 ? 20 * Math.log10(x) : -240;
}

/** In-place iterative radix-2 FFT. Length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n <= 1 || (n & (n - 1)) !== 0 || im.length !== n) return;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

/** Mono mixdown with NaN replaced by 0 (NaNs are counted separately). */
export function mixdown(channels: readonly Float32Array[]): Float32Array {
  const len = channels.reduce((m, c) => Math.max(m, c.length), 0);
  const out = new Float32Array(len);
  if (channels.length === 0) return out;
  const inv = 1 / channels.length;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i];
      if (v === v) out[i] += v * inv;
    }
  }
  return out;
}

export function bandEdges(count = BAND_COUNT, lo = BAND_LO, hi = BAND_HI): number[] {
  const edges: number[] = [];
  const r = Math.log(hi / lo);
  for (let i = 0; i <= count; i++) edges.push(lo * Math.exp((r * i) / count));
  return edges;
}

export function analyzeChannels(channels: readonly Float32Array[], sampleRate: number): SignalStats {
  const sr = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
  const length = channels.reduce((m, c) => Math.max(m, c.length), 0);
  let peak = 0;
  let sumSq = 0;
  let nan = 0;
  let clip = 0;
  let dc = 0;
  for (const ch of channels) {
    let sum = 0;
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i];
      if (v !== v || !Number.isFinite(v)) {
        nan++;
        continue;
      }
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
      if (a >= 0.999) clip++;
      sumSq += v * v;
      sum += v;
    }
    if (ch.length > 0) dc = Math.max(dc, Math.abs(sum / ch.length));
  }
  const totalSamples = Math.max(1, channels.reduce((s, c) => s + c.length, 0));
  const rms = Math.sqrt(sumSq / totalSamples);

  // 10 ms RMS envelope on the mono mix -> active span
  const mono = mixdown(channels);
  const win = Math.max(1, Math.round(sr * 0.01));
  const thresh = Math.pow(10, SILENCE_DB / 20);
  let first = -1;
  let last = -1;
  let activeSq = 0;
  let activeN = 0;
  for (let w = 0; w * win < mono.length; w++) {
    let s = 0;
    const a = w * win;
    const b = Math.min(mono.length, a + win);
    for (let i = a; i < b; i++) s += mono[i] * mono[i];
    const r = Math.sqrt(s / Math.max(1, b - a));
    if (r > thresh) {
      if (first < 0) first = a;
      last = b;
    }
  }
  if (first >= 0) {
    for (let i = first; i < last; i++) {
      activeSq += mono[i] * mono[i];
      activeN++;
    }
  }
  const activeRms = activeN > 0 ? Math.sqrt(activeSq / activeN) : 0;

  const { centroid, bands } = spectralSummary(mono, sr, first < 0 ? 0 : first, last < 0 ? 0 : last);

  return {
    sampleRate: sr,
    length,
    duration: length / sr,
    peak,
    peakDb: toDb(peak),
    rms,
    rmsDb: toDb(rms),
    activeRmsDb: toDb(activeRms),
    activeStart: first < 0 ? 0 : first / sr,
    activeEnd: last < 0 ? 0 : last / sr,
    activeDuration: first < 0 ? 0 : (last - first) / sr,
    dcOffset: dc,
    clipCount: clip,
    nanCount: nan,
    spectralCentroid: centroid,
    bands,
    crestDb: activeRms > 0 ? toDb(peak) - toDb(activeRms) : 0,
  };
}

/** Energy-weighted centroid and log-band energy distribution over [from, to) samples. */
export function spectralSummary(mono: Float32Array, sr: number, from: number, to: number): { centroid: number; bands: number[] } {
  const N = 2048;
  const hop = 1024;
  const w = hann(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const edges = bandEdges();
  const bandE = new Float64Array(BAND_COUNT);
  let num = 0;
  let den = 0;
  const start = Math.max(0, Math.min(from, mono.length));
  const end = Math.max(start, Math.min(to, mono.length));
  const binHz = sr / N;
  for (let pos = start; pos < end || pos === start; pos += hop) {
    for (let i = 0; i < N; i++) {
      const j = pos + i;
      re[i] = j < end ? mono[j] * w[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const e = re[k] * re[k] + im[k] * im[k];
      const f = k * binHz;
      num += f * e;
      den += e;
      if (f >= BAND_LO && f < BAND_HI) {
        // binary search would be overkill for 24 bands
        let b = 0;
        while (b < BAND_COUNT - 1 && f >= edges[b + 1]) b++;
        bandE[b] += e;
      }
    }
    if (end - start <= 0) break;
  }
  let total = 0;
  for (let i = 0; i < BAND_COUNT; i++) total += bandE[i];
  const bands = Array.from(bandE, (e) => (total > 0 ? e / total : 0));
  return { centroid: den > 0 ? num / den : 0, bands };
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / Math.sqrt(na * nb);
}

export interface Spectrogram {
  frames: number;
  bins: number;
  fMin: number;
  fMax: number;
  /** frames * bins, dB (row-major by frame). */
  db: Float32Array;
}

/** Log-frequency spectrogram (dB) for visual sanity checks. */
export function spectrogram(mono: Float32Array, sr: number, opts: { fftSize?: number; hop?: number; bins?: number; fMin?: number; fMax?: number } = {}): Spectrogram {
  const N = opts.fftSize ?? 1024;
  const hop = opts.hop ?? 256;
  const bins = opts.bins ?? 128;
  const fMin = opts.fMin ?? 40;
  const fMax = Math.min(opts.fMax ?? 16000, sr / 2);
  const frames = Math.max(1, Math.ceil(mono.length / hop));
  const db = new Float32Array(frames * bins);
  const w = hann(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const binHz = sr / N;
  const ratio = Math.log(fMax / fMin);
  for (let f = 0; f < frames; f++) {
    const pos = f * hop - N / 2;
    for (let i = 0; i < N; i++) {
      const j = pos + i;
      re[i] = j >= 0 && j < mono.length ? mono[j] * w[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < bins; b++) {
      const f0 = fMin * Math.exp((ratio * b) / bins);
      const f1 = fMin * Math.exp((ratio * (b + 1)) / bins);
      const k0 = Math.max(1, Math.floor(f0 / binHz));
      const k1 = Math.max(k0 + 1, Math.ceil(f1 / binHz));
      let e = 0;
      for (let k = k0; k < k1 && k < N / 2; k++) e += re[k] * re[k] + im[k] * im[k];
      e /= k1 - k0;
      db[f * bins + b] = 10 * Math.log10(e / ((N / 4) * (N / 4)) + 1e-12);
    }
  }
  return { frames, bins, fMin, fMax, db };
}

/**
 * Loudness-fluctuation rate: the power-weighted mean frequency (Hz) of a signal's RMS envelope (sampled at
 * `envRate` Hz, mean removed, DC bin excluded). Slow gusts / swells read well below 1 Hz, tremolo or flutter
 * reads at its rate. A listen-proxy for "does the wind gust or warble?".
 */
export function modulationCentroid(mono: Float32Array, sampleRate: number, envRate = 20, maxHz = 8): number {
  const sr = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
  const win = Math.max(1, Math.round(sr / Math.max(1, envRate)));
  const frames = Math.floor(mono.length / win);
  if (frames < 8) return 0;
  const env = new Float64Array(frames);
  let mean = 0;
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = f * win; i < (f + 1) * win; i++) {
      const v = mono[i];
      if (v === v) s += v * v;
    }
    env[f] = Math.sqrt(s / win);
    mean += env[f];
  }
  mean /= frames;
  if (!(mean > 1e-9)) return 0;
  for (let f = 0; f < frames; f++) env[f] = (env[f] - mean) / mean;
  const rate = sr / win;
  const kMax = Math.min(Math.floor(frames / 2), Math.floor((maxHz * frames) / rate));
  let num = 0;
  let den = 0;
  for (let k = 1; k <= kMax; k++) {
    let re = 0;
    let im = 0;
    const w = (-2 * Math.PI * k) / frames;
    for (let f = 0; f < frames; f++) {
      re += env[f] * Math.cos(w * f);
      im += env[f] * Math.sin(w * f);
    }
    const p = re * re + im * im;
    num += p * ((k * rate) / frames);
    den += p;
  }
  return den > 0 ? num / den : 0;
}

/**
 * Envelope fluctuation split by timescale: the 50 ms RMS envelope (normalised by its mean) is separated into a
 * ±0.5 s moving average (`slowStd`: gusts, swells) and the residual (`fastStd`: flutter/tremolo plus the
 * inherent envelope jitter of filtered noise). More robust than a modulation centroid for noise beds, whose
 * own envelope jitter is broadband.
 */
export function envelopeFluctuation(mono: Float32Array, sampleRate: number): { slowStd: number; fastStd: number } {
  const sr = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
  const win = Math.max(1, Math.round(sr * 0.05));
  const n = Math.floor(mono.length / win);
  if (n < 21) return { slowStd: 0, fastStd: 0 };
  const e = new Float64Array(n);
  let mean = 0;
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * win; i < (f + 1) * win; i++) {
      const v = mono[i];
      if (v === v) s += v * v;
    }
    e[f] = Math.sqrt(s / win);
    mean += e[f];
  }
  mean /= n;
  if (!(mean > 1e-9)) return { slowStd: 0, fastStd: 0 };
  const half = 10;
  const slow = new Float64Array(n);
  let slowMean = 0;
  for (let f = 0; f < n; f++) {
    let a = 0;
    let c = 0;
    for (let k = Math.max(0, f - half); k <= Math.min(n - 1, f + half); k++) {
      a += e[k] / mean;
      c++;
    }
    slow[f] = a / c;
    slowMean += slow[f];
  }
  slowMean /= n;
  let vs = 0;
  let vf = 0;
  for (let f = 0; f < n; f++) {
    vs += (slow[f] - slowMean) ** 2;
    vf += (e[f] / mean - slow[f]) ** 2;
  }
  return { slowStd: Math.sqrt(vs / n), fastStd: Math.sqrt(vf / n) };
}
