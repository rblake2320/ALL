/**
 * CLIP-AUDIT scenario matrix, derived from the REAL sim content (engine + home + people modules), so new objects,
 * interactions and socials are audited without touching this file:
 *
 *  slot    every (object def, slot, stage anim, carry, expression) a stage can put a zombie in: 'target' stages on
 *          the object's own slots (stage.target.slots filter), 'nearestTag' stages on every object carrying the tag,
 *          'seat' stages (watch TV, eat, read, listen to music) on every sit slot - plus the dining composite (seat
 *          + table in the seat's front tile, the sim's preferTable pick) for sitEat.
 *  pair    socials (actor anim x target anim / fail anim) at the sim's adjacency spacing: 1.0 m (neighbouring tile
 *          centres) and 0.55 m (runner.arriveHere: the actor stops as soon as it enters a neighbouring tile while
 *          walking up to the target), facing each other.
 *  floor   every ANIM_STATE on open floor (feet / below-floor / self-intersection / carry hold), with the carry the
 *          content gives it.
 */
import { ANIM_STATES, CARRY_ITEMS } from '../../src/shared/appearance';
import type { AnimState, CarryItem, Expression } from '../../src/shared/appearance';
import type { InteractionDef, ObjectDef, StageDef } from '../../src/sim/contracts';
import { engineContent } from '../../src/sim/engine/content';
import { homeContent } from '../../src/sim/content/home';
import { peopleContent } from '../../src/sim/content/people';
import { BEH } from '../../src/sim/content/home/ids';
import { carryFor } from '../../src/sim/engine/objects';
import { PHYSICAL_SPECS, type PhysicalSpec } from '../../src/shared/catalog';

export interface Act {
  anim: AnimState;
  carry: CarryItem | null;
  expression: Expression;
}

export interface Companion {
  objectId: string;
  /** Footprint min corner offset from the main object's origin tile, in the main object's rotation frame. */
  ox: number;
  oz: number;
}

export interface SlotScenario {
  kind: 'slot';
  key: string;
  objectId: string;
  slotIndex: number;
  /** faceObject slots: which approach tile (index into the spec's approach list). */
  approach: number;
  act: Act;
  /** Interactions that produce this scenario (provenance). */
  via: string[];
  companions: Companion[];
}

export interface PairScenario {
  kind: 'pair';
  key: string;
  a: Act;
  b: Act;
  /** Root-to-root distance (m). */
  spacing: number;
  via: string[];
}

export interface FloorScenario {
  kind: 'floor';
  key: string;
  act: Act;
  via: string[];
}

export type Scenario = SlotScenario | PairScenario | FloorScenario;

const MODULES = [engineContent, homeContent, peopleContent];

export function allObjects(): ObjectDef[] {
  const out = new Map<string, ObjectDef>();
  for (const m of MODULES) for (const o of m.objects ?? []) out.set(o.id, o);
  return [...out.values()];
}

export function allInteractions(): Map<string, InteractionDef> {
  const out = new Map<string, InteractionDef>();
  for (const m of MODULES) for (const i of m.interactions ?? []) out.set(i.id, i);
  return out;
}

function stagesOf(ix: InteractionDef): StageDef[] {
  return ix.stages ?? (ix.stage ? [ix.stage] : []);
}

const SPEC = new Map<string, PhysicalSpec>(PHYSICAL_SPECS.map((s) => [s.id, s]));
const SEATED: ReadonlySet<string> = new Set(['sit', 'sitEat', 'sitTalk', 'sitTV', 'sitComputer', 'sitRead', 'sitChess']);

/** Slot indices of `spec` a stage target may use (slot id filter), 'sit' kind for seat stages. */
function slotIndices(spec: PhysicalSpec, ids?: string[], kind?: string): number[] {
  const out: number[] = [];
  spec.slots.forEach((s, i) => {
    if (ids && ids.length && !ids.includes(s.id)) return;
    if (kind && s.kind !== kind) return;
    out.push(i);
  });
  return out;
}

export interface MatrixOptions {
  /** Expand faceObject slots to every approach side (default: front only + one side). */
  allApproaches?: boolean;
}

const PICKUP_BETWEEN_STAGES: ReadonlySet<string> = new Set([BEH.stitch, BEH.throwAway, BEH.putAwayLeftovers, BEH.cleanUp]);
function requiredCarry(ix: InteractionDef): CarryItem | null {
  return ix.behavior === BEH.stitch && (ix.params?.mode === 'self' || ix.params?.mode === 'other') ? 'limb' : null;
}

export function buildMatrix(opts: MatrixOptions = {}): Scenario[] {
  const ixs = allInteractions();
  const objects = allObjects();
  const byTag = new Map<string, ObjectDef[]>();
  for (const o of objects) for (const t of o.tags ?? []) {
    const l = byTag.get(t) ?? [];
    l.push(o);
    byTag.set(t, l);
  }
  const seats = PHYSICAL_SPECS.filter((s) => s.slots.some((x) => x.kind === 'sit'));
  const slotMap = new Map<string, SlotScenario>();
  const addSlot = (objectId: string, slotIndex: number, approach: number, act: Act, via: string, companions: Companion[] = []) => {
    const spec = SPEC.get(objectId);
    if (!spec || !spec.slots[slotIndex]) return;
    // a seated clip off a 'sit' slot never shows: the home behaviours swap it for a standing one (standingAnim /
    // eating.ts 'standEat') as soon as the stage resolves to a non-seat
    if (SEATED.has(act.anim) && spec.slots[slotIndex].kind !== 'sit') return;
    const comp = companions.map((c) => `${c.objectId}@${c.ox},${c.oz}`).join('+');
    const key = `slot:${objectId}#${spec.slots[slotIndex].id}${approach ? `~a${approach}` : ''}:${act.anim}${act.carry ? `+${act.carry}` : ''}${comp ? `|${comp}` : ''}`;
    const prev = slotMap.get(key);
    if (prev) {
      if (!prev.via.includes(via)) prev.via.push(via);
      // keep the first expression (deterministic); posture differences are second order
      return;
    }
    slotMap.set(key, { kind: 'slot', key, objectId, slotIndex, approach, act, via: [via], companions });
  };
  const approachesFor = (spec: PhysicalSpec, i: number): number[] => {
    const s = spec.slots[i];
    if (!(s.faceObject || !s.pose)) return [0];
    if (opts.allApproaches) return s.approach.map((_, k) => k);
    // front (first) + the first side approach (x = -1) when there is one
    const side = s.approach.findIndex((a) => a.x < 0);
    return side > 0 ? [0, side] : [0];
  };
  const floorActs = new Map<string, FloorScenario>();
  const addFloor = (act: Act, via: string) => {
    const key = `floor:${act.anim}${act.carry ? `+${act.carry}` : ''}`;
    const prev = floorActs.get(key);
    if (prev) {
      if (!prev.via.includes(via)) prev.via.push(via);
      return;
    }
    floorActs.set(key, { kind: 'floor', key, act, via: [via] });
  };

  for (const o of objects) {
    const spec = SPEC.get(o.id);
    for (const iid of o.interactions ?? []) {
      const ix = ixs.get(iid);
      if (!ix) continue;
      let carry: CarryItem | null = requiredCarry(ix);
      for (const [stageIndex, st] of stagesOf(ix).entries()) {
        // These behaviours call holdItem(queuedObject) on completion of the grab stage. Its carryFor(tags)
        // survives into the stitching / bin / fridge / sink stage even though that stage has no carry field.
        if (stageIndex > 0 && PICKUP_BETWEEN_STAGES.has(ix.behavior ?? '')) carry = carryFor(o) ?? carry;
        if (st.carry !== undefined) carry = st.carry;
        const act: Act = { anim: st.anim, carry, expression: st.expression ?? 'neutral' };
        const via = `${o.id}/${iid}`;
        const targets = [st.target, ...(st.fallback ? [st.fallback] : [])];
        for (const tg of targets) {
          if (tg.kind === 'target' && spec) {
            for (const i of slotIndices(spec, tg.slots)) for (const a of approachesFor(spec, i)) addSlot(o.id, i, a, act, via);
          } else if (tg.kind === 'nearestTag') {
            for (const t of byTag.get(tg.tag) ?? []) {
              const ts = SPEC.get(t.id);
              if (!ts) continue;
              for (const i of slotIndices(ts, tg.slots)) for (const a of approachesFor(ts, i)) addSlot(t.id, i, a, act, via);
            }
          } else if (tg.kind === 'seat') {
            for (const s of seats) for (const i of slotIndices(s, undefined, 'sit')) addSlot(s.id, i, 0, act, via);
            if (tg.preferTable) addDining(act, via, addSlot);
          } else if (tg.kind === 'here' || tg.kind === 'tileNear') {
            // The content declares a seated stage, but home behaviours replace its animation when no seat resolves.
            // Preserve the carried item: bare standEat/read clips cannot detect a plate/book anchor regression.
            const standing = act.anim === 'sitEat' ? 'standEat' : ix.params?.standingAnim;
            if (!SEATED.has(act.anim)) addFloor(act, tg === st.fallback ? `${via} (fallback)` : via);
            else if (typeof standing === 'string' && (ANIM_STATES as readonly string[]).includes(standing)) {
              addFloor({ ...act, anim: standing as AnimState }, `${via} (standing fallback)`);
            }
          }
        }
      }
    }
  }
  // agent-targeted interactions (embalm / stitch others) and self interactions
  const pairs = new Map<string, PairScenario>();
  for (const ix of ixs.values()) {
    if (ix.targetKind === 'object') continue;
    let carry: CarryItem | null = requiredCarry(ix);
    for (const st of stagesOf(ix)) {
      if (st.carry !== undefined) carry = st.carry;
      const act: Act = { anim: st.anim, carry, expression: st.expression ?? 'neutral' };
      if (st.target.kind === 'nearestTag') {
        for (const t of byTag.get(st.target.tag) ?? []) {
          const ts = SPEC.get(t.id);
          if (!ts) continue;
          for (const i of slotIndices(ts, st.target.slots)) {
            if (ts.slots[i].kind === 'stand') addSlot(t.id, i, 0, act, ix.id);
          }
        }
      } else if (st.target.kind !== 'exit') addFloor(act, ix.id);
    }
    const so = ix.social;
    if (so && ix.targetKind === 'agent') {
      const st = stagesOf(ix)[0];
      if (!st || st.target.kind === 'tileNear') continue;
      const a: Act = { anim: st.anim, carry: null, expression: st.expression ?? 'neutral' };
      for (const tAnim of [so.targetAnim, ...(so.failAnim ? [so.failAnim] : [])]) {
        for (const spacing of [1.0, 0.55]) {
          const key = `pair:${a.anim}~${tAnim}@${spacing}`;
          const prev = pairs.get(key);
          if (prev) {
            if (!prev.via.includes(ix.id)) prev.via.push(ix.id);
            continue;
          }
          pairs.set(key, { kind: 'pair', key, a, b: { anim: tAnim, carry: null, expression: 'neutral' }, spacing, via: [ix.id] });
        }
      }
    }
  }
  // every clip at least once on the floor (the renderer can be asked for any state)
  for (const anim of ANIM_STATES) addFloor({ anim, carry: null, expression: 'neutral' }, 'all-clips');
  // movement.ts changes animation without clearing carrying; runner.ts waits/blocked routes use idle. Every
  // supported carry can survive a route between stages (including a retained held world object). Leg loss selects
  // limp/crawl. These are runtime combinations, not the meaningless cross-product of every clip with every item.
  for (const carry of CARRY_ITEMS) for (const anim of ['walk', 'limp', 'crawl', 'idle'] as const) {
    addFloor({ anim, carry, expression: 'neutral' }, 'engine/movement.ts + runner.ts (retained carry)');
  }
  const out: Scenario[] = [...slotMap.values(), ...pairs.values(), ...floorActs.values()];
  return out.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
}

/** Tables a seat stage with preferTable picks when they stand in the seat's front tile. */
export const DINING_TABLES = ['table_rickety', 'table_wake', 'table_coffinlid', 'table_urnstand'];
const DINING_SEATS = ['chair_creaky', 'chair_ribcage', 'armchair_tattered', 'sofa_moldy', 'sofa_velvet', 'pew_salvaged'];

function addDining(act: Act, via: string, add: (objectId: string, slot: number, approach: number, act: Act, via: string, companions: Companion[]) => void): void {
  for (const seat of DINING_SEATS) {
    const spec = SPEC.get(seat);
    if (!spec) continue;
    // first sit slot; the table's footprint starts in the row in front of the seat (+Z local), under the slot
    const i = spec.slots.findIndex((s) => s.kind === 'sit');
    const s = spec.slots[i];
    if (!s?.pose) continue;
    for (const t of DINING_TABLES) {
      const ts = SPEC.get(t);
      if (!ts) continue;
      const ox = Math.floor(s.pose.x) - (ts.footprint.w > 1 ? Math.floor((ts.footprint.w - 1) / 2) : 0);
      add(seat, i, 0, act, via, [{ objectId: t, ox, oz: spec.footprint.d }]);
    }
  }
}
