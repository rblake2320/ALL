/**
 * DEV-ONLY placeholder ModelLibrary: bevelled boxes sized by each spec's footprint/height with a few category
 * details (seat backs, table legs, lamp bulbs, screens, door/window frames with 'Glass'), plus simple
 * neighbourhood props for every ENV_MODELS id. Dynamic parts are named per the catalog (bulb, flame, glow,
 * screen, flag, serving_N) and animated by update(). Used when src/render/models is not available.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ModelLibrary, ObjectVisualState } from '../contracts';
import { PHYSICAL_BY_ID, type PhysicalSpec } from '../../shared/catalog';
import { DIM } from '../../shared/dimensions';

const CATEGORY_COLORS: Record<string, string> = {
  seating: '#6e3b3b',
  surfaces: '#6b4a35',
  kitchen: '#8a8f7a',
  preservation: '#7fa3a8',
  beds: '#4a3326',
  electronics: '#4b5156',
  hobbies: '#7a6a3a',
  decor: '#8e6a6a',
  lighting: '#8a7040',
  outdoor: '#6d7275',
  misc: '#6a5a6e',
  doors: '#5e4030',
  windows: '#5e4030',
  item: '#c9b9a0',
};

type Geo = THREE.BufferGeometry;

export function createPlaceholderModels(): ModelLibrary {
  const geoCache = new Map<string, Geo>();
  const boundsCache = new Map<string, THREE.Box3>();
  const shared = {
    dark: new THREE.MeshStandardMaterial({ color: '#2e2629', roughness: 0.8, name: 'Trim' }),
    metal: new THREE.MeshStandardMaterial({ color: '#7d8287', roughness: 0.35, metalness: 0.8, name: 'Metal' }),
    bone: new THREE.MeshStandardMaterial({ color: '#e8e0c8', roughness: 0.7, name: 'Bone' }),
    wood: new THREE.MeshStandardMaterial({ color: '#5a3e2c', roughness: 0.75, name: 'Wood' }),
    leaf: new THREE.MeshStandardMaterial({ color: '#3f5a3a', roughness: 0.9, name: 'Leaf' }),
    bark: new THREE.MeshStandardMaterial({ color: '#3a2f2a', roughness: 0.95, name: 'Bark' }),
    stone: new THREE.MeshStandardMaterial({ color: '#77736b', roughness: 0.9, name: 'Stone' }),
    roof: new THREE.MeshStandardMaterial({ color: '#3b3440', roughness: 0.85, name: 'Roof' }),
    glass: new THREE.MeshStandardMaterial({ color: '#9fb4b8', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.35, name: 'Glass' }),
    mattress: new THREE.MeshStandardMaterial({ color: '#d9cfb8', roughness: 0.9, name: 'Fabric' }),
  };

  const rbox = (w: number, h: number, d: number, r = 0.03): Geo => {
    const key = `rb:${w.toFixed(3)}:${h.toFixed(3)}:${d.toFixed(3)}:${r}`;
    let g = geoCache.get(key);
    if (!g) {
      const rr = Math.max(0.002, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
      g = new RoundedBoxGeometry(Math.max(0.01, w), Math.max(0.01, h), Math.max(0.01, d), 2, rr);
      geoCache.set(key, g);
    }
    return g;
  };
  const cyl = (rt: number, rb: number, h: number, seg = 12): Geo => {
    const key = `cy:${rt}:${rb}:${h}:${seg}`;
    let g = geoCache.get(key);
    if (!g) {
      g = new THREE.CylinderGeometry(rt, rb, h, seg);
      geoCache.set(key, g);
    }
    return g;
  };
  const sphere = (r: number, seg = 12): Geo => {
    const key = `sp:${r}:${seg}`;
    let g = geoCache.get(key);
    if (!g) {
      g = new THREE.SphereGeometry(r, seg, Math.max(6, seg - 4));
      geoCache.set(key, g);
    }
    return g;
  };
  const cone = (r: number, h: number, seg = 10): Geo => {
    const key = `co:${r}:${h}:${seg}`;
    let g = geoCache.get(key);
    if (!g) {
      g = new THREE.ConeGeometry(r, h, seg);
      geoCache.set(key, g);
    }
    return g;
  };

  const mesh = (g: Geo, m: THREE.Material, x: number, y: number, z: number, name = ''): THREE.Mesh => {
    const me = new THREE.Mesh(g, m);
    me.position.set(x, y, z);
    if (name) me.name = name;
    return me;
  };

  const paint = (spec: PhysicalSpec | undefined, tint: string | null | undefined): THREE.MeshStandardMaterial => {
    const c = tint || spec?.variants?.[0] || CATEGORY_COLORS[spec?.category ?? 'misc'] || '#777777';
    const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.72, name: 'Paint' });
    return m;
  };
  const emissive = (color: string, name: string): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: 0, roughness: 0.5, name });

  function buildSpec(spec: PhysicalSpec, tint: string | null | undefined): THREE.Group {
    const g = new THREE.Group();
    const w = spec.footprint.w;
    const d = spec.footprint.d;
    const h = Math.max(0.03, spec.height);
    const p = paint(spec, tint);
    const tags = spec.tags;
    const add = (o: THREE.Object3D) => {
      g.add(o);
      return o;
    };
    if (spec.placement === 'door') {
      const fw = DIM.DOOR_WIDTH;
      const fh = DIM.DOOR_HEIGHT;
      const t = DIM.WALL_THICKNESS + 0.04;
      add(mesh(rbox(0.07, fh, t, 0.01), shared.dark, -fw / 2 - 0.02, fh / 2, 0));
      add(mesh(rbox(0.07, fh, t, 0.01), shared.dark, fw / 2 + 0.02, fh / 2, 0));
      add(mesh(rbox(fw + 0.1, 0.08, t, 0.01), shared.dark, 0, fh, 0));
      const door = new THREE.Group();
      door.name = 'door';
      door.position.set(-fw / 2, 0, 0);
      door.add(mesh(rbox(fw - 0.02, fh - 0.04, 0.05, 0.012), p, fw / 2, fh / 2, 0));
      door.add(mesh(sphere(0.035, 8), shared.metal, fw - 0.1, 1.0, 0.05));
      add(door);
      return g;
    }
    if (spec.placement === 'window') {
      const ww = DIM.WINDOW_WIDTH;
      const wh = h;
      const y0 = DIM.WINDOW_SILL;
      const t = DIM.WALL_THICKNESS + 0.03;
      add(mesh(rbox(ww + 0.1, 0.07, t + 0.06, 0.01), p, 0, y0, 0));
      add(mesh(rbox(ww + 0.08, 0.06, t, 0.01), p, 0, y0 + wh, 0));
      add(mesh(rbox(0.06, wh, t, 0.01), p, -ww / 2, y0 + wh / 2, 0));
      add(mesh(rbox(0.06, wh, t, 0.01), p, ww / 2, y0 + wh / 2, 0));
      add(mesh(rbox(ww, 0.04, 0.04, 0.005), p, 0, y0 + wh / 2, 0));
      add(mesh(rbox(0.035, wh, 0.04, 0.005), p, 0, y0 + wh / 2, 0));
      add(mesh(rbox(ww - 0.04, wh - 0.04, 0.012, 0.004), shared.glass, 0, y0 + wh / 2, 0));
      return g;
    }
    if (spec.placement === 'wall') {
      if (tags.includes('light')) {
        add(mesh(rbox(0.16, 0.22, 0.04, 0.01), shared.metal, 0, 1.6, 0.02));
        add(mesh(rbox(0.05, 0.05, 0.16, 0.01), shared.metal, 0, 1.6, 0.1));
        add(mesh(cyl(0.035, 0.035, 0.16), shared.bone, 0, 1.72, 0.17));
        add(mesh(cone(0.03, 0.08, 8), emissive('#ffb35a', 'flame'), 0, 1.84, 0.17));
      } else {
        add(mesh(rbox(0.74, 0.92, 0.06, 0.012), new THREE.MeshStandardMaterial({ color: '#b08a3e', metalness: 0.6, roughness: 0.4 }), 0, 1.6, 0.03));
        add(mesh(rbox(0.58, 0.76, 0.02, 0.005), p, 0, 1.6, 0.065));
      }
      return g;
    }
    if (spec.layer === 'rug') {
      add(mesh(rbox(w - 0.1, 0.02, d - 0.1, 0.008), p, 0, 0.01, 0));
      return g;
    }
    const iw = Math.max(0.2, w - 0.12);
    const id = Math.max(0.2, d - 0.12);
    if (tags.includes('seat')) {
      const seatH = DIM.SEAT_HEIGHT;
      add(mesh(rbox(iw, seatH * 0.45, id * 0.85, 0.04), p, 0, seatH - seatH * 0.22, 0.03));
      add(mesh(rbox(iw, h - seatH + 0.12, 0.16, 0.04), p, 0, seatH + (h - seatH) / 2 - 0.04, -id / 2 + 0.08));
      if (tags.includes('sofa') || tags.includes('armchair')) {
        add(mesh(rbox(0.14, 0.32, id * 0.85, 0.04), p, -iw / 2 + 0.07, seatH + 0.05, 0.03));
        add(mesh(rbox(0.14, 0.32, id * 0.85, 0.04), p, iw / 2 - 0.07, seatH + 0.05, 0.03));
      }
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ])
        add(mesh(cyl(0.03, 0.025, seatH * 0.55), shared.wood, (sx * iw) / 2.3, seatH * 0.27, (sz * id) / 2.4));
      return g;
    }
    if (tags.includes('surface') || tags.includes('table') || tags.includes('desk') || tags.includes('chess')) {
      const top = Math.min(h, tags.includes('desk') ? DIM.TABLE_HEIGHT : h);
      add(mesh(rbox(iw, 0.06, id, 0.02), p, 0, top - 0.03, 0));
      if (tags.includes('counter')) add(mesh(rbox(iw, top - 0.06, id - 0.06, 0.02), shared.wood, 0, (top - 0.06) / 2, 0));
      else
        for (const [sx, sz] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ])
          add(mesh(cyl(0.035, 0.03, top - 0.06), shared.wood, (sx * iw) / 2.25, (top - 0.06) / 2, (sz * id) / 2.25));
      if (tags.includes('desk')) {
        add(mesh(rbox(0.5, 0.34, 0.08, 0.02), shared.dark, 0, top + 0.2, -id / 2 + 0.2));
        add(mesh(rbox(0.44, 0.28, 0.01, 0.004), emissive('#7fe0ff', 'screen'), 0, top + 0.2, -id / 2 + 0.245));
      }
      if (tags.includes('chess')) for (let i = 0; i < 6; i++) add(mesh(cyl(0.025, 0.035, 0.08, 8), shared.bone, -0.4 + i * 0.16, top + 0.04, 0.05 * (i % 2)));
      return g;
    }
    if (tags.includes('bed')) {
      add(mesh(rbox(iw, DIM.BED_HEIGHT - 0.05, id, 0.05), p, 0, (DIM.BED_HEIGHT - 0.05) / 2, 0));
      add(mesh(rbox(iw - 0.08, 0.1, id - 0.1, 0.04), shared.mattress, 0, DIM.BED_HEIGHT - 0.03, 0.02));
      if (tags.includes('coffin')) {
        const lid = mesh(rbox(iw * 0.6, 0.06, id * 0.95, 0.02), p, iw * 0.45, h - 0.1, 0);
        lid.rotation.z = -0.5;
        add(lid);
        if (spec.dynamicParts?.includes('glow')) add(mesh(rbox(iw - 0.1, 0.02, 0.06, 0.01), emissive('#7fe0ff', 'glow'), 0, DIM.BED_HEIGHT + 0.05, -id / 2 + 0.1));
      } else add(mesh(rbox(iw, h - DIM.BED_HEIGHT + 0.2, 0.12, 0.04), p, 0, h / 2 + 0.1, -id / 2 + 0.06));
      return g;
    }
    if (tags.includes('light')) {
      add(mesh(cyl(0.16, 0.2, 0.06, 14), shared.dark, 0, 0.03, 0));
      add(mesh(cyl(0.025, 0.025, h - 0.25, 8), shared.metal, 0, (h - 0.25) / 2 + 0.05, 0));
      if (tags.includes('candle')) {
        for (let i = -2; i <= 2; i++) {
          add(mesh(cyl(0.03, 0.03, 0.14, 8), shared.bone, i * 0.09, h - 0.12, 0));
          add(mesh(cone(0.022, 0.07, 8), emissive('#ffb35a', 'flame'), i * 0.09, h - 0.01, 0));
        }
      } else {
        add(mesh(sphere(0.15, 14), emissive('#ffd59a', 'bulb'), 0, h - 0.17, 0));
        if (tags.includes('outdoorLight')) add(mesh(rbox(0.36, 0.06, 0.36, 0.02), shared.dark, 0, h - 0.0, 0));
      }
      return g;
    }
    if (tags.includes('tree')) {
      add(mesh(cyl(0.12, 0.2, h * 0.6, 8), shared.bark, 0, h * 0.3, 0));
      for (let i = 0; i < 5; i++) {
        const b = mesh(cyl(0.03, 0.07, h * 0.4, 6), shared.bark, 0, h * 0.62, 0);
        b.rotation.set(0.7 * Math.cos(i * 1.3), i * 1.25, 0.7 * Math.sin(i * 1.3));
        add(b);
      }
      return g;
    }
    if (tags.includes('plant')) {
      add(mesh(cyl(0.16, 0.12, 0.3, 12), new THREE.MeshStandardMaterial({ color: '#7a4a32', roughness: 0.9 }), 0, 0.15, 0));
      for (let i = 0; i < 6; i++) {
        const l = mesh(cone(0.08, h - 0.3, 6), shared.leaf, Math.cos(i) * 0.08, 0.3 + (h - 0.3) / 2, Math.sin(i) * 0.08);
        l.rotation.set(Math.sin(i * 2) * 0.4, 0, Math.cos(i * 2) * 0.4);
        add(l);
      }
      return g;
    }
    if (tags.includes('mailbox')) {
      add(mesh(rbox(0.08, 1.0, 0.08, 0.02), shared.wood, 0, 0.5, 0));
      add(mesh(rbox(0.26, 0.24, 0.44, 0.08), p, 0, 1.08, 0));
      const flag = new THREE.Group();
      flag.name = 'flag';
      flag.position.set(0.15, 1.02, -0.1);
      flag.add(mesh(rbox(0.02, 0.24, 0.02, 0.005), new THREE.MeshStandardMaterial({ color: '#b03a2e' }), 0, 0.12, 0));
      flag.add(mesh(rbox(0.02, 0.08, 0.12, 0.005), new THREE.MeshStandardMaterial({ color: '#c8402f' }), 0, 0.2, 0.06));
      add(flag);
      return g;
    }
    if (spec.placement === 'item') return buildItem(spec, p, g);
    // generic appliance/prop: bevelled box + optional screen/glow/flame/water details
    add(mesh(rbox(iw, h, id, 0.04), p, 0, h / 2, 0));
    if (spec.dynamicParts?.includes('screen')) add(mesh(rbox(iw * 0.7, h * 0.45, 0.012, 0.004), emissive('#9fe870', 'screen'), 0, h * 0.58, id / 2 + 0.006));
    if (spec.dynamicParts?.includes('glow')) add(mesh(rbox(iw * 0.6, 0.04, 0.02, 0.006), emissive('#7fe0ff', 'glow'), 0, h * 0.8, id / 2 + 0.01));
    if (spec.dynamicParts?.includes('flame')) for (const sx of [-0.18, 0.18]) add(mesh(cone(0.07, 0.14, 8), emissive('#ff8a3a', 'flame'), sx, h + 0.06, 0.05));
    if (tags.includes('fridge')) add(mesh(rbox(0.04, 0.3, 0.04, 0.01), shared.metal, iw / 2 - 0.08, h * 0.65, id / 2 + 0.02));
    return g;
  }

  function buildItem(spec: PhysicalSpec, p: THREE.MeshStandardMaterial, g: THREE.Group): THREE.Group {
    const id = spec.id;
    if (id === 'item_fire') {
      for (let i = 0; i < 5; i++) {
        const f = mesh(cone(0.12 - i * 0.012, 0.5 + (i % 3) * 0.18, 8), emissive(i % 2 ? '#ffb35a' : '#ff6a2a', 'flame'), Math.cos(i * 1.7) * 0.15, 0.3, Math.sin(i * 1.7) * 0.15);
        g.add(f);
      }
      return g;
    }
    if (id === 'item_meal' || id === 'item_pizza') {
      g.add(mesh(cyl(0.22, 0.2, 0.03, 18), shared.bone, 0, 0.015, 0));
      for (let i = 0; i < 4; i++) g.add(mesh(sphere(0.07, 10), new THREE.MeshStandardMaterial({ color: id === 'item_pizza' ? '#d9a050' : '#d98a9a', roughness: 0.6 }), Math.cos(i * 1.57) * 0.08, 0.07, Math.sin(i * 1.57) * 0.08, `serving_${i}`));
      return g;
    }
    if (id === 'item_dish') {
      g.add(mesh(cyl(0.13, 0.11, 0.025, 16), shared.bone, 0, 0.012, 0));
      g.add(mesh(cyl(0.08, 0.08, 0.004, 12), new THREE.MeshStandardMaterial({ color: '#6a5a3a' }), 0, 0.027, 0));
      return g;
    }
    if (id === 'item_limb_arm' || id === 'item_limb_leg') {
      const len = id === 'item_limb_arm' ? 0.6 : 0.85;
      const limb = mesh(cyl(0.05, 0.06, len, 10), new THREE.MeshStandardMaterial({ color: '#9fb88a', roughness: 0.8 }), 0, 0.06, 0);
      limb.rotation.z = Math.PI / 2;
      g.add(limb);
      return g;
    }
    if (id === 'item_bonepile') {
      for (let i = 0; i < 7; i++) {
        const b = mesh(cyl(0.025, 0.025, 0.4, 6), shared.bone, Math.cos(i) * 0.15, 0.05 + (i % 3) * 0.04, Math.sin(i * 1.3) * 0.15);
        b.rotation.set(Math.PI / 2, i * 0.9, 0.3);
        g.add(b);
      }
      g.add(mesh(sphere(0.12, 12), shared.bone, 0, 0.22, 0));
      g.add(mesh(sphere(0.2, 10), emissive('#9fe870', 'glow'), 0, 0.3, 0));
      (g.children[g.children.length - 1] as THREE.Mesh).material = new THREE.MeshStandardMaterial({ color: '#9fe870', emissive: new THREE.Color('#9fe870'), emissiveIntensity: 0.6, transparent: true, opacity: 0.25, name: 'glow' });
      return g;
    }
    const h = Math.max(0.05, spec.height);
    g.add(mesh(rbox(0.35, h, 0.3, 0.03), p, 0, h / 2, 0));
    return g;
  }

  function buildEnv(id: string): THREE.Group {
    const g = new THREE.Group();
    const house = (w: number, d: number, h: number, body: string, tower = false) => {
      const bm = new THREE.MeshStandardMaterial({ color: body, roughness: 0.85, name: 'Paint' });
      g.add(mesh(rbox(w, h, d, 0.08), bm, 0, h / 2, 0));
      const roofGeo = new THREE.ConeGeometry(Math.max(w, d) * 0.72, h * 0.55, 4);
      const roof = mesh(roofGeo, shared.roof, 0, h + h * 0.27, 0);
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
      g.add(roof);
      for (let fl = 0; fl < Math.floor(h / 2.8); fl++)
        for (const wx of [-w * 0.3, w * 0.3]) {
          g.add(mesh(rbox(0.9, 1.2, 0.08, 0.02), shared.dark, wx, 1.6 + fl * 2.8, d / 2 + 0.02));
          g.add(mesh(rbox(0.72, 1.0, 0.04, 0.01), shared.glass, wx, 1.6 + fl * 2.8, d / 2 + 0.05));
        }
      g.add(mesh(rbox(1.0, 2.1, 0.1, 0.02), shared.wood, 0, 1.05, d / 2 + 0.03));
      g.add(mesh(rbox(w * 0.7, 0.15, 1.6, 0.03), shared.wood, 0, 0.08, d / 2 + 0.8));
      if (tower) {
        g.add(mesh(rbox(2, h * 1.5, 2, 0.06), bm, w / 2 - 1, (h * 1.5) / 2, -d / 2 + 1));
        g.add(mesh(cone(1.6, 2.4, 4), shared.roof, w / 2 - 1, h * 1.5 + 1.2, -d / 2 + 1));
      }
    };
    switch (id) {
      case 'env_house_a':
        house(8, 8, 6.2, '#6f6a7e');
        break;
      case 'env_house_b':
        house(9, 7, 3.6, '#7d6f5e');
        break;
      case 'env_house_c':
        house(6, 8, 7.5, '#5e6a6a', true);
        break;
      case 'env_streetlamp':
        g.add(mesh(cyl(0.07, 0.11, 4, 10), shared.dark, 0, 2, 0));
        g.add(mesh(rbox(0.06, 0.06, 0.9, 0.02), shared.dark, 0, 3.95, 0.4));
        g.add(mesh(sphere(0.2, 14), emissive('#ffd59a', 'bulb'), 0, 3.75, 0.8));
        break;
      case 'env_fence':
        g.add(mesh(rbox(1.0, 0.05, 0.04, 0.01), shared.dark, 0.5, 0.95, 0));
        g.add(mesh(rbox(1.0, 0.05, 0.04, 0.01), shared.dark, 0.5, 0.3, 0));
        for (let i = 0; i < 5; i++) {
          g.add(mesh(cyl(0.015, 0.015, 1.05, 6), shared.dark, i * 0.2 + 0.1, 0.52, 0));
          g.add(mesh(cone(0.03, 0.09, 6), shared.dark, i * 0.2 + 0.1, 1.08, 0));
        }
        break;
      case 'env_tree_a':
        g.add(mesh(cyl(0.18, 0.32, 3.8, 8), shared.bark, 0, 1.9, 0));
        for (let i = 0; i < 6; i++) {
          const b = mesh(cyl(0.04, 0.1, 2.4, 6), shared.bark, Math.cos(i * 1.1) * 0.5, 4.2, Math.sin(i * 1.1) * 0.5);
          b.rotation.set(0.6 * Math.cos(i * 1.1), 0, -0.6 * Math.sin(i * 1.1));
          g.add(b);
        }
        break;
      case 'env_tree_b':
        g.add(mesh(cyl(0.12, 0.18, 1.2, 8), shared.bark, 0, 0.6, 0));
        for (let i = 0; i < 3; i++) g.add(mesh(cone(1.3 - i * 0.32, 2.2, 9), shared.leaf, 0, 1.6 + i * 1.1, 0));
        break;
      case 'env_bush':
        for (let i = 0; i < 4; i++) g.add(mesh(new THREE.IcosahedronGeometry(0.45 - i * 0.05, 1), shared.leaf, Math.cos(i * 2) * 0.25, 0.4 + (i % 2) * 0.15, Math.sin(i * 2) * 0.25));
        break;
      case 'env_hydrant':
        g.add(mesh(cyl(0.12, 0.14, 0.6, 12), new THREE.MeshStandardMaterial({ color: '#a5532f', roughness: 0.6 }), 0, 0.3, 0));
        g.add(mesh(sphere(0.12, 10), new THREE.MeshStandardMaterial({ color: '#a5532f', roughness: 0.6 }), 0, 0.62, 0));
        break;
      case 'env_gravestones':
        for (let i = 0; i < 3; i++) {
          const s = mesh(rbox(0.55, 0.85 - i * 0.12, 0.14, 0.1), shared.stone, (i - 1) * 0.8, (0.85 - i * 0.12) / 2, i % 2 ? 0.2 : -0.1);
          s.rotation.z = (i - 1) * 0.08;
          g.add(s);
        }
        break;
      case 'env_hearse': {
        const body = new THREE.MeshStandardMaterial({ color: '#1f1c22', roughness: 0.35, metalness: 0.4, name: 'Paint' });
        g.add(mesh(rbox(5, 0.9, 1.9, 0.12), body, 0, 0.75, 0));
        g.add(mesh(rbox(3.2, 0.8, 1.8, 0.15), body, -0.6, 1.55, 0));
        g.add(mesh(rbox(2.6, 0.5, 1.82, 0.05), shared.glass, -0.6, 1.6, 0));
        for (const wx of [-1.7, 1.6]) for (const wz of [-0.9, 0.9]) g.add(mesh(cyl(0.36, 0.36, 0.24, 14), shared.dark, wx, 0.36, wz)).rotation.x = Math.PI / 2;
        break;
      }
      case 'env_cart':
        g.add(mesh(rbox(1.1, 0.6, 0.7, 0.05), new THREE.MeshStandardMaterial({ color: '#a5532f' }), 0, 0.7, 0));
        g.add(mesh(cyl(0.18, 0.18, 0.06, 12), shared.dark, -0.4, 0.18, 0.38)).rotation.x = Math.PI / 2;
        g.add(mesh(cyl(0.18, 0.18, 0.06, 12), shared.dark, 0.4, 0.18, 0.38)).rotation.x = Math.PI / 2;
        break;
      default:
        g.add(mesh(rbox(1, 1, 1, 0.08), new THREE.MeshStandardMaterial({ color: '#888', name: 'Paint' }), 0, 0.5, 0));
    }
    return g;
  }

  const lib: ModelLibrary = {
    ready: Promise.resolve(),
    progress: () => 1,
    has: (id: string) => !!PHYSICAL_BY_ID[id] || id.startsWith('env_'),
    create(modelId: string, tint?: string | null): THREE.Object3D {
      const spec = PHYSICAL_BY_ID[modelId];
      const root = spec ? buildSpec(spec, tint) : buildEnv(modelId);
      root.name = `placeholder:${modelId}`;
      // per-instance dynamic materials (so update() never affects other instances)
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.material && ['bulb', 'flame', 'glow', 'screen'].includes((m.material as THREE.Material).name)) {
          m.material = (m.material as THREE.Material).clone();
          m.name = m.name || (m.material as THREE.Material).name;
        }
      });
      return root;
    },
    update(instance: THREE.Object3D, s: ObjectVisualState, t: number): void {
      instance.traverse((o) => {
        const m = o as THREE.Mesh;
        if (o.name === 'flag') o.rotation.z = s.flag ? -1.4 : 0;
        if (o.name === 'door') o.rotation.y = s.inUse ? -1.1 : 0;
        if (o.name.startsWith('serving_')) o.visible = Number(o.name.slice(8)) < s.servings;
        if (!m.isMesh) return;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (!mat || !mat.emissive) return;
        switch (mat.name) {
          case 'bulb':
            mat.emissiveIntensity = s.lit ? 3.2 : 0;
            break;
          case 'flame':
            mat.emissiveIntensity = s.lit || s.burning || instance.name.includes('item_fire') || (instance.name.includes('stove') && s.inUse) ? 2.5 + 0.8 * Math.sin(t * 17 + m.id) : 0;
            break;
          case 'screen':
            mat.emissiveIntensity = s.powered && (s.inUse || instance.name.includes('arcade')) ? 1.6 + 0.3 * Math.sin(t * 9) : 0.02;
            break;
          case 'glow':
            mat.emissiveIntensity = s.powered ? 1.4 : 0;
            break;
        }
      });
    },
    bounds(modelId: string): THREE.Box3 {
      let b = boundsCache.get(modelId);
      if (!b) {
        const o = lib.create(modelId, null);
        o.updateMatrixWorld(true);
        b = new THREE.Box3().setFromObject(o);
        if (b.isEmpty()) b.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
        boundsCache.set(modelId, b);
      }
      return b.clone();
    },
    dispose(): void {
      for (const g of geoCache.values()) g.dispose();
      geoCache.clear();
      for (const m of Object.values(shared)) m.dispose();
    },
  };
  return lib;
}
