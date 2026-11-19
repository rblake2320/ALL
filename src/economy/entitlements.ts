/**
 * Which entitlements the LOCAL client may ever record (docs/MONETIZATION.md §1: Grave Gold is server-only, "Offline/dev
 * builds can never mint GG"). Anything that is sold ONLY for Grave Gold or real money — premium items and bodies,
 * GG bundles, boosts, the season track, subscriptions — is a server entitlement: the local Bones ledger refuses to
 * write it (`planAppend` → serverOnly) and the wallet ignores it if a hand-edited ledger contains it. Bones-sold
 * content (also when it additionally appears in a paid bundle, e.g. the Starter Pack) and quest cosmetics stay local.
 */
import { CATALOG } from './catalog';
import { GG_CONTENT, STORE_SKUS } from './skus';

/** Namespaces that only the server ever grants, whatever the catalogue says. */
const SERVER_NAMESPACES = ['boost:', 'season:', 'sub:', 'currency:'] as const;

function build(): ReadonlySet<string> {
  const bonesSold = new Set<string>();
  for (const s of STORE_SKUS) if (s.priceBones !== undefined) for (const c of s.contents) bonesSold.add(c.contentId);
  const out = new Set<string>();
  for (const s of STORE_SKUS) {
    if (s.priceBones !== undefined) continue;
    for (const c of s.contents) if (c.contentId !== GG_CONTENT && !bonesSold.has(c.contentId)) out.add(c.contentId);
  }
  for (const e of CATALOG) if (e.tier === 'premium' && !bonesSold.has(e.contentId)) out.add(e.contentId);
  return out;
}

const SERVER_ONLY: ReadonlySet<string> = build();

export function isServerOnlyEntitlement(id: string): boolean {
  return SERVER_ONLY.has(id) || SERVER_NAMESPACES.some((p) => id.startsWith(p));
}

/** The entitlements of `ids` the local ledger may grant (server-only ones removed). */
export function localEntitlements(ids: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const id of ids) if (!isServerOnlyEntitlement(id)) out.add(id);
  return out;
}
