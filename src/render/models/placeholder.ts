/**
 * Procedural stand-ins used when a GLB is missing, fails to load, or the id is unknown. Sized from the catalog
 * (footprint x height, wall/opening/item conventions), coloured by category, with a darker front notch so the
 * facing (+Z) is always readable. The main material is named 'Paint' so tints still apply.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DIM } from '../../shared/dimensions';
import { shapeBounds, type ModelShape } from './specs';

const CATEGORY_COLOURS: Readonly<Record<string, string>> = {
  seating: '#5b3f6e',
  surfaces: '#6b4a35',
  kitchen: '#cfd6c4',
  preservation: '#7fb8c0',
  beds: '#6e2a35',
  electronics: '#4a4a5e',
  hobbies: '#6f8f5e',
  decor: '#d9cfb8',
  lighting: '#ffb35a',
  outdoor: '#4f6b44',
  misc: '#a5532f',
  doors: '#6b4a35',
  windows: '#8fb0bc',
  item: '#e8e0c8',
  env: '#6f7378',
};

export class PlaceholderFactory {
  private readonly geos = new Map<string, THREE.BufferGeometry[]>();
  private readonly mats = new Map<string, THREE.MeshStandardMaterial>();
  private notchMat: THREE.MeshStandardMaterial | null = null;

  private bodyMat(category: string): THREE.MeshStandardMaterial {
    let m = this.mats.get(category);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: CATEGORY_COLOURS[category] ?? '#8a8a8a', roughness: 0.8, metalness: 0 });
      m.name = 'Paint';
      m.userData = { placeholder: true };
      this.mats.set(category, m);
    }
    return m;
  }

  private notch(): THREE.MeshStandardMaterial {
    if (!this.notchMat) {
      this.notchMat = new THREE.MeshStandardMaterial({ color: '#2b2f3a', roughness: 0.7 });
      this.notchMat.name = 'PlaceholderNotch';
    }
    return this.notchMat;
  }

  private geometries(sh: ModelShape): THREE.BufferGeometry[] {
    const key = `${sh.id}`;
    const hit = this.geos.get(key);
    if (hit) return hit;
    const [x0, y0, z0, x1, y1, z1] = shapeBounds(sh);
    const out: THREE.BufferGeometry[] = [];
    const rb = (w: number, h: number, d: number, cx: number, cy: number, cz: number): THREE.BufferGeometry => {
      const ww = Math.max(0.01, w);
      const hh = Math.max(0.01, h);
      const dd = Math.max(0.01, d);
      const r = Math.max(0.002, Math.min(0.04, ww * 0.2, hh * 0.2, dd * 0.2));
      const g = new RoundedBoxGeometry(ww, hh, dd, 2, r);
      g.translate(cx, cy, cz);
      return g;
    };
    if (sh.placement === 'door' || sh.placement === 'window') {
      const t = z1 - z0;
      const jw = 0.5 - (sh.placement === 'door' ? DIM.DOOR_WIDTH : DIM.WINDOW_WIDTH) / 2;
      const body = [
        rb(jw, y1 - y0, t, -0.5 + jw / 2, (y0 + y1) / 2, 0),
        rb(jw, y1 - y0, t, 0.5 - jw / 2, (y0 + y1) / 2, 0),
        rb(1, 0.08, t, 0, y1 - 0.04, 0),
      ];
      if (sh.placement === 'window') body.push(rb(1, 0.06, t + 0.04, 0, y0 + 0.03, 0));
      out.push(mergeOrFirst(body));
      out.push(rb(0.12, 0.06, 0.03, 0, y1 - 0.04, z1 + 0.01));
    } else {
      const w = x1 - x0;
      const h = y1 - y0;
      const d = z1 - z0;
      out.push(rb(w, h, d, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
      const nw = Math.min(0.2, w * 0.4);
      const nh = Math.min(0.08, h * 0.3);
      out.push(rb(nw, nh, 0.04, (x0 + x1) / 2, y1 - nh / 2, z1 + 0.012));
    }
    this.geos.set(key, out);
    return out;
  }

  create(sh: ModelShape): THREE.Group {
    const g = new THREE.Group();
    g.name = sh.id;
    g.userData = { placeholder: true, modelId: sh.id };
    const [body, notch] = this.geometries(sh);
    const bm = new THREE.Mesh(body, this.bodyMat(String(sh.category)));
    bm.name = `${sh.id}_placeholder`;
    bm.castShadow = sh.height > 0.05;
    bm.receiveShadow = true;
    g.add(bm);
    if (notch) {
      const nm = new THREE.Mesh(notch, this.notch());
      nm.name = `${sh.id}_front`;
      nm.castShadow = false;
      nm.receiveShadow = true;
      g.add(nm);
    }
    return g;
  }

  bounds(sh: ModelShape): THREE.Box3 {
    const [x0, y0, z0, x1, y1, z1] = shapeBounds(sh);
    return new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1 + 0.04));
  }

  dispose(): void {
    for (const list of this.geos.values()) for (const g of list) g.dispose();
    this.geos.clear();
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
    this.notchMat?.dispose();
    this.notchMat = null;
  }
}

/** Merge same-layout geometries into one (falls back to the first part if merging is impossible). */
function mergeOrFirst(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (list.length === 1) return list[0];
  const merged = mergeGeometries(list, false);
  if (!merged) {
    for (let i = 1; i < list.length; i++) list[i].dispose();
    return list[0];
  }
  for (const g of list) g.dispose();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
