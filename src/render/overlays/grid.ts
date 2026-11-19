/**
 * Build/buy grid: an anti-aliased shader grid over the lot (fwidth lines), brighter inside the buildable area,
 * with a soft spotlight around the cursor and a crisp outline of the buildable rectangle.
 */
import * as THREE from 'three';

const vertex = /* glsl */ `
varying vec2 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const fragment = /* glsl */ `
uniform vec4 uBuild;
uniform vec2 uLot;
uniform vec3 uColor;
uniform vec3 uEdgeColor;
uniform float uOpacity;
uniform vec2 uFocus;
uniform float uFocusRadius;
varying vec2 vW;
float gridLine(vec2 p, float width) {
  vec2 g = abs(fract(p - 0.5) - 0.5) / max(fwidth(p), vec2(1e-4));
  return 1.0 - min(min(g.x, g.y) / width, 1.0);
}
void main() {
  if (vW.x < 0.0 || vW.y < 0.0 || vW.x > uLot.x || vW.y > uLot.y) discard;
  float line = gridLine(vW, 1.0);
  float inside = step(uBuild.x, vW.x) * step(vW.x, uBuild.z) * step(uBuild.y, vW.y) * step(vW.y, uBuild.w);
  float d = distance(vW, uFocus);
  float spot = 1.0 - smoothstep(uFocusRadius * 0.35, uFocusRadius, d);
  float a = line * uOpacity * mix(0.25, 1.0, inside) * mix(0.45, 1.0, spot);
  // buildable outline
  vec2 db = min(abs(vW - uBuild.xy), abs(vW - uBuild.zw));
  vec2 fw = max(fwidth(vW), vec2(1e-4));
  float onX = (vW.y >= uBuild.y && vW.y <= uBuild.w) ? 1.0 - min(db.x / (fw.x * 1.6), 1.0) : 0.0;
  float onZ = (vW.x >= uBuild.x && vW.x <= uBuild.z) ? 1.0 - min(db.y / (fw.y * 1.6), 1.0) : 0.0;
  float edge = max(onX, onZ);
  vec3 col = mix(uColor, uEdgeColor, edge);
  a = max(a, edge * uOpacity * 1.6);
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, min(a, 1.0));
  #include <colorspace_fragment>
}
`;

export class GridOverlay {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.PlaneGeometry;
  private target = 0;
  private level = 0;

  constructor() {
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.geometry.rotateX(-Math.PI / 2);
    this.geometry.translate(0.5, 0, 0.5);
    this.material = new THREE.ShaderMaterial({
      name: 'build-grid',
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: {
        uBuild: { value: new THREE.Vector4(1, 1, 29, 27) },
        uLot: { value: new THREE.Vector2(30, 30) },
        uColor: { value: new THREE.Color('#e8e0c8') },
        uEdgeColor: { value: new THREE.Color('#9fe870') },
        uOpacity: { value: 0 },
        uFocus: { value: new THREE.Vector2(15, 15) },
        uFocusRadius: { value: 9 },
      },
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'grid';
    this.mesh.position.y = 0.012;
    this.mesh.renderOrder = 4;
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => undefined;
    this.mesh.visible = false;
  }

  setLot(width: number, depth: number, b: { x0: number; z0: number; x1: number; z1: number } | null | undefined): void {
    const w = Number.isFinite(width) && width > 0 ? width : 30;
    const d = Number.isFinite(depth) && depth > 0 ? depth : 30;
    this.mesh.scale.set(w, 1, d);
    (this.material.uniforms.uLot.value as THREE.Vector2).set(w, d);
    const bb = b && [b.x0, b.z0, b.x1, b.z1].every((v) => Number.isFinite(v)) ? b : { x0: 1, z0: 1, x1: w - 1, z1: d - 3 };
    (this.material.uniforms.uBuild.value as THREE.Vector4).set(bb.x0, bb.z0, bb.x1, bb.z1);
  }

  /** 0 (hidden) .. 1 (fully shown): the faded-in level, for effects that must yield to build mode. */
  get activeLevel(): number {
    return this.level;
  }

  setActive(on: boolean): void {
    this.target = on ? 1 : 0;
  }

  setFocus(x: number, z: number): void {
    if (Number.isFinite(x) && Number.isFinite(z)) (this.material.uniforms.uFocus.value as THREE.Vector2).set(x, z);
  }

  update(dt: number, cameraDistance: number): void {
    const k = Math.min(1, (Number.isFinite(dt) ? dt : 0) * 8);
    this.level += (this.target - this.level) * k;
    if (Math.abs(this.target - this.level) < 0.005) this.level = this.target;
    this.mesh.visible = this.level > 0.01;
    this.material.uniforms.uOpacity.value = 0.36 * this.level;
    this.material.uniforms.uFocusRadius.value = Math.max(6, (Number.isFinite(cameraDistance) ? cameraDistance : 30) * 0.45);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
