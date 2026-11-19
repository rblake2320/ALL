/**
 * DEV-ONLY picking ground truth: renders the scene once with every agent / object / wall / floor in a unique flat
 * ID colour (merged chunks and static batches swapped for the precise originals, overlays/sky/fog/shadows off) and
 * reads back what is visible under each sample point. Used by dev/render.pick.cjs to measure pick() accuracy.
 */
import * as THREE from 'three';

export interface TruthSample {
  x: number;
  y: number;
}

/** 'agent:<id>' | 'object:<id>' | 'wall' | 'ground' | 'none' per sample (CSS px relative to the canvas). */
export function pickTruth(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, cssW: number, cssH: number, samples: TruthSample[]): string[] {
  const W = Math.max(1, Math.floor(cssW));
  const H = Math.max(1, Math.floor(cssH));
  const idList = ['none'];
  const idIndex = new Map<string, number>([['none', 0]]);
  const ident = (s: string): number => {
    let i = idIndex.get(s);
    if (i === undefined) {
      i = idList.length;
      idIndex.set(s, i);
      idList.push(s);
    }
    return i;
  };
  const topName = (o: THREE.Object3D): string => {
    let n: THREE.Object3D | null = o;
    while (n && n.parent && n.parent !== scene) n = n.parent;
    return n ? n.name : '';
  };
  const identityOf = (o: THREE.Object3D): string | null => {
    const top = topName(o);
    if (top === 'objects') {
      let h: THREE.Object3D | null = o;
      while (h && !(h.userData && h.userData.objectId)) h = h.parent;
      return h ? `object:${String(h.userData.objectId)}` : null;
    }
    if (top === 'agents') {
      let h: THREE.Object3D | null = o;
      while (h && !(h.userData && h.userData.agentId)) h = h.parent;
      return h ? `agent:${String(h.userData.agentId)}` : null;
    }
    if (top === 'walls') return 'wall';
    if (top === 'floors') return 'ground';
    if (top === 'world-dressing') return o.name === 'ground' ? 'ground' : 'none';
    return null;
  };
  const restoreVis: [THREE.Object3D, boolean][] = [];
  const restoreMat: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
  const mats = new Map<number, THREE.MeshBasicMaterial>();
  const setVis = (o: THREE.Object3D, v: boolean) => {
    restoreVis.push([o, o.visible]);
    o.visible = v;
  };
  // 1. visibility: originals instead of merged copies; no overlays
  scene.traverse((o) => {
    const top = topName(o);
    if (o.userData && (o.userData.staticChunk || o.userData.staticBatch || o.userData.staticBatchPart || o.userData.__rimShell)) setVis(o, false);
    const info = o.userData && (o.userData.__staticBatch as { sources?: THREE.Mesh[] } | undefined);
    if (info && Array.isArray(info.sources)) for (const s of info.sources) setVis(s, true);
    if (o.parent === scene && !['objects', 'agents', 'walls', 'floors', 'world-dressing', 'lighting'].includes(top)) setVis(o, false);
  });
  // 2. ID materials
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const id = identityOf(m);
    const n = id === null ? 0 : ident(id);
    // same face culling as the real material, so the ID pass shows exactly the surfaces the player sees
    const src = Array.isArray(m.material) ? m.material[0] : m.material;
    const side = src ? src.side : THREE.FrontSide;
    const key = n * 4 + side;
    let mat = mats.get(key);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ fog: false, toneMapped: false, side });
      mat.color.setRGB(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, THREE.LinearSRGBColorSpace);
      mats.set(key, mat);
    }
    restoreMat.push([m, m.material]);
    m.material = mat;
  });
  const fog = scene.fog;
  const bg = scene.background;
  const env = scene.environment;
  const shadows = gl.shadowMap.enabled;
  const prevTarget = gl.getRenderTarget();
  const clear = gl.getClearColor(new THREE.Color());
  const clearA = gl.getClearAlpha();
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType });
  rt.texture.colorSpace = THREE.NoColorSpace;
  const px = new Uint8Array(W * H * 4);
  const out: string[] = [];
  try {
    scene.fog = null;
    scene.background = null;
    scene.environment = null;
    gl.shadowMap.enabled = false;
    gl.setClearColor(0x000000, 1);
    gl.setRenderTarget(rt);
    gl.clear();
    gl.render(scene, camera);
    gl.readRenderTargetPixels(rt, 0, 0, W, H, px);
  } finally {
    gl.setRenderTarget(prevTarget);
    gl.setClearColor(clear, clearA);
    scene.fog = fog;
    scene.background = bg;
    scene.environment = env;
    gl.shadowMap.enabled = shadows;
    for (const [m, mat] of restoreMat) m.material = mat;
    for (let i = restoreVis.length - 1; i >= 0; i--) restoreVis[i][0].visible = restoreVis[i][1];
    for (const m of mats.values()) m.dispose();
    rt.dispose();
  }
  for (const s of samples) {
    const x = Math.min(W - 1, Math.max(0, Math.floor(s.x)));
    const y = Math.min(H - 1, Math.max(0, Math.floor(s.y)));
    const i = ((H - 1 - y) * W + x) * 4;
    const n = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    out.push(idList[n] ?? 'none');
  }
  return out;
}
