/**
 * SIM-SPATIAL public entry point (see docs/CONTRACTS.md "Factory entry points").
 *
 *  createSpatial(getState, content): SpatialAPI        — geometry service (walkability, rooms, paths, slots, placement)
 *  createBuildService(ctx): BuildService                — build/buy commands with exact undo/redo
 *  createLotTemplate(id) / LOT_TEMPLATE_INFO            — 'starter' (Fixer-Upper on Mildew Lane) / 'empty'
 *  edgeKey, parseEdge, edgeBetween, edgeSides, rectEdges, wallLocalToWorld, openingFrame (+ normalizeEdge, wallRot,
 *  edgeMidpoint, linkOpenings, worldFacing)
 *
 * Conventions are documented at the top of each source file:
 *  edges.ts (edge keys, sides, crossings, wall-item & opening frames), geometry.ts (rotation, footprints, facings),
 *  grid.ts (walkability, wall codes, step rules), rooms.ts, pathfinding.ts, slots.ts, environment.ts, placement.ts,
 *  build/plan.ts (costs & limits), build/service.ts (undo/redo semantics), build/carry.ts (items riding on moved
 *  surfaces, releasing users), build/tx.ts (snapshots), build/verify.ts (restore checks), templates/index.ts (layouts).
 */
export { createSpatial, type SpatialService, type SpatialDebug, type SpatialFault } from './spatial';
export { createBuildService } from './build/service';
export type { BuildContext } from './build/context';
export { createLotTemplate, LOT_TEMPLATE_INFO, linkOpenings, type TemplateObject, type TemplateResult } from './templates';
export {
  edgeKey,
  parseEdge,
  normalizeEdge,
  edgeBetween,
  edgeSides,
  rectEdges,
  wallRot,
  wallLocalToWorld,
  openingFrame,
  edgeMidpoint,
  type EdgeKind,
  type ParsedEdge,
} from './edges';
export { worldFacing } from './geometry';
export { MAX_EDGES_PER_OP, MAX_TILES_PER_OP, DEFAULT_ROOM_FLOOR, BUILD_REASONS } from './build/plan';
export { REASONS as PLACEMENT_REASONS } from './placement';
