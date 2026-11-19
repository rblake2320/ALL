import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HomeShellLibrary, parseHomesManifest } from '../../../src/render/world/homeShells';
import { LotVisual, type VisualContext } from '../../../src/render/world/regionVisuals';
import { buildWorldMap } from '../../../src/shared/mildewLane';
import { START_TEMPLATE_BOUNDS_V1 } from '../../../src/shared/startNeighbours';
import { createStartTemplate } from '../../../src/sim/world/startTemplates';

const manifest = JSON.parse(readFileSync('public/assets/manifest.homes.json', 'utf8'));

describe('neighbour shell geometry follows the actual furnished lot', () => {
  for (const [id, bounds] of Object.entries(START_TEMPLATE_BOUNDS_V1)) {
    it(`${id}: template walls, front door, manifest and shared render bounds agree`, () => {
      const built = createStartTemplate(id);
      const xs: number[] = [], zs: number[] = [];
      for (const key of Object.keys(built.lot.walls)) {
        const [kind, xx, zz] = key.split(':'), x = Number(xx), z = Number(zz);
        xs.push(x, x + (kind === 'h' ? 1 : 0)); zs.push(z, z + (kind === 'v' ? 1 : 0));
      }
      expect({ x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) }).toEqual({ x0: bounds.x0, x1: bounds.x1, z0: bounds.z0, z1: bounds.z1 });
      const door = built.objects.find(o => o.placement.kind === 'opening' && o.defId.startsWith('door_') && o.placement.edge === `h:${bounds.doorX - 0.5}:${bounds.z1}`);
      expect(door).toBeDefined();
      const entry = Object.values(manifest.shells).find((s: any) => s.template === id) as any;
      expect(entry.tileFootprint).toEqual({ w: bounds.x1 - bounds.x0, d: bounds.z1 - bounds.z0 });
      expect(entry.doors[0]).toEqual({ x: bounds.doorX - (bounds.x0 + bounds.x1) / 2, z: (bounds.z1 - bounds.z0) / 2 });
    });

    for (const mirrored of [false, true]) it(`${id}: ${mirrored ? 'mirrored' : 'normal'} rendered shell occupies the real walls; no decorative ghost yard`, () => {
      const shells = new HomeShellLibrary('', null);
      shells.setManifest(parseHomesManifest(manifest));
      const info = shells.forTemplate(id)!;
      const geometry = new THREE.BoxGeometry(info.footprint.w, 3, info.footprint.d).translate(0, 1.5, 0);
      const material = new THREE.MeshStandardMaterial();
      for (const lod of [0, 1] as const) shells.setProto(info.id, lod, [{ geometry, material, glass: false }]);
      const sidewalk = new THREE.MeshBasicMaterial();
      const def = buildWorldMap({ seed: 1, genVersion: 1, contentVersion: 1 }, { regionId: 'wormwood:mildew_n2', templateId: 'starter' }).regions.find(r => r.id === 'wormwood:mildew_n1')!;
      def.templateId = id;
      const dx = 2, dz = -1;
      const ctx = { shells, seed: 1, profile: 'desktop', lotTransform: () => ({ mirrored, dx, dz }), kit: { sidewalk } } as unknown as VisualContext;
      const lot = new LotVisual(def.id, ctx, def);
      try {
        lot.build('active');
        for (const tier of ['active', 'warm', 'active'] as const) {
          lot.setTier(tier); lot.refresh();
          const box = new THREE.Box3().setFromObject(lot.shellObject()!);
          expect(box.min.x).toBeCloseTo((mirrored ? 30 - bounds.x1 : bounds.x0) + dx);
          expect(box.max.x).toBeCloseTo((mirrored ? 30 - bounds.x0 : bounds.x1) + dx);
          expect(box.min.z).toBeCloseTo(bounds.z0 + dz);
          expect(box.max.z).toBeCloseTo(bounds.z1 + dz);
          expect(lot.root.getObjectByName('yard')).toBeUndefined();
        }
      } finally { lot.dispose(); shells.dispose(); sidewalk.dispose(); }
    });
  }
});
