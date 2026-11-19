/**
 * Sky dome: gradient (horizon → zenith, fog colour below the horizon so terrain fades seamlessly), hashed
 * twinkling stars, a cratered moon disc with halo, and a soft sun glow. Follows the camera. (Image-based
 * lighting comes from a dim RoomEnvironment PMREM — see lighting.ts.)
 */
import * as THREE from 'three';

const vertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const fragment = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunGlow;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform float uMoon;
uniform float uMoonSize;
uniform float uStars;
uniform float uTime;
uniform float uHorizonOffset;
varying vec3 vDir;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
                mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
  return n;
}

void main() {
  vec3 d = normalize(vDir);
  float e = d.y - uHorizonOffset;
  vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.6, e));
  // faint banded clouds near the horizon
  float cl = noise3(d * vec3(3.0, 12.0, 3.0) + vec3(uTime * 0.004, 0.0, 0.0));
  col = mix(col, mix(uHorizon, uZenith, 0.35), smoothstep(0.55, 0.85, cl) * 0.25 * (1.0 - smoothstep(0.05, 0.4, e)));
  // sun glow
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 48.0) * 0.55 + pow(sd, 5.0) * 0.12) * uSunGlow;
  // stars
  if (uStars > 0.001) {
    vec3 sp = d * 180.0;
    vec3 cell = floor(sp);
    float h = hash13(cell);
    if (h > 0.972) {
      vec3 jitter = vec3(hash13(cell + 1.7), hash13(cell + 5.3), hash13(cell + 9.1)) - 0.5;
      float dist = length(fract(sp) - 0.5 - jitter * 0.6);
      float tw = 0.65 + 0.35 * sin(uTime * (1.5 + h * 3.0) + h * 80.0);
      float s = smoothstep(0.16, 0.0, dist) * tw * smoothstep(0.02, 0.25, e);
      col += vec3(0.86, 0.88, 1.0) * s * uStars * (0.5 + h);
    }
  }
  // moon disc + halo
  if (uMoon > 0.001) {
    float md = dot(d, uMoonDir);
    float rad = 0.042 * uMoonSize;
    float cosR = cos(rad);
    float disc = smoothstep(cosR - 0.0004, cosR + 0.0004, md);
    // craters: noise on the disc in a moon-local frame
    vec3 up = abs(uMoonDir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 mx = normalize(cross(up, uMoonDir));
    vec3 my = cross(uMoonDir, mx);
    vec2 uv = vec2(dot(d, mx), dot(d, my)) / max(rad, 1e-4);
    float cr = noise3(vec3(uv * 3.2, 1.0)) * 0.6 + noise3(vec3(uv * 7.0, 4.0)) * 0.4;
    vec3 moonCol = uMoonColor * (1.05 - smoothstep(0.45, 0.8, cr) * 0.28 - length(uv) * 0.12);
    float halo = pow(max(md, 0.0), 260.0 / max(uMoonSize, 0.5)) * 0.55 + pow(max(md, 0.0), 24.0) * 0.08;
    col += uMoonColor * halo * uMoon;
    col = mix(col, moonCol * 1.6, disc * uMoon);
  }
  // below the horizon: fog colour (terrain fades into it)
  col = mix(uGround, col, smoothstep(-0.06, 0.03, e));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.SphereGeometry;

  constructor(radius = 400) {
    this.geometry = new THREE.SphereGeometry(radius, 48, 24);
    this.material = new THREE.ShaderMaterial({
      name: 'sky-dome',
      vertexShader: vertex,
      fragmentShader: fragment,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color('#8e9fae') },
        uHorizon: { value: new THREE.Color('#c3c7bb') },
        uGround: { value: new THREE.Color('#9aa39a') },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color('#fff0dc') },
        uSunGlow: { value: 1 },
        uMoonDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() },
        uMoonColor: { value: new THREE.Color('#e8eef8') },
        uMoon: { value: 0 },
        uMoonSize: { value: 1 },
        uStars: { value: 0 },
        uTime: { value: 0 },
        uHorizonOffset: { value: -0.08 },
      },
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  /** Keep the dome centred on the camera. */
  follow(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
