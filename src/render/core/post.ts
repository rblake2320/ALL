/**
 * Post-processing for high/ultra: EffectComposer → RenderPass → UnrealBloomPass (threshold ≈ 0.85, subtle) →
 * vignette (plum-tinted, gentle) OR, with the miniature look on, the diorama pass (tilt-shift focus + split-tone +
 * the same vignette; core/diorama.ts) → OutputPass (ACES + sRGB). low/medium render directly (no composer).
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { QualitySettings } from './quality';
import { DioramaShader, blurPxFor } from './diorama';

export const VignetteShader = {
  name: 'AfterlifeVignette',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uStrength: { value: 0.32 },
    uAspect: { value: 16 / 9 },
    uTint: { value: new THREE.Color(0.62, 0.56, 0.72) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    uniform float uAspect;
    uniform vec3 uTint;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0) / max(uAspect, 1.0) * 2.0;
      float r = length(d);
      float v = smoothstep(0.45, 1.25, r) * uStrength;
      c.rgb *= mix(vec3(1.0), uTint, v);
      gl_FragColor = c;
    }
  `,
};

export class PostPipeline {
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private vignette: ShaderPass | null = null;
  private diorama: ShaderPass | null = null;
  private miniature = true;
  private focusY = 0.5;
  private amount = 1;
  private renderPass: RenderPass | null = null;
  private output: OutputPass | null = null;
  private settings: QualitySettings | null = null;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {}

  get enabled(): boolean {
    return this.composer !== null;
  }

  configure(q: QualitySettings, width: number, height: number, pixelRatio: number): void {
    this.settings = q;
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.pixelRatio = pixelRatio;
    this.disposeComposer();
    if (!q.post) return;
    const rt = new THREE.WebGLRenderTarget(this.width * pixelRatio, this.height * pixelRatio, {
      type: THREE.HalfFloatType,
      samples: q.msaa,
    });
    const composer = new EffectComposer(this.renderer, rt);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(this.width, this.height);
    this.renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(this.renderPass);
    if (q.bloom) {
      // half-resolution bloom keeps the cost low; strength subtle per ART_DIRECTION
      this.bloom = new UnrealBloomPass(new THREE.Vector2(this.width / 2, this.height / 2), 0.32, 0.55, 0.85);
      composer.addPass(this.bloom);
    }
    if (q.diorama && this.miniature) {
      this.diorama = new ShaderPass(DioramaShader);
      this.diorama.uniforms.uStrength.value = q.vignette ? 0.32 : 0;
      composer.addPass(this.diorama);
      this.syncDiorama();
    } else if (q.vignette) {
      this.vignette = new ShaderPass(VignetteShader);
      this.vignette.uniforms.uAspect.value = this.width / this.height;
      composer.addPass(this.vignette);
    }
    this.output = new OutputPass();
    composer.addPass(this.output);
    this.composer = composer;
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.pixelRatio = pixelRatio;
    if (!this.composer) return;
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(this.width, this.height);
    if (this.bloom) this.bloom.resolution.set(this.width / 2, this.height / 2);
    if (this.vignette) this.vignette.uniforms.uAspect.value = this.width / this.height;
    this.syncDiorama();
  }

  /** True when the miniature pass is in the chain (high/ultra with the setting on). */
  get dioramaActive(): boolean {
    return this.diorama !== null;
  }

  /** Player setting: rebuilds the chain only when the value changes. */
  setMiniature(on: boolean): void {
    const next = on === true;
    if (next === this.miniature) return;
    this.miniature = next;
    if (this.settings) this.configure(this.settings, this.width, this.height, this.pixelRatio);
  }

  /** Per frame: focus line (0 bottom .. 1 top) and overall amount 0..1. Garbage is ignored. */
  setDiorama(focusY: number, amount: number): void {
    if (Number.isFinite(focusY)) this.focusY = Math.min(1, Math.max(0, focusY));
    if (Number.isFinite(amount)) this.amount = Math.min(1, Math.max(0, amount));
    if (this.diorama) {
      this.diorama.uniforms.uFocusY.value = this.focusY;
      this.diorama.uniforms.uAmount.value = this.amount;
    }
  }

  private syncDiorama(): void {
    if (!this.diorama) return;
    const u = this.diorama.uniforms;
    u.uAspect.value = this.width / this.height;
    // texel in CSS pixels: the blur radius is authored in CSS px, so it looks the same at every pixel ratio
    (u.uTexel.value as THREE.Vector2).set(1 / this.width, 1 / this.height);
    u.uBlurPx.value = blurPxFor(this.height);
    u.uFocusY.value = this.focusY;
    u.uAmount.value = this.amount;
  }

  /** Bloom strength follows the night (lamps/windows/wisp glow more at night). */
  setBloomStrength(s: number): void {
    if (this.bloom && Number.isFinite(s)) this.bloom.strength = s;
  }

  render(dt: number): void {
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  private disposeComposer(): void {
    if (this.composer) {
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
      for (const p of this.composer.passes) (p as { dispose?: () => void }).dispose?.();
    }
    this.composer = null;
    this.bloom = null;
    this.vignette = null;
    this.diorama = null;
    this.renderPass = null;
    this.output = null;
  }

  dispose(): void {
    this.disposeComposer();
  }
}
