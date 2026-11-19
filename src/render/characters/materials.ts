/**
 * Per-rig material patching: decay blotches on Skin (procedural 3D noise in bind-pose space, biased by the
 * baked `_rot` vertex mask) and a fresnel rim tint on every material for hover/selection highlights.
 * Programs are shared across rigs (stable customProgramCacheKey); uniforms are per rig.
 */
import * as THREE from 'three';

export interface RigUniforms {
  uRimColor: { value: THREE.Color };
  uRimStrength: { value: number };
  uDecay: { value: number };
  uBlotch: { value: THREE.Color };
}

export function createRigUniforms(): RigUniforms {
  return {
    uRimColor: { value: new THREE.Color('#e8e0c8') },
    uRimStrength: { value: 0 },
    uDecay: { value: 0 },
    uBlotch: { value: new THREE.Color('#4b4a2f') },
  };
}

const NOISE = /* glsl */ `
float zHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float zNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(zHash(i + vec3(0, 0, 0)), zHash(i + vec3(1, 0, 0)), f.x),
                 mix(zHash(i + vec3(0, 1, 0)), zHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(zHash(i + vec3(0, 0, 1)), zHash(i + vec3(1, 0, 1)), f.x),
                 mix(zHash(i + vec3(0, 1, 1)), zHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

const SKIN_KEY = 'zombie-skin-v1';
const STD_KEY = 'zombie-std-v1';

/** Patch a (cloned, per-rig) material in place. `skin` enables the decay blotch overlay. */
export function patchMaterial(mat: THREE.Material, u: RigUniforms, skin: boolean): void {
  const m = mat as THREE.MeshStandardMaterial;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = u.uRimColor;
    shader.uniforms.uRimStrength = u.uRimStrength;
    if (skin) {
      shader.uniforms.uDecay = u.uDecay;
      shader.uniforms.uBlotch = u.uBlotch;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float _rot;\nvarying float vZRot;\nvarying vec3 vZRest;',
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvZRot = _rot;\nvZRest = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\nuniform float uDecay;\nuniform vec3 uBlotch;\nvarying float vZRot;\nvarying vec3 vZRest;\n${NOISE}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
  {
    // big soft blotches + fine breakup; coverage grows with decay (max ~55% of the skin)
    float n = zNoise(vZRest * 9.0) * 0.6 + zNoise(vZRest * 23.0 + 7.1) * 0.25 + vZRot * 0.3;
    float thr = 1.0 - 0.55 * uDecay;
    float m = smoothstep(thr - 0.07, thr + 0.05, n) * smoothstep(0.1, 0.3, uDecay);
    diffuseColor.rgb = mix(diffuseColor.rgb, uBlotch, m * 0.85);
  }`,
        );
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  if (uRimStrength > 0.001) {
    float rimF = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
    totalEmissiveRadiance += uRimColor * (pow(rimF, 2.2) * uRimStrength);
  }`,
      );
  };
  m.customProgramCacheKey = () => (skin ? SKIN_KEY : STD_KEY);
  m.needsUpdate = true;
}

/** Dispose a list of materials (textures are never used by the character assets). */
export function disposeMaterials(list: Iterable<THREE.Material>): void {
  for (const m of list) {
    try {
      m.dispose();
    } catch {
      /* already disposed */
    }
  }
}
