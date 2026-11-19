/**
 * AUDIO CONTRACT — fully procedural (WebAudio synthesis; no sample files) so every sound is original IP.
 * Must be robust when AudioContext is unavailable (tests, locked-down browsers): every method becomes a no-op.
 */
import type { SfxId, VoiceEmotion, MusicMood } from '../shared/audioIds';

export interface AudioVolumes {
  master: number; // 0..1
  music: number;
  sfx: number;
  voice: number;
  ambient: number;
  ui: number;
}

export interface SpatialHint {
  /** -1 (left) .. 1 (right) */
  pan: number;
  /** 0..1 distance attenuation already applied by caller */
  gain: number;
}

export interface AudioAPI {
  /** Must be called from a user gesture (autoplay policy). Idempotent. */
  unlock(): Promise<void>;
  readonly unlocked: boolean;
  setVolumes(v: Partial<AudioVolumes>): void;
  getVolumes(): AudioVolumes;
  /** Mute everything (window hidden / pause menu) without losing volume settings. */
  setMuted(muted: boolean): void;
  /** Duck music/ambient for dialogs. */
  setDucked(ducked: boolean): void;
  sfx(id: SfxId, opts?: { spatial?: SpatialHint; pitch?: number; volume?: number }): void;
  /** Start/stop a looping sound identified by `key` (e.g. `shower:o12`). Re-calling with on=true just updates spatial. */
  loop(key: string, id: SfxId, on: boolean, spatial?: SpatialHint): void;
  stopAllLoops(): void;
  /** Zombie gibberish ("Groanish"). `seed` gives a stable timbre per zombie; pitch 0..1 from appearance.voicePitch. */
  voice(seed: number, pitch: number, emotion: VoiceEmotion, durationMs: number, spatial?: SpatialHint): void;
  /** Adaptive procedural music; crossfades between moods. 'none' fades out. */
  music(mood: MusicMood | 'none'): void;
  /** Speed index 0..4 (see SPEED_MINUTES_PER_SECOND in src/sim/types.ts). >= 3 mutes footsteps; 4 thins ambience. */
  setGameSpeed(speed: number): void;
  /** Ambient bed: day birds/wind vs night crickets/owls; indoor muffling; `moon` = full-moon night layer (optional). */
  setAmbience(opts: { night: boolean; indoor: boolean; rain?: boolean; moon?: boolean }): void;
  /** Optional diagnostics snapshot (context state, active voices, loops, music mood, dropped events, errors). */
  stats?(): Readonly<Record<string, string | number | boolean>>;
  dispose(): void;
}
