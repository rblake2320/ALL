/**
 * Story-step marker (W-116, D-065, owner playtest #1): an original bobbing candle-gold arrow over the object the current
 * Act 1 step is about (src/shared/storyTarget.ts), with a soft halo and a pulsing ground ring — cheap (one cone, one
 * sprite, one plane; no lights, no shadows), unlit and E10+. Emissive enough that bloom catches it at night.
 * Reduced motion: no bob, no pulse.
 */
import * as THREE from 'three';
import { makeCanvas, ctx2d } from '../world/canvasUtil';

function glowTexture(): THREE.CanvasTexture {
  const c = makeCanvas(64, 64);
  const g = ctx2d(c);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.4)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function ringTexture(): THREE.CanvasTexture {
  const c = makeCanvas(64, 64);
  const g = ctx2d(c);
  const gr = g.createRadialGradient(32, 32, 16, 32, 32, 31);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.7)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * W-116: the marker stands still (no bob / spin / pulse) when EITHER the game's Reduce motion setting is on OR the
 * OS / browser asks for reduced motion (`prefers-reduced-motion: reduce`).
 */
export function markerReducedMotion(setting: boolean | null | undefined, prefersReduced: boolean | null | undefined): boolean {
  return setting === true || prefersReduced === true;
}

/** `prefers-reduced-motion: reduce` right now (false where matchMedia is missing or throws). */
export function prefersReducedMotion(win: { matchMedia?: (q: string) => { matches: boolean } } | null | undefined = typeof window !== 'undefined' ? window : null): boolean {
  try {
    return !!win && typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

/** Height (world units) of the arrow tip above the object's top. */
export const MARKER_LIFT = 0.45;

/** A canvas texture, or null where no canvas exists (headless tests): the marker then draws untextured. */
function safeTexture(make: () => THREE.CanvasTexture): THREE.CanvasTexture | null {
  try {
    return make();
  } catch {
    return null;
  }
}

export class QuestMarker {
  readonly group = new THREE.Group();
  private readonly arrow: THREE.Mesh;
  private readonly halo: THREE.Sprite;
  private readonly ring: THREE.Mesh;
  private readonly floating = new THREE.Group();
  private readonly owned: { dispose(): void }[] = [];
  private fade = 0;
  /** Last placed tip position (world), for tests / e2e. */
  readonly tip = new THREE.Vector3();

  constructor() {
    const gold = new THREE.Color('#ffc94d');
    const coneGeo = new THREE.ConeGeometry(0.16, 0.42, 4, 1);
    coneGeo.rotateX(Math.PI); // point down
    coneGeo.translate(0, 0.21, 0); // tip at y = 0
    const arrowMat = new THREE.MeshBasicMaterial({ color: gold.clone().multiplyScalar(1.6), transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
    this.arrow = new THREE.Mesh(coneGeo, arrowMat);
    this.arrow.renderOrder = 20;
    const glow = safeTexture(glowTexture);
    const haloMat = new THREE.SpriteMaterial({ map: glow, color: gold.clone(), transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 });
    this.halo = new THREE.Sprite(haloMat);
    this.halo.scale.setScalar(0.85);
    this.halo.position.y = 0.24;
    this.halo.renderOrder = 19;
    this.floating.add(this.halo, this.arrow);
    const ringTex = safeTexture(ringTexture);
    const ringMat = new THREE.MeshBasicMaterial({ map: ringTex, color: gold.clone(), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const ringGeo = new THREE.PlaneGeometry(1.5, 1.5);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.renderOrder = 5;
    this.group.add(this.floating, this.ring);
    this.group.name = 'quest-marker';
    this.group.visible = false;
    for (const o of [coneGeo, arrowMat, glow, haloMat, ringTex, ringMat, ringGeo]) if (o) this.owned.push(o);
    this.group.traverse((o) => {
      o.frustumCulled = false;
      o.raycast = () => undefined;
    });
  }

  get visible(): boolean {
    return this.group.visible;
  }

  /**
   * @param top world point just above the target object (null = hide)
   * @param ground ground point under it (the ring)
   */
  update(t: number, dt: number, top: { x: number; y: number; z: number } | null, ground: { x: number; z: number } | null, reduceMotion = false): void {
    if (!top) {
      this.group.visible = false;
      this.fade = 0;
      return;
    }
    this.fade += (1 - this.fade) * Math.min(1, (Number.isFinite(dt) ? dt : 0) * 5);
    this.group.visible = true;
    const bob = reduceMotion ? 0 : 0.12 * (0.5 + 0.5 * Math.sin(t * 3.1));
    this.floating.position.set(top.x, top.y + MARKER_LIFT + bob, top.z);
    this.tip.copy(this.floating.position);
    this.arrow.rotation.y = reduceMotion ? 0 : t * 1.4;
    this.floating.scale.setScalar(Math.max(0.05, this.fade));
    (this.halo.material as THREE.SpriteMaterial).opacity = (0.5 + (reduceMotion ? 0 : 0.15 * Math.sin(t * 4.3))) * this.fade;
    if (ground) {
      this.ring.visible = true;
      this.ring.position.set(ground.x, 0.03, ground.z);
      const pulse = reduceMotion ? 1 : 1 + 0.08 * Math.sin(t * 3);
      this.ring.scale.set(pulse, 1, pulse);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.5 * this.fade;
    } else this.ring.visible = false;
  }

  dispose(): void {
    for (const o of this.owned) o.dispose();
  }
}
