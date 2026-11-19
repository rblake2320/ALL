/**
 * Catalog thumbnails: offscreen 3/4-view studio renders (transparent background, 128² PNG), cached by
 * (modelId, tint) and processed from a queue a couple per frame so the catalog never stalls the game.
 * Renders at 256² with MSAA into an HDR target, then tone-maps (ACES) + sRGB-encodes in a tiny pass and
 * downsamples on a 2D canvas. Never rejects: failures resolve to a neutral placeholder icon.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { ModelLibrary, ObjectVisualState } from '../contracts';
import { BoundedCache, thumbKey, normalizeTint } from './thumbKey';
import type { ThrottledWarn } from '../core/diagnostics';
import { makeCanvas, ctx2d } from '../world/canvasUtil';
import { safeReady, delay } from '../core/math';

export const THUMB_SIZE = 128;
const RENDER_SIZE = 256;

interface Job {
  key: string;
  modelId: string;
  tint: string | null;
  resolve: (url: string) => void;
}

const encodeVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const encodeFragment = /* glsl */ `
uniform sampler2D tSrc;
uniform float uExposure;
varying vec2 vUv;
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 color) {
  const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= uExposure / 0.6;
  color = ACESInputMat * color;
  color = RRTAndODTFit(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec4 c = texture2D(tSrc, vUv);
  vec3 rgb = c.a > 0.0001 ? c.rgb / c.a : vec3(0.0);
  gl_FragColor = vec4(toSRGB(aces(rgb)), c.a);
}
`;

export class ThumbnailRenderer {
  private readonly cache = new BoundedCache<Promise<string>>(512);
  private readonly queue: Job[] = [];
  private modelsReady = false;
  private disposed = false;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private hdr: THREE.WebGLRenderTarget | null = null;
  private ldr: THREE.WebGLRenderTarget | null = null;
  private encodeScene: THREE.Scene | null = null;
  private encodeCam: THREE.OrthographicCamera | null = null;
  private encodeMat: THREE.ShaderMaterial | null = null;
  private pixels: Uint8Array | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envTried = false;
  private readonly visual: ObjectVisualState = { powered: true, inUse: false, broken: false, lit: true, servings: 4, progress: 0.7, flag: true, dirt: 0, burning: false };
  private fallbackUrl = '';

  constructor(
    private readonly models: ModelLibrary,
    private readonly warn: ThrottledWarn,
  ) {
    // a library that never settles must not stall the catalog: render whatever create() returns after 30 s
    Promise.race([safeReady(models.ready), delay(30_000)]).then(() => {
      this.modelsReady = true;
    });
  }

  /** Cached promise for a thumbnail; invalid ids resolve to the placeholder icon. */
  request(modelId: unknown, tint?: unknown): Promise<string> {
    const key = thumbKey(modelId, tint);
    if (!key) return Promise.resolve(this.fallback());
    const hit = this.cache.get(key);
    if (hit) return hit;
    const p = new Promise<string>((resolve) => {
      if (this.disposed) {
        resolve(this.fallback());
        return;
      }
      this.queue.push({ key, modelId: modelId as string, tint: normalizeTint(tint), resolve });
    });
    this.cache.set(key, p);
    return p;
  }

  pending(): number {
    return this.queue.length;
  }

  /** Render up to `budget` queued thumbnails with the main renderer. Called once per frame. */
  process(renderer: THREE.WebGLRenderer, budget = 2): void {
    if (this.disposed || !this.modelsReady || this.queue.length === 0) return;
    for (let i = 0; i < budget && this.queue.length > 0; i++) {
      const job = this.queue.shift()!;
      let url: string;
      try {
        url = this.renderOne(renderer, job.modelId, job.tint);
      } catch (e) {
        this.warn.warn('thumb', `thumbnail for ${job.modelId} failed`, e);
        url = this.fallback();
        this.cache.delete(job.key); // allow a retry later
      }
      job.resolve(url);
    }
  }

  private ensure(): void {
    if (this.scene) return;
    const scene = new THREE.Scene();
    const key = new THREE.DirectionalLight(0xffe6c8, 3.2);
    key.position.set(-2.5, 4, 3.5);
    const rim = new THREE.DirectionalLight(0xbfd8ff, 2.2);
    rim.position.set(3, 2.5, -3.5);
    const fill = new THREE.HemisphereLight(0xe8e0f0, 0x4a3f48, 1.6);
    scene.add(key, rim, fill);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.05, 200);
    this.hdr = new THREE.WebGLRenderTarget(RENDER_SIZE, RENDER_SIZE, { type: THREE.HalfFloatType, samples: 4 });
    this.ldr = new THREE.WebGLRenderTarget(RENDER_SIZE, RENDER_SIZE, { type: THREE.UnsignedByteType });
    this.encodeMat = new THREE.ShaderMaterial({ vertexShader: encodeVertex, fragmentShader: encodeFragment, uniforms: { tSrc: { value: this.hdr.texture }, uExposure: { value: 1.05 } }, depthTest: false, depthWrite: false });
    this.encodeScene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.encodeMat);
    quad.frustumCulled = false;
    this.encodeScene.add(quad);
    this.encodeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.pixels = new Uint8Array(RENDER_SIZE * RENDER_SIZE * 4);
  }

  /** Same dim studio reflections as the lot by day (decision #14b) so chrome/brass thumbnails don't go black. */
  private ensureEnvironment(renderer: THREE.WebGLRenderer): void {
    if (this.envTried || !this.scene) return;
    this.envTried = true;
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      this.envRT = pmrem.fromScene(room, 0.04);
      room.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry?.dispose();
          (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x?.dispose());
        }
      });
      pmrem.dispose();
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.35;
    } catch (e) {
      this.warn.warn('thumb-env', 'thumbnail environment map failed', e);
    }
  }

  /**
   * After a context restore the scratch render targets come back by themselves (three.js re-creates them lazily);
   * only the baked studio environment must be re-made. Old-context objects are dropped, not disposed.
   */
  invalidate(): void {
    this.envRT = null;
    this.envTried = false;
    if (this.scene) this.scene.environment = null;
  }

  private renderOne(renderer: THREE.WebGLRenderer, modelId: string, tint: string | null): string {
    this.ensure();
    this.ensureEnvironment(renderer);
    const scene = this.scene!;
    const cam = this.camera!;
    const obj = this.models.create(modelId, tint);
    try {
      this.models.update(obj, this.visual, 0.6);
    } catch {
      /* optional */
    }
    scene.add(obj);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj, true);
    if (box.isEmpty() || !Number.isFinite(box.min.x)) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(0.15, sphere.radius);
    const fov = (cam.fov * Math.PI) / 180;
    const dist = (r / Math.sin(fov / 2)) * 1.04;
    const yaw = 0.62;
    const pitch = 0.42;
    cam.position.set(sphere.center.x + Math.sin(yaw) * Math.cos(pitch) * dist, sphere.center.y + Math.sin(pitch) * dist, sphere.center.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    cam.near = Math.max(0.01, dist - r * 2);
    cam.far = dist + r * 2;
    cam.lookAt(sphere.center);
    cam.updateProjectionMatrix();
    // save renderer state
    const prevTarget = renderer.getRenderTarget();
    const prevColor = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevAutoClear = renderer.autoClear;
    const prevShadow = renderer.shadowMap.enabled;
    try {
      renderer.shadowMap.enabled = false;
      renderer.autoClear = true;
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(this.hdr);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.setRenderTarget(this.ldr);
      renderer.clear();
      renderer.render(this.encodeScene!, this.encodeCam!);
      renderer.readRenderTargetPixels(this.ldr!, 0, 0, RENDER_SIZE, RENDER_SIZE, this.pixels!);
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(prevColor, prevAlpha);
      renderer.autoClear = prevAutoClear;
      renderer.shadowMap.enabled = prevShadow;
      scene.remove(obj);
      try {
        this.models.release?.(obj);
      } catch {
        /* optional */
      }
    }
    return this.encode(this.pixels!);
  }

  private encode(px: Uint8Array): string {
    const big = makeCanvas(RENDER_SIZE, RENDER_SIZE);
    const g = ctx2d(big);
    const img = g.createImageData(RENDER_SIZE, RENDER_SIZE);
    // WebGL rows are bottom-up
    for (let y = 0; y < RENDER_SIZE; y++) {
      const src = (RENDER_SIZE - 1 - y) * RENDER_SIZE * 4;
      img.data.set(px.subarray(src, src + RENDER_SIZE * 4), y * RENDER_SIZE * 4);
    }
    g.putImageData(img, 0, 0);
    const small = makeCanvas(THUMB_SIZE, THUMB_SIZE);
    const s = ctx2d(small);
    s.imageSmoothingEnabled = true;
    s.imageSmoothingQuality = 'high';
    s.drawImage(big, 0, 0, THUMB_SIZE, THUMB_SIZE);
    return small.toDataURL('image/png');
  }

  /** Neutral icon used when a model can't be rendered (or the renderer is gone). */
  fallback(): string {
    if (this.fallbackUrl) return this.fallbackUrl;
    try {
      const c = makeCanvas(THUMB_SIZE, THUMB_SIZE);
      const g = ctx2d(c);
      g.clearRect(0, 0, THUMB_SIZE, THUMB_SIZE);
      g.fillStyle = 'rgba(232,224,200,0.18)';
      g.strokeStyle = 'rgba(232,224,200,0.55)';
      g.lineWidth = 4;
      g.beginPath();
      g.roundRect(30, 40, 68, 56, 10);
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(30, 52);
      g.lineTo(64, 30);
      g.lineTo(98, 52);
      g.stroke();
      this.fallbackUrl = c.toDataURL('image/png');
    } catch {
      this.fallbackUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    }
    return this.fallbackUrl;
  }

  dispose(): void {
    this.disposed = true;
    for (const j of this.queue) j.resolve(this.fallback());
    this.queue.length = 0;
    this.hdr?.dispose();
    this.ldr?.dispose();
    this.envRT?.dispose();
    this.envRT = null;
    this.encodeMat?.dispose();
    this.encodeScene?.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.scene = null;
  }
}
