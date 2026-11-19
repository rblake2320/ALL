/** Small lookups for the S3 tests (real content, real spatial service). */
import type { Engine } from '../../../src/sim/engine/types';
import type { ObjectState } from '../../../src/sim/types';
import { floorBlocks, footprintOf, isDoor, specOf } from '../../../src/sim/spatial/defs';
import { objectRegion, spatialOfRegion } from '../../../src/sim/engine/regions';

/** A shipped 1×1 floor object that blocks its tile (furniture / a crate: "a portal blocked by a placed object"). */
export function blockingDef(eng: Engine): string {
  const ids = Object.keys(eng.content.objects).sort();
  for (const id of ids) {
    const s = specOf(eng.content, id);
    const d = eng.content.objects[id] as unknown as { placement?: string };
    if (!s || (d.placement !== undefined && d.placement !== 'floor')) continue;
    const fp = footprintOf(s);
    if (fp.w === 1 && fp.d === 1 && floorBlocks(s)) return id;
  }
  throw new Error('no 1x1 blocking floor object in the shipped content');
}

/** First indoor walkable tile (resident mask) of a region, in row-major order. */
export function indoorTile(eng: Engine, regionId: string): { x: number; z: number } {
  const sp = spatialOfRegion(eng, regionId)!;
  for (let z = 0; z < sp.depth(); z++) for (let x = 0; x < sp.width(); x++) if (sp.isIndoor(x, z) && sp.isWalkable(x, z)) return { x, z };
  throw new Error(`no indoor tile in ${regionId}`);
}

/** A door of the region's house: an opening object whose def is a door and that has an indoor side. */
export function frontDoor(eng: Engine, regionId: string): ObjectState {
  const sp = spatialOfRegion(eng, regionId)!;
  const doors = Object.values(eng.state.objects)
    .filter((o) => objectRegion(eng, o) === regionId && o.placement.kind === 'opening' && isDoor(specOf(eng.content, o.defId)))
    .filter((o) => {
      const m = /^([hv]):(\d+):(\d+)$/.exec((o.placement as { edge: string }).edge)!;
      const x = Number(m[2]);
      const z = Number(m[3]);
      const sides = m[1] === 'h' ? [[x, z - 1], [x, z]] : [[x - 1, z], [x, z]];
      const indoor = sides.filter(([sx, sz]) => sp.isIndoor(sx, sz)).length;
      return indoor === 1;
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (doors.length === 0) throw new Error(`no exterior door in ${regionId}`);
  return doors[0];
}
