/**
 * Selection marker — an original floating toxic-green "soul wisp": a soft teardrop flame (outer + inner core,
 * vertex-animated flicker), a halo billboard, three orbiting motes and a faint ground ring under the zombie.
 * Emissive HDR colours so bloom catches it on high/ultra; the halo carries the glow on low.
 */
import * as THREE from 'three';
import { makeCanvas, ctx2d } from '../world/canvasUtil';

const flameVertex = /* glsl */ `
uniform float uTime;
uniform float uFlicker;
varying float vH;
varying vec3 vN;
varying vec3 vV;
void main() {
  vec3 p = position;
  float h = clamp(p.y / 0.3, 0.0, 1.0);
  float sway = sin(uTime * 7.3 + p.y * 18.0) * 0.012 + sin(uTime * 11.1 + 1.3) * 0.008;
  p.x += sway * h * h * 2.2;
  p.z += cos(uTime * 6.1 + p.y * 14.0) * 0.010 * h * h * 2.0;
  p.y *= 1.0 + uFlicker * (0.10 * sin(uTime * 13.7) + 0.06 * sin(uTime * 23.1 + 2.0)) * h;
  vH = h;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const flameFragment = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uIntensity;
varying float vH;
varying vec3 vN;
varying vec3 vV;
void main() {
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float body = pow(facing, 1.4);
  vec3 col = mix(uColor, uCore, body * (1.0 - vH));
  float a = (0.25 + 0.75 * body) * (1.0 - smoothstep(0.55, 1.0, vH) * 0.85);
  gl_FragColor = vec4(col * uIntensity * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function teardrop(scale: number): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const t = i / n; // 0 bottom → 1 tip
    const y = t * 0.3;
    // round bulb at the bottom, long pinched tip
    const r = Math.sin(Math.pow(t, 0.55) * Math.PI) * 0.085 * Math.pow(1 - t, 0.35) + (i === 0 ? 0 : 0.0001);
    pts.push(new THREE.Vector2(r * scale, y * scale));
  }
  return new THREE.LatheGeometry(pts, 20);
}

function haloTexture(): THREE.CanvasTexture {
  const c = makeCanvas(128, 128);
  const g = ctx2d(c);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function ringTexture(): THREE.CanvasTexture {
  const c = makeCanvas(128, 128);
  const g = ctx2d(c);
  const gr = g.createRadialGradient(64, 64, 30, 64, 64, 62);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.75, 'rgba(255,255,255,0.18)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class SoulWisp {
  readonly group = new THREE.Group();
  private readonly flameMat: THREE.ShaderMaterial;
  private readonly coreMat: THREE.ShaderMaterial;
  private readonly outer: THREE.Mesh;
  private readonly inner: THREE.Mesh;
  private readonly halo: THREE.Sprite;
  private readonly motes: THREE.Sprite[] = [];
  private readonly ring: THREE.Mesh;
  private readonly floating = new THREE.Group();
  private readonly owned: { dispose(): void }[] = [];
  private fade = 0;

  constructor() {
    const toxic = new THREE.Color('#9fe870');
    const mk = (core: THREE.Color, intensity: number) =>
      new THREE.ShaderMaterial({
        name: 'soul-wisp',
        vertexShader: flameVertex,
        fragmentShader: flameFragment,
        uniforms: { uTime: { value: 0 }, uFlicker: { value: 1 }, uColor: { value: toxic.clone() }, uCore: { value: core }, uIntensity: { value: intensity } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
    this.flameMat = mk(new THREE.Color('#c9f7a2'), 1.15);
    this.coreMat = mk(new THREE.Color('#e4ffcc'), 1.5);
    const g1 = teardrop(1);
    const g2 = teardrop(0.55);
    this.outer = new THREE.Mesh(g1, this.flameMat);
    this.inner = new THREE.Mesh(g2, this.coreMat);
    this.inner.position.y = 0.012;
    const haloTex = haloTexture();
    const haloMat = new THREE.SpriteMaterial({ map: haloTex, color: toxic.clone().multiplyScalar(0.9), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 });
    this.halo = new THREE.Sprite(haloMat);
    this.halo.scale.setScalar(0.62);
    this.halo.position.y = 0.11;
    const moteMat = new THREE.SpriteMaterial({ map: haloTex, color: new THREE.Color('#c8ff9a').multiplyScalar(1.3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 });
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(moteMat);
      s.scale.setScalar(0.07);
      this.motes.push(s);
      this.floating.add(s);
    }
    this.floating.add(this.halo, this.outer, this.inner);
    const ringTex = ringTexture();
    const ringMat = new THREE.MeshBasicMaterial({ map: ringTex, color: toxic.clone(), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const ringGeo = new THREE.PlaneGeometry(1.15, 1.15);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.renderOrder = 5;
    this.group.add(this.floating, this.ring);
    this.group.name = 'soul-wisp';
    this.group.visible = false;
    for (const o of [g1, g2, haloTex, haloMat, moteMat, ringTex, ringMat, ringGeo, this.flameMat, this.coreMat]) this.owned.push(o);
    this.group.traverse((o) => {
      o.frustumCulled = false;
      o.raycast = () => undefined;
    });
  }

  /**
   * @param head head-top of the selected zombie (null = no selection)
   * @param feet feet position (ground ring)
   */
  update(t: number, dt: number, head: THREE.Vector3 | null, feet: { x: number; y: number; z: number } | null, reduceMotion = false): void {
    if (!head) {
      this.group.visible = false;
      this.fade = 0;
      return;
    }
    this.fade += (1 - this.fade) * Math.min(1, (Number.isFinite(dt) ? dt : 0) * 6);
    this.group.visible = true;
    const bob = reduceMotion ? 0 : Math.sin(t * 2.3) * 0.045;
    this.floating.position.set(head.x, head.y + 0.3 + bob, head.z);
    this.floating.rotation.y = t * 0.9;
    const s = 0.9 + 0.1 * this.fade;
    this.floating.scale.setScalar(s * this.fade);
    this.flameMat.uniforms.uTime.value = t;
    this.coreMat.uniforms.uTime.value = t * 1.07 + 3.1;
    this.flameMat.uniforms.uFlicker.value = reduceMotion ? 0.2 : 1;
    this.coreMat.uniforms.uFlicker.value = reduceMotion ? 0.2 : 1;
    (this.halo.material as THREE.SpriteMaterial).opacity = (0.45 + 0.12 * Math.sin(t * 5.1)) * this.fade;
    for (let i = 0; i < this.motes.length; i++) {
      const a = t * (1.4 + i * 0.35) + (i * Math.PI * 2) / 3;
      const r = 0.16 + 0.03 * Math.sin(t * 2 + i);
      this.motes[i].position.set(Math.cos(a) * r, 0.06 + 0.1 * Math.sin(t * 1.7 + i * 2), Math.sin(a) * r);
    }
    if (feet) {
      this.ring.visible = true;
      this.ring.position.set(feet.x, feet.y + 0.02, feet.z);
      const pulse = 1 + 0.06 * Math.sin(t * 3);
      this.ring.scale.set(pulse, 1, pulse);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.42 * this.fade;
    } else this.ring.visible = false;
  }

  dispose(): void {
    for (const o of this.owned) o.dispose();
  }
}
