/** Narrow temporal guard: the ordinary gate's 8%/92% samples miss the pickup rise (0.65–0.85 s). */
import { lookName, SEL } from './audit';
import { GATE_LOOKS } from './gate';
import { makeSolid, penetration } from './detect';
import { poseRig, rigFor, sampleRig } from './rigs';
import { buildMatrix } from './scenarios';
import type { CarryItem } from '../../src/shared/appearance';

export const PICKUP_RISE_TIMES = Array.from({ length: 13 }, (_, i) => +(0.65 + i / 60).toFixed(6));
export interface RiseRow { look: string; carry: CarryItem; mm: number; at: number; samples: number; detail: string }
export function pickupCarries(): CarryItem[] {
  const carries = buildMatrix().flatMap((s) => {
    const act = s.kind === 'pair' ? s.a : s.act;
    return act.anim === 'pickup' && act.carry ? [act.carry] : [];
  });
  return [...new Set(carries)].sort();
}
export async function pickupRise(): Promise<RiseRow[]> {
  const rows: RiseRow[] = [];
  for (const look of GATE_LOOKS) for (const carry of pickupCarries()) {
    const lr = await rigFor(look);
    let mm = 0, at = PICKUP_RISE_TIMES[0], detail = '-';
    for (const t of PICKUP_RISE_TIMES) {
      poseRig(lr, { anim: 'pickup', carry }, { x: 10, y: 0, z: 10, facing: 0 }, t);
      const sample = sampleRig(lr);
      if (!sample.item) throw new Error(`pickup rise: carried item absent at ${t}: ${lookName(look)} ${carry}`);
      const p = penetration(makeSolid(sample.body), makeSolid(sample.item), { aFilter: (label) => !SEL.holding(label) });
      if (!Number.isFinite(p.maxDepthMm)) throw new Error(`invalid pickup rise measurement ${lookName(look)} ${carry}`);
      if (p.maxDepthMm > mm) { mm = p.maxDepthMm; at = t; detail = p.worstPart ?? '-'; }
    }
    rows.push({ look: lookName(look), carry, mm, at, samples: PICKUP_RISE_TIMES.length, detail });
    await new Promise<void>((r) => setImmediate(r));
  }
  return rows;
}
