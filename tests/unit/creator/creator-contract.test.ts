import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { verifyPack, PackRegistry } from '../../../src/packs';
import { brandSkinFor } from '../../../src/economy/brands';

function fixture(): Map<string, Uint8Array> {
  return new Map(['pack.json', 'art/logo.svg'].map(name => [name,
    new Uint8Array(readFileSync(new URL(`../../../docs/contributors/examples/creator-demo/${name}`, import.meta.url)))]));
}

describe('Creator Kit exported example with the game runtime', () => {
  it('registers the actual exported directory pack and restores the built-in resolver', async () => {
    const result = await verifyPack(fixture(), { trustedKeys: [], creatorMode: true, engineVersion: '1.0.0' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const prior = brandSkinFor('fridge_humming')?.id;
    const registry = new PackRegistry();
    try {
      expect(registry.register(result.pack)).toEqual({ ok: true });
      expect(brandSkinFor('fridge_humming')?.id).toBe('creator_demo');
      expect(registry.register(result.pack).ok).toBe(false);
    } finally { registry.unregister(result.pack.manifest.id); }
    expect(brandSkinFor('fridge_humming')?.id).toBe(prior);
  });

  it('refuses the unsigned example without explicit Creator mode', async () => {
    const result = await verifyPack(fixture(), { trustedKeys: [], engineVersion: '1.0.0' });
    expect(result).toMatchObject({ ok: false, stage: 'signature' });
  });

  it('refuses modified artwork and unlisted files from the exported pack', async () => {
    const tampered = fixture(); tampered.set('art/logo.svg', new Uint8Array([1, 2, 3]));
    expect(await verifyPack(tampered, { trustedKeys: [], creatorMode: true, engineVersion: '1.0.0' })).toMatchObject({ ok: false, stage: 'assets' });
    const extra = fixture(); extra.set('extra.svg', new Uint8Array([1]));
    expect(await verifyPack(extra, { trustedKeys: [], creatorMode: true, engineVersion: '1.0.0' })).toMatchObject({ ok: false, stage: 'assets' });
  });
});
