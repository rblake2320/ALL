/**
 * Pure appearance / limb / animation planning for the zombie rig (no three.js).
 * Everything here is total: unknown strings, NaN and out-of-range values fall back to safe defaults.
 */
import {
  ACCESSORIES, ANIM_STATES, BOTTOM_STYLES, CARRY_ITEMS, EXPRESSIONS, EXTRA_ANIM_FALLBACK, EXTRA_ANIM_STATES,
  EXTRA_ONE_SHOT_STATES, EYE_STYLES, HAIR_STYLES, LIMB_IDS, TOP_STYLES, defaultAppearance, intactLimbs, isExtraAnimState,
} from '../../shared/appearance';
import type {
  Accessory, AnimState, AnyAnimState, BottomStyle, CarryItem, Expression, ExtraAnimState, EyeStyle, HairStyle,
  LimbCondition, LimbId, LimbState, TopStyle, ZombieAppearance,
} from '../../shared/appearance';
import { DIM } from '../../shared/dimensions';
import { isCastBodyId, normalizeBody } from '../../shared/cast';
import type { BodyId } from '../../shared/cast';
import { clamp01, finiteOr, isHexColor, skinToneIndex } from './colors';
import { BUILD_GAIN, STITCH_HIDE_MORPHS, accessoryNode, bottomNodes, eyesNode, hairNode, topNodes } from './names';

function pick<T extends string>(v: unknown, list: readonly T[], fallback: T): T {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Return a fully valid appearance (invalid fields replaced by defaultAppearance() values). */
export function sanitizeAppearance(input: unknown): ZombieAppearance {
  const d = defaultAppearance();
  const a = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof ZombieAppearance, unknown>>;
  const out: ZombieAppearance = {
    height: clamp01(finiteOr(a.height, d.height)),
    build: clamp01(finiteOr(a.build, d.build)),
    skinTone: skinToneIndex(finiteOr(a.skinTone, d.skinTone)),
    hairStyle: pick<HairStyle>(a.hairStyle, HAIR_STYLES, d.hairStyle),
    hairColor: isHexColor(a.hairColor) ? a.hairColor : d.hairColor,
    topStyle: pick<TopStyle>(a.topStyle, TOP_STYLES, d.topStyle),
    topColor: isHexColor(a.topColor) ? a.topColor : d.topColor,
    bottomStyle: pick<BottomStyle>(a.bottomStyle, BOTTOM_STYLES, d.bottomStyle),
    bottomColor: isHexColor(a.bottomColor) ? a.bottomColor : d.bottomColor,
    shoeColor: isHexColor(a.shoeColor) ? a.shoeColor : d.shoeColor,
    eyeStyle: pick<EyeStyle>(a.eyeStyle, EYE_STYLES, d.eyeStyle),
    eyeColor: isHexColor(a.eyeColor) ? a.eyeColor : d.eyeColor,
    accessory: pick<Accessory>(a.accessory, ACCESSORIES, d.accessory),
    stitches: typeof a.stitches === 'boolean' ? a.stitches : d.stitches,
    voicePitch: clamp01(finiteOr(a.voicePitch, d.voicePitch)),
  };
  // cast body: only known ids survive ('classic' / unknown / missing -> absent = procedural body)
  if (isCastBodyId(a.body)) out.body = a.body;
  return out;
}

/** The body a (sanitised or raw) appearance asks for: a cast id, or 'classic'. */
export function bodyOf(app: unknown): BodyId {
  return normalizeBody(app && typeof app === 'object' ? (app as { body?: unknown }).body : undefined);
}

const LIMB_CONDITIONS: readonly LimbCondition[] = ['ok', 'missing', 'prosthetic'];

export function sanitizeLimbs(input: unknown): LimbState {
  const out = intactLimbs();
  const l = (input && typeof input === 'object' ? input : {}) as Partial<Record<LimbId, unknown>>;
  for (const id of LIMB_IDS) out[id] = pick<LimbCondition>(l[id], LIMB_CONDITIONS, 'ok');
  return out;
}

export function sanitizeAnim(v: unknown): AnimState {
  return pick<AnimState>(v, ANIM_STATES, 'idle');
}

const ANY_ANIM_STATES: readonly AnyAnimState[] = [...ANIM_STATES, ...EXTRA_ANIM_STATES];

/** Like sanitizeAnim but also admits EXTRA_ANIM_STATES (W-056); anything else reads as 'idle'. */
export function sanitizeAnyAnim(v: unknown): AnyAnimState {
  return pick<AnyAnimState>(v, ANY_ANIM_STATES, 'idle');
}

/** Clip-availability predicate of a loaded animation set (zombie.glb, or a cast body's baked + shared clips). */
export type ClipAvailability = (name: string) => boolean;
const NO_EXTRA_CLIPS: ClipAvailability = () => false;

/**
 * The state that actually plays for a requested state (W-056): core states as-is; an extra state when the loaded
 * clip set has it, else its EXTRA_ANIM_FALLBACK core state. Unknown input reads as 'idle'.
 */
export function effectiveAnim(stateIn: unknown, has: ClipAvailability = NO_EXTRA_CLIPS): AnyAnimState {
  const state = sanitizeAnyAnim(stateIn);
  if (!isExtraAnimState(state)) return state;
  let ok = false;
  try {
    ok = has(state) === true;
  } catch {
    ok = false; // a broken lookup never breaks the rig: play the fallback
  }
  return ok ? state : EXTRA_ANIM_FALLBACK[state];
}

export function sanitizeExpression(v: unknown): Expression {
  return pick<Expression>(v, EXPRESSIONS, 'neutral');
}

export function sanitizeCarry(v: unknown): CarryItem | null {
  return typeof v === 'string' && (CARRY_ITEMS as readonly string[]).includes(v) ? (v as CarryItem) : null;
}

/** Skin parts fully covered by each top (safe to hide: saves draw calls, no gaps). */
export const TOP_COVERS: Record<TopStyle, { armUpper: boolean; armLower: boolean; torso: boolean }> = {
  tee: { armUpper: false, armLower: false, torso: true },
  hoodie: { armUpper: true, armLower: true, torso: true },
  suit: { armUpper: true, armLower: true, torso: true },
  blouse: { armUpper: true, armLower: false, torso: true },
  dress: { armUpper: false, armLower: false, torso: true },
  tatters: { armUpper: false, armLower: false, torso: false },
  cardigan: { armUpper: true, armLower: true, torso: true },
};

export const BOTTOM_COVERS: Record<BottomStyle, { legUpper: boolean; legLower: boolean }> = {
  pants: { legUpper: true, legLower: true },
  shorts: { legUpper: false, legLower: false },
  skirt: { legUpper: true, legLower: true },
};

/** Hair styles that a beanie fully hides. */
export const BEANIE_HIDES: ReadonlySet<HairStyle> = new Set<HairStyle>(['afro', 'mohawk', 'bun']);

export interface VisibilityPlan {
  /** Node names that must be visible; every other variant node is hidden. */
  visible: Set<string>;
  /** Morph influences for the Stitches mesh (1 = collapse seams of that limb). */
  stitchMorphs: Record<string, number>;
}

/** Appearance + limbs -> which mesh nodes are visible. */
export function visibilityPlan(appIn: unknown, limbsIn: unknown): VisibilityPlan {
  const app = sanitizeAppearance(appIn);
  const limbs = sanitizeLimbs(limbsIn);
  const vis = new Set<string>(['Head', eyesNode(app.eyeStyle)]);
  const hair = hairNode(app.hairStyle);
  if (hair && !(app.accessory === 'beanie' && BEANIE_HIDES.has(app.hairStyle))) vis.add(hair);
  const acc = accessoryNode(app.accessory);
  if (acc) vis.add(acc);
  if (app.stitches) vis.add('Stitches');
  const tc = TOP_COVERS[app.topStyle];
  const bc = BOTTOM_COVERS[app.bottomStyle];
  const dress = app.topStyle === 'dress';
  const [topBody, sleeveL, sleeveR] = topNodes(app.topStyle);
  const [waist, legL, legR] = bottomNodes(app.bottomStyle);
  if (!tc.torso) vis.add('Torso');
  vis.add(topBody);
  if (!dress) vis.add(waist);
  for (const s of ['L', 'R'] as const) {
    const arm = limbs[s === 'L' ? 'armL' : 'armR'];
    if (arm !== 'missing') vis.add(s === 'L' ? sleeveL : sleeveR);
    if (arm === 'ok') {
      if (!tc.armUpper) vis.add(`ArmUpper_${s}`);
      if (!tc.armLower) vis.add(`ArmLower_${s}`);
      vis.add(`Hand_${s}`);
    } else if (arm === 'missing') vis.add(`Stump_Arm${s}`);
    else vis.add(`Prosthetic_Arm${s}`);
    const leg = limbs[s === 'L' ? 'legL' : 'legR'];
    if (leg !== 'missing' && !(dress && app.bottomStyle === 'shorts')) vis.add(s === 'L' ? legL : legR);
    if (leg === 'ok') {
      if (!bc.legUpper) vis.add(`LegUpper_${s}`);
      if (!bc.legLower) vis.add(`LegLower_${s}`);
      vis.add(`Shoe_${s}`);
    } else if (leg === 'missing') vis.add(`Stump_Leg${s}`);
    else vis.add(`Prosthetic_Leg${s}`);
  }
  const stitchMorphs: Record<string, number> = {};
  for (const id of ['armL', 'armR', 'legL', 'legR'] as const) {
    stitchMorphs[STITCH_HIDE_MORPHS[id]] = limbs[id] === 'ok' ? 0 : 1;
  }
  return { visible: vis, stitchMorphs };
}

/** Overall rig scale for appearance.height (0..1 -> 0.88..1.08). */
export function heightScale(height: unknown): number {
  return 0.88 + 0.2 * clamp01(finiteOr(height, 0.5));
}

/**
 * Scale of a cast body for appearance.height (0..1 -> 0.94..1.06): +-6 % around the body's own sculpted height
 * (cast bodies are normalised to CastBodyDef.height in the GLB, so 0.5 = exactly as designed).
 */
export function castHeightScale(height: unknown): number {
  return 0.94 + 0.12 * clamp01(finiteOr(height, 0.5));
}

/** Width factor for appearance.build (0..1 -> 0.9..1.15). */
export function buildWidth(build: unknown): number {
  return 0.9 + 0.25 * clamp01(finiteOr(build, 0.4));
}

/** Influence of the 'build' morph (delta = +BUILD_GAIN width at 1; negative influences slim down). */
export function buildInfluence(build: unknown): number {
  return (buildWidth(build) - 1) / BUILD_GAIN;
}

// ───────────────────────────── animation planning ─────────────────────────────

// Classification of the EXTRA_ANIM_STATES clips (W-056) from their authoring source and contact table
// (tools/blender/characters/W051.md on desktop/astra-anim). Only consulted when the extra clip itself plays;
// while it is missing, the core fallback state is classified instead.
/** Core + extra one-shots (hold their last frame); every other clip loops. */
export const ONE_SHOT_ANIMS: ReadonlySet<AnyAnimState> = new Set<AnyAnimState>([
  'pickup', 'collapse', 'yawn', ...EXTRA_ONE_SHOT_STATES,
]);
/** In-place locomotion cycles: their time scale follows the measured walk speed. 'chase' is an in-place jog. */
export const LOCOMOTION_ANIMS: ReadonlySet<AnyAnimState> = new Set<AnyAnimState>(['walk', 'limp', 'crawl', 'chase']);
/** Extra clips seated at the .46 m chair seat (W051.md contact table). */
export const EXTRA_SEATED_ANIMS: ReadonlySet<ExtraAnimState> = new Set<ExtraAnimState>(['drive', 'row', 'playKeys']);
/**
 * Clips whose pelvis is anchored to SEAT_HEIGHT (height scaling must not move the seat; cast bodies retarget their
 * pelvis with the seat rule). Core sit* clips plus EXTRA_SEATED_ANIMS.
 */
export const SEATED_ANIMS: ReadonlySet<AnyAnimState> = new Set<AnyAnimState>([
  'sit', 'sitEat', 'sitTalk', 'sitTV', 'sitComputer', 'sitRead', 'sitChess', ...EXTRA_SEATED_ANIMS,
]);
/**
 * Seat contact height (m above the rig origin) of every clip whose pelvis rests on a seat: SEAT_HEIGHT for
 * SEATED_ANIMS, plus the higher saddles of the vehicle / playground extras (W051.md: bike .72, moped .62, swing .64).
 */
export const SEAT_CONTACT_HEIGHT: ReadonlyMap<AnyAnimState, number> = new Map<AnyAnimState, number>([
  ...[...SEATED_ANIMS].map((c) => [c, DIM.SEAT_HEIGHT] as [AnyAnimState, number]),
  ['rideBike', 0.72], ['rideMoped', 0.62], ['swing', 0.64],
]);
/** Seat contact height of a clip, 0 when it stands / lies (see SEAT_CONTACT_HEIGHT). */
export function seatContactHeight(clip: AnyAnimState): number {
  return SEAT_CONTACT_HEIGHT.get(clip) ?? 0;
}
/** Clips that keep the body off the legs (no substitution when legs are missing). */
export const OFF_FEET_ANIMS: ReadonlySet<AnyAnimState> = new Set<AnyAnimState>([
  ...SEAT_CONTACT_HEIGHT.keys(), 'sleep', 'beEmbalmed', 'bath', 'crawl', 'collapse', 'enterVehicle',
]);
/**
 * W-120 clip tags: clips that take the hands down to the floor (heldProps.ts stows a sculpted held prop for them).
 * Prone = face down / bent over the floor (the prop rides on the back); supine = lying on the back (on the chest).
 */
export const HANDS_DOWN_PRONE_ANIMS: ReadonlySet<AnyAnimState> = new Set<AnyAnimState>(['crawl', 'clean', 'feral']);
export const HANDS_DOWN_SUPINE_ANIMS: ReadonlySet<AnyAnimState> = new Set<AnyAnimState>(['sleep', 'bath', 'beEmbalmed']);
/**
 * W-120: per-look floor-contact lift (m, model units: scaled with the body's height scale), blended by clip weight.
 * The classic crawl plants the palms 13-16 mm into the floor (hand bones +35..43 mm); the retargeted crawl drags the
 * belly / chest of the Lid Guard 15-17 mm, Runner 14-16, Pickpocket 18-20, Granny 8-9, Fortune Teller 19-21 and
 * Tourist 20-22 mm through it (their hands stay +73..170 mm). Each lifts the crawling body just onto that contact:
 * millimetres, never the ~0.5 m a whole-root lift for the shield lid would need (heldProps.ts moves the lid
 * instead). Measured by tests/unit/clip-audit/crawlFloor.test.ts.
 */
export const FLOOR_CONTACT_LIFT: Readonly<Partial<Record<BodyId, ReadonlyMap<AnyAnimState, number>>>> = {
  classic: new Map<AnyAnimState, number>([['crawl', 0.014]]),
  shield: new Map<AnyAnimState, number>([['crawl', 0.0155]]),
  runner: new Map<AnyAnimState, number>([['crawl', 0.0155]]),
  thief: new Map<AnyAnimState, number>([['crawl', 0.019]]),
  granny: new Map<AnyAnimState, number>([['crawl', 0.0095]]),
  fortune: new Map<AnyAnimState, number>([['crawl', 0.0205]]),
  tourist: new Map<AnyAnimState, number>([['crawl', 0.0215]]),
};
/** Floor-contact lift of `body` playing `clip` (0 for everything not listed). */
export function floorContactLift(body: BodyId, clip: AnyAnimState): number {
  return FLOOR_CONTACT_LIFT[body]?.get(clip) ?? 0;
}
/** Clips authored right-handed; mirrored when the right arm is gone but the left is usable. */
export const RIGHT_HANDED_ANIMS: ReadonlySet<AnyAnimState> = new Set<AnyAnimState>([
  'wave', 'phone', 'paint', 'cook', 'stitch', 'standEat', 'sitEat', 'sitChess', 'pickup', 'embalm', 'flirt',
  'admire',
  // extras whose right hand works while the left steadies / rests (W051.md, clips_*.py)
  'applyMakeup', 'spray', 'selfie', 'pose', 'prank', 'toast', 'saw', 'solder', 'fixVehicle', 'playGuitar', 'cue',
  'crouchPet',
]);
/** Clips during which a carried item is held out in the carry pose. */
export const HOLD_ANIMS: ReadonlySet<AnyAnimState> = new Set<AnyAnimState>(['idle', 'walk', 'limp', 'listen', 'groan', 'chase']);
/**
 * Clips that pick an item up: the carried item is shown in the hand only from this clip time (s), when the hand has
 * reached the floor / shelf / fridge. Before it the arm swings down past the thigh and an item already in the hand
 * cut 30-150 mm into the leg on every body (clip audit `pen:item-body` at t = 0.096 s on `pickup+ingredients`,
 * `+pizza`, `+book`). The shared `pickup` clip (1.2 s) has the hand at its lowest from 0.40 to 0.62 s on the Classic,
 * Lowside and The Drowned; the item clears every body from 0.35 s. Applies only to an item that ARRIVES with the
 * clip (set in the frame the clip starts, or later): the sim keeps the carry through a stage that declares none
 * (src/sim/engine/runner.ts), so Throw Away bends to the trash holding the dish or limb, and that item stays in the
 * hand throughout. Hidden only, never moved: the item, its anchor and the hold pose are unchanged.
 */
export const CARRY_REVEAL_AT: Readonly<Partial<Record<AnyAnimState, number>>> = { pickup: 0.45 };
/** Is a carried item shown while `clip` plays at clip time `t` (s)? */
export function carryShown(clip: AnyAnimState, t: number): boolean {
  const at = CARRY_REVEAL_AT[clip];
  return at === undefined || !(t < at);
}
/** Carry items that use the carry (palm-up) hold pose. */
export const HOLD_ITEMS: ReadonlySet<CarryItem> = new Set<CarryItem>([
  'plate', 'dish', 'ingredients', 'limb', 'book', 'phone', 'brush', 'pizza',
]);

export interface AnimPlan {
  /** Clip to play: a core state, or an extra state whose clip is loaded (never an extra that is missing). */
  clip: AnyAnimState;
  mirror: boolean;
  /** Extra time scale (e.g. legless 'idle' -> slow crawl). */
  timeScale: number;
}

/**
 * Map a requested state to the clip to play given the current limbs. `has` says which clips the loaded animation
 * set contains: an extra state (EXTRA_ANIM_STATES) plays when present, else its EXTRA_ANIM_FALLBACK (the default,
 * `has` omitted, is "no extras" - e.g. the capsule fallback rig). The missing-limb substitution and mirroring rules
 * then apply to whichever state plays.
 */
export function resolveAnim(stateIn: unknown, limbsIn: unknown, has: ClipAvailability = NO_EXTRA_CLIPS): AnimPlan {
  const state = effectiveAnim(stateIn, has);
  const limbs = sanitizeLimbs(limbsIn);
  const noL = limbs.legL === 'missing';
  const noR = limbs.legR === 'missing';
  const travel = state === 'walk' || state === 'limp' || state === 'chase';
  if (noL && noR && !OFF_FEET_ANIMS.has(state)) {
    // no legs at all: everything upright becomes crawling (slowly when not travelling)
    return { clip: 'crawl', mirror: false, timeScale: travel ? 1 : 0.35 };
  }
  if (travel && (noL || noR)) {
    return { clip: 'limp', mirror: noR && !noL, timeScale: 1 };
  }
  if (state === 'limp' && !noL && !noR) return { clip: 'walk', mirror: false, timeScale: 1 };
  if (state === 'crawl' && !(noL && noR)) return { clip: 'crawl', mirror: false, timeScale: 1 };
  const mirror = RIGHT_HANDED_ANIMS.has(state) && limbs.armR === 'missing' && limbs.armL !== 'missing';
  return { clip: state, mirror, timeScale: 1 };
}

/** Which hand holds a carried item ('R' preferred), or null when both arms are missing. */
export function carryHand(limbsIn: unknown): 'L' | 'R' | null {
  const limbs = sanitizeLimbs(limbsIn);
  if (limbs.armR !== 'missing') return 'R';
  if (limbs.armL !== 'missing') return 'L';
  return null;
}

/**
 * Sanitise a walk-speed scale: NaN / non-numbers / negatives -> 1 (default shuffle), clamped to [0, 6].
 * 0 is meaningful: RENDER passes it while a walker is not actually moving, and the cycle freezes mid-stride.
 */
export function sanitizeSpeed(v: unknown): number {
  const n = finiteOr(v, 1);
  if (n < 0) return 1;
  if (n === 0) return 0; // also normalises -0
  return n > 6 ? 6 : n;
}

/** Deterministic 32-bit seed from an appearance (so blinks differ per zombie but are reproducible). */
export function appearanceSeed(app: ZombieAppearance): number {
  const s = `${app.hairStyle}|${app.hairColor}|${app.topStyle}|${app.topColor}|${app.eyeStyle}|${app.skinTone}|${app.height}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
