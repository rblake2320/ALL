/**
 * Allowed content-pack publisher keys (docs/MONETIZATION.md §5: first-party key for now).
 *
 * PRODUCTION: `PRODUCTION_PUBLISHER_KEYS` holds the first-party Ed25519 PUBLIC key (raw 32 bytes, base64). The private
 * key never enters the repository — it lives in the release signing environment (secret store / CI secret) and is
 * passed to `node scripts/build-pack.mjs --key <path>` at release time. Until the production key is generated the entry
 * below is a PLACEHOLDER and is ignored (an invalid key can never verify anything), so release builds accept no packs.
 *
 * DEVELOPMENT: `node scripts/build-pack.mjs` generates a dev key pair into `.keys/` (gitignored) on first run and prints
 * the public key; `vite dev` trusts it when started with VITE_DEV_PACK_PUBKEY=<base64> (DEV builds only — the branch
 * is removed from production bundles). Tests pass their own ephemeral keys explicitly.
 */
export interface PublisherKey {
  keyId: string;
  /** Raw Ed25519 public key, base64 (32 bytes). */
  publicKey: string;
  label: string;
}

export const PRODUCTION_KEY_PLACEHOLDER = 'REPLACE_WITH_FIRST_PARTY_ED25519_PUBLIC_KEY';

export const PRODUCTION_PUBLISHER_KEYS: readonly PublisherKey[] = [
  { keyId: 'afterlife-first-party', publicKey: PRODUCTION_KEY_PLACEHOLDER, label: 'Afterlife Lease (first party)' },
];

const RAW_KEY_B64_RE = /^[A-Za-z0-9+/]{43}=$/;

export function isUsableKey(k: PublisherKey): boolean {
  return RAW_KEY_B64_RE.test(k.publicKey);
}

/** Keys this build trusts (placeholders filtered out; dev key only in DEV builds). */
export function trustedPublisherKeys(): PublisherKey[] {
  const keys = PRODUCTION_PUBLISHER_KEYS.filter(isUsableKey);
  if (import.meta.env.DEV) {
    const dev = (import.meta.env as Record<string, unknown>).VITE_DEV_PACK_PUBKEY;
    if (typeof dev === 'string' && RAW_KEY_B64_RE.test(dev)) keys.push({ keyId: 'afterlife-dev', publicKey: dev, label: 'Local development key' });
  }
  return keys;
}
