/**
 * AUDIO module entry. createAudio() returns a fully procedural WebAudio engine (no sample files) that is
 * a total no-op when WebAudio is unavailable or locked.
 */
import type { AudioAPI } from './contracts';
import { AudioEngine, type AudioEngineOptions } from './engine';

export type { AudioAPI, AudioVolumes, SpatialHint } from './contracts';
export { AudioEngine, type AudioEngineOptions, type AudioStats } from './engine';
export { DEFAULT_VOLUMES } from './volumes';

export function createAudio(options?: AudioEngineOptions): AudioAPI {
  return new AudioEngine(options);
}
