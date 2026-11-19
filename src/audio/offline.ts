/**
 * Offline rendering helpers: the exact runtime synthesis rendered into an OfflineAudioContext (or any
 * BaseAudioContext + destination). Used by the dev sound board's objective verification.
 */
import type { MusicMood, SfxId, VoiceEmotion } from '../shared/audioIds';
import { MusicSection } from './music/player';
import { createRng } from './prng';
import { SFX_TABLE, loopFactoryFor } from './sfx/table';
import { reverbIR } from './synth/buffers';
import type { LoopFactory, OneShot, Sx } from './synth/types';
import { planVoice } from './voice/groanish';
import { renderVoice } from './voice/render';

export const OFFLINE_RATE = 44100;
const T0 = 0.02;

function sxOf(ctx: BaseAudioContext, dest: AudioNode, seed: number, vol = 1): Sx {
  return { ctx, out: dest, t: T0, rng: createRng(seed), pitch: 1, vol };
}

/** Render `seconds` of stereo audio produced by `build` into a fresh OfflineAudioContext. */
export async function renderOffline(seconds: number, build: (ctx: BaseAudioContext, dest: AudioNode) => void, sampleRate = OFFLINE_RATE): Promise<AudioBuffer> {
  const len = Math.max(1, Math.ceil(seconds * sampleRate));
  const ctx = new OfflineAudioContext(2, len, sampleRate);
  build(ctx, ctx.destination);
  return ctx.startRendering();
}

export function sfxInto(ctx: BaseAudioContext, dest: AudioNode, id: SfxId, seed = 1): number {
  const def = SFX_TABLE[id];
  return def.play(sxOf(ctx, dest, seed, def.trim ?? 1)) + T0;
}

export function recipeInto(ctx: BaseAudioContext, dest: AudioNode, recipe: OneShot, seed = 1): number {
  return recipe(sxOf(ctx, dest, seed)) + T0;
}

/** Run a loop for `seconds` with the same windowed scheduling the engine uses, then stop it. */
export function loopInto(ctx: BaseAudioContext, dest: AudioNode, id: SfxId, seconds: number, seed = 1): void {
  factoryInto(ctx, dest, loopFactoryFor(SFX_TABLE[id]), SFX_TABLE[id].trim ?? 1, seconds, seed);
}

/** Same as loopInto for any loop factory (internal ambience beds) with an explicit output trim. */
export function factoryInto(ctx: BaseAudioContext, dest: AudioNode, factory: LoopFactory, trimGain: number, seconds: number, seed = 1): void {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, 0);
  g.gain.linearRampToValueAtTime(1, 0.25);
  g.gain.setValueAtTime(1, Math.max(0.3, seconds - 0.4));
  g.gain.linearRampToValueAtTime(0, seconds - 0.05);
  const trim = ctx.createGain();
  trim.gain.value = trimGain;
  g.connect(trim).connect(dest);
  const voice = factory(sxOf(ctx, g, seed));
  for (let t = T0; t < seconds; t += 0.1) voice.schedule?.(t, Math.min(seconds, t + 0.2));
  voice.stop(seconds);
}

export function voiceInto(ctx: BaseAudioContext, dest: AudioNode, seed: number, pitch: number, emotion: VoiceEmotion, ms: number, variant = 0): number {
  const plan = planVoice(seed, pitch, emotion, ms, variant);
  return renderVoice(sxOf(ctx, dest, seed), plan, 1).end;
}

/** A music cue with its reverb send, scheduled up-front for `seconds`. */
export function musicInto(ctx: BaseAudioContext, dest: AudioNode, mood: MusicMood, seconds: number): MusicSection {
  const wet = ctx.createGain();
  const conv = ctx.createConvolver();
  conv.buffer = reverbIR(ctx);
  const ret = ctx.createGain();
  ret.gain.value = 0.85;
  wet.connect(conv).connect(ret).connect(dest);
  const section = new MusicSection(ctx, dest, wet, mood, 0, 0, () => 1);
  section.pump(0, seconds);
  return section;
}
