/**
 * Canonical node / bone / morph names inside public/assets/models/characters/zombie.glb.
 * Mirrors tools/blender/characters/lib/names.py (the GLB tests assert both agree).
 */
import { ACCESSORIES, BOTTOM_STYLES, EYE_STYLES, HAIR_STYLES, TOP_STYLES } from '../../shared/appearance';
import type { Accessory, BottomStyle, EyeStyle, HairStyle, TopStyle } from '../../shared/appearance';

export const BONE_NAMES = [
  'root', 'pelvis', 'spine', 'chest', 'neck', 'head', 'jaw',
  'shoulder_L', 'upperarm_L', 'forearm_L', 'hand_L',
  'shoulder_R', 'upperarm_R', 'forearm_R', 'hand_R',
  'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R', 'prop_R', 'prop_L',
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

export const MATERIAL_NAMES = [
  'Skin', 'Hair', 'Top', 'Bottom', 'Shoes', 'EyeWhite', 'Iris', 'Mouth', 'Teeth', 'Stitch', 'Prosthetic', 'Accessory',
] as const;
export type MaterialName = (typeof MATERIAL_NAMES)[number];

/** Expression morphs present on Head and on every Eyes_* mesh. */
export const FACE_MORPHS = [
  'blink', 'talk', 'happy', 'sad', 'angry', 'sleepy', 'disgusted', 'flirty', 'shocked', 'focused',
] as const;
export type FaceMorph = (typeof FACE_MORPHS)[number];

export const BUILD_MORPH = 'build';
/** Build morph at influence 1 widens by this fraction. */
export const BUILD_GAIN = 0.15;
export const STITCH_HIDE_MORPHS = { armL: 'hide_armL', armR: 'hide_armR', legL: 'hide_legL', legR: 'hide_legR' } as const;

export const BODY_NODES = [
  'Head', 'Torso', 'ArmUpper_L', 'ArmLower_L', 'Hand_L', 'ArmUpper_R', 'ArmLower_R', 'Hand_R',
  'LegUpper_L', 'LegLower_L', 'Foot_L', 'LegUpper_R', 'LegLower_R', 'Foot_R', 'Shoe_L', 'Shoe_R', 'Stitches',
] as const;

export const LIMB_NODES = [
  'Stump_ArmL', 'Stump_ArmR', 'Stump_LegL', 'Stump_LegR',
  'Prosthetic_ArmL', 'Prosthetic_ArmR', 'Prosthetic_LegL', 'Prosthetic_LegR',
] as const;

export const eyesNode = (s: EyeStyle): string => `Eyes_${s}`;
export const hairNode = (s: HairStyle): string | null => (s === 'bald' ? null : `Hair_${s}`);
export const topNodes = (s: TopStyle): [string, string, string] => [`Top_${s}_Body`, `Top_${s}_SleeveL`, `Top_${s}_SleeveR`];
export const bottomNodes = (s: BottomStyle): [string, string, string] => [
  `Bottom_${s}_Waist`, `Bottom_${s}_LegL`, `Bottom_${s}_LegR`,
];
export const accessoryNode = (a: Accessory): string | null => (a === 'none' ? null : `Acc_${a}`);

/** Every mesh node the GLB must contain (one per style list entry + body + limb variants). */
export function requiredNodes(): string[] {
  const out: string[] = [...BODY_NODES, ...LIMB_NODES];
  for (const s of EYE_STYLES) out.push(eyesNode(s));
  for (const s of HAIR_STYLES) {
    const n = hairNode(s);
    if (n) out.push(n);
  }
  for (const s of TOP_STYLES) out.push(...topNodes(s));
  for (const s of BOTTOM_STYLES) out.push(...bottomNodes(s));
  for (const a of ACCESSORIES) {
    const n = accessoryNode(a);
    if (n) out.push(n);
  }
  return out;
}

/** Bones for the carry hold layer, per side. */
export const ARM_CHAIN = {
  L: ['upperarm_L', 'forearm_L', 'hand_L'],
  R: ['upperarm_R', 'forearm_R', 'hand_R'],
} as const;

export function mirrorBoneName(name: string): string {
  if (name.endsWith('_L')) return name.slice(0, -2) + '_R';
  if (name.endsWith('_R')) return name.slice(0, -2) + '_L';
  return name;
}
