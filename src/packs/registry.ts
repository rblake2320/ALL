/**
 * All-or-nothing pack registration (docs/MONETIZATION.md §5): a verified pack is registered only if EVERY item can be
 * registered (no id clashes with built-in or already registered content); otherwise nothing changes. Unregistering
 * removes exactly what the pack added. Brand skins feed `brandSkinFor()` (src/economy/brands.ts).
 */
import type { BrandSkin } from '../shared/economy';
import { HOUSE_BRAND_SKINS, setPackBrandSkins } from '../economy/brands';
import type { VerifiedPack } from './verify';

export type RegisterResult = { ok: true } | { ok: false; error: string };

export class PackRegistry {
  private readonly packs = new Map<string, VerifiedPack>();

  constructor(private readonly apply: (skins: readonly BrandSkin[]) => void = setPackBrandSkins) {}

  list(): VerifiedPack[] {
    return [...this.packs.values()];
  }

  register(p: VerifiedPack): RegisterResult {
    const id = p.manifest.id;
    if (this.packs.has(id)) return { ok: false, error: `pack "${id}" is already loaded` };
    const skins = p.manifest.contents.brandSkins ?? [];
    const builtin = new Set<string>(HOUSE_BRAND_SKINS.map((s) => s.id));
    const byPacks = new Set<string>();
    for (const other of this.packs.values()) for (const s of other.manifest.contents.brandSkins ?? []) byPacks.add(s.id);
    const mine = new Set<string>();
    for (const s of skins) {
      // A SIGNED pack may re-ship a built-in house skin (same id) — that overrides it; any other clash is refused.
      const clash = byPacks.has(s.id) || mine.has(s.id) || (builtin.has(s.id) && !p.signed);
      if (clash) return { ok: false, error: `brand skin id "${s.id}" is already in use` };
      mine.add(s.id);
    }
    const next = new Map(this.packs);
    next.set(id, p);
    try {
      this.apply(collect(next));
    } catch (e) {
      return { ok: false, error: `registration failed: ${(e as Error).message}` };
    }
    this.packs.set(id, p);
    return { ok: true };
  }

  unregister(id: string): boolean {
    if (!this.packs.delete(id)) return false;
    this.apply(collect(this.packs));
    return true;
  }
}

function collect(packs: ReadonlyMap<string, VerifiedPack>): BrandSkin[] {
  const out: BrandSkin[] = [];
  for (const p of packs.values()) for (const s of p.manifest.contents.brandSkins ?? []) out.push(s);
  return out;
}
