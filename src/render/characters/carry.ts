/**
 * Procedural carry items. Each item is modelled around its own origin (documented per builder) in item space:
 * +Y = up, +Z = forward. Two placements:
 *  - 'palm' (default): parented to prop_R / prop_L, whose frame is +Y up off the palm and +Z forward in the carry
 *    pose; the item is shifted by its PALM_OFFSET so it rests on the upturned palm.
 *  - anchored ('centered' | 'open'): parented to a bone with a per-clip matrix exported in the GLB
 *    (Rig extras carryAnchors, computed in tools/blender/characters/lib/anchors.py), item origin at the anchor.
 * Items are authored as small groups of primitives, then baked into ONE vertex-coloured mesh (plus one emissive
 * mesh for glowing parts such as the phone screen) so a carried item costs a single draw call.
 * Geometry and materials are shared by every rig and owned by the CarryLibrary (disposed with the factory).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CarryItem } from '../../shared/appearance';

/** 'palm' = default carry on the palm; 'centered' = anchored at the item origin; 'open' = open book. */
export type CarryVariant = 'palm' | 'centered' | 'open';
/** Extra props an anchor can add to the other hand (e.g. a fork while eating). */
export type CarryExtra = 'fork';

/** Item-origin offset from the prop bone in the default palm carry. */
const PALM_OFFSET: Record<CarryItem, [number, number, number]> = {
  plate: [0, 0.001, 0.04],
  dish: [0, 0.001, 0.04],
  ingredients: [0, 0, 0.05],
  limb: [0, 0.03, 0.12],
  book: [0, 0.002, 0.05],
  phone: [0, 0.013, 0.04],
  brush: [0, 0.012, 0.04],
  pizza: [0, 0, 0.1],
};

type Builder = () => THREE.Object3D;

export class CarryLibrary {
  private geos: THREE.BufferGeometry[] = [];
  private mats = new Map<string, THREE.MeshStandardMaterial>();
  private templates = new Map<string, THREE.Object3D>();
  private disposed = false;
  /** Shared materials of the baked items: vertex colours carry the per-part colour. */
  private readonly baked = {
    solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0, name: 'Carry' }),
    glow: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0, emissive: '#7fe0ff',
      emissiveIntensity: 2.0, name: 'CarryGlow' }),
  };

  private mat(hex: string, rough = 0.75, emissive?: string, emissiveIntensity = 0, metal = 0): THREE.MeshStandardMaterial {
    const key = `${hex}|${rough}|${emissive ?? ''}|${emissiveIntensity}|${metal}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal });
      if (emissive) {
        m.emissive.set(emissive);
        m.emissiveIntensity = emissiveIntensity;
      }
      m.name = `Carry_${hex}`;
      this.mats.set(key, m);
    }
    return m;
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  private mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, shadow = true): THREE.Mesh {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    return mesh;
  }

  /** Bumpy pink brain loaf (two hemispheres). Origin: bottom centre. */
  private brain(scale = 1): THREE.Object3D {
    const g = this.geo(new THREE.SphereGeometry(0.055, 12, 9));
    const pos = g.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const w = 1 + 0.08 * Math.sin(v.x * 140) * Math.sin(v.z * 120 + v.y * 60);
      pos.setXYZ(i, v.x * w, Math.max(v.y, -0.01) * 0.75 * w, v.z * 1.2 * w);
    }
    g.computeVertexNormals();
    const pink = this.mat('#d68a96', 0.55);
    const grp = new THREE.Group();
    const a = this.mesh(g, pink, -0.028, 0.008, 0);
    const b = this.mesh(g, pink, 0.028, 0.008, 0);
    a.rotation.z = 0.12;
    b.rotation.z = -0.12;
    grp.add(a, b);
    grp.scale.setScalar(scale);
    return grp;
  }

  /** Plate. Origin: centre of the plate bottom. */
  private plate(dirty: boolean): THREE.Object3D {
    const grp = new THREE.Group();
    const rim = this.geo(new THREE.CylinderGeometry(0.125, 0.095, 0.022, 20));
    grp.add(this.mesh(rim, this.mat('#e8e0c8', 0.45), 0, 0.011, 0));
    const well = this.geo(new THREE.CylinderGeometry(0.092, 0.092, 0.004, 18));
    grp.add(this.mesh(well, this.mat('#d9cfb8', 0.5), 0, 0.022, 0, false));
    if (dirty) {
      const smear = this.geo(new THREE.CylinderGeometry(0.035, 0.035, 0.005, 8));
      const brown = this.mat('#6b5a3a', 0.9);
      const green = this.mat('#7e9a52', 0.9);
      grp.add(this.mesh(smear, brown, 0.03, 0.025, 0.02, false), this.mesh(smear, green, -0.04, 0.025, -0.03, false));
      const fork = this.fork();
      fork.position.set(0.0, 0.03, 0.0);
      fork.rotation.set(-Math.PI / 2 + 0.05, 0, 0.5);
      grp.add(fork);
    } else {
      grp.add(this.brain());
      grp.children[grp.children.length - 1].position.set(0, 0.022, 0);
    }
    return grp;
  }

  /** Kitchen fork. Origin: the grip (inside the fist); handle toward -Z, tines toward +Z. */
  private fork(): THREE.Object3D {
    const grp = new THREE.Group();
    const steel = this.mat('#b8bec4', 0.32, undefined, 0, 0.75);
    const handle = this.geo(new THREE.BoxGeometry(0.012, 0.006, 0.12));
    grp.add(this.mesh(handle, steel, 0, 0, 0.03, false));
    const neck = this.geo(new THREE.BoxGeometry(0.02, 0.005, 0.03));
    grp.add(this.mesh(neck, steel, 0, 0.002, 0.1, false));
    const tine = this.geo(new THREE.BoxGeometry(0.0035, 0.004, 0.045));
    for (const x of [-0.0075, 0, 0.0075]) grp.add(this.mesh(tine, steel, x, 0.004, 0.135, false));
    // a speared morsel of brain on the tines
    const bite = this.geo(new THREE.SphereGeometry(0.014, 8, 6));
    grp.add(this.mesh(bite, this.mat('#d68a96', 0.55), 0, 0.006, 0.14, false));
    return grp;
  }

  /** Paper grocery bag with a carrot and a bone sticking out. Origin: bottom centre. */
  private bag(): THREE.Object3D {
    const grp = new THREE.Group();
    const box = this.geo(new THREE.BoxGeometry(0.17, 0.22, 0.12));
    grp.add(this.mesh(box, this.mat('#b89a6a', 0.95), 0, 0.11, 0));
    const top = this.geo(new THREE.BoxGeometry(0.175, 0.03, 0.125));
    const t = this.mesh(top, this.mat('#a3865a', 0.95), 0, 0.225, 0);
    t.rotation.x = 0.12;
    grp.add(t);
    const carrot = this.geo(new THREE.ConeGeometry(0.018, 0.12, 6));
    const c = this.mesh(carrot, this.mat('#d9772b', 0.7), -0.04, 0.27, -0.02);
    c.rotation.z = 0.3;
    const leaf = this.geo(new THREE.SphereGeometry(0.04, 7, 5));
    const bone = this.geo(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 6));
    const b = this.mesh(bone, this.mat('#e8e0c8', 0.6), 0.04, 0.27, 0.02);
    b.rotation.z = -0.4;
    grp.add(c, this.mesh(leaf, this.mat('#6f8f5e', 0.85), 0.02, 0.24, -0.03), b);
    return grp;
  }

  /** A spare (stitched) forearm. Origin: centre of the limb. */
  private limb(): THREE.Object3D {
    const grp = new THREE.Group();
    const skin = this.mat('#9fb88a', 0.65);
    const arm = this.geo(new THREE.CylinderGeometry(0.036, 0.044, 0.42, 8));
    const a = this.mesh(arm, skin, 0, 0, 0);
    a.rotation.x = Math.PI / 2;
    const hand = this.geo(new THREE.SphereGeometry(0.045, 8, 6));
    const h = this.mesh(hand, skin, 0, 0, 0.23);
    h.scale.set(1, 0.55, 1.3);
    const cuff = this.geo(new THREE.CylinderGeometry(0.052, 0.05, 0.05, 8));
    const c = this.mesh(cuff, this.mat('#6b4f8a', 0.9), 0, 0, -0.22);
    c.rotation.x = Math.PI / 2;
    const stitch = this.geo(new THREE.TorusGeometry(0.039, 0.005, 4, 10));
    const s = this.mesh(stitch, this.mat('#2a2230', 0.9), 0, 0, 0.15, false);
    grp.add(a, h, c, s);
    return grp;
  }

  /** Closed book. Origin: bottom centre. */
  private book(): THREE.Object3D {
    const grp = new THREE.Group();
    const cover = this.geo(new THREE.BoxGeometry(0.16, 0.035, 0.22));
    grp.add(this.mesh(cover, this.mat('#6e2a35', 0.8), 0, 0.018, 0));
    const pages = this.geo(new THREE.BoxGeometry(0.15, 0.028, 0.205));
    grp.add(this.mesh(pages, this.mat('#e8e0c8', 0.9), 0.006, 0.018, 0, false));
    return grp;
  }

  /**
   * Open book held up to read. Origin: centre of the spine; pages face +Y, top edge toward +Z, the two pages
   * fan out to +-X in a shallow V.
   */
  private openBook(): THREE.Object3D {
    const grp = new THREE.Group();
    const coverMat = this.mat('#6e2a35', 0.8);
    const pageMat = this.mat('#e8e0c8', 0.9);
    const inkMat = this.mat('#6b5a4a', 0.95);
    const cover = this.geo(new THREE.BoxGeometry(0.135, 0.006, 0.19));
    const pages = this.geo(new THREE.BoxGeometry(0.125, 0.012, 0.178));
    const line = this.geo(new THREE.BoxGeometry(0.085, 0.001, 0.006));
    for (const side of [-1, 1]) {
      const half = new THREE.Group();
      half.rotation.z = side * 0.21; // pages rise from the spine
      const c = this.mesh(cover, coverMat, side * 0.0675, -0.004, 0);
      const p = this.mesh(pages, pageMat, side * 0.064, 0.005, 0, false);
      half.add(c, p);
      for (let i = 0; i < 4; i++) half.add(this.mesh(line, inkMat, side * 0.064, 0.0115, 0.06 - i * 0.035, false));
      grp.add(half);
    }
    const spine = this.geo(new THREE.CylinderGeometry(0.008, 0.008, 0.19, 6));
    const s = this.mesh(spine, coverMat, 0, -0.006, 0, false);
    s.rotation.x = Math.PI / 2;
    grp.add(s);
    return grp;
  }

  /**
   * Chunky retro brick phone (reads from the 3/4 camera even when held to the ear). Origin: centre; long axis +Z
   * (earpiece end), screen + keypad on the +Y face, stubby antenna on top.
   */
  private phone(): THREE.Object3D {
    const grp = new THREE.Group();
    const body = this.geo(new THREE.BoxGeometry(0.054, 0.026, 0.13));
    grp.add(this.mesh(body, this.mat('#2b2f3a', 0.45), 0, 0, 0));
    const face = this.geo(new THREE.BoxGeometry(0.046, 0.002, 0.118));
    grp.add(this.mesh(face, this.mat('#3a3f55', 0.5), 0, 0.0135, 0, false));
    const screen = this.geo(new THREE.BoxGeometry(0.036, 0.002, 0.034));
    grp.add(this.mesh(screen, this.mat('#7fe0ff', 0.3, '#7fe0ff', 2.2), 0, 0.0148, 0.033, false));
    const key = this.geo(new THREE.BoxGeometry(0.009, 0.003, 0.007));
    const keyMat = this.mat('#d9cfb8', 0.6);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) grp.add(this.mesh(key, keyMat, (c - 1) * 0.013, 0.0148, -0.004 - r * 0.012, false));
    const antenna = this.geo(new THREE.CylinderGeometry(0.004, 0.005, 0.045, 6));
    const a = this.mesh(antenna, this.mat('#1d1726', 0.5), 0.018, 0.0, 0.085, false);
    a.rotation.x = Math.PI / 2;
    const knob = this.geo(new THREE.SphereGeometry(0.0065, 6, 5));
    grp.add(a, this.mesh(knob, this.mat('#a5532f', 0.6), 0.018, 0, 0.108, false));
    return grp;
  }

  /** Paint brush. Origin: the grip; bristles toward +Z. */
  private brush(): THREE.Object3D {
    const grp = new THREE.Group();
    const handle = this.geo(new THREE.CylinderGeometry(0.007, 0.009, 0.22, 6));
    const h = this.mesh(handle, this.mat('#8a5a36', 0.7), 0, 0, 0);
    h.rotation.x = Math.PI / 2;
    const ferrule = this.geo(new THREE.CylinderGeometry(0.01, 0.01, 0.03, 6));
    const f = this.mesh(ferrule, this.mat('#9aa0a6', 0.35), 0, 0, 0.125, false);
    f.rotation.x = Math.PI / 2;
    const tip = this.geo(new THREE.ConeGeometry(0.011, 0.045, 6));
    const t = this.mesh(tip, this.mat('#a5532f', 0.6), 0, 0, 0.16, false);
    t.rotation.x = Math.PI / 2;
    grp.add(h, f, t);
    return grp;
  }

  /** Brain Pizza delivery box (lid seam, grease stain, brain logo). Origin: bottom centre. */
  private pizza(): THREE.Object3D {
    const grp = new THREE.Group();
    const box = this.geo(new THREE.BoxGeometry(0.34, 0.044, 0.34));
    grp.add(this.mesh(box, this.mat('#c8a878', 0.95), 0, 0.022, 0));
    const lid = this.geo(new THREE.BoxGeometry(0.345, 0.008, 0.345));
    grp.add(this.mesh(lid, this.mat('#b8966a', 0.95), 0, 0.046, 0, false));
    const stain = this.geo(new THREE.CircleGeometry(0.035, 10));
    const st = this.mesh(stain, this.mat('#9a7a4a', 0.95), 0.1, 0.0505, -0.09, false);
    st.rotation.x = -Math.PI / 2;
    const logo = this.geo(new THREE.CircleGeometry(0.065, 16));
    const l = this.mesh(logo, this.mat('#6e2a35', 0.8), 0, 0.0505, 0, false);
    l.rotation.x = -Math.PI / 2;
    const b = this.brain(0.62);
    b.position.set(0, 0.049, 0.004);
    b.scale.y *= 0.35;
    grp.add(st, l, b);
    return grp;
  }

  private buildItem(item: CarryItem, variant: CarryVariant): THREE.Object3D {
    if (item === 'book' && variant === 'open') return this.openBook();
    const builders: Record<CarryItem, Builder> = {
      plate: () => this.plate(false),
      dish: () => this.plate(true),
      ingredients: () => this.bag(),
      limb: () => this.limb(),
      book: () => this.book(),
      phone: () => this.phone(),
      brush: () => this.brush(),
      pizza: () => this.pizza(),
    };
    return builders[item]();
  }

  /**
   * Merge an authored group into one mesh per kind (solid / emissive): every part's transform is applied to a copy
   * of its geometry and its material colour becomes a vertex colour. The authoring geometries are released.
   */
  private bake(group: THREE.Object3D): THREE.Object3D {
    group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const parts: Record<'solid' | 'glow', THREE.BufferGeometry[]> = { solid: [], glow: [] };
    const shadow: Record<'solid' | 'glow', boolean> = { solid: false, glow: false };
    const used = new Set<THREE.BufferGeometry>();
    const col = new THREE.Color();
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      const kind = mat.emissiveIntensity > 0 && mat.emissive.getHex() !== 0 ? 'glow' : 'solid';
      const g = m.geometry.clone();
      used.add(m.geometry);
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      const n = g.getAttribute('position').count;
      const colors = new Float32Array(n * 3);
      col.copy(mat.color);
      for (let i = 0; i < n; i++) {
        colors[i * 3] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      if (!g.index) g.setIndex([...Array(n).keys()]);
      parts[kind].push(g);
      if (m.castShadow) shadow[kind] = true;
    });
    const out = new THREE.Group();
    for (const kind of ['solid', 'glow'] as const) {
      if (!parts[kind].length) continue;
      const merged = mergeGeometries(parts[kind], false);
      for (const g of parts[kind]) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      this.geos.push(merged);
      const mesh = new THREE.Mesh(merged, this.baked[kind]);
      mesh.name = kind === 'solid' ? 'carryMesh' : 'carryGlow';
      mesh.castShadow = shadow[kind] && kind === 'solid';
      out.add(mesh);
    }
    // the authoring primitives are no longer needed
    this.geos = this.geos.filter((g) => {
      if (!used.has(g)) return true;
      g.dispose();
      return false;
    });
    return out;
  }

  private template(key: string, make: () => THREE.Object3D): THREE.Object3D {
    let tpl = this.templates.get(key);
    if (!tpl) {
      tpl = this.bake(make());
      this.templates.set(key, tpl);
    }
    return tpl;
  }

  /**
   * New instance (a clone sharing geometry/materials) named `carry_<item>`. 'palm' places the item origin at its
   * palm offset from the prop bone; anchored variants put the origin at the parent's origin.
   */
  create(item: CarryItem, variant: CarryVariant = 'palm'): THREE.Object3D {
    const v: CarryVariant = variant === 'open' && item !== 'book' ? 'centered' : variant;
    const key = `${item}|${v === 'palm' ? 'centered' : v}`;
    const model = this.template(key, () => this.buildItem(item, v)).clone(true);
    const root = new THREE.Group();
    root.name = `carry_${item}`;
    root.userData.carryVariant = v;
    if (v === 'palm') {
      const o = PALM_OFFSET[item];
      model.position.set(o[0], o[1], o[2]);
    }
    root.add(model);
    return root;
  }

  /** Extra prop for an anchored placement (named `carry_<extra>`), origin at the grip. */
  createExtra(extra: CarryExtra): THREE.Object3D {
    const root = new THREE.Group();
    root.name = `carry_${extra}`;
    root.add(this.template(`extra|${extra}`, () => this.fork()).clone(true));
    return root;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    for (const g of this.geos) g.dispose();
    for (const m of this.mats.values()) m.dispose();
    this.baked.solid.dispose();
    this.baked.glow.dispose();
    this.geos = [];
    this.mats.clear();
    this.templates.clear();
    this.disposed = true;
  }
}
