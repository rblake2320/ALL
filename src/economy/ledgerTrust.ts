/**
 * Ledger trust boundary (security review 2026-11-05, M-1). The local Bones ledger is an UNKEYED SHA-256 chain by
 * design: `verifyChain` proves structure (no torn writes, no naive edits), not authorship — anyone can build a valid
 * chain with `planAppend` (e.g. 500,000 Bones). That is acceptable for offline play and must stay contained:
 *
 *  - every export/view of the local ledger carries `trust: 'local-unverified'`;
 *  - `acceptAsAuthoritative` is the ONLY door through which ledger data could ever become authoritative, and it
 *    refuses anything local. No server import API exists yet; the future server (W-096/W-099) plugs in behind
 *    `ServerLedgerSource` with its own signature verification and must never import a local balance, entitlement,
 *    `quests.grants`, `worldId` or `flags` as truth (review §8.1).
 * Grave Gold is server-only already (ledger.ts refuses `gg`, ServerWallet has no credit method) — unchanged.
 */
import type { LedgerEntry } from '../shared/economy';
import type { LedgerState } from './ledgerStore';

export const LOCAL_LEDGER_EXPORT_FORMAT = 'afterlife-lease-ledger-export';

/** A local ledger snapshot for diagnostics / support / a future account-link UI. Never authoritative. */
export interface LocalLedgerExport {
  format: typeof LOCAL_LEDGER_EXPORT_FORMAT;
  v: 1;
  trust: 'local-unverified';
  status: LedgerState['status'];
  count: number;
  headHash: string;
  bones: number;
  entitlements: string[];
  entries: LedgerEntry[];
}

export function exportLocalLedger(s: LedgerState): LocalLedgerExport {
  return {
    format: LOCAL_LEDGER_EXPORT_FORMAT,
    v: 1,
    trust: 'local-unverified',
    status: s.status,
    count: s.entries.length,
    headHash: s.headHash,
    bones: s.totals.bones,
    entitlements: [...s.totals.entitlements].sort(),
    entries: s.entries.map((e) => ({ ...e, ...(e.entitlements ? { entitlements: [...e.entitlements] } : {}) })),
  };
}

declare const authoritativeBrand: unique symbol;

/** Ledger data verified by the server. Only a `ServerLedgerSource` may produce it (none exists yet). */
export interface AuthoritativeLedger {
  readonly [authoritativeBrand]: true;
  readonly trust: 'server-verified';
  readonly bones: number;
  readonly entitlements: ReadonlySet<string>;
}

/** Phase 4 seam: the server's ledger, fetched and signature-checked by the server client. */
export interface ServerLedgerSource {
  fetchVerified(): Promise<AuthoritativeLedger>;
}

export type AuthorityRefusal = { ok: false; reason: 'local-unverified' | 'no-verifier'; message: string };

/**
 * The one gate before ledger data could be treated as authoritative. Offline it ALWAYS refuses: local data
 * (`trust: 'local-unverified'`, a LedgerState, a LocalLedgerExport, a raw chain) → 'local-unverified'; anything that
 * merely CLAIMS 'server-verified' → 'no-verifier' (a claim is not a signature, and no verifier is wired in this build).
 */
export function acceptAsAuthoritative(data: unknown): AuthorityRefusal {
  const trust = data && typeof data === 'object' ? (data as { trust?: unknown }).trust : undefined;
  if (trust === 'server-verified') return { ok: false, reason: 'no-verifier', message: 'No server ledger verifier exists in this build; claimed server data is not trusted.' };
  return { ok: false, reason: 'local-unverified', message: 'A local Bones ledger is never authoritative (it is not signed by the server).' };
}
