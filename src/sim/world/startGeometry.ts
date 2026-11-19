/** AC-6: extract signatures from built lot grids, never from random seeds. */
import {
  evaluateStartDiversity, isValidPlacement, placementWorldRect, startGeometrySignature,
  type StartDiversityReport, type StartGeometry, type StartSignature, type WorldRegionDef,
} from '../../shared/world';
import type { LotState, ObjectState } from '../types';

/** Adapter over generator output or a restored region. No save format is introduced here. */
export interface BuiltStartLot {
  region: WorldRegionDef;
  lot: LotState;
  objects: readonly Pick<ObjectState, 'defId' | 'placement'>[];
  /** Actual applied plan mirror, recorded by the builder (not a requested RNG choice). */
  mirrored: boolean;
}

export interface BuiltStartLayout {
  home: BuiltStartLot;
  /** All seven other residential street slots, regardless of active/render tier. */
  neighbours: readonly BuiltStartLot[];
  fallback: boolean;
}

export type StartExtraction =
  | { ok: true; geometry: StartGeometry; signature: StartSignature }
  | { ok: false; reason: string };

const id = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9_-]*$/.test(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function edgeValid(edge: unknown, lot: LotState): edge is string {
  if (typeof edge !== 'string') return false;
  const m = /^(h|v):(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(edge);
  if (!m) return false;
  const x = Number(m[2]), z = Number(m[3]);
  return m[1] === 'h' ? x < lot.width && z <= lot.depth : x <= lot.width && z < lot.depth;
}

function slotOf(b: BuiltStartLot): string | null {
  const parts = b.region.id.split(':');
  return parts.length === 2 && id(parts[0]) && id(parts[1]) ? parts[1] : null;
}

/** Strict structural admission, not a replacement for S7 placement/reachability checks. */
function invalidLot(b: BuiltStartLot | null | undefined): string | null {
  if (!b || !record(b) || !record(b.region) || !record(b.lot)) return 'missing built region/grid';
  const { region: r, lot: l } = b;
  if (typeof r.id !== 'string' || !slotOf(b) || r.kind !== 'lot' || r.lotId !== r.id || r.unfinished) return 'not an open residential slot';
  if (!id(r.templateId) || !id(r.districtId) || typeof b.mirrored !== 'boolean') return 'missing built template/district/mirror metadata';
  if (!isValidPlacement(r.placement) || r.placement.regionId !== r.id) return 'invalid region placement identity';
  if (l.width !== r.placement.width || l.depth !== r.placement.depth) return 'grid differs from region dimensions';
  const rect = l.buildable;
  if (!rect || ![rect.x0, rect.z0, rect.x1, rect.z1].every(Number.isInteger) ||
      rect.x0 < 0 || rect.z0 < 0 || rect.x1 > l.width || rect.z1 > l.depth || rect.x0 >= rect.x1 || rect.z0 >= rect.z1) return 'invalid buildable rectangle';
  if (!Array.isArray(l.floors) || l.floors.length !== l.width * l.depth) return 'incomplete terrain';
  for (let i = 0; i < l.floors.length; i++) if (l.floors[i] !== null && !id(l.floors[i])) return 'invalid or sparse terrain';
  if (!record(l.walls)) return 'missing walls';
  for (const [key, wall] of Object.entries(l.walls)) {
    if (!edgeValid(key, l) || !record(wall) || !Array.isArray(wall.paint) || wall.paint.length !== 2 || !wall.paint.every(id)) return 'invalid wall';
  }
  if (!Array.isArray(b.objects)) return 'missing built objects';
  const occupied = new Set<string>();
  for (const obj of b.objects) {
    if (!obj || !id(obj.defId) || !record(obj.placement)) return 'invalid object';
    const p = obj.placement;
    if (p.kind === 'opening') {
      if (!edgeValid(p.edge, l) || !Object.hasOwn(l.walls, p.edge) || occupied.has(p.edge)) return 'missing wall or duplicate opening';
      occupied.add(p.edge);
    } else if (p.kind === 'wall') {
      if (!edgeValid(p.edge, l) || !Object.hasOwn(l.walls, p.edge) || (p.side !== 0 && p.side !== 1)) return 'invalid wall object';
    } else if (p.kind === 'floor') {
      if (![p.x, p.z, p.rot].every(Number.isInteger) || p.x < 0 || p.z < 0 || p.x >= l.width || p.z >= l.depth || p.rot < 0 || p.rot > 3) return 'invalid floor object';
    } else if (p.kind !== 'loose' && p.kind !== 'held') return 'unknown object placement';
  }
  return null;
}

/** No mutations; missing/unbuilt neighbours are a refusal, never invented from StartPick. */
export function extractStartGeometry(input: BuiltStartLayout | null | undefined): StartExtraction {
  const fail = (reason: string): StartExtraction => ({ ok: false, reason });
  if (!input || typeof input.fallback !== 'boolean' || !Array.isArray(input.neighbours) || input.neighbours.length !== 7) return fail('expected home, seven built neighbours and explicit fallback status');
  const lots = [input.home, ...input.neighbours];
  const seen = new Set<string>();
  for (const lot of lots) {
    const error = invalidLot(lot);
    if (error) return fail(error);
    if (seen.has(lot.region.id)) return fail('duplicate region id');
    seen.add(lot.region.id);
    if (lot.region.districtId !== input.home.region.districtId) return fail('neighbour belongs to another district');
  }
  for (let i = 0; i < lots.length; i++) for (let j = i + 1; j < lots.length; j++) {
    const a = placementWorldRect(lots[i].region.placement)!;
    const b = placementWorldRect(lots[j].region.placement)!;
    if (a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1) return fail('overlapping built regions');
  }
  const h = input.home;
  const geometry: StartGeometry = {
    slotId: slotOf(h)!, rot: h.region.placement.rot,
    buildable: { ...h.lot.buildable },
    shellEdges: Object.keys(h.lot.walls).sort(),
    openings: h.objects.flatMap(o => o.placement.kind === 'opening' ? [`${o.defId}@${o.placement.edge}`] : []).sort(),
    terrain: [...h.lot.floors],
    neighbours: input.neighbours.map(n => `${slotOf(n)}=${n.region.templateId}${n.mirrored ? '~m' : ''}`).sort(),
    fallback: input.fallback,
  };
  const signature = startGeometrySignature(geometry);
  return signature ? { ok: true, geometry, signature } : fail('shared signature contract refused extracted geometry');
}

export interface BuiltStartSample { seed: number; layout: BuiltStartLayout }
export interface BuiltStartAudit {
  pass: boolean;
  coverageErrors: string[];
  extractionErrors: { seed: number; reason: string }[];
  diversity: StartDiversityReport;
  signatures: { seed: number; signature: StartSignature | null }[];
}

/** AC-6's exact seed cohort. Duplicating/omitting seeds cannot inflate the success count. */
export function auditBuiltStarts(samples: readonly BuiltStartSample[]): BuiltStartAudit {
  const coverageErrors: string[] = [];
  const extractionErrors: BuiltStartAudit['extractionErrors'] = [];
  const signatures: BuiltStartAudit['signatures'] = [];
  const seen = new Set<number>();
  if (!Array.isArray(samples) || samples.length !== 50) coverageErrors.push('expected exactly seeds 1..50');
  for (const sample of Array.isArray(samples) ? samples : []) {
    if (!sample || !Number.isInteger(sample.seed) || sample.seed < 1 || sample.seed > 50 || seen.has(sample.seed)) {
      coverageErrors.push('invalid, duplicate or out-of-cohort seed');
      continue;
    }
    seen.add(sample.seed);
    const result = extractStartGeometry(sample.layout);
    if (!result.ok) extractionErrors.push({ seed: sample.seed, reason: result.reason });
    signatures.push({ seed: sample.seed, signature: result.ok ? result.signature : null });
  }
  if (seen.size !== 50) coverageErrors.push('incomplete seed cohort');
  signatures.sort((a, b) => a.seed - b.seed);
  const diversity = evaluateStartDiversity(signatures.map(s => s.signature));
  return { pass: !coverageErrors.length && !extractionErrors.length && diversity.pass, coverageErrors, extractionErrors, diversity, signatures };
}
