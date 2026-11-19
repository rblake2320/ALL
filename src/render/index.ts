/**
 * RENDER module entry point (docs/CONTRACTS.md factory table).
 *
 *   createRenderer({ models, characters }) → RendererAPI
 *
 * The asset libraries are injected so the renderer can run against the real GLB libraries
 * (src/render/models, src/render/characters) or the dev placeholders (src/render/dev/placeholders).
 */
import type { CharacterFactory, ModelLibrary, RendererAPI } from './contracts';
import { Renderer, type RendererDebug, type RenderStats } from './renderer';
import type { PetLibrary } from './pets';
import type { WildlifeLibrary } from './wildlife';

export type { RendererDebug, RenderStats };

export function createRenderer(deps: { models: ModelLibrary; characters: CharacterFactory; pets?: PetLibrary; wildlife?: WildlifeLibrary; assetBaseUrl?: string }): RendererAPI {
  if (!deps || !deps.models || !deps.characters) throw new Error('createRenderer: models and characters are required');
  return new Renderer(deps);
}

/** Narrow a RendererAPI to the debug/perf interface when it is ours. */
export function rendererDebug(r: RendererAPI): RendererDebug | null {
  return r instanceof Renderer ? r : null;
}
