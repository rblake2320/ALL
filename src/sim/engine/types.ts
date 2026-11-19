/** Internal engine wiring types (not part of the public contract). */
import type {
  BuildService,
  ContentRegistry,
  EffectHandler,
  InteractionBehavior,
  RequirementCheck,
  Rng,
  SimContext,
  SimEvent,
  SimSystem,
  SpatialAPI,
  TimeInfo,
} from '../contracts';
import type { AgentState, WorldState } from '../types';
import type { EngineRegistry } from './registry';
import type { RegionRegistry } from './regions';

export interface FaultRecord {
  tick: number;
  where: string;
  message: string;
}

export interface SystemEntry {
  sys: SimSystem;
  failures: number;
  disabled: boolean;
}

export type ConditionFn = (ctx: SimContext, agent: AgentState | null, params: Record<string, any>) => boolean;

export type SpatialFactory = (getState: () => WorldState, content: ContentRegistry) => SpatialAPI;
export type BuildFactory = (ctx: SimContext) => BuildService;

export interface EngineDeps {
  spatialFactory: SpatialFactory;
  buildFactory: BuildFactory;
}

export interface Engine {
  state: WorldState;
  content: EngineRegistry;
  systems: SystemEntry[];
  /**
   * Spatial service of the region IN SCOPE (an accessor, W-025 S1: see regions.ts). The home scope — the only one a
   * home-only world ever has — returns the original home service, so every existing call site is unchanged.
   */
  spatial: SpatialAPI;
  /** W-025 S1: per-region services (home + active regions) and the current region scope. */
  regions: RegionRegistry;
  /** W-025 S3: builds the spatial services of non-home regions (regionSetup.ts). */
  spatialFactory?: SpatialFactory;
  build: BuildService;
  ctx: SimContext;
  rng: Rng;
  time: TimeInfo;
  events: SimEvent[];
  faults: FaultRecord[];
  effects: Record<string, EffectHandler>;
  requirements: Record<string, RequirementCheck>;
  behaviors: Record<string, InteractionBehavior>;
  conditions: Record<string, ConditionFn>;
  /** Run uids currently inside finishRun (re-entrancy guard so end() runs exactly once). */
  finishing: Set<number>;
  /** Run uid -> failure reason requested by an effect (e.g. spend "Can't afford", effect threw). */
  pendingFail: Map<number, string>;
  /** Idempotency key prefix for spend/earn effects executed by the runner (null outside runner effects). */
  effectKey: string | null;
  /** Uid of the run whose effects are executing (removeObject does not fail that run). */
  currentRunUid: number | null;
  /** W-124: the agent whose per-tick update is running (null outside it) — lets spend() see a job run's hooks. */
  actingAgentId?: string | null;
  /** Per-tick cache of system mood modifiers. */
  moodModCache: Map<string, { tick: number; parts: { label: string; value: number }[] }>;
  /** SimSystem.onEvent delivery queue while observers run (null = idle); nested emits are queued, never recursive. */
  observing?: SimEvent[] | null;
}
