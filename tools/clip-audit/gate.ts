/** Shared coverage and verdict rules for the gate and its recorded baseline. No renderer or sim substitutions. */
import { PREMIUM_BODY_IDS } from '../../src/shared/premiumBodies';
import { buildMatrix, type Scenario } from './scenarios';
import type { Look } from './rigs';
import { allowFor, type AllowEntry, ALLOW } from './allowlist';
import type { Evaluation } from './audit';
import { THRESHOLDS } from './thresholds';

export const GATE_LOOKS: Look[] = [
  { body: 'classic', height: 0.5 },
  { body: 'mascot', height: 0.5 },
  ...PREMIUM_BODY_IDS.flatMap((body): Look[] => [
    { body, height: 0.5, detail: 'high' }, { body, height: 0.5, detail: 'low' },
  ]),
];
export const GATE_OPTIONS = { times: 2, rot: 0, oneWay: true } as const;
export type GatePart = 'slotsA' | 'slotsB' | 'social' | 'floor';
export const GATE_PARTS: GatePart[] = ['slotsA', 'slotsB', 'social', 'floor'];

export function gateScenarios(part: GatePart): Scenario[] {
  const all = buildMatrix();
  const slots = all.filter((s) => s.kind === 'slot' && (s.companions.length === 0 || s.companions[0].objectId === 'table_rickety'));
  if (part === 'slotsA') return slots.filter((_, i) => i % 2 === 0);
  if (part === 'slotsB') return slots.filter((_, i) => i % 2 === 1);
  return all.filter((s) => s.kind === (part === 'social' ? 'pair' : 'floor'));
}

export interface GateFailure { key: string; look: string; check: string; mm: number; detail: string }

/** Invalid measurements and explicit evaluation errors cannot be admitted by a numerical baseline. */
export function judgeEvaluation(e: Evaluation, list: readonly AllowEntry[] = ALLOW): { failures: GateFailure[]; allowed: GateFailure[] } {
  const failures: GateFailure[] = [], allowed: GateFailure[] = [];
  if (!e.checks.length || !e.times.length || e.times.some((t) => !Number.isFinite(t) || t < 0)) {
    failures.push({ key: e.key, look: e.look, check: 'error', mm: 0, detail: 'empty measurement' });
  }
  for (const c of e.checks) {
    const invalid = c.name.startsWith('error') || !Number.isFinite(c.value) || !Number.isFinite(c.t) || c.t < 0 || !e.times.includes(c.t);
    // These newly protected premium standing contact cases must stay in the hand as well as outside the body.
    const contact = c.name === 'gap:hand-item' && ['floor:standEat+plate', 'floor:read+book'].includes(e.key) &&
      /^(sexton|lowside|waitress|patient|fisherman)@/.test(e.look);
    const excessive = contact ? c.value > THRESHOLDS.handItemFailMm : c.name.startsWith('pen:') && c.value > THRESHOLDS.penFailMm;
    if (!invalid && !excessive) continue;
    const f = { key: e.key, look: e.look, check: c.name, mm: c.value, detail: c.detail };
    const a = invalid || contact ? null : allowFor(c.name, e.key, e.look, list);
    (a && c.value <= a.maxMm ? allowed : failures).push(f);
  }
  return { failures, allowed };
}
