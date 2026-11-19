/**
 * SEATING harness (dev/seating.html): every seat object of the catalog in a row on an empty lot, each sit slot
 * occupied by a zombie posed at the sim's slot pose (same placement path as the game: sim slot → AgentState pos /
 * facing / posY → AgentManager → real character rig). Real model library + real character factory.
 *
 *   npx vite --config dev/render.vite.config.ts --port 5175 --strictPort
 *   http://127.0.0.1:5175/dev/seating.html?body=classic&anim=sit
 *
 * URL: body=classic|<castBodyId> · anim=<sit clip> · height=0..1 (appearance.height, default 0.5) · fit=0 (no running
 * interaction: the renderer's seat fit is skipped, i.e. the raw slot pose) · quality=low|medium|high ·
 * objects=<base url> (another furniture build, e.g. /dev/out/seating/before-assets/).
 * window.__seating: { ready, seats: [{defId, slotId, x, z}], focus(i, yaw, pitch, dist), capture(), rigs() }
 */
import { createRenderer, rendererDebug } from '../src/render/index';
import { createModelLibrary } from '../src/render/models/index';
import { createCharacterFactory } from '../src/render/characters/index';
import type { CharacterFactory, ZombieRig } from '../src/render/contracts';
import { buildSampleWorld, emptyLot } from '../src/render/dev/sampleWorld';
import { createFakeSim } from '../src/render/dev/fakeSim';
import { PHYSICAL_BY_ID } from '../src/shared/catalog';
import { localToWorld, rotYaw, type Rot } from '../src/shared/dimensions';
import { isCastBodyId } from '../src/shared/cast';
import type { AgentState, ObjectState, WorldState } from '../src/sim/types';
import type { AnimState } from '../src/shared/appearance';

const params = new URLSearchParams(location.search);
const body = params.get('body') ?? 'classic';
const anim = (params.get('anim') ?? 'sit') as AnimState;
const height = Number(params.get('height') ?? '0.5');

/** Seat objects in the catalog (every spec with a 'sit' slot), laid out left → right. */
export const SEAT_IDS = Object.values(PHYSICAL_BY_ID)
  .filter((s) => s.slots.some((sl) => sl.kind === 'sit'))
  .map((s) => s.id);

interface SeatInfo { defId: string; slotId: string; x: number; z: number; objX: number; objZ: number; w: number; d: number }

function buildWorld(): { world: WorldState; seats: SeatInfo[] } {
  const world = buildSampleWorld();
  const tpl = world.agents.a1 as AgentState;
  world.objects = {};
  world.agents = {};
  world.household.memberIds = [];
  world.lot = emptyLot();
  for (let i = 0; i < world.lot.floors.length; i++) world.lot.floors[i] = 'floor_parquet';
  const seats: SeatInfo[] = [];
  // diagonal layout: no neighbour sits on any camera line through a seat (front or side profile)
  let x = 1;
  let z = 1;
  let n = 0;
  for (const id of SEAT_IDS) {
    const spec = PHYSICAL_BY_ID[id];
    const rot: Rot = 0;
    const o: ObjectState = {
      id: `o${n}`, defId: id, placement: { kind: 'floor', x, z, rot }, value: spec.price, purchasedTick: 0, tint: null,
      condition: { broken: false, dirt: 0, burning: false, burnMinutes: 0 }, data: {}, reservedBy: {}, inUseBy: [], rev: 1,
    };
    world.objects[o.id] = o;
    spec.slots.forEach((slot, slotIndex) => {
      if (slot.kind !== 'sit' || !slot.pose) return;
      const p = localToWorld(spec.footprint.w, spec.footprint.d, x, z, rot, slot.pose.x, slot.pose.z);
      const facing = rotYaw(rot) + (slot.facing ?? 0);
      const aid = `a${seats.length}`;
      const app = { ...tpl.appearance, height } as typeof tpl.appearance;
      if (isCastBodyId(body)) app.body = body;
      else delete app.body;
      world.agents[aid] = {
        ...JSON.parse(JSON.stringify(tpl)), id: aid, appearance: app, pos: { x: p.x, z: p.z }, prevPos: { x: p.x, z: p.z },
        posY: slot.pose.y, facing, prevFacing: facing, path: null, anim,
        // a running interaction on this slot (what the renderer reads to fit the sitter to the seat)
        active: params.get('fit') === '0' ? null : ({ interactionId: 'sit', target: { kind: 'object', id: o.id }, stageTarget: { kind: 'object', id: o.id }, slot: slotIndex, phase: 'run', stage: 0, data: {} } as unknown as AgentState['active']), carrying: (params.get('carry') as AgentState['carrying']) ?? null, expression: 'neutral',
      };
      world.household.memberIds.push(aid);
      o.inUseBy.push(aid);
      seats.push({ defId: id, slotId: slot.id, x: p.x, z: p.z, objX: x, objZ: z, w: spec.footprint.w, d: spec.footprint.d });
    });
    x += spec.footprint.w + 1;
    z += 3;
    n++;
  }
  return { world, seats };
}

interface Api {
  ready: boolean;
  error: string | null;
  seats: SeatInfo[];
  frames: number;
  /** Continuous rendering (automation turns it off once the rigs are posed: captures render on demand). */
  live: boolean;
  focus(x: number, z: number, yaw: number, pitch: number, dist: number): void;
  capture(): string;
  rigs(): { body: string; wanted: string; kind: string }[];
}
const api: Api = { ready: false, error: null, seats: [], frames: 0, live: true, focus: () => undefined, capture: () => '', rigs: () => [] };
(window as unknown as { __seating: Api }).__seating = api;

async function main(): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const baseUrl = import.meta.env.BASE_URL + 'assets/';
  // objects=<url base> loads another furniture build (before/after sheets: dev/out/seating/before-assets/)
  const models = createModelLibrary({ baseUrl: params.get('objects') ?? baseUrl });
  const characters = createCharacterFactory({ baseUrl }) as CharacterFactory;
  const rigs: ZombieRig[] = [];
  const create = characters.create.bind(characters);
  characters.create = (app, limbs) => {
    const r = create(app, limbs);
    rigs.push(r);
    return r;
  };
  api.rigs = () => rigs.map((r) => {
    const x = r as unknown as { kind?: string; body?: string; wantedBody?: string };
    return { kind: x.kind ?? '?', body: x.body ?? '?', wanted: x.wantedBody ?? '?' };
  });
  const renderer = createRenderer({ models, characters });
  const dbg = rendererDebug(renderer);
  await renderer.init(canvas, { quality: (params.get('quality') as 'low' | 'medium' | 'high') ?? 'medium', pixelRatio: 1 });
  renderer.resize(canvas.clientWidth, canvas.clientHeight);
  const { world, seats } = buildWorld();
  api.seats = seats;
  const sim = createFakeSim(world);
  renderer.attach(sim);
  renderer.setWallMode('down');
  dbg?.debugTime(12 * 60 + 30, 0);
  api.focus = (x, z, yaw, pitch, distance) => renderer.setCamera({ target: { x, z }, yaw, pitch, distance }, true);
  api.capture = () => {
    renderer.frame(1, 1 / 60);
    return canvas.toDataURL('image/png');
  };
  let last = performance.now();
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!api.live) return;
    renderer.frame(1, dt);
    api.frames++;
  };
  requestAnimationFrame(loop);
  api.ready = true;
}

main().catch((e) => {
  api.error = String(e && (e as Error).stack ? (e as Error).stack : e);
  console.error(e);
});
