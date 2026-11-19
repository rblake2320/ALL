/**
 * Master mixing graph (works on any BaseAudioContext):
 *
 *   music(dry) -> vol -> duck -> sting-duck -> radio-duck ─┐
 *   music(wet) -> vol -> duck -> sting-duck -> radio-duck ─┼─> reverb ─┐
 *   sfx   -> vol ─┬────────────────────────────┤          │
 *               └─ send ─> reverb             │          ├─> master -> mute -> compressor -> out
 *   voice -> vol ─┬─ send ─> reverb            │          │
 *   ambient -> vol -> duck -> indoor LP -> thin ─┬─ send ─> reverb
 *   ui    -> vol ────────────────────────────────────────┘
 *
 * The compressor is a gentle glue limiter; the final `safety` waveshaper is transparent below 0.8 and bends
 * smoothly into a 0.98 ceiling, so pile-ups (24 loops + a burst of one-shots + stingers) can never clip the DAC.
 */
import type { AudioVolumes } from './contracts';
import type { BusId } from './sfx/table';
import { reverbIR } from './synth/buffers';
import { filterNode, gainNode, glideParam } from './synth/core';
import { volumeToGain } from './volumes';

export const DUCK_LEVEL = 0.35;
/** Fixed output makeup into the limiter (+4 dB): keeps typical gameplay near -23 dBFS RMS. */
export const MASTER_MAKEUP = 1.6;
export const INDOOR_CUTOFF = 900;
export const OUTDOOR_CUTOFF = 18000;
/** Diegetic music priority: a stereo loop louder than this (spatial gain) starts ducking the score... */
export const RADIO_DUCK_FROM = 0.15;
/** ...down to 1 - depth (≈ -8 dB) when the stereo is right at the camera. */
export const RADIO_DUCK_DEPTH = 0.6;

/** Score gain under the loudest playing stereo (pure). */
export function radioDuckFor(stereoGain: number): number {
  if (!(stereoGain > RADIO_DUCK_FROM)) return 1;
  const k = Math.min(1, (stereoGain - RADIO_DUCK_FROM) / (1 - RADIO_DUCK_FROM));
  return 1 - RADIO_DUCK_DEPTH * k;
}

/** Safety clipper: identity below SAFETY_KNEE, never above SAFETY_CEILING (inputs up to ±SAFETY_RANGE). */
export const SAFETY_KNEE = 0.8;
export const SAFETY_CEILING = 0.98;
export const SAFETY_RANGE = 4;

/** The safety transfer function (pure; exported for tests). C1-continuous at the knee, odd-symmetric. */
export function safetyCurveValue(x: number): number {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 0 : Math.sign(x) * SAFETY_CEILING;
  const a = Math.abs(x);
  if (a <= SAFETY_KNEE) return x;
  const room = SAFETY_CEILING - SAFETY_KNEE;
  return Math.sign(x) * (SAFETY_KNEE + room * Math.tanh((a - SAFETY_KNEE) / room));
}

let safetyCurve: Float32Array | null = null;
/** Curve over the shaper's [-1, 1] domain, fed with input * (1 / SAFETY_RANGE). */
export function safetyCurveTable(): Float32Array {
  if (safetyCurve) return safetyCurve;
  const n = 8193; // odd: exact 0 at the centre; linear region interpolates exactly
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = safetyCurveValue(((i / (n - 1)) * 2 - 1) * SAFETY_RANGE);
  safetyCurve = c;
  return c;
}

export interface MixGraph {
  ctx: BaseAudioContext;
  master: GainNode;
  mute: GainNode;
  comp: DynamicsCompressorNode;
  /** Final peak-safety stage (null if the implementation lacks WaveShaper; the compressor still limits). */
  safety: WaveShaperNode | null;
  /** Where producers connect, per bus. */
  input: Record<BusId, GainNode>;
  /** Music reverb-send input (per-instrument wet signal). */
  musicWet: GainNode;
  reverbIn: GainNode;
  ambientFilter: BiquadFilterNode;
  ambientThin: GainNode;
  setVolumes(v: AudioVolumes): void;
  setDucked(d: boolean): void;
  setMuted(m: boolean): void;
  /** Momentary music dip under a stinger. */
  stingDuck(seconds: number): void;
  /** Score level under a nearby diegetic stereo (1 = none). */
  setRadioDuck(level: number): void;
  setIndoor(indoor: boolean, thin: number): void;
  dispose(): void;
}

export function buildGraph(ctx: BaseAudioContext, dest: AudioNode, volumes: AudioVolumes): MixGraph {
  const g = (v: number) => gainNode(ctx, v);
  const master = g(volumeToGain(volumes.master) * MASTER_MAKEUP);
  const mute = g(1);
  const comp = ctx.createDynamicsCompressor();
  // gentle limiter: only touches peaks of dense moments
  comp.threshold.value = -10;
  comp.knee.value = 10;
  comp.ratio.value = 8;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  master.connect(mute).connect(comp);
  let safety: WaveShaperNode | null = null;
  let safetyIn: GainNode | null = null;
  try {
    safetyIn = g(1 / SAFETY_RANGE);
    safety = ctx.createWaveShaper();
    safety.curve = safetyCurveTable() as Float32Array<ArrayBuffer>;
    safety.oversample = '2x';
    comp.connect(safetyIn).connect(safety).connect(dest);
  } catch {
    // no shaper: fall back to the compressor alone
    safety = null;
    safetyIn = null;
    comp.connect(dest);
  }

  const reverbIn = g(1);
  const reverbOut = g(0.85);
  let convolver: ConvolverNode | null = null;
  try {
    convolver = ctx.createConvolver();
    convolver.buffer = reverbIR(ctx);
    reverbIn.connect(convolver).connect(reverbOut).connect(master);
  } catch {
    convolver = null; // no reverb on hostile implementations; dry mix still works
  }

  const vol: Record<BusId, GainNode> = {
    music: g(volumeToGain(volumes.music)),
    sfx: g(volumeToGain(volumes.sfx)),
    voice: g(volumeToGain(volumes.voice)),
    ambient: g(volumeToGain(volumes.ambient)),
    ui: g(volumeToGain(volumes.ui)),
  };
  const musicWetVol = g(volumeToGain(volumes.music));
  const duckM = g(1);
  const duckMW = g(1);
  const stingM = g(1);
  const stingMW = g(1);
  const radioM = g(1);
  const radioMW = g(1);
  vol.music.connect(duckM).connect(stingM).connect(radioM).connect(master);
  musicWetVol.connect(duckMW).connect(stingMW).connect(radioMW).connect(reverbIn);

  const sfxSend = g(0.12);
  vol.sfx.connect(master);
  vol.sfx.connect(sfxSend).connect(reverbIn);
  const voiceSend = g(0.14);
  vol.voice.connect(master);
  vol.voice.connect(voiceSend).connect(reverbIn);
  vol.ui.connect(master);

  const duckA = g(1);
  const ambientFilter = filterNode(ctx, 'lowpass', OUTDOOR_CUTOFF, 0.6);
  const ambientThin = g(1);
  const ambSend = g(0.3);
  vol.ambient.connect(duckA).connect(ambientFilter).connect(ambientThin).connect(master);
  ambientThin.connect(ambSend).connect(reverbIn);

  const all: AudioNode[] = [master, mute, comp, reverbIn, reverbOut, musicWetVol, duckM, duckMW, stingM, stingMW, radioM, radioMW, sfxSend, voiceSend, duckA, ambientFilter, ambientThin, ambSend, ...Object.values(vol)];
  if (convolver) all.push(convolver);
  if (safety && safetyIn) all.push(safetyIn, safety);

  return {
    ctx,
    master,
    mute,
    comp,
    safety,
    input: vol,
    musicWet: musicWetVol,
    reverbIn,
    ambientFilter,
    ambientThin,
    setVolumes(v) {
      glideParam(ctx, master.gain, volumeToGain(v.master) * MASTER_MAKEUP, 0.04);
      glideParam(ctx, vol.music.gain, volumeToGain(v.music), 0.04);
      glideParam(ctx, musicWetVol.gain, volumeToGain(v.music), 0.04);
      glideParam(ctx, vol.sfx.gain, volumeToGain(v.sfx), 0.04);
      glideParam(ctx, vol.voice.gain, volumeToGain(v.voice), 0.04);
      glideParam(ctx, vol.ambient.gain, volumeToGain(v.ambient), 0.04);
      glideParam(ctx, vol.ui.gain, volumeToGain(v.ui), 0.04);
    },
    setDucked(d) {
      const tc = d ? 0.1 : 0.25;
      const lvl = d ? DUCK_LEVEL : 1;
      glideParam(ctx, duckM.gain, lvl, tc);
      glideParam(ctx, duckMW.gain, lvl, tc);
      glideParam(ctx, duckA.gain, d ? 0.5 : 1, tc);
    },
    setMuted(m) {
      glideParam(ctx, mute.gain, m ? 0 : 1, 0.03);
    },
    stingDuck(seconds) {
      const now = ctx.currentTime;
      for (const p of [stingM.gain, stingMW.gain]) {
        glideParam(ctx, p, 0.45, 0.05);
        try {
          p.setTargetAtTime(1, now + Math.max(0.2, Math.min(4, seconds)), 0.4);
        } catch {
          /* ignore */
        }
      }
    },
    setRadioDuck(level) {
      const l = Math.min(1, Math.max(0.2, Number.isFinite(level) ? level : 1));
      // slow glide: walking the camera past a stereo should feel like a mix move, not a pump
      glideParam(ctx, radioM.gain, l, 0.35);
      glideParam(ctx, radioMW.gain, l, 0.35);
    },
    setIndoor(indoor, thin) {
      glideParam(ctx, ambientFilter.frequency, indoor ? INDOOR_CUTOFF : OUTDOOR_CUTOFF, 0.4);
      glideParam(ctx, ambientThin.gain, (indoor ? 0.75 : 1) * thin, 0.4);
    },
    dispose() {
      for (const n of all) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
    },
  };
}
