/**
 * FX system: one instanced billboard mesh (a single draw call) over a capped particle pool, a canvas-drawn
 * atlas, one-shot bursts for every FxKind and persistent emitters (fly swarms, stench, zzz, fire, notes) that
 * owners (agent/object managers) drive per frame through handles. Premultiplied alpha lets additive (sparks,
 * embers) and normal (smoke, dust) particles share the draw call.
 */
import * as THREE from 'three';
import { ParticlePool, FX_ATLAS_COLS, FX_ATLAS_ROWS, MAX_ANCHORS, DEFAULT_KIND_CAPS } from './fxPool';
import { burst, PERSISTENT_DEFS, type PersistentType } from './fxKinds';
import { buildFxAtlas } from './fxTextures';
import { mulberry32 } from '../core/math';
import type { QualitySettings } from '../core/quality';

const vertex = /* glsl */ `
attribute vec3 iPos;
attribute vec2 iSizeRot;
attribute vec4 iColor;
attribute vec2 iMeta;
uniform vec2 uAtlas;
uniform float uPxScale;
uniform float uMinPx;
varying vec2 vUv;
varying vec4 vColor;
varying float vAdd;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iSizeRot.y);
  float s = sin(iSizeRot.y);
  // keep particles readable when zoomed out: never smaller than uMinPx on screen (0-size = delayed → stays 0)
  float minWorld = uMinPx * uPxScale * max(-mvPosition.z, 0.0);
  float size = iSizeRot.x > 0.0 ? max(iSizeRot.x, minWorld) : 0.0;
  vec2 q = position.xy * size;
  mvPosition.xy += vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  gl_Position = projectionMatrix * mvPosition;
  float f = iMeta.x;
  float col = mod(f, uAtlas.x);
  float row = floor(f / uAtlas.x);
  vUv = (vec2(col, uAtlas.y - 1.0 - row) + uv) / uAtlas;
  vColor = iColor;
  vAdd = iMeta.y;
  #include <fog_vertex>
}
`;

const fragment = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vColor;
varying float vAdd;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vColor.a;
  if (a < 0.004) discard;
  vec3 rgb = t.rgb * vColor.rgb * vColor.a;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    rgb *= 1.0 - fogFactor;
    a *= 1.0 - fogFactor;
  #endif
  gl_FragColor = vec4(rgb, a * (1.0 - vAdd));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface EmitterHandle {
  readonly type: PersistentType;
  active: boolean;
  x: number;
  y: number;
  z: number;
  /** Internal: spawn accumulator / anchor slot / bookkeeping. */
  acc: number;
  anchor: number;
  warmed: boolean;
  released: boolean;
}

export class FxSystem {
  readonly mesh: THREE.Mesh;
  private pool: ParticlePool;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly texture: THREE.CanvasTexture;
  private attrPos!: THREE.InstancedBufferAttribute;
  private attrSize!: THREE.InstancedBufferAttribute;
  private attrColor!: THREE.InstancedBufferAttribute;
  private attrMeta!: THREE.InstancedBufferAttribute;
  private attrs: THREE.InstancedBufferAttribute[] = [];
  private readonly emitters: EmitterHandle[] = [];
  private readonly freeAnchors: number[] = [];
  private readonly rnd = mulberry32(0xf00d);
  private scale = 1;

  /** @param atlas injectable for tests (defaults to the canvas-drawn atlas) */
  constructor(q: Pick<QualitySettings, 'particleCapacity' | 'particleScale'>, atlas: () => HTMLCanvasElement = buildFxAtlas) {
    this.texture = new THREE.CanvasTexture(atlas());
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.premultiplyAlpha = true;
    this.texture.generateMipmaps = true;
    this.material = new THREE.ShaderMaterial({
      name: 'fx-particles',
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null }, uAtlas: { value: new THREE.Vector2(FX_ATLAS_COLS, FX_ATLAS_ROWS) }, uPxScale: { value: 0.0008 }, uMinPx: { value: 7 } }]),
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.material.uniforms.uMap.value = this.texture;
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.geometry.setAttribute('uv', quad.getAttribute('uv'));
    this.pool = new ParticlePool(q.particleCapacity, DEFAULT_KIND_CAPS, q.particleScale);
    this.scale = q.particleScale;
    this.allocAttributes(this.pool.capacity);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'fx';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    for (let i = MAX_ANCHORS - 1; i >= 0; i--) this.freeAnchors.push(i);
  }

  private allocAttributes(cap: number): void {
    const mk = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n).setUsage(THREE.DynamicDrawUsage);
    this.attrPos = mk(3);
    this.attrSize = mk(2);
    this.attrColor = mk(4);
    this.attrMeta = mk(2);
    this.geometry.setAttribute('iPos', this.attrPos);
    this.geometry.setAttribute('iSizeRot', this.attrSize);
    this.geometry.setAttribute('iColor', this.attrColor);
    this.geometry.setAttribute('iMeta', this.attrMeta);
    this.attrs = [this.attrPos, this.attrSize, this.attrColor, this.attrMeta];
    this.geometry.instanceCount = 0;
  }

  /** Resize the pool for a quality preset (drops live particles; emitters keep running). */
  configure(q: Pick<QualitySettings, 'particleCapacity' | 'particleScale'>): void {
    if (q.particleCapacity === this.pool.capacity && q.particleScale === this.scale) return;
    this.pool = new ParticlePool(q.particleCapacity, DEFAULT_KIND_CAPS, q.particleScale);
    this.scale = q.particleScale;
    this.geometry.dispose();
    this.allocAttributes(this.pool.capacity);
    for (const e of this.emitters) e.warmed = false;
  }

  /** Camera parameters for the minimum on-screen particle size. */
  setView(fovDeg: number, viewportHeightPx: number): void {
    if (!Number.isFinite(fovDeg) || !Number.isFinite(viewportHeightPx) || viewportHeightPx < 1) return;
    this.material.uniforms.uPxScale.value = (2 * Math.tan((fovDeg * Math.PI) / 360)) / viewportHeightPx;
  }

  /** One-shot burst. Unknown kinds / bad positions are ignored. */
  burst(kind: unknown, x: number, y: number, z: number): boolean {
    return burst(kind, this.pool, this.rnd, x, y, z, this.scale);
  }

  acquire(type: PersistentType): EmitterHandle {
    const h: EmitterHandle = { type, active: false, x: 0, y: 0, z: 0, acc: 0, anchor: -1, warmed: false, released: false };
    if (type === 'flySwarm') h.anchor = this.freeAnchors.pop() ?? -1;
    this.emitters.push(h);
    return h;
  }

  release(h: EmitterHandle | null | undefined): void {
    if (!h || h.released) return;
    h.released = true;
    h.active = false;
    const i = this.emitters.indexOf(h);
    if (i >= 0) {
      this.emitters[i] = this.emitters[this.emitters.length - 1];
      this.emitters.pop();
    }
    if (h.anchor >= 0) {
      this.pool.killAnchor(h.anchor);
      this.freeAnchors.push(h.anchor);
      h.anchor = -1;
    }
  }

  /** Live particle count (diagnostics). */
  count(): number {
    return this.pool.count;
  }

  /** Active persistent emitters (diagnostics/tests). */
  emitterCount(): number {
    return this.emitters.length;
  }

  /** Free fly-swarm anchor slots (diagnostics/tests). */
  freeAnchorCount(): number {
    return this.freeAnchors.length;
  }

  /** Instances drawn by the last update (diagnostics/tests). */
  drawnInstances(): number {
    return this.geometry.instanceCount;
  }

  update(dt: number, timeSec: number): void {
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    const pool = this.pool;
    for (let i = 0; i < this.emitters.length; i++) {
      const e = this.emitters[i];
      const def = PERSISTENT_DEFS[e.type];
      if (e.anchor >= 0) {
        pool.anchors[e.anchor * 3] = e.x;
        pool.anchors[e.anchor * 3 + 1] = e.y;
        pool.anchors[e.anchor * 3 + 2] = e.z;
      }
      if (!e.active) {
        // inactive: stop spawning; live particles finish their lives (swarms keep orbiting the anchor)
        e.warmed = false;
        continue;
      }
      if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.z)) continue;
      if (!e.warmed) {
        e.warmed = true;
        for (let k = 0; k < def.prewarm; k++) {
          const p = def.emit(pool, this.rnd, e.x, e.y, e.z, e.anchor);
          if (p >= 0) pool.age[p] = pool.life[p] * this.rnd() * 0.6;
        }
        e.acc = 0;
      }
      e.acc += step;
      let guard = 0;
      while (e.acc >= def.interval && guard++ < 8) {
        e.acc -= def.interval;
        def.emit(pool, this.rnd, e.x, e.y, e.z, e.anchor);
      }
      if (guard >= 8) e.acc = 0;
    }
    pool.update(step);
    const n = pool.writeRender(
      timeSec,
      this.attrPos.array as Float32Array,
      this.attrSize.array as Float32Array,
      this.attrColor.array as Float32Array,
      this.attrMeta.array as Float32Array,
    );
    this.geometry.instanceCount = n;
    if (n > 0) {
      for (let k = 0; k < this.attrs.length; k++) {
        const a = this.attrs[k];
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * a.itemSize);
        a.needsUpdate = true;
      }
    }
    this.mesh.visible = n > 0;
  }

  clear(): void {
    this.pool.clear();
    this.geometry.instanceCount = 0;
  }

  dispose(): void {
    for (const e of [...this.emitters]) this.release(e);
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
