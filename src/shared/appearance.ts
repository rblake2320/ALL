/**
 * Zombie appearance + animation contract shared by the simulation (which stores it in saves),
 * Create-a-Zombie UI, and the procedural character rig.
 */

export const SKIN_TONES = [
  '#9fb88a', // moss
  '#8fa7a0', // grave-slate
  '#b7b59a', // parchment
  '#a3c2a8', // pistachio rot
  '#8f9fbf', // corpse-blue
  '#b4a1b0', // bruise-lilac
  '#c2b38f', // embalmed tan
  '#7f8f76', // swamp
  '#d0c6b6', // pale bone
  '#9a8a7a', // dusty umber
] as const;

export const HAIR_STYLES = [
  'bald',
  'buzz',
  'messy',
  'bob',
  'bun',
  'mohawk',
  'long',
  'combover',
  'pigtails',
  'afro',
] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

export const TOP_STYLES = ['tee', 'hoodie', 'suit', 'blouse', 'dress', 'tatters', 'cardigan'] as const;
export type TopStyle = (typeof TOP_STYLES)[number];

export const BOTTOM_STYLES = ['pants', 'shorts', 'skirt'] as const;
export type BottomStyle = (typeof BOTTOM_STYLES)[number];

export const EYE_STYLES = ['droopy', 'wide', 'mismatched', 'sleepy', 'beady'] as const;
export type EyeStyle = (typeof EYE_STYLES)[number];

export const ACCESSORIES = ['none', 'glasses', 'bowtie', 'necklace', 'beanie', 'bandage', 'flower', 'eyepatch'] as const;
export type Accessory = (typeof ACCESSORIES)[number];

export interface ZombieAppearance {
  /** 0 = short, 1 = tall. Scales overall height ~0.88x..1.08x. */
  height: number;
  /** 0 = slim, 1 = stocky. */
  build: number;
  /** Index into SKIN_TONES. */
  skinTone: number;
  hairStyle: HairStyle;
  hairColor: string;
  topStyle: TopStyle;
  topColor: string;
  bottomStyle: BottomStyle;
  bottomColor: string;
  shoeColor: string;
  eyeStyle: EyeStyle;
  eyeColor: string;
  accessory: Accessory;
  /** Visible stitch seams on face/arms. */
  stitches: boolean;
  /** 0 = deep groan, 1 = squeaky. Used by the voice synth too. */
  voicePitch: number;
  /** Optional sculpted cast body (see shared/cast.ts). Missing/'classic' = procedural body. Unknown ids read as 'classic'. */
  body?: import('./cast').BodyId;
}

export type LimbId = 'armL' | 'armR' | 'legL' | 'legR';
export const LIMB_IDS: LimbId[] = ['armL', 'armR', 'legL', 'legR'];

/** 'ok' = original limb, 'missing' = gone (show a stump), 'prosthetic' = wooden replacement. */
export type LimbCondition = 'ok' | 'missing' | 'prosthetic';
export type LimbState = Record<LimbId, LimbCondition>;

export function intactLimbs(): LimbState {
  return { armL: 'ok', armR: 'ok', legL: 'ok', legR: 'ok' };
}

/**
 * Animation states the rig must implement. All loop unless noted.
 * Pose anchors (see DIM): sit* -> seat contact (pelvis bone origin, bottom of the hip mass) at SEAT_HEIGHT above rig origin;
 * sleep -> lying on back, body centred on origin, head toward local -Z, at y=0 (renderer lifts
 * the rig root to BED_HEIGHT); bath -> seated low (renderer places root at tub floor);
 * beEmbalmed -> like sleep (renderer lifts root to SLAB_HEIGHT).
 */
export const ANIM_STATES = [
  'idle',
  'walk', // zombie shuffle, arms slightly forward
  'limp', // one leg missing
  'crawl', // both legs missing (root stays on ground)
  'sit',
  'sitEat',
  'sitTalk',
  'sitTV', // slouched watching
  'sitComputer', // typing
  'sitRead',
  'sitChess',
  'standEat',
  'sleep',
  'talk', // gesturing
  'listen',
  'laugh',
  'cry',
  'angry', // stomping, fists
  'flirt',
  'kiss', // lean forward
  'hug', // arms forward wrap
  'wave',
  'cheer',
  'dance',
  'cook', // stirring at counter height
  'clean', // scrubbing low
  'washHands', // at sink
  'shower', // scrubbing, head tilted up
  'bath',
  'exercise', // lifting
  'paint', // arm brushing at easel
  'embalm', // working over slab
  'beEmbalmed',
  'stitch', // sewing at table, standing
  'read', // standing reading
  'phone', // hand to ear
  'admire', // looking in mirror, posing
  'pickup', // one-shot bend (non-looping, ~1.2s)
  'groan', // head back, arms limp
  'stretch',
  'collapse', // one-shot fall asleep on floor -> then lies
  'feral', // hunched, twitchy
  'mourn', // head down, kneeling
  'yawn', // one-shot
  'disgusted', // recoil
] as const;
export type AnimState = (typeof ANIM_STATES)[number];

export const EXPRESSIONS = ['neutral', 'happy', 'sad', 'angry', 'sleepy', 'disgusted', 'flirty', 'shocked', 'focused'] as const;
export type Expression = (typeof EXPRESSIONS)[number];

/** Items a zombie can visibly carry in-hand. */
export const CARRY_ITEMS = ['plate', 'dish', 'ingredients', 'limb', 'book', 'phone', 'brush', 'pizza'] as const;
export type CarryItem = (typeof CARRY_ITEMS)[number];

export function defaultAppearance(): ZombieAppearance {
  return {
    height: 0.5,
    build: 0.4,
    skinTone: 0,
    hairStyle: 'messy',
    hairColor: '#3b2f2f',
    topStyle: 'tee',
    topColor: '#6b4f8a',
    bottomStyle: 'pants',
    bottomColor: '#3a3f55',
    shoeColor: '#2a2420',
    eyeStyle: 'droopy',
    eyeColor: '#f2e86d',
    accessory: 'none',
    stitches: true,
    voicePitch: 0.5,
  };
}

/**
 * Animation states added for the specced systems + levels (W-051, docs/systems/**, docs/levels/**). They are authored on
 * the same rig (same rest pose and bone names, so cast bodies inherit them). Until a clip exists in the runtime GLB,
 * the rig plays the listed fallback, so content can reference these states before the art lands.
 * Not part of ANIM_STATES on purpose: ANIM_STATES stays the guaranteed-present core set.
 */
export const EXTRA_ANIM_STATES = [
  'applyMakeup', 'adjustWig', 'spray', 'selfie', 'pose', 'saw', 'solder', 'rummage', 'enterVehicle', 'fixVehicle',
  'rideBike', 'rideMoped', 'drive', 'vows', 'officiate', 'prank', 'jump', 'buildSnow', 'shiver', 'dig', 'fishCast',
  'fishWait', 'crouchPet', 'swing', 'row', 'pray', 'toast', 'warmHands', 'chase', 'playGuitar', 'playKeys', 'cue',
  'swingMallet', 'punch', 'djScratch',
] as const;
export type ExtraAnimState = (typeof EXTRA_ANIM_STATES)[number];
export type AnyAnimState = AnimState | ExtraAnimState;

/** Played while the extra clip is missing from the loaded GLB (never a one-shot core clip, so loops stay loops). */
export const EXTRA_ANIM_FALLBACK: Record<ExtraAnimState, AnimState> = {
  applyMakeup: 'admire', adjustWig: 'admire', spray: 'clean', selfie: 'phone', pose: 'admire', saw: 'cook',
  solder: 'stitch', rummage: 'clean', enterVehicle: 'idle', fixVehicle: 'clean', rideBike: 'sit', rideMoped: 'sit',
  drive: 'sit', vows: 'talk', officiate: 'read', prank: 'laugh', jump: 'dance', buildSnow: 'clean', shiver: 'idle',
  dig: 'clean', fishCast: 'wave', fishWait: 'idle', crouchPet: 'mourn', swing: 'sit', row: 'sit', pray: 'mourn',
  toast: 'cheer', warmHands: 'idle', chase: 'walk', playGuitar: 'dance', playKeys: 'sitComputer', cue: 'idle',
  swingMallet: 'exercise', punch: 'angry', djScratch: 'dance',
};

/** Extra states that play once (all others loop). */
export const EXTRA_ONE_SHOT_STATES: readonly ExtraAnimState[] = ['enterVehicle', 'fishCast', 'jump'];

export function isExtraAnimState(v: unknown): v is ExtraAnimState {
  return typeof v === 'string' && (EXTRA_ANIM_STATES as readonly string[]).includes(v);
}
