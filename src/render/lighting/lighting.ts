/**
 * Day/night lighting rig keyed to sim time: one shadow-casting key light (sun by day, moon by night) with its
 * shadow camera fitted to the lot, a hemisphere fill, linear fog that follows the camera distance, the sky dome
 * (+ throttled PMREM environment bake) and a fixed pool of PointLights handed to the lit lamps nearest the
 * camera target.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createLightingSample, sampleLighting, lampsOn as keyLampsOn, type LightingSample } from './keyframes';
import { SkyDome } from './sky';
import { selectLamps, type LampCandidate } from './lampPool';
import type { QualitySettings } from '../core/quality';
import type { ThrottledWarn } from '../core/diagnostics';

/** Global intensity calibration (three.js physical light units → the diorama look). */
const KEY_SCALE = 1.35;
const HEMI_SCALE = 1.25;
/** Dim neutral environment for metals (binding decision #14b): ≈0.35 by day → 0.12 at night. */
const ENV_DAY = 0.35;
const ENV_NIGHT = 0.12;
const LAMP_SCALE = 1.1;

/** Environment-map intensity for a night factor (0 day .. 1 night): 0.35 → 0.12 (decision #14b). Pure. */
export function environmentIntensity(night: number): number {
  const n = Number.isFinite(night) ? Math.min(1, Math.max(0, night)) : 0;
  return ENV_DAY + (ENV_NIGHT - ENV_DAY) * n;
}
export const MAX_LAMP_LIGHTS = 8;
const FULL_MOON_DISC = new THREE.Color().setRGB(0.72, 1.0, 0.74, THREE.SRGBColorSpace);

export interface LampSource extends LampCandidate {
  color: THREE.Color;
  intensity: number;
  distance: number;
  /** Candles flicker. */
  flicker: boolean;
  /** Stable phase for flicker. */
  seed: number;
}

export class Lighting {
  readonly key = new THREE.DirectionalLight(0xffffff, 2);
  readonly hemi = new THREE.HemisphereLight(0xc2c8c6, 0x605d4b, 1);
  readonly fog = new THREE.Fog(0x9aa39a, 30, 120);
  readonly sky = new SkyDome();
  readonly sample: LightingSample = createLightingSample();
  readonly lamps: THREE.PointLight[] = [];
  private readonly group = new THREE.Group();
  private lotCenter = new THREE.Vector3(15, 0, 15);
  private lotRadius = 24;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envEnabled = false;
  private envFailed = false;
  private readonly tmpColor = new THREE.Color();
  private readonly dir = new THREE.Vector3();
  /** Unit direction from the lot toward the key light (sun / moon) for the current frame. */
  get keyDirection(): THREE.Vector3 {
    return this.dir;
  }
  private readonly selected = new Int32Array(MAX_LAMP_LIGHTS);
  private readonly scratch = new Float64Array(MAX_LAMP_LIGHTS);
  private lampCount = MAX_LAMP_LIGHTS;
  /** 0..1 smoothed lamps-on factor (≥ 0.5 = lamps on). */
  lampsOn = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly warn: ThrottledWarn,
  ) {
    this.group.name = 'lighting';
    this.key.name = 'key-light';
    this.key.castShadow = true;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.025;
    this.key.shadow.radius = 2.5;
    this.group.add(this.key, this.key.target, this.hemi);
    for (let i = 0; i < MAX_LAMP_LIGHTS; i++) {
      const p = new THREE.PointLight(0xffc27a, 0, 6, 2);
      p.name = `lamp-${i}`;
      p.castShadow = false;
      this.lamps.push(p);
      this.group.add(p);
    }
    scene.add(this.group);
    scene.add(this.sky.mesh);
    scene.fog = this.fog;
    this.fitToLot(30, 30);
  }

  /** Shadow / pool configuration for a quality preset. Changing the lamp count recompiles shaders once. */
  configure(q: QualitySettings): void {
    this.key.castShadow = q.shadows;
    if (q.shadows && this.key.shadow.mapSize.x !== q.shadowMapSize) {
      this.key.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      if (this.key.shadow.map) {
        this.key.shadow.map.dispose();
        this.key.shadow.map = null;
      }
    }
    const n = Math.max(0, Math.min(MAX_LAMP_LIGHTS, q.lampLights));
    if (n !== this.lampCount) {
      this.lampCount = n;
      for (let i = 0; i < MAX_LAMP_LIGHTS; i++) {
        const inScene = this.lamps[i].parent === this.group;
        if (i < n && !inScene) this.group.add(this.lamps[i]);
        if (i >= n && inScene) this.group.remove(this.lamps[i]);
      }
    }
    this.envEnabled = q.environment;
    if (!q.environment) this.clearEnvironment();
  }

  /**
   * W-025 S5: centre the key-light shadow box on another lot-sized region of the walkable world (the region the camera
   * looks at), keeping the fitted radius. Garbage is ignored.
   */
  setShadowCenter(x: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.lotCenter.set(x, 0, z);
  }

  shadowCenter(): { x: number; z: number } {
    return { x: this.lotCenter.x, z: this.lotCenter.z };
  }

  fitToLot(width: number, depth: number): void {
    const w = Number.isFinite(width) && width > 0 ? width : 30;
    const d = Number.isFinite(depth) && depth > 0 ? depth : 30;
    this.lotCenter.set(w / 2, 0, d / 2);
    this.lotRadius = Math.hypot(w, d) / 2 + 3;
    const cam = this.key.shadow.camera;
    cam.left = -this.lotRadius;
    cam.right = this.lotRadius;
    cam.top = this.lotRadius;
    cam.bottom = -this.lotRadius;
    cam.near = 1;
    cam.far = 80 + this.lotRadius * 2;
    cam.updateProjectionMatrix();
  }

  /**
   * Per frame. `minuteOfDay` may be fractional; `fullMoon` 0..1. `cameraYaw` places the decorative moon disc
   * where the camera can see it; `cameraDistance` drives the fog range.
   */
  update(minuteOfDay: number, fullMoon: number, camera: THREE.PerspectiveCamera, cameraYaw: number, cameraDistance: number, timeSec: number): LightingSample {
    const s = sampleLighting(minuteOfDay, fullMoon, this.sample);
    // key light
    const cosE = Math.cos(s.keyElevation);
    this.dir.set(Math.sin(s.keyAzimuth) * cosE, Math.sin(s.keyElevation), Math.cos(s.keyAzimuth) * cosE).normalize();
    const dist = 60;
    this.key.position.copy(this.lotCenter).addScaledVector(this.dir, dist);
    this.key.target.position.copy(this.lotCenter);
    this.key.target.updateMatrixWorld();
    this.key.color.setRGB(s.keyColor[0], s.keyColor[1], s.keyColor[2], THREE.SRGBColorSpace);
    this.key.intensity = s.keyIntensity * KEY_SCALE;
    const cam = this.key.shadow.camera;
    cam.near = Math.max(0.5, dist - this.lotRadius - 10);
    cam.far = dist + this.lotRadius + 10;
    cam.updateProjectionMatrix();
    // fill
    this.hemi.color.setRGB(s.hemiSky[0], s.hemiSky[1], s.hemiSky[2], THREE.SRGBColorSpace);
    this.hemi.groundColor.setRGB(s.hemiGround[0], s.hemiGround[1], s.hemiGround[2], THREE.SRGBColorSpace);
    this.hemi.intensity = s.hemiIntensity * HEMI_SCALE * (this.envEnabled && this.envRT ? 0.85 : 1);
    if (this.envRT) this.scene.environmentIntensity = environmentIntensity(s.night);
    // fog follows the camera so the lot stays crisp at every zoom and the world edge never shows
    this.fog.color.setRGB(s.fogColor[0], s.fogColor[1], s.fogColor[2], THREE.SRGBColorSpace);
    const dens = Math.max(0.5, s.fogDensity);
    const d = Number.isFinite(cameraDistance) ? cameraDistance : 30;
    this.fog.near = (d * 0.75 + 8) / dens;
    this.fog.far = (d + 62) / dens;
    // sky
    const u = this.sky.material.uniforms;
    (u.uZenith.value as THREE.Color).setRGB(s.skyZenith[0], s.skyZenith[1], s.skyZenith[2], THREE.SRGBColorSpace);
    (u.uHorizon.value as THREE.Color).setRGB(s.skyHorizon[0], s.skyHorizon[1], s.skyHorizon[2], THREE.SRGBColorSpace);
    (u.uGround.value as THREE.Color).copy(this.fog.color);
    (u.uSunDir.value as THREE.Vector3).copy(this.dir);
    (u.uSunColor.value as THREE.Color).copy(this.key.color);
    u.uSunGlow.value = 1 - s.night;
    const yaw = Number.isFinite(cameraYaw) ? cameraYaw : 0;
    const mAz = yaw + Math.PI + 0.45;
    const mEl = 0.16;
    (u.uMoonDir.value as THREE.Vector3).set(Math.sin(mAz) * Math.cos(mEl), Math.sin(mEl), Math.cos(mAz) * Math.cos(mEl)).normalize();
    this.tmpColor.setRGB(0.88, 0.93, 1.0, THREE.SRGBColorSpace);
    if (s.moonTint > 0) this.tmpColor.lerp(FULL_MOON_DISC, s.moonTint * 0.7);
    (u.uMoonColor.value as THREE.Color).copy(this.tmpColor);
    u.uMoon.value = s.moon;
    u.uMoonSize.value = s.moonSize;
    u.uStars.value = s.stars;
    u.uTime.value = timeSec;
    this.sky.follow(camera);
    this.lampsOn = keyLampsOn(s);
    return s;
  }

  /**
   * Build the PMREM'd RoomEnvironment once (a neutral studio interior: chrome/brass read as metal instead of black).
   * Intensity follows the time of day in update(). Cheap no-op once built.
   */
  updateEnvironment(renderer: THREE.WebGLRenderer): void {
    if (!this.envEnabled || this.envRT || this.envFailed) return;
    try {
      if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      this.envRT = this.pmrem.fromScene(room, 0.04);
      room.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry?.dispose();
          (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x?.dispose());
        }
      });
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = environmentIntensity(this.sample.night);
    } catch (e) {
      this.envFailed = true;
      this.warn.warn('pmrem', 'environment map generation failed', e);
    }
  }

  private clearEnvironment(): void {
    if (this.envRT) this.envRT.dispose();
    this.envRT = null;
    this.scene.environment = null;
  }

  /**
   * Re-bake the environment after a context restore: its texels died with the old context. The old target and
   * generator are dropped, not disposed (their GL names belong to the lost context).
   */
  invalidateEnvironment(): void {
    this.envRT = null;
    this.pmrem = null;
    this.scene.environment = null;
    this.envFailed = false;
  }

  /**
   * Assign the pool to the lit lamps nearest the camera target. Unassigned pool lights go dark (they stay in
   * the scene so the light count — and therefore every shader — is stable).
   */
  assignLamps(sources: readonly LampSource[], count: number, targetX: number, targetZ: number, timeSec: number): number {
    const n = selectLamps(sources, count, targetX, targetZ, this.lampCount, this.selected, this.scratch);
    for (let i = 0; i < this.lampCount; i++) {
      const light = this.lamps[i];
      // NOTE: never toggle `visible` — invisible lights change the shader light count (recompiles)
      if (i >= n) {
        light.intensity = 0;
        continue;
      }
      const src = sources[this.selected[i]];
      light.position.set(src.x, src.y, src.z);
      light.color.copy(src.color);
      light.distance = src.distance * 1.25;
      let k = 1;
      if (src.flicker) k = 0.86 + 0.08 * Math.sin(timeSec * 9.1 + src.seed) + 0.06 * Math.sin(timeSec * 23.7 + src.seed * 2.3);
      light.intensity = src.intensity * LAMP_SCALE * k;
    }
    return n;
  }

  dispose(): void {
    this.clearEnvironment();
    this.pmrem?.dispose();
    this.pmrem = null;
    this.key.shadow.map?.dispose();
    this.scene.remove(this.group);
    this.scene.remove(this.sky.mesh);
    this.sky.dispose();
    for (const l of this.lamps) l.dispose();
    this.key.dispose();
    this.hemi.dispose();
  }
}
