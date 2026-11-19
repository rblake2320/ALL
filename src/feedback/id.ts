/**
 * Feedback report IDs (W-110 §1): `FB-XXXXX-XXXXX`, 10 Crockford base-32 symbols = 50 random bits from the platform
 * CSPRNG (GameEnv.randomU32 → crypto.getRandomValues). Never the simulation RNG (the sim stays byte-deterministic).
 *
 * 50 bits keeps the birthday-collision chance below 1 in 10^6 until ~47 000 reports exist for one build, and the
 * outbox re-rolls on a local collision. The id is minted ONCE when the dialog opens, so pressing Send twice (or a
 * retry after a crash) writes the same id again — the outbox and the ingest are idempotent on it.
 * Crockford's alphabet has no I, L, O or U, so the id reads aloud and survives handwriting.
 */

export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const FEEDBACK_ID_RE = /^FB-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;

export function isFeedbackId(v: unknown): v is string {
  return typeof v === 'string' && FEEDBACK_ID_RE.test(v);
}

/** Mint a new id from 32-bit random words (two calls; 25 bits of each are used). */
export function newFeedbackId(randomU32: () => number): string {
  let out = '';
  for (let half = 0; half < 2; half++) {
    let n = randomU32() >>> 0;
    let part = '';
    for (let i = 0; i < 5; i++) {
      part += CROCKFORD[n & 31];
      n >>>= 5;
    }
    out += (half === 0 ? 'FB-' : '-') + part;
  }
  return out;
}

/** Storage-key form (profile key grammar [A-Za-z0-9_-]): FB-7Q3KM-X2P9A → fbr-7q3km-x2p9a. */
export function idKey(id: string): string {
  return `fbr-${id.slice(3).toLowerCase()}`;
}

/** Inverse of idKey (null for anything else). */
export function idFromKey(key: string): string | null {
  const m = /^fbr-([0-9a-hjkmnp-tv-z]{5})-([0-9a-hjkmnp-tv-z]{5})$/.exec(key);
  return m ? `FB-${m[1].toUpperCase()}-${m[2].toUpperCase()}` : null;
}
