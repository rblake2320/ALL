/**
 * W-073 rest slots (Terra / owner-confirmed defect class of the armchair bug): `slot:sarcophagus_cryo#lie:clean` —
 * repairing a bed / coffin / sarcophagus / desk / tub resolves (home_repair: at.target() without a slot filter) to
 * the object's lie / sit / bath slot, so the zombie stood INSIDE the furniture (260 mm, legs through the sarcophagus).
 * Gameplay path: AgentManager.syncOne -> standingOffset(a.active.stageTarget, a.active.slot) shows it on the slot's
 * first approach tile facing the object; rootPoseFor in the audit composes exactly that.
 *
 *  1. every standing clip the content plays on a posed rest slot, × classic + mascot: no penetration > 15 mm into the
 *     object (NO allow-list) and the root is outside the footprint;
 *  2. every lie slot × every body (classic + 25 cast) × lying clip: after the renderer's lie lift (LIE_FIT, per body
 *     like seatFit) the back (lowest spine / chest vertex) rests on the modelled surface (SlotSpec.lie, checked against
 *     the GLB by the static gate): −30 mm (pressed into the padding) … +20 mm.
 */
import { allowFor } from '../../../tools/clip-audit/allowlist';
import { describe, expect, it } from 'vitest';
import { CAST_BODY_IDS, type BodyId } from '../../../src/shared/cast';
import { OFF_FEET_ANIMS } from '../../../src/render/characters/plan';
import { isPosedRestSlot } from '../../../src/render/agents/reach';
import { evaluate, rootPoseFor, setupFor } from '../../../tools/clip-audit/audit';
import { buildMatrix, type SlotScenario } from '../../../tools/clip-audit/scenarios';
import { slotPose, SPEC_BY_ID } from '../../../tools/clip-audit/objects';
import { poseRig, rigFor, sampleRig } from '../../../tools/clip-audit/rigs';
import { boneOf } from '../../../tools/clip-audit/audit';
import { published } from './gate';

const restScenarios = (): SlotScenario[] =>
  buildMatrix().filter((s): s is SlotScenario => s.kind === 'slot' && !OFF_FEET_ANIMS.has(s.act.anim) && isPosedRestSlot(SPEC_BY_ID.get(s.objectId)!.slots[s.slotIndex]));

describe.skipIf(!published)('rest slots: nobody stands inside a bed, coffin, sarcophagus, desk or tub', () => {
  it('standing clips on rest slots are shown beside the furniture, without penetrating it', async () => {
    const sc = restScenarios();
    expect(sc.map((s) => s.key)).toContain('slot:sarcophagus_cryo#lie:clean');
    const bad: string[] = [];
    for (const body of ['classic', 'mascot'] as BodyId[]) {
      for (const s of sc) {
        const look = { body, height: 0.5 };
        const setup = await setupFor(s, 0);
        const root = rootPoseFor(s, look, slotPose(setup.main.spec, setup.main.frame, s.slotIndex, s.approach), setup.main.frame);
        const f = setup.main.frame;
        const inside = root.x > f.ox && root.x < f.ox + f.w && root.z > f.oz && root.z < f.oz + f.d;
        if (inside) bad.push(`${s.key} ${body}: root inside the footprint`);
        const e = await evaluate(s, look, { times: 2, rot: 0, oneWay: true });
        const pen = e.checks.find((c) => c.name === 'pen:object');
        const ok = pen ? allowFor('pen:object', s.key, `${body}@h0.5`) : null;
        if (pen && pen.value > 15 && !(ok && pen.value <= ok.maxMm)) bad.push(`${s.key} ${body}: ${pen.value} mm (${pen.detail})`);
      }
    }
    expect(bad).toEqual([]);
  }, 900000);

  it('lying backs rest on every lie surface for every body (per-body lie lift)', async () => {
    const lies = buildMatrix().filter((s): s is SlotScenario => s.kind === 'slot' && (s.act.anim === 'sleep' || s.act.anim === 'beEmbalmed'));
    expect(new Set(lies.map((s) => s.objectId)).size).toBeGreaterThanOrEqual(6);
    const bad: string[] = [];
    for (const body of ['classic', ...CAST_BODY_IDS] as BodyId[]) {
      const look = { body, height: 0.5 };
      const lr = await rigFor(look);
      for (const s of lies) {
        const spec = SPEC_BY_ID.get(s.objectId)!;
        const slot = spec.slots[s.slotIndex];
        const frame = { w: spec.footprint.w, d: spec.footprint.d, ox: 10, oz: 10, rot: 0 as const };
        const root = rootPoseFor(s, look, slotPose(spec, frame, s.slotIndex, 0), frame);
        for (const t of [0.5, 2.0]) {
          poseRig(lr, s.act, root, t);
          const m = sampleRig(lr).body;
          const back = m.labels.map((l) => /^(spine|chest)$/.test(boneOf(l)));
          let lo = Infinity;
          for (let i = 0; i < m.pos.length / 3; i++) if (back[m.vLabel[i]] && m.pos[i * 3 + 1] < lo) lo = m.pos[i * 3 + 1];
          const d = lo - slot.lie!.height;
          if (d < -0.03 || d > 0.02) bad.push(`${s.key} ${body}@${t}: back ${(d * 1000).toFixed(0)} mm from the surface`);
        }
      }
    }
    expect(bad).toEqual([]);
  }, 900000);
});
