/**
 * W-073 clipping gate allow-list: known penetrations the gate accepts, each with its root cause, owner and request.
 * Same pattern as tests/unit/seating (BIG_BACKED / RIGID_CAPE ...): an entry is a documented exception, not a fix.
 *
 * Entries are narrow on purpose: one row per (check, clip, gate body) that measured over the threshold, capped at the
 * measured worst + 10 % + 3 mm (`maxMm`). So a clip / body that is clean today fails the gate the day it starts
 * clipping, and a documented exception that gets worse fails too. Remove the rows of a cause when its owner lands the
 * fix (the measured rows are regenerated with CLIP_GATE_DUMP=1, see docs/audits/clipping-W073.md §Gate).
 * Used by the CI gate (tests/unit/clip-audit/gate*.test.ts) and the CLI exit code (run.ts).
 * Root causes and requests: docs/audits/clipping-W073.md, docs/contract-requests/clipping.md.
 */
import BASELINE from './premiumBaseline.json';
export interface AllowEntry {
  /** Check name ('pen:object', ...) or a prefix ending in '*'. */
  check: string;
  /** Scenario key pattern (tools/clip-audit/scenarios.ts keys). */
  key: RegExp;
  /** Look pattern ('classic@h0.5', ...); omitted = every gate look. */
  look?: RegExp;
  /** Deepest accepted penetration (mm). */
  maxMm: number;
  /** Finding id in docs/audits/clipping-W073.md. */
  finding: string;
  /** Root-cause class: object geometry | slot/anchor data | animation clip | body scale/offset | placement/collision. */
  cause: string;
  owner: string;
  reason: string;
}

interface Cause {
  finding: string;
  cause: string;
  owner: string;
  reason: string;
}

/** Root causes the rows below point at (ids = docs/audits/clipping-W073.md findings). */
export const CAUSES: Record<string, Cause> = {
  social: {
    finding: 'F1b', cause: 'animation clip', owner: 'Astra (clipping.md A13)',
    reason: 'lunging social clips (angry / feral / kiss / hug / dance) reach 0.8–1.0 m ahead on big bodies: more than the render social fit may push partners apart (SOCIAL_PUSH_MAX 0.35 m each); hug arms wrap through the partner',
  },
  work: {
    finding: 'F2b', cause: 'animation clip', owner: 'Astra (clipping.md A7, A8); objects D1 (fridge door)',
    reason: 'floor-mopping clean / deep pickup bend 1.0–1.3 m ahead on wide bodies: more than the render work stand-off (≤ 0.28 m, inside the approach tile) clears; fridge door leaf swings into the user',
  },
  floor: {
    finding: 'F5', cause: 'animation clip / cast retarget', owner: 'Astra (clipping.md A1–A4) + cast-runtime',
    reason: 'crawl drags the feet below the floor, the mourn kneel puts the toes into it, planted feet roll through it, collapse / lying clips sink the trunk on a flat floor',
  },
  self: {
    finding: 'F6', cause: 'animation clip', owner: 'Astra (clipping.md A5, A6)',
    reason: 'hands through the (big cast) head in face-touching gestures; classic forearms hang into the hips in idle / groan; feet cross',
  },
  seat: {
    finding: 'F7', cause: 'animation clip', owner: 'Astra (clipping.md A9–A11, seating.md §4.1) + cast (seating.md §4.3–4.4)',
    reason: 'sit* thigh slope presses the thighs into every cushion; resting forearms inside armrests; head / hands into the PC desk hutch; bear-suit back through the backrest',
  },
  lying: {
    finding: 'F8', cause: 'animation clip / body scale', owner: 'Astra (clipping.md A4) + cast (B3)',
    reason: 'lying / bathing clips: bent knees and hands into coffin / tub / slab sides, big cast heads below the pillow',
  },
  carry: {
    finding: 'F9', cause: 'slot/anchor data (carry anchors)', owner: 'Astra (clipping.md A12) + cast-runtime (B2)',
    reason: 'carry anchors are computed on the classic proportions: book / plate / pizza box / phone end up in the chest, arm or foot of wide cast bodies',
  },
  wall: {
    finding: 'F10', cause: 'body scale / animation clip', owner: 'cast assets (clipping.md B1) + Astra (A7)',
    reason: 'worst case (a zombie working in a 1-tile alcove): wide bodies / floor-bend clips reach past a wall face beside or behind the standing tile',
  },
  static: {
    finding: 'F12', cause: 'object geometry', owner: 'level kits (clipping.md C); objects (D2)',
    reason: 'level-kit models wider than their manifest footprint; armchair back 21 mm over its footprint (inside the 60 mm wall half-thickness; left for the next seating rebuild)',
  },
  door: {
    finding: 'F11', cause: 'body scale / props', owner: 'cast assets (clipping.md B1)',
    reason: 'walking half-width (arms + held props: staff, barbell, suit) wider than the 0.43 m half door opening',
  },
};

/** [cause, check, scenario-key regex source, look regex source ('' = any), maxMm] — generated from the gate dump. */
type Row = [keyof typeof CAUSES, string, string, string, number];
const ROWS: Row[] = [
  // W-111: standing clean beside a raised rest object now stands on the floor (was floating 307–336 mm); the mascot
  // (bear suit) head then reaches 24.5 / 28.8 mm into the lid at the 0.28 m stand-off cap. Measured worst × 1.1 + 3 mm.
  ['work', 'pen:object', '^slot:(coffin_chillrest|sarcophagus_cryo)#lie:clean$', '^mascot@', 35],
  // gate (classic / mascot × every scenario), measured worst × 1.1 + 3 mm
  ['carry', 'pen:item-body', "^floor:phone(\\+|$)", '^mascot@', 41],
  ['carry', 'pen:item-body', "^floor:pickup(\\+|$)", '^mascot@', 46],
  ['carry', 'pen:item-body', "^slot:[^:]+:phone(\\+|\\||$)", '^classic@', 27],
  ['carry', 'pen:item-body', "^slot:[^:]+:phone(\\+|\\||$)", '^mascot@', 41],
  ['carry', 'pen:item-body', "^slot:[^:]+:pickup(\\+|\\||$)", '^mascot@', 78], // W-120 resample (was 37)
  ['carry', 'pen:item-body', "^slot:[^:]+:sitEat(\\+|\\||$)", '^mascot@', 60],
  ['carry', 'pen:item-body', "^slot:[^:]+:sitRead(\\+|\\||$)", '^mascot@', 264],
  ['floor', 'pen:floor', "^floor:bath(\\+|$)", '^classic@', 41],
  ['floor', 'pen:floor', "^floor:beEmbalmed(\\+|$)", '^classic@', 31],
  ['floor', 'pen:floor', "^floor:cheer(\\+|$)", '^mascot@', 57],
  ['floor', 'pen:floor', "^floor:clean(\\+|$)", '^mascot@', 26],
  ['floor', 'pen:floor', "^floor:collapse(\\+|$)", '^classic@', 31],
  ['floor', 'pen:floor', "^floor:crawl(\\+|$)", '^classic@', 235],
  ['floor', 'pen:floor', "^floor:dance(\\+|$)", '^mascot@', 31],
  ['floor', 'pen:floor', "^floor:feral(\\+|$)", '^mascot@', 35],
  ['floor', 'pen:floor', "^floor:flirt(\\+|$)", '^classic@', 42],
  ['floor', 'pen:floor', "^floor:flirt(\\+|$)", '^mascot@', 101],
  ['floor', 'pen:floor', "^floor:hug(\\+|$)", '^mascot@', 49],
  ['floor', 'pen:floor', "^floor:limp(\\+|$)", '^mascot@', 52], // W-120 resample (was 40)
  ['floor', 'pen:floor', "^floor:mourn(\\+|$)", '^classic@', 123],
  ['floor', 'pen:floor', "^floor:mourn(\\+|$)", '^mascot@', 164],
  ['floor', 'pen:floor', "^floor:pickup(\\+|$)", '^classic@', 22],
  ['floor', 'pen:floor', "^floor:pickup(\\+|$)", '^mascot@', 51],
  ['floor', 'pen:floor', "^floor:sleep(\\+|$)", '^classic@', 31],
  ['floor', 'pen:floor', "^floor:stretch(\\+|$)", '^mascot@', 37],
  ['floor', 'pen:floor', "^floor:walk(\\+|$)", '^mascot@', 52], // W-120 resample (was 40)
  ['floor', 'pen:floor', "^floor:yawn(\\+|$)", '^mascot@', 38],
  ['floor', 'pen:floor', "^pair:cheer~", '^mascot@', 57],
  ['floor', 'pen:floor', "^pair:dance~", '^mascot@', 31],
  ['floor', 'pen:floor', "^pair:feral~", '^mascot@', 35],
  ['floor', 'pen:floor', "^pair:flirt~", '^classic@', 42],
  ['floor', 'pen:floor', "^pair:flirt~", '^mascot@', 101],
  ['floor', 'pen:floor', "^pair:hug~", '^mascot@', 49],
  ['floor', 'pen:floor', "^slot:[^:]+:clean(\\+|\\||$)", '^mascot@', 26],
  ['floor', 'pen:floor', "^slot:[^:]+:mourn(\\+|\\||$)", '^classic@', 123],
  ['floor', 'pen:floor', "^slot:[^:]+:mourn(\\+|\\||$)", '^mascot@', 164],
  ['floor', 'pen:floor', "^slot:[^:]+:pickup(\\+|\\||$)", '^classic@', 22],
  ['floor', 'pen:floor', "^slot:[^:]+:pickup(\\+|\\||$)", '^mascot@', 51],
  ['lying', 'pen:object', "^slot:[^:]+:bath(\\+|\\||$)", '^classic@', 32],
  ['lying', 'pen:object', "^slot:[^:]+:bath(\\+|\\||$)", '^mascot@', 25],
  ['lying', 'pen:object', "^slot:[^:]+:beEmbalmed(\\+|\\||$)", '^classic@', 61],
  ['lying', 'pen:object', "^slot:[^:]+:beEmbalmed(\\+|\\||$)", '^mascot@', 92],
  ['lying', 'pen:object', "^slot:[^:]+:sleep(\\+|\\||$)", '^classic@', 77],
  ['lying', 'pen:object', "^slot:[^:]+:sleep(\\+|\\||$)", '^mascot@', 64],
  ['seat', 'pen:object', "^slot:[^:]+:sit(\\+|\\||$)", '^classic@', 57],
  ['seat', 'pen:object', "^slot:[^:]+:sit(\\+|\\||$)", '^mascot@', 122],
  ['seat', 'pen:object', "^slot:[^:]+:sitChess(\\+|\\||$)", '^classic@', 53],
  ['seat', 'pen:object', "^slot:[^:]+:sitChess(\\+|\\||$)", '^mascot@', 48],
  ['seat', 'pen:object', "^slot:[^:]+:sitComputer(\\+|\\||$)", '^classic@', 44],
  ['seat', 'pen:object', "^slot:[^:]+:sitComputer(\\+|\\||$)", '^mascot@', 45],
  ['seat', 'pen:object', "^slot:[^:]+:sitEat(\\+|\\||$)", '^classic@', 91],
  ['seat', 'pen:object', "^slot:[^:]+:sitEat(\\+|\\||$)", '^mascot@', 104],
  ['seat', 'pen:object', "^slot:[^:]+:sitRead(\\+|\\||$)", '^classic@', 53],
  ['seat', 'pen:object', "^slot:[^:]+:sitRead(\\+|\\||$)", '^mascot@', 106],
  ['seat', 'pen:object', "^slot:[^:]+:sitTV(\\+|\\||$)", '^classic@', 109],
  ['seat', 'pen:object', "^slot:[^:]+:sitTV(\\+|\\||$)", '^mascot@', 171],
  ['self', 'pen:self-arm', "^floor:admire(\\+|$)", '^classic@', 66],
  ['self', 'pen:self-arm', "^floor:collapse(\\+|$)", '^classic@', 76],
  ['self', 'pen:self-arm', "^floor:cook(\\+|$)", '^classic@', 61],
  ['self', 'pen:self-arm', "^floor:cry(\\+|$)", '^classic@', 48], // W-120 resample (was 32)
  ['self', 'pen:self-arm', "^floor:flirt(\\+|$)", '^classic@', 23],
  ['self', 'pen:self-arm', "^floor:groan(\\+|$)", '^classic@', 82],
  ['self', 'pen:self-arm', "^floor:idle(\\+|$)", '^classic@', 89],
  ['self', 'pen:self-arm', "^floor:laugh(\\+|$)", '^classic@', 31],
  ['self', 'pen:self-arm', "^floor:pickup(\\+|$)", '^classic@', 36],
  ['self', 'pen:self-arm', "^floor:sit(\\+|$)", '^classic@', 46],
  ['self', 'pen:self-arm', "^floor:sitTV(\\+|$)", '^classic@', 26],
  ['self', 'pen:self-arm', "^floor:sleep(\\+|$)", '^classic@', 48],
  ['self', 'pen:self-arm', "^floor:wave(\\+|$)", '^classic@', 22],
  ['self', 'pen:self-arm', "^floor:yawn(\\+|$)", '^classic@', 30],
  ['self', 'pen:self-leg', "^floor:pickup(\\+|$)", '^classic@', 28],
  ['social', 'pen:partner', "^pair:angry~", '^mascot@', 316],
  ['social', 'pen:partner', "^pair:dance~", '^mascot@', 128], // W-120 resample (was 79)
  ['social', 'pen:partner', "^pair:feral~", '^mascot@', 313],
  ['social', 'pen:partner', "^pair:flirt~", '^mascot@', 39],
  ['social', 'pen:partner', "^pair:hug~", '^classic@', 44],
  ['social', 'pen:partner', "^pair:hug~", '^mascot@', 270],
  ['social', 'pen:partner', "^pair:kiss~", '^classic@', 31],
  ['social', 'pen:partner', "^pair:kiss~", '^mascot@', 203],
  ['wall', 'pen:wall-back', "^slot:[^:]+:admire(\\+|\\||$)", '^mascot@', 217],
  ['wall', 'pen:wall-back', "^slot:[^:]+:mourn(\\+|\\||$)", '^classic@', 42],
  ['wall', 'pen:wall-side', "^slot:[^:]+:admire(\\+|\\||$)", '^mascot@', 341],
  ['wall', 'pen:wall-side', "^slot:[^:]+:clean(\\+|\\||$)", '^mascot@', 400],
  ['wall', 'pen:wall-side', "^slot:[^:]+:cook(\\+|\\||$)", '^mascot@', 325],
  ['wall', 'pen:wall-side', "^slot:[^:]+:embalm(\\+|\\||$)", '^mascot@', 282],
  ['wall', 'pen:wall-side', "^slot:[^:]+:exercise(\\+|\\||$)", '^mascot@', 279],
  ['wall', 'pen:wall-side', "^slot:[^:]+:idle(\\+|\\||$)", '^mascot@', 289],
  ['wall', 'pen:wall-side', "^slot:[^:]+:mourn(\\+|\\||$)", '^mascot@', 268],
  ['wall', 'pen:wall-side', "^slot:[^:]+:paint(\\+|\\||$)", '^mascot@', 311],
  ['wall', 'pen:wall-side', "^slot:[^:]+:phone(\\+|\\||$)", '^mascot@', 305],
  ['wall', 'pen:wall-side', "^slot:[^:]+:pickup(\\+|\\||$)", '^mascot@', 320],
  ['wall', 'pen:wall-side', "^slot:[^:]+:read(\\+|\\||$)", '^mascot@', 294],
  ['wall', 'pen:wall-side', "^slot:[^:]+:shower(\\+|\\||$)", '^mascot@', 339], // W-120 resample (was 256)
  ['wall', 'pen:wall-side', "^slot:[^:]+:standEat(\\+|\\||$)", '^mascot@', 308],
  ['wall', 'pen:wall-side', "^slot:[^:]+:stitch(\\+|\\||$)", '^mascot@', 278],
  ['wall', 'pen:wall-side', "^slot:[^:]+:talk(\\+|\\||$)", '^mascot@', 325],
  ['wall', 'pen:wall-side', "^slot:[^:]+:washHands(\\+|\\||$)", '^mascot@', 274],
  ['work', 'pen:object', "^slot:[^:]+:admire(\\+|\\||$)", '^mascot@', 33],
  ['work', 'pen:object', "^slot:[^:]+:clean(\\+|\\||$)", '^classic@', 44],
  ['work', 'pen:object', "^slot:[^:]+:clean(\\+|\\||$)", '^mascot@', 349],
  ['work', 'pen:object', "^slot:[^:]+:exercise(\\+|\\||$)", '^classic@', 21],
  ['work', 'pen:object', "^slot:[^:]+:exercise(\\+|\\||$)", '^mascot@', 22],
  ['work', 'pen:object', "^slot:[^:]+:pickup(\\+|\\||$)", '^mascot@', 135],
  ['work', 'pen:object', "^slot:[^:]+:read(\\+|\\||$)", '^mascot@', 27],
  ['work', 'pen:object', "^slot:[^:]+:shower(\\+|\\||$)", '^mascot@', 36],
  ['work', 'pen:object', "^slot:[^:]+:standEat(\\+|\\||$)", '^mascot@', 59],
  // W-120: the audit used to read a STOPPED clip's duration (idle, 4 s) and clamp every time past a clip's end, so the
  // gate's late sample showed the loop's first frame on shorter clips. Sampling the clip on screen at the renderer's
  // wrapped time exposed these pre-existing penetrations (same causes; measured worst x 1.1 + 3 mm):
  ['self', 'pen:self-arm', "^floor:shower(\\+|$)", '^classic@', 117],
  ['floor', 'pen:floor', "^floor:collapse(\\+|$)", '^mascot@', 33],
  ['social', 'pen:partner', "^pair:talk~", '^mascot@', 210],
  ['carry', 'pen:item-body', "^slot:[^:]+:pickup(\\+|\\||$)", '^classic@', 75],
  ['carry', 'pen:item-body', "^slot:[^:]+:paint(\\+|\\||$)", '^mascot@', 53],
  // static (tests/unit/clip-audit/gate-static.test.ts): key = object id / body
  ['static', 'static:footprint', '^armchair_tattered$', '', 26],
  ['static', 'static:level-footprint', '^tree_willow$', '', 247],
  ['static', 'static:level-footprint', '^pond_murky$', '', 166],
  ['static', 'static:level-footprint', '^stairs_crypt$', '', 113],
  ['static', 'static:level-footprint', '^board_notice$', '', 54],
  ['static', 'static:level-footprint', '^rack_tools$', '', 25],
  ['static', 'static:level-footprint', '^den_stray_raccoon$', '', 25],
  ['door', 'doorway', '^boss$', '', 625],
  ['door', 'doorway', '^strongman$', '', 665],
  ['door', 'doorway', '^ringmaster$', '', 254],
  ['door', 'doorway', '^fortune$', '', 116],
  ['door', 'doorway', '^mascot$', '', 317],
  ['door', 'doorway', '^tourist$', '', 116],
];

const exact = (value: string): RegExp => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

/** Frozen 12-look gate sweep. Every row is one measured check/scenario/look, with the legacy 10% + 3 mm margin.
 * The two newly covered premium contact checks have NO exception. See premiumBaseline.json and
 * docs/desktop-reports/sol-premium-clip-coverage.md for source, asset hashes, measurements and existing defects.
 */
export const RECORDED_ALLOW: AllowEntry[] = BASELINE.rows.map((row) => {
  const [cause, check, key, look, measured, cap] = row;
  if (typeof cause !== 'string' || !Object.hasOwn(CAUSES, cause) || typeof check !== 'string' || !check.startsWith('pen:') ||
      typeof key !== 'string' || typeof look !== 'string' || typeof measured !== 'number' || !Number.isFinite(measured) || measured <= 15 ||
      typeof cap !== 'number' || cap !== Math.ceil(measured * 1.1 + 3)) throw new Error('invalid recorded clip baseline row');
  return { ...CAUSES[cause], check, key: exact(key), look: exact(look), maxMm: cap,
    reason: `${CAUSES[cause].reason}; observed ${measured} mm at ${BASELINE.assetPin}, exact recorded case (source ${BASELINE.source})` };
});

export const LEGACY_ALLOW: AllowEntry[] = ROWS.map(([c, check, key, look, maxMm]) => ({
  ...CAUSES[c], check, key: new RegExp(key), ...(look ? { look: new RegExp(look) } : {}), maxMm,
}));
// Exact measured cases take precedence over the older clip-level patterns (e.g. bare pickup versus pickup+limb).
export const ALLOW: AllowEntry[] = [...RECORDED_ALLOW, ...LEGACY_ALLOW];

/** The allow-list entry covering `check` on scenario `key` for `look` (depth not considered), or null. */
export function allowFor(check: string, key: string, look: string, list: readonly AllowEntry[] = ALLOW): AllowEntry | null {
  for (const a of list) {
    if (a.check !== check && !(a.check.endsWith('*') && check.startsWith(a.check.slice(0, -1)))) continue;
    if (!a.key.test(key)) continue;
    if (a.look && !a.look.test(look)) continue;
    return a;
  }
  return null;
}

/** Penetration check over the FAIL threshold that no allow-list entry covers (or deeper than its maxMm). */
export interface Unallowed {
  key: string;
  look: string;
  check: string;
  mm: number;
}

/**
 * Every penetration FAIL (pen:* checks, verdict FAIL) in `evals` not covered by the allow-list. Drives the CLI exit
 * code (run.ts matrix / summary exit 1 when non-empty unless --report-only) and mirrors the CI gate's rule.
 */
export function unallowedFails(evals: readonly { key: string; look: string; checks: readonly { name: string; value: number; verdict: string }[] }[], list: readonly AllowEntry[] = ALLOW): Unallowed[] {
  const out: Unallowed[] = [];
  for (const e of evals) {
    for (const c of e.checks) {
      if (c.name.startsWith('error') || !Number.isFinite(c.value)) {
        out.push({ key: e.key, look: e.look, check: c.name, mm: c.value });
        continue;
      }
      if (c.verdict !== 'FAIL' || !c.name.startsWith('pen:')) continue;
      const a = allowFor(c.name, e.key, e.look, list);
      if (a && c.value <= a.maxMm) continue;
      out.push({ key: e.key, look: e.look, check: c.name, mm: c.value });
    }
  }
  return out;
}
