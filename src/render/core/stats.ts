/**
 * Renderer introspection types for the dev harness, perf overlay and profiling scripts (not part of the game
 * contract): per-frame counters and the debug hooks the Renderer class exposes beyond RendererAPI.
 */
import type * as THREE from 'three';
import type { QualityLevel } from '../contracts';

export interface RenderStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  /** Cumulative WebGLRenderer.compile calls issued by material warm-up. */
  precompileCalls: number;
  /** Cumulative synchronous duration of material warm-up compile calls, in milliseconds. */
  precompileMs: number;
  objects: number;
  agents: number;
  /** Zombies outside the view frustum this frame (skipped by both passes). */
  agentsCulled: number;
  /** Lot chunk meshes (merged furniture). */
  chunks: number;
  particles: number;
  lampsLit: number;
  lampLights: number;
  wallSegments: number;
  quality: QualityLevel;
  pixelRatio: number;
  contextLost: boolean;
  thumbnailsPending: number;
  /** W-025 S5: scene rebuilds (attach / lot resize / world switch). A walk across regions never adds one (AC-2). */
  sceneRebuilds?: number;
  /** W-025 S5: world view counters (null without a scene). */
  world?: import('../world/worldView').WorldViewStats | null;
  /**
   * Frames rendered since init (monotonic). Test hook (W-115): the e2e harness budgets its waits in rendered frames,
   * not wall-clock time, so a software-rendered CI runner at a fraction of a frame per second is not mistaken for a
   * dropped input.
   */
  frames: number;
  /** Duration of the last rendered frame's renderer work in ms (0 before the first frame). */
  lastFrameMs: number;
  /** Wall cutaway heights have reached the current wall mode's targets (no height animation pending). */
  wallsSettled: boolean;
  /** W-136: the perspective in effect, the zombie it is attached to, and whether that zombie's body is hidden. */
  perspective: 'overview' | 'shoulder' | 'firstPerson';
  perspectiveAgent: string | null;
  perspectiveBodyHidden: boolean;
  /** Wall mode as drawn (first person draws every wall up whatever the player's wall view). */
  drawnWallMode: 'up' | 'cutaway' | 'down';
  /** Camera position, the point it looks at and its vertical field of view, as last applied. */
  viewPose: { x: number; y: number; z: number; lx: number; ly: number; lz: number; fovDeg: number };
}

/** Extra introspection used by the dev harness / perf overlay (not part of the game contract). */
export interface RendererDebug {
  stats(): RenderStats;
  scene(): THREE.Scene | null;
  /** The main camera and WebGL renderer (dev tools: picking ground truth, profilers). */
  camera(): THREE.PerspectiveCamera;
  webgl(): THREE.WebGLRenderer | null;
  /** A/B switches for the draw-call optimisations (profiling only; objects are rebuilt). */
  debugPerf(opts: { batching?: boolean; chunking?: boolean; cullAgents?: boolean }): void;
  /** Force a specific minute-of-day (null = follow the sim) — screenshots / art iteration. */
  debugTime(minuteOfDay: number | null, fullMoon?: number): void;
}
