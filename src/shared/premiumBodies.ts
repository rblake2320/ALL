/**
 * PREMIUM BODIES — realistic zombies sold in the store (tools/blender/cast/premium).
 *
 * Same runtime contract as a cast body (src/shared/cast.ts): one skinned mesh 'Body' on the 22-bone cast rig, shared
 * clips, shared pelvis rule. Differences:
 *   - Each design ships as two files: `high` (models/characters/premium/<id>.glb) and `low`
 *     (models/characters/premium/<id>_low.glb, inside the cast budget). The entitlement selects the design; the
 *     machine selects the file (see premiumDetail in src/render/characters/cast.ts).
 *   - They are never dealt out at random: townies, the randomiser and the demo household draw from CAST_BODY_IDS
 *     only, so a premium body is only ever seen on a zombie whose player chose it.
 *
 * This list and tools/blender/cast/premium/bodies.json are the same data (tests/unit/premium-assets pins them to
 * each other). Ids are stored in saves: never rename one.
 */
import type { CastBodyDef } from './cast';

export const PREMIUM_BODY_IDS = ['sexton', 'lowside', 'waitress', 'patient', 'fisherman'] as const;
export type PremiumBodyId = (typeof PREMIUM_BODY_IDS)[number];

export const PREMIUM_BODIES: readonly CastBodyDef[] = [
  { id: 'sexton', name: 'The Sexton', sourceId: 'undertaker', category: 'premium', height: 1.86, blurb: 'Buried half the town. Dug himself out.' },
  { id: 'lowside', name: 'Lowside', sourceId: 'biker', category: 'premium', height: 1.88, blurb: "Laid the bike down in '09. Still walking it off." },
  { id: 'waitress', name: 'Night Shift', sourceId: 'waitress', category: 'premium', height: 1.70, blurb: "Coffee's cold. So is she." },
  { id: 'patient', name: 'Bed Nine', sourceId: 'patient', category: 'premium', height: 1.78, blurb: 'Discharged himself. Against advice.' },
  { id: 'fisherman', name: 'The Drowned', sourceId: 'fisherman', category: 'premium', height: 1.76, blurb: 'Went out past the buoys. Came back on the tide.' },
];

export function isPremiumBodyId(v: unknown): v is PremiumBodyId {
  return typeof v === 'string' && (PREMIUM_BODY_IDS as readonly string[]).includes(v);
}

export type PremiumDetail = 'high' | 'low';

/**
 * The file a machine loads: the low-detail one on the Low and Medium graphics levels (and whenever the level is not
 * known yet), the high-detail one on High and Ultra.
 */
export function premiumDetailForQuality(level: unknown): PremiumDetail {
  return level === 'high' || level === 'ultra' ? 'high' : 'low';
}

/** GLB path of a premium body, relative to the assets base url. */
export function premiumGlbPath(id: PremiumBodyId, detail: PremiumDetail): string {
  return `models/characters/premium/${id}${detail === 'low' ? '_low' : ''}.glb`;
}
