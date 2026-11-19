import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HomeShellLibrary } from '../../../src/render/world/homeShells';
import { LotVisual, type VisualContext } from '../../../src/render/world/regionVisuals';
import { buildWorldMap } from '../../../src/shared/mildewLane';

describe('a real vacant world lot', () => {
  it('stays vacant through active/warm/refresh instead of drawing a seeded placeholder house', () => {
    const shells = new HomeShellLibrary('/assets/', null);
    const sidewalk = new THREE.MeshBasicMaterial();
    const def = buildWorldMap({ seed: 1, genVersion: 1, contentVersion: 1 }, { regionId: 'wormwood:mildew_n2', templateId: 'starter' }).regions.find((r) => r.id === 'wormwood:mildew_n1')!;
    def.templateId = 'empty';
    const context = { shells, seed: 1, profile: 'desktop', lotTransform: () => null, kit: { sidewalk } } as unknown as VisualContext;
    const lot = new LotVisual(def.id, context, def);
    try {
      expect(lot.shellId).toBe('');
      lot.build('active');
      lot.setTier('warm');
      lot.setTier('active');
      lot.refresh();
      expect(lot.shellObject()).toBeNull();
      expect(lot.isPlaceholder()).toBe(false);
      expect(lot.pickBoxes()).toHaveLength(0);
      expect(lot.root.getObjectByName('yard')).toBeUndefined();
    } finally { lot.dispose(); shells.dispose(); sidewalk.dispose(); }
  });
});
