/**
 * Create-a-Zombie preview: its own small WebGL renderer + scene with a zombie rig standing on a turntable
 * plinth (bevelled stone drum, moss felt top, candle-warm key, toxic-green rim, contact shadow).
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CharacterFactory, PreviewStage, ZombieRig } from '../contracts';
import type { ZombieAppearance, LimbState, AnyAnimState, Expression } from '../../shared/appearance';
import { defaultAppearance, intactLimbs, ANIM_STATES, EXPRESSIONS, isExtraAnimState } from '../../shared/appearance';
import type { ThrottledWarn } from '../core/diagnostics';
import { makeCanvas, ctx2d } from '../world/canvasUtil';
import { mulberry32 } from '../core/math';
import { isCastBodyId, castBody } from '../../shared/cast';

const PLINTH_H = 0.2;
const CAM_FOV = 28;
const CAM_BASE = { y: 1.45, z: 4.3, lookY: 0.95 };
/** Tallest top (plinth + figure) the default framing already shows: the tallest classic zombie (skull 1.62 m x 1.08). */
const FRAME_TOP = PLINTH_H + 1.62 * 1.08;
/** Angle (rad) of a point at height `top` above the view axis for a camera at (y, z) looking at (0, lookY, 0). */
const aboveAxis = (top: number, f: { y: number; z: number; lookY: number }) =>
  Math.atan2(top - f.y, f.z) + Math.atan2(f.y - f.lookY, f.z);
/** Headroom the classic framing leaves above its tallest zombie (kept for tall cast bodies). */
const FRAME_ANGLE = aboveAxis(FRAME_TOP, CAM_BASE);

/**
 * Camera framing for an appearance: the classic framing for classic zombies and any cast body no taller than the
 * tallest classic zombie, pulled back + raised just enough for tall cast bodies (bosses ~2 m x 1.06) so the head never clips.
 */
export function previewFraming(app: unknown): { y: number; z: number; lookY: number } {
  const a = (app && typeof app === 'object' ? app : {}) as { body?: unknown; height?: unknown };
  const hRaw = typeof a.height === 'number' && Number.isFinite(a.height) ? Math.min(1, Math.max(0, a.height)) : 0.5;
  if (!isCastBodyId(a.body)) return { ...CAM_BASE }; // classic framing unchanged
  const top = PLINTH_H + castBody(a.body).height * (0.94 + 0.12 * hRaw);
  if (top <= FRAME_TOP) return { ...CAM_BASE };
  const lift = (top - FRAME_TOP) * 0.5;
  const f = { y: CAM_BASE.y + lift, z: CAM_BASE.z, lookY: CAM_BASE.lookY + lift };
  // back off until the head has the same angular headroom the classic framing gives its tallest zombie
  while (f.z < 8 && aboveAxis(top, f) > FRAME_ANGLE) f.z += 0.05;
  return f;
}

function plinthGeometry(): THREE.LatheGeometry {
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.66, 0),
    new THREE.Vector2(0.7, 0.02),
    new THREE.Vector2(0.7, 0.07),
    new THREE.Vector2(0.66, 0.09),
    new THREE.Vector2(0.62, 0.1),
    new THREE.Vector2(0.62, 0.16),
    new THREE.Vector2(0.65, 0.175),
    new THREE.Vector2(0.65, PLINTH_H - 0.01),
    new THREE.Vector2(0.63, PLINTH_H),
    new THREE.Vector2(0, PLINTH_H),
  ];
  return new THREE.LatheGeometry(pts, 56);
}

function shadowTexture(): THREE.CanvasTexture {
  const c = makeCanvas(128, 128);
  const g = ctx2d(c);
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, 'rgba(10,6,14,0.55)');
  gr.addColorStop(0.5, 'rgba(10,6,14,0.25)');
  gr.addColorStop(1, 'rgba(10,6,14,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function feltTexture(): THREE.CanvasTexture {
  const c = makeCanvas(256, 256);
  const g = ctx2d(c);
  g.fillStyle = '#4f6646';
  g.fillRect(0, 0, 256, 256);
  const r = mulberry32(31337);
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(120,150,96,0.25)' : 'rgba(30,40,28,0.25)';
    g.fillRect(r() * 256, r() * 256, 1.5, 1.5);
  }
  g.strokeStyle = 'rgba(232,224,200,0.25)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(128, 128, 112, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function safeTexture(make: () => THREE.CanvasTexture): THREE.CanvasTexture | null {
  try {
    return make();
  } catch {
    return null;
  }
}

/** PreviewStage plus a synchronous render hook (dev harness capture only). */
export type PreviewStageInternal = PreviewStage & { renderNow(): void };

export function createPreviewStage(canvas: HTMLCanvasElement, characters: CharacterFactory, warn: ThrottledWarn, pixelRatio = 1): PreviewStageInternal {
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch (e) {
    warn.warn('preview-gl', 'preview WebGL context unavailable', e);
  }
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 50);
  camera.position.set(0, CAM_BASE.y, CAM_BASE.z);
  camera.lookAt(0, CAM_BASE.lookY, 0);
  const frame = { ...CAM_BASE };
  let frameTarget = { ...CAM_BASE };
  const applyFrame = (k: number) => {
    frame.y += (frameTarget.y - frame.y) * k;
    frame.z += (frameTarget.z - frame.z) * k;
    frame.lookY += (frameTarget.lookY - frame.lookY) * k;
    camera.position.set(0, frame.y, frame.z);
    camera.lookAt(0, frame.lookY, 0);
  };
  const owned: { dispose(): void }[] = [];
  if (renderer) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(2, Math.max(1, Number.isFinite(pixelRatio) ? pixelRatio : 1)));
    renderer.setClearColor(0x000000, 0);
  }
  // lights
  const key = new THREE.DirectionalLight(0xffd2a0, 3.2);
  key.position.set(-2.2, 3.6, 2.8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -1.5;
  key.shadow.camera.right = 1.5;
  key.shadow.camera.top = 2.5;
  key.shadow.camera.bottom = -0.5;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  const rim = new THREE.DirectionalLight(0x9fe870, 2.6);
  rim.position.set(2.6, 2.2, -2.6);
  const back = new THREE.DirectionalLight(0x9e8cd8, 1.4);
  back.position.set(-2.8, 1.6, -2.4);
  const fill = new THREE.HemisphereLight(0xd9cfe6, 0x2b2230, 1.25);
  scene.add(key, rim, back, fill);
  // dim studio reflections so prosthetic metal / glasses read as metal, not black (same rule as the lot, #14b).
  // Baked after the first frame, so opening Create-a-Zombie never waits on it.
  let envRT: THREE.WebGLRenderTarget | null = null;
  let envBaked = false;
  const bakeEnvironment = (): void => {
    if (envBaked || !renderer) return;
    envBaked = true;
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      envRT = pmrem.fromScene(room, 0.04);
      scene.environment = envRT.texture;
      scene.environmentIntensity = 0.35;
      room.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry?.dispose();
          (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x?.dispose());
        }
      });
      pmrem.dispose();
    } catch (e) {
      warn.warn('preview-env', 'preview environment map failed', e);
    }
  };
  // turntable
  const turntable = new THREE.Group();
  scene.add(turntable);
  const pGeo = plinthGeometry();
  const pMat = new THREE.MeshStandardMaterial({ color: '#5a5560', roughness: 0.82, metalness: 0.05 });
  const plinth = new THREE.Mesh(pGeo, pMat);
  plinth.receiveShadow = true;
  plinth.castShadow = true;
  turntable.add(plinth);
  // canvas-drawn textures are cosmetic: without a 2D canvas (headless hosts) the plinth just goes untextured
  const feltTex = safeTexture(feltTexture);
  const topGeo = new THREE.CircleGeometry(0.6, 48);
  topGeo.rotateX(-Math.PI / 2);
  const topMat = new THREE.MeshStandardMaterial({ map: feltTex, color: feltTex ? '#ffffff' : '#4f6646', roughness: 0.98 });
  const top = new THREE.Mesh(topGeo, topMat);
  top.position.y = PLINTH_H + 0.002;
  top.receiveShadow = true;
  turntable.add(top);
  const shTex = safeTexture(shadowTexture);
  const shGeo = new THREE.PlaneGeometry(2.2, 2.2);
  shGeo.rotateX(-Math.PI / 2);
  const shMat = new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false, opacity: shTex ? 1 : 0 });
  const shadow = new THREE.Mesh(shGeo, shMat);
  shadow.position.y = 0.001;
  scene.add(shadow);
  owned.push(pGeo, pMat, topGeo, topMat, shGeo, shMat);
  if (feltTex) owned.push(feltTex);
  if (shTex) owned.push(shTex);

  let rig: ZombieRig | null = null;
  let app: ZombieAppearance = defaultAppearance();
  let limbs: LimbState = intactLimbs();
  let anim: AnyAnimState = 'idle';
  let expr: Expression = 'neutral';
  const makeRig = () => {
    try {
      rig = characters.create(app, { ...limbs });
      rig.root.position.set(0, PLINTH_H, 0);
      // keep the rig's own caster flags (eyes / stitches / glasses never cast — no acne on the face up close)
      rig.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.receiveShadow = true;
      });
      turntable.add(rig.root);
      rig.setAnim(anim);
      rig.setExpression(expr);
    } catch (e) {
      warn.warn('preview-rig', 'preview rig creation failed', e);
      rig = null;
    }
  };
  Promise.resolve(characters.ready)
    .catch(() => undefined)
    .then(() => {
      if (!disposed) makeRig();
    });

  let disposed = false;
  let raf = 0;
  let framesDrawn = 0;
  let last = typeof performance !== 'undefined' ? performance.now() : 0;
  let width = Math.max(1, canvas.clientWidth || canvas.width || 320);
  let height = Math.max(1, canvas.clientHeight || canvas.height || 420);
  const applySize = () => {
    if (!renderer) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  applySize();
  const loop = (now: number) => {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      rig?.update(dt);
      applyFrame(1 - Math.exp(-dt * 6));
      if (renderer && !renderer.getContext().isContextLost()) {
        renderer.render(scene, camera);
        if (!envBaked && ++framesDrawn >= 2) bakeEnvironment();
      }
    } catch (e) {
      warn.warn('preview-frame', 'preview frame failed', e);
    }
  };
  const hasRaf = typeof requestAnimationFrame === 'function';
  if (hasRaf) raf = requestAnimationFrame(loop);

  return {
    renderNow() {
      applyFrame(1);
      try {
        if (renderer && !renderer.getContext().isContextLost()) renderer.render(scene, camera);
      } catch (e) {
        warn.warn('preview-frame', 'preview render failed', e);
      }
    },
    setAppearance(a: ZombieAppearance) {
      if (!a || typeof a !== 'object') return;
      app = { ...a };
      frameTarget = previewFraming(app);
      try {
        rig?.setAppearance(app);
      } catch (e) {
        warn.warn('preview-app', 'setAppearance failed', e);
      }
    },
    setLimbs(l: LimbState) {
      if (!l || typeof l !== 'object') return;
      limbs = { ...intactLimbs(), ...l };
      try {
        rig?.setLimbs({ ...limbs });
      } catch (e) {
        warn.warn('preview-limbs', 'setLimbs failed', e);
      }
    },
    setAnim(a: AnyAnimState) {
      if (!(ANIM_STATES as readonly string[]).includes(a) && !isExtraAnimState(a)) return;
      anim = a;
      try {
        rig?.setAnim(a);
      } catch (e) {
        warn.warn('preview-anim', 'setAnim failed', e);
      }
    },
    setExpression(e: Expression) {
      if (!(EXPRESSIONS as readonly string[]).includes(e)) return;
      expr = e;
      try {
        rig?.setExpression(e);
      } catch (err) {
        warn.warn('preview-expr', 'setExpression failed', err);
      }
    },
    setYaw(yaw: number) {
      if (Number.isFinite(yaw)) turntable.rotation.y = yaw;
    },
    bodyStatus() {
      // W-130: the handle shows `body` while `wantedBody` loads; the factory knows why they differ
      const h = rig as unknown as { body?: string; wantedBody?: string } | null;
      if (!h) return 'loading';
      const want = typeof h.wantedBody === 'string' ? h.wantedBody : 'classic';
      if (want === h.body) return 'ready';
      const f = characters as unknown as { bodyStatus?: (b: string) => 'ready' | 'loading' | 'offline' | 'unavailable' };
      try {
        return typeof f.bodyStatus === 'function' ? f.bodyStatus(want) : 'loading';
      } catch {
        return 'loading';
      }
    },
    resize(w: number, h: number) {
      if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return;
      width = Math.floor(w);
      height = Math.floor(h);
      applySize();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (hasRaf && raf) cancelAnimationFrame(raf);
      try {
        if (rig) {
          turntable.remove(rig.root);
          rig.dispose();
        }
      } catch {
        /* ignore */
      }
      for (const o of owned) o.dispose();
      envRT?.dispose();
      scene.environment = null;
      key.shadow.map?.dispose();
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss();
      }
      renderer = null;
    },
  };
}
