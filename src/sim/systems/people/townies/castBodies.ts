/**
 * Cast bodies for townies and service NPCs (src/shared/cast.ts) — WITHOUT touching any RNG stream.
 *
 * The body of townie slot `i` is a pure function of (world seed, i): a hash-driven permutation of every cast body
 * listed twice, consumed by the ~60 % of slots that roll "cast" on a separate hash. So adding bodies changed none of
 * the names, looks, traits, skills or needs that `generateTownies` draws, nor anything the sim draws later — every
 * determinism/balance result is unchanged — and each cast body appears at most twice in a town.
 */
import { CAST_BODY_IDS, type CastBodyId } from '../../../../shared/cast';
import type { ZombieAppearance } from '../../../../shared/appearance';

/** Share of townies with a cast body (the rest keep the procedural body). */
export const TOWNIE_CAST_SHARE = 0.6;
/** Every cast body appears at most this many times among the townies. */
export const TOWNIE_CAST_MAX_REPEAT = 2;

/** lowbias32 integer hash. */
function mix32(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

function seedKey(seed: unknown): number {
  return typeof seed === 'number' && Number.isFinite(seed) ? Math.floor(seed) >>> 0 : 1;
}

/** Bodies for townie slots 0..count-1 (null = classic). Pure: same seed → same list. */
export function townieBodies(seed: unknown, count: number): (CastBodyId | null)[] {
  const n = Math.max(0, Math.min(1024, Math.floor(Number.isFinite(count) ? count : 0)));
  const s = seedKey(seed);
  // Fisher–Yates over [each id × MAX_REPEAT] driven by the hash, so no body can appear more than MAX_REPEAT times.
  const pool: CastBodyId[] = [];
  for (let r = 0; r < TOWNIE_CAST_MAX_REPEAT; r++) pool.push(...CAST_BODY_IDS);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = mix32(s ^ mix32(0xca57b0d1 + i)) % (i + 1);
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  const out: (CastBodyId | null)[] = [];
  let next = 0;
  for (let i = 0; i < n; i++) {
    const roll = mix32(s ^ mix32(0x70776e1e + i * 0x9e3779b1)) / 0x1_0000_0000;
    out.push(roll < TOWNIE_CAST_SHARE && next < pool.length ? pool[next++] : null);
  }
  return out;
}

/** Fixed bodies for service NPCs (constant: no RNG). */
export const SERVICE_BODIES: Readonly<Record<'pizza' | 'repo', CastBodyId>> = { pizza: 'pizza', repo: 'boss' };

/** `app` with `body` appended last (absent for classic), so classic appearances serialise exactly as before. */
export function withCastBody(app: ZombieAppearance, body: CastBodyId | null): ZombieAppearance {
  const out: ZombieAppearance = { ...app };
  delete out.body;
  if (body) out.body = body;
  return out;
}
