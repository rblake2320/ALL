/**
 * CAST BODIES — 25 hand-designed "advanced" zombie bodies imported from the owner's Zombie Smash 2 art pipeline
 * (source: github.com/rblake2320/zombie-smash-2 @ 9c79c4c, assets/models/<sourceId>_rigged.glb).
 *
 * A cast body replaces the procedural (style-driven) zombie mesh with a single sculpted, textured, skinned mesh.
 * It is OPTIONAL per zombie: `ZombieAppearance.body` undefined or 'classic' = the procedural rig (unchanged behaviour).
 *
 * Runtime asset contract (built by tools/blender/cast/build_cast.py, consumed by src/render/characters):
 *   public/assets/models/characters/cast/<id>.glb  +  public/assets/manifest.cast.json
 *   - glTF Y-up, metres, front = +Z, feet on y = 0, single skinned mesh named 'Body'.
 *   - Skeleton uses the SAME bone names as zombie.glb (root pelvis spine chest neck head [jaw] shoulder_L upperarm_L
 *     forearm_L hand_L prop_L shoulder_R upperarm_R forearm_R hand_R prop_R thigh_L shin_L foot_L thigh_R shin_R foot_R)
 *     and every clip in ANIM_STATES under the same name (retargeted from zombie.glb), so every anchor rule in
 *     appearance.ts (sit* seat contact at SEAT_HEIGHT, lying clips, carry anchors) holds unchanged.
 *   - Standing height normalised to CAST_BODIES[i].height (metres, skull/headwear top), always < DIM.DOOR_HEIGHT.
 *
 * Which ZombieAppearance fields still apply to a cast body: height (as a ±6 % scale around the body's own height),
 * voicePitch, eyeColor (only if the body exposes an eye material). Hair/top/bottom/shoe/eye style/accessory/stitches/
 * skinTone/build are ignored (CAZ greys them out). Limb loss/prosthetics still work (bone collapse + stump cap).
 */

import { PREMIUM_BODIES, isPremiumBodyId, type PremiumBodyId } from './premiumBodies';

/** 'premium' = the store bodies of src/shared/premiumBodies.ts (two files per design, never dealt at random). */
export type CastCategory = 'zombie' | 'boss' | 'turned' | 'premium';

export interface CastBodyDef {
  /** Stable id stored in saves. Never rename. */
  id: CastBodyId;
  /** Source model basename in zombie-smash-2/assets/models (<sourceId>_rigged.glb). */
  sourceId: string;
  /** Display name (English; i18n key is `cast.<id>`). */
  name: string;
  category: CastCategory;
  /** Target standing height in metres (top of head/headwear). */
  height: number;
  /** Short flavour line for the CAZ tooltip. */
  blurb: string;
}

export const CAST_BODY_IDS = [
  'walker', 'cone', 'hardhat', 'runner', 'thief', 'gold', 'bride', 'nurse', 'granny', 'screamer', 'clown', 'shield',
  'sneezer', 'boss', 'strongman', 'ringmaster', 'fortune', 'mascot', 'civilian', 'business', 'gamer', 'jogger',
  'pizza', 'streamer', 'tourist',
] as const;
/** One of the 25 bodies of the cast kit (CAST_BODY_IDS): what townies, the randomiser and the demo draw from. */
export type CastKitBodyId = (typeof CAST_BODY_IDS)[number];
/** Any sculpted body a zombie may wear: the cast kit plus the premium bodies. */
export type CastBodyId = CastKitBodyId | PremiumBodyId;

/** 'classic' = procedural style-driven body (default). */
export type BodyId = 'classic' | CastBodyId;

export const CAST_BODIES: readonly CastBodyDef[] = [
  { id: 'walker', sourceId: 'walker', name: 'Walker', category: 'zombie', height: 1.72, blurb: 'The classic shambler. Reliable, if a little moist.' },
  { id: 'cone', sourceId: 'cone', name: 'Cone-Head', category: 'zombie', height: 1.86, blurb: 'Found a traffic cone. Never took it off.' },
  { id: 'hardhat', sourceId: 'hardhat', name: 'Hard Hat', category: 'zombie', height: 1.78, blurb: 'Safety first. Even after death.' },
  { id: 'runner', sourceId: 'runner', name: 'Runner', category: 'zombie', height: 1.74, blurb: 'Still training for a marathon nobody is holding.' },
  { id: 'thief', sourceId: 'thief', name: 'Pickpocket', category: 'zombie', height: 1.70, blurb: 'Your spare change is already gone.' },
  { id: 'gold', sourceId: 'gold', name: 'Goldie', category: 'zombie', height: 1.72, blurb: 'Glitters faintly. Nobody knows why.' },
  { id: 'bride', sourceId: 'bride', name: 'Bride', category: 'zombie', height: 1.70, blurb: 'Till death do us part. Death did not.' },
  { id: 'nurse', sourceId: 'nurse', name: 'Nurse', category: 'zombie', height: 1.70, blurb: 'Bedside manner: technically present.' },
  { id: 'granny', sourceId: 'granny', name: 'Granny', category: 'zombie', height: 1.58, blurb: 'Curlers in, opinions loud.' },
  { id: 'screamer', sourceId: 'screamer', name: 'Screamer', category: 'zombie', height: 1.72, blurb: 'Indoor voice not included.' },
  { id: 'clown', sourceId: 'clown', name: 'Clown', category: 'zombie', height: 1.76, blurb: 'Honk.' },
  { id: 'shield', sourceId: 'shield', name: 'Lid Guard', category: 'zombie', height: 1.76, blurb: 'Carries a lid everywhere, just in case.' },
  { id: 'sneezer', sourceId: 'sneezer', name: 'Sneezer', category: 'zombie', height: 1.72, blurb: 'Please do not stand downwind.' },
  { id: 'boss', sourceId: 'boss', name: 'Big Lug', category: 'boss', height: 2.0, blurb: 'Takes up the whole sofa.' },
  { id: 'strongman', sourceId: 'boss_strongman', name: 'Strongman', category: 'boss', height: 2.0, blurb: 'Curls the fridge for fun.' },
  { id: 'ringmaster', sourceId: 'boss_ringmaster', name: 'Ringmaster', category: 'boss', height: 1.98, blurb: 'Runs the household like a three-ring circus.' },
  { id: 'fortune', sourceId: 'boss_fortune', name: 'Fortune Teller', category: 'boss', height: 1.84, blurb: 'Predicted all of this. Did nothing.' },
  { id: 'mascot', sourceId: 'boss_mascot', name: 'Mascot', category: 'boss', height: 1.96, blurb: 'Still in the bear suit. Still smiling.' },
  { id: 'civilian', sourceId: 'civilian', name: 'Freshly Turned', category: 'turned', height: 1.74, blurb: 'Turned last Tuesday. Still adjusting.' },
  { id: 'business', sourceId: 'civ_business', name: 'Middle Manager', category: 'turned', height: 1.76, blurb: 'Still checks email out of habit.' },
  { id: 'gamer', sourceId: 'civ_gamer', name: 'Gamer', category: 'turned', height: 1.72, blurb: 'One more round. Forever.' },
  { id: 'jogger', sourceId: 'civ_jogger', name: 'Jogger', category: 'turned', height: 1.72, blurb: 'Personal best: never stopping.' },
  { id: 'pizza', sourceId: 'civ_pizza', name: 'Delivery Driver', category: 'turned', height: 1.74, blurb: 'Thirty minutes or it’s free. It’s been years.' },
  { id: 'streamer', sourceId: 'civ_streamer', name: 'Streamer', category: 'turned', height: 1.70, blurb: 'Don’t forget to like and subscribe.' },
  { id: 'tourist', sourceId: 'civ_tourist', name: 'Tourist', category: 'turned', height: 1.74, blurb: 'Came for the sights. Stayed forever.' },
];

/** Every sculpted body: the cast kit, then the premium bodies (store, picker and name lookups). */
export const SCULPTED_BODIES: readonly CastBodyDef[] = [...CAST_BODIES, ...PREMIUM_BODIES];
export const SCULPTED_BODY_IDS: readonly CastBodyId[] = SCULPTED_BODIES.map((b) => b.id);

export function isCastBodyId(v: unknown): v is CastBodyId {
  return (typeof v === 'string' && (CAST_BODY_IDS as readonly string[]).includes(v)) || isPremiumBodyId(v);
}

export function castBody(id: CastBodyId): CastBodyDef {
  const d = SCULPTED_BODIES.find((b) => b.id === id);
  if (!d) throw new Error(`unknown cast body ${id}`);
  return d;
}

/** Normalise any stored value: unknown/missing -> 'classic'. Never throws (saves may come from future/older builds). */
export function normalizeBody(v: unknown): BodyId {
  return isCastBodyId(v) ? v : 'classic';
}
