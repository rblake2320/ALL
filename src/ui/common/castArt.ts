/**
 * UI-side helpers for cast bodies (src/shared/cast.ts): thumbnail URLs, the portrait face crop, CAZ grouping and
 * which Create-a-Zombie options still apply to a cast body. Pure + DOM-free so it is unit-testable.
 */
import type { ZombieAppearance } from '../../shared/appearance';
import { SCULPTED_BODIES, SCULPTED_BODY_IDS, isCastBodyId, type CastBodyDef, type CastBodyId, type CastCategory } from '../../shared/cast';
import { isPremiumBodyId } from '../../shared/premiumBodies';

/** Category order + i18n key of each heading in the CAZ body picker. */
export const CAST_CATEGORY_ORDER: readonly CastCategory[] = ['premium', 'zombie', 'boss', 'turned'];

export interface CastGroup {
  category: CastCategory;
  bodies: CastBodyDef[];
}

/** Every sculpted body grouped by category in CAST_CATEGORY_ORDER (catalogue order inside a group). */
export function castGroups(): CastGroup[] {
  return CAST_CATEGORY_ORDER.map((category) => ({ category, bodies: SCULPTED_BODIES.filter((b) => b.category === category) }));
}

/** The appearance's cast body, or null for the procedural ("classic") body — also for junk values. */
export function castBodyOf(app: Partial<ZombieAppearance> | null | undefined): CastBodyId | null {
  const b = app && typeof app === 'object' ? (app as { body?: unknown }).body : undefined;
  return isCastBodyId(b) ? b : null;
}

function assetBase(): string {
  let base = '/';
  try {
    const b = import.meta.env?.BASE_URL;
    if (typeof b === 'string' && b.length > 0) base = b;
  } catch {
    /* non-Vite host */
  }
  return base.endsWith('/') ? base : `${base}/`;
}

/** URL of the square CAZ thumbnail baked by tools/blender/cast (public/assets/ui/cast/<id>.webp; premium: ui/premium). */
export function castThumbUrl(id: CastBodyId): string {
  return `${assetBase()}assets/ui/${isPremiumBodyId(id) ? 'premium' : 'cast'}/${id}.webp`;
}

/**
 * Face crop of a thumbnail inside the 100×100 portrait viewBox: the image is drawn `size` units wide with its
 * (fx, fy) point (fractions of the image) at the portrait centre. Tuned to the thumbnail framing of
 * tools/blender/cast (camera on the bust); a missing/odd image falls back to the procedural SVG portrait.
 */
export interface FaceCrop {
  fx: number;
  fy: number;
  size: number;
}
const DEFAULT_CROP: FaceCrop = { fx: 0.5, fy: 0.3, size: 175 };
/**
 * Per-body face crops, measured on the published 256² thumbnails (alpha bbox → head band → face centre) and checked
 * on a contact sheet: the thumbnails are full-figure renders whose head size varies (tall headwear, bosses, props).
 * Re-measure if tools/blender/cast changes the thumbnail camera.
 */
const CROP_OVERRIDES: Partial<Record<CastBodyId, Partial<FaceCrop>>> = {
  walker: { fx: 0.484, fy: 0.234, size: 169 },
  cone: { fx: 0.498, fy: 0.256, size: 186 },
  hardhat: { fx: 0.479, fy: 0.224, size: 167 },
  runner: { fx: 0.5, fy: 0.221, size: 166 },
  thief: { fx: 0.521, fy: 0.227, size: 168 },
  gold: { fx: 0.512, fy: 0.221, size: 166 },
  bride: { fx: 0.516, fy: 0.221, size: 166 },
  nurse: { fx: 0.52, fy: 0.224, size: 167 },
  granny: { fx: 0.486, fy: 0.224, size: 167 },
  screamer: { fx: 0.514, fy: 0.227, size: 168 },
  clown: { fx: 0.512, fy: 0.221, size: 166 },
  shield: { fx: 0.494, fy: 0.237, size: 140 },
  sneezer: { fx: 0.514, fy: 0.215, size: 165 },
  boss: { fx: 0.506, fy: 0.221, size: 166 },
  strongman: { fx: 0.498, fy: 0.354, size: 121 },
  ringmaster: { fx: 0.484, fy: 0.224, size: 167 },
  fortune: { fx: 0.494, fy: 0.221, size: 166 },
  mascot: { fx: 0.504, fy: 0.215, size: 165 },
  civilian: { fx: 0.496, fy: 0.224, size: 167 },
  business: { fx: 0.504, fy: 0.218, size: 166 },
  gamer: { fx: 0.5, fy: 0.221, size: 166 },
  jogger: { fx: 0.516, fy: 0.212, size: 165 },
  pizza: { fx: 0.498, fy: 0.221, size: 166 },
  streamer: { fx: 0.5, fy: 0.215, size: 165 },
  tourist: { fx: 0.49, fy: 0.224, size: 167 },
};

export function castFaceCrop(id: CastBodyId): FaceCrop {
  return { ...DEFAULT_CROP, ...(CROP_OVERRIDES[id] ?? {}) };
}

/** Image rectangle (viewBox units) for a crop. */
export function faceCropRect(c: FaceCrop): { x: number; y: number; w: number; h: number } {
  const w = c.size;
  return { x: 50 - c.fx * w, y: 50 - c.fy * w, w, h: w };
}

/**
 * Bodies whose GLB has NO separate eye material, so the eye colour cannot apply (docs/contract-requests/cast.md §2.7:
 * every cast body ships one baked atlas material, `eyeMaterial: null`). Remove an id here if a rebuilt body gains one.
 */
const NO_EYE_MATERIAL = new Set<CastBodyId>(SCULPTED_BODY_IDS);

export function castEyeColorApplies(id: CastBodyId): boolean {
  return !NO_EYE_MATERIAL.has(id);
}

/** Create-a-Zombie options and whether they still apply to `body` (null = classic: everything applies). */
export type CazLookOption = 'height' | 'build' | 'skinTone' | 'eyeStyle' | 'eyeColor' | 'stitches' | 'hair' | 'outfit' | 'accessory' | 'voice';

export function lookOptionApplies(body: CastBodyId | null, option: CazLookOption): boolean {
  if (body === null) return true;
  switch (option) {
    case 'height':
    case 'voice':
      return true;
    case 'eyeColor':
      return castEyeColorApplies(body);
    default:
      return false;
  }
}
