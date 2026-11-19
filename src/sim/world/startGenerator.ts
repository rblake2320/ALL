/** W-025 S7. Version 1 is saved-world data: freeze its salts, pools and transforms after release. */
import type { ContentRegistry } from '../contracts';
import type { TemplateResult } from '../spatial/templates/builder';
import { createSpatial } from '../spatial';
import { rotatedSize, type Rot } from '../../shared/dimensions';
import { buildWorldMap, RESIDENTIAL_SLOTS, slotRegionId } from '../../shared/mildewLane';
import { canonicalStartPick, isUsableStartPick } from '../../shared/town';
import { hash32, normalizeSeed, pickStart, type StartGenSpec, type StartPick, type WorldMap } from '../../shared/world';
import { createStartTemplate } from './startTemplates';
import type { BuiltStartLayout, BuiltStartLot } from './startGeometry';
import { admissionWorld, graveyardWalkTiles, validateStartLot, type StartLotValidation } from './startValidation';
import { assignStartNeighbours, START_NEIGHBOUR_POOL_V1 } from '../../shared/startNeighbours';

export type StartBaseType = 'derelict' | 'starter' | 'empty';
export const START_GEN_V1: StartGenSpec = {
  genVersion: 1, pool: [{ templateId: 'derelict', weight: 3 }, { templateId: 'derelict_lean', weight: 1 }, { templateId: 'derelict_lshape', weight: 1 }],
  slots: RESIDENTIAL_SLOTS,
  variation: { buildableInsetMax: 2, shellVariants: 3, terrainVariants: 4, neighbourPool: [...new Set(START_NEIGHBOUR_POOL_V1)] },
  constraints: { requiredReachableTags: ['mailbox', 'coffin'], startingFunds: 2500, maxGraveyardWalkTiles: 140, maxAttempts: 8 },
  fallback: { templateId: 'derelict', slotId: 'mildew_n2' },
};

export interface StartValidation extends StartLotValidation {
  startingFunds: number;
  graveyardWalkTiles: number;
  canonicalValue: number;
  neighbourErrors: string[];
}
export interface GeneratedStart {
  start: StartPick;
  home: TemplateResult;
  map: WorldMap;
  layout: BuiltStartLayout;
  validation: StartValidation;
  fallback: boolean;
  /** Failed candidates are retained, not silently presented as successful first attempts. */
  attempts: { pick: StartPick; errors: string[] }[];
}

/** X mirror and bounded translation of the actual wall/floor/object data. */
export function transformStartTemplate(input: TemplateResult, registry: ContentRegistry, mirrored: boolean, dx = 0, dz = 0): TemplateResult {
  if (typeof mirrored !== 'boolean' || !Number.isInteger(dx) || dx < -3 || dx > 3 || !Number.isInteger(dz) || dz < -2 || dz > 1) throw new Error('Transform outside version-1 bounds');
  const out = structuredClone(input), w = input.lot.width, d = input.lot.depth;
  const edge = (key: string): string => {
    const [kind, xs, zs] = key.split(':'), x = Number(xs), z = Number(zs);
    return `${kind}:${(mirrored ? w - x - (kind === 'h' ? 1 : 0) : x) + dx}:${z + dz}`;
  };
  out.lot.walls = {};
  for (const [key, wall] of Object.entries(input.lot.walls)) out.lot.walls[edge(key)] = {
    ...structuredClone(wall), openingId: null, paint: mirrored && key.startsWith('v:') ? [wall.paint[1], wall.paint[0]] : [...wall.paint],
  };
  out.lot.floors = new Array<string | null>(w * d).fill(null);
  input.lot.floors.forEach((f, i) => {
    const x = (mirrored ? w - 1 - i % w : i % w) + dx, z = Math.floor(i / w) + dz;
    if (f !== null && x >= 0 && x < w && z >= 0 && z < d) out.lot.floors[z * w + x] = f;
  });
  for (const o of out.objects) {
    const p = o.placement;
    if (p.kind === 'floor') {
      const def = registry.objects[o.defId];
      if (!def) throw new Error(`Unknown catalog object: ${o.defId}`);
      const size = rotatedSize(def.footprint.w, def.footprint.d, p.rot);
      p.x = (mirrored ? w - p.x - size.w : p.x) + dx;
      p.rot = mirrored ? ((4 - p.rot) % 4) as Rot : p.rot;
      // Mailbox stays by the public sidewalk; the house may move independently of it.
      if (o.defId !== 'mailbox_crooked') p.z += dz;
    } else if (p.kind === 'opening' || p.kind === 'wall') {
      if (p.kind === 'wall' && mirrored && p.edge.startsWith('v:')) p.side = p.side === 0 ? 1 : 0;
      p.edge = edge(p.edge);
    } else throw new Error('Start templates must contain placed objects only');
  }
  return out;
}

function variedHome(pick: StartPick, registry: ContentRegistry, canonical: boolean): { home: TemplateResult; mirrored: boolean } {
  const original = createStartTemplate(pick.templateId);
  if (canonical) return { home: original, mirrored: false };
  const draw = (salt: number, n: number) => hash32(pick.variantSeed, salt) % n;
  const mirrored = draw(1, 2) === 1;
  const home = transformStartTemplate(original, registry, mirrored, draw(2, 7) - 3, draw(3, 4) - 2);
  home.lot.buildable = { x0: 1 + draw(4, 3), z0: 1 + draw(5, 3), x1: 29 - draw(6, 3), z1: 27 - draw(7, 3) };
  const mailbox = home.objects.find(o => o.defId === 'mailbox_crooked');
  if (mailbox?.placement.kind === 'floor') mailbox.placement.z = home.lot.buildable.z1 - 1;
  // Four bounded terrain palettes: grass, packed dirt, wet mud and autumn leaf litter.
  const palette = draw(8, 4), px = home.lot.buildable.x0 + draw(9, 3), pz = home.lot.buildable.z0 + draw(10, 3);
  const patches = palette === 0 ? [] : palette === 1 ? [[0, 0, 3, 3]] : palette === 2 ? [[0, 0, 2, 5], [3, 3, 2, 2]] : [[0, 0, 2, 2], [3, 2, 2, 2], [1, 5, 2, 2]];
  for (const [ox, oz, pw, pd] of patches) for (let z = pz + oz; z < pz + oz + pd; z++) for (let x = px + ox; x < px + ox + pw; x++) {
    const i = z * home.lot.width + x;
    if (home.lot.floors[i] === null) home.lot.floors[i] = ['floor_dirt_packed', 'floor_dirt_packed', 'floor_mud_yard', 'floor_leaf_litter'][palette];
  }
  // Existing tree costs $250: even one extra breaches the story's 10% value band ($202.80).
  // Keep the actual starting inventory equal; vary its position without manufacturing free resale value.
  const tree = home.objects.find(o => o.defId === 'tree_gnarled');
  if (tree?.placement.kind === 'floor') {
    tree.placement.x = home.lot.buildable.x0 + 1 + draw(11, 3);
    tree.placement.z = home.lot.buildable.z0 + 2 + draw(12, 4);
  }
  // Move the table and its chair together, then coffin/sink independently. A candidate must stay in
  // its original room AND keep all approaches reachable. Invalid jitter leaves the legal position intact.
  const state = admissionWorld(home, registry), S = createSpatial(() => state, registry);
  for (const [i, ids] of [['table_rickety', 'chair_creaky'], ['coffin_pine'], ['sink_rusty']].entries()) {
    const jx = draw(30 + i * 2, 3) - 1, jz = draw(31 + i * 2, 3) - 1;
    if (!jx && !jz) continue;
    const candidate = structuredClone(home);
    let sameRoom = true;
    for (const o of candidate.objects.filter(o => ids.includes(o.defId))) if (o.placement.kind === 'floor') {
      const p = o.placement, room = S.roomAt(p.x, p.z);
      if (!room || S.roomAt(p.x + jx, p.z + jz) !== room) sameRoom = false;
      p.x += jx; p.z += jz;
    }
    if (sameRoom && validateStartLot(candidate, registry).ok) home.objects = candidate.objects;
  }
  return { home, mirrored };
}

function construct(seed: number, base: StartBaseType, pick: StartPick, registry: ContentRegistry, canonical: boolean, fallback: boolean, canonicalValue: number): GeneratedStart {
  const { home, mirrored } = variedHome(pick, registry, canonical);
  const homeId = slotRegionId(pick.slotId);
  const map = buildWorldMap({ seed, genVersion: 1, contentVersion: 1 }, { regionId: homeId, templateId: pick.templateId });
  assignStartNeighbours(map, homeId, pick);
  const neighbours: BuiltStartLot[] = [], neighbourErrors: string[] = [];
  for (const slot of RESIDENTIAL_SLOTS) {
    if (slot === pick.slotId) continue;
    const region = map.regions.find(r => r.id === slotRegionId(slot))!;
    // Furnished neighbour layouts are authored and admitted as-is. Mirroring asymmetrical multi-seat objects
    // is not equivalent to rotating their art/slots, so do not advertise a mirror that was not built.
    const built = createStartTemplate(region.templateId!);
    const result = validateStartLot(built, registry);
    neighbourErrors.push(...result.errors.map(e => `${slot}: ${e}`));
    neighbours.push({ region, ...built, mirrored: false });
  }
  const result = validateStartLot(home, registry, base === 'derelict');
  const walk = base === 'empty' ? 0 : graveyardWalkTiles(home, registry, map, homeId);
  const errors = [...result.errors, ...neighbourErrors];
  if (base === 'derelict' && Math.abs(result.structuralValue - canonicalValue) > canonicalValue * 0.1) errors.push(`Lot value ${result.structuralValue} outside 10% of ${canonicalValue}`);
  if (base !== 'empty' && (!Number.isFinite(walk) || walk > 140)) errors.push(`Graveyard gate walk ${walk} exceeds 140 tiles`);
  const validation: StartValidation = { ...result, errors, ok: errors.length === 0, startingFunds: base === 'derelict' ? 2500 : base === 'starter' ? 6500 : 22000, graveyardWalkTiles: walk, canonicalValue, neighbourErrors };
  return { start: { ...pick }, home, map, layout: { home: { region: map.regions.find(r => r.id === homeId)!, ...home, mirrored }, neighbours, fallback }, validation, fallback, attempts: [] };
}

/** Rebuilding from a saved pick never rolls another candidate. Invalid picks fail closed. */
export function generateStart(seed: number, base: StartBaseType, registry: ContentRegistry, explicitPick?: StartPick): GeneratedStart {
  const normalized = normalizeSeed(seed);
  if (normalized === null || !['derelict', 'starter', 'empty'].includes(base)) throw new Error('Invalid start seed or base type');
  const canonicalValue = validateStartLot(createStartTemplate('derelict'), registry, true).structuralValue;
  if (explicitPick !== undefined) {
    if (!isUsableStartPick(explicitPick) || explicitPick.genVersion !== 1 || explicitPick.attempt > 8) throw new Error('Unsupported or invalid saved StartPick');
    if (base === 'derelict' ? !START_GEN_V1.pool.some(p => p.templateId === explicitPick.templateId) : explicitPick.templateId !== base) throw new Error('Saved StartPick differs from requested base type');
    const canonical = explicitPick.variantSeed === 0 && explicitPick.neighbourSeed === 0;
    const fallback = canonical && explicitPick.attempt === 8;
    if (explicitPick.attempt === 8 && !fallback) throw new Error('Invalid fallback marker');
    if (fallback && (explicitPick.slotId !== 'mildew_n2' || explicitPick.templateId !== base)) throw new Error('Fallback must use the canonical lot and slot');
    const result = construct(normalized, base, explicitPick, registry, canonical, fallback, canonicalValue);
    if (!result.validation.ok) throw new Error(`Saved start failed admission: ${result.validation.errors.join('; ')}`);
    return result;
  }
  const spec: StartGenSpec = { ...START_GEN_V1, pool: base === 'derelict' ? START_GEN_V1.pool : [{ templateId: base, weight: 1 }] };
  const attempts: GeneratedStart['attempts'] = [];
  for (let attempt = 0; attempt < spec.constraints.maxAttempts; attempt++) {
    const pick = pickStart(normalized, spec, attempt)!;
    const result = construct(normalized, base, pick, registry, false, false, canonicalValue);
    attempts.push({ pick, errors: [...result.validation.errors] });
    if (result.validation.ok) return { ...result, attempts };
  }
  const result = construct(normalized, base, { ...canonicalStartPick(base), attempt: 8 }, registry, true, true, canonicalValue);
  if (!result.validation.ok) throw new Error(`Canonical fallback failed admission: ${result.validation.errors.join('; ')}`);
  return { ...result, attempts };
}
