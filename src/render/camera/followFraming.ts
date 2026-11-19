/**
 * HUD-aware follow framing (W-025 S5 fix, Sol P2 on S11: at 844×390 the recentred zombie sat behind the agent panel).
 *
 * The followed / recentred actor is framed on an UNOBSCURED screen point: its body envelope (a 0.6-tile footprint,
 * 1.6 m tall) is placed at the free spot nearest the viewport centre that covers no HUD panel (`pickFramePoint` from
 * src/shared/framing.ts, the W-116 story-framing search, fed with `hudPanelRects()`). On flat ground a pinhole camera
 * sees a target and an actor that move together identically, so for a given camera pose the needed shift is a
 * constant WORLD offset (focus − actor): it is solved once (`solveFocus` on the camera's goal pose) and re-solved
 * only when the pose, the viewport or the HUD rects change. Continuous follow then aims at actor + offset every
 * frame, so the framing survives walking, region crossings and resizes (a one-shot frameAt would be overwritten).
 */
import * as THREE from 'three';
import { pickFramePoint, rectOverlap, solveFocus, type FrameRect, type FrameSize } from '../../shared/framing';
import type { CameraRig } from './cameraRig';

/** The actor's body envelope: half the 0.6-tile footprint and the 1.6 m body height (Sol's audit box). */
export const ACTOR_ENVELOPE = { halfWidth: 0.3, height: 1.6 } as const;
/** Extra clearance (CSS px) around the projected body box. */
export const ACTOR_BOX_PAD = 4;

export interface FollowOffset {
  /** World offset to add to the actor's position to get the camera focus. */
  x: number;
  z: number;
  /** HUD area (px²) the body box still covers at the chosen spot (0 = clear). */
  overlap: number;
}

const V = new THREE.Vector3();

function project(cam: THREE.PerspectiveCamera, vw: number, vh: number, x: number, y: number, z: number): { x: number; y: number } | null {
  V.set(x, y, z).project(cam);
  if (!Number.isFinite(V.x) || !Number.isFinite(V.y) || V.z > 1) return null;
  return { x: ((V.x + 1) / 2) * vw, y: ((1 - V.y) / 2) * vh };
}

/** Screen box (CSS px) of the body envelope of an actor standing at (ax, az), with the rig's CURRENT pose. */
export function actorScreenBox(rig: CameraRig, viewport: FrameSize, ax: number, az: number): FrameRect | null {
  const cam = rig.camera;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const h = ACTOR_ENVELOPE.halfWidth;
  for (const dx of [-h, h])
    for (const dz of [-h, h])
      for (const y of [0, ACTOR_ENVELOPE.height]) {
        const p = project(cam, viewport.w, viewport.h, ax + dx, y, az + dz);
        if (!p) return null;
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Focus offset that puts the actor's body envelope on the free spot nearest the screen centre (null when the
 * projection is unusable; then the caller centres the actor as before). Uses the rig's GOAL pose; the camera is put
 * back exactly where it was.
 */
export function followFrameOffset(rig: CameraRig, viewport: FrameSize, avoid: readonly FrameRect[]): FollowOffset | null {
  const vw = viewport.w;
  const vh = viewport.h;
  if (!(vw > 0 && vh > 0)) return null;
  // measure at a canonical actor position (the offset does not depend on where the actor stands)
  const box = rig.probe(0, 0, () => actorScreenBox(rig, viewport, 0, 0));
  const anchor = rig.probe(0, 0, () => project(rig.camera, vw, vh, 0, ACTOR_ENVELOPE.height / 2, 0));
  if (!box || !anchor) return null;
  const bw = box.w + 2 * ACTOR_BOX_PAD;
  const bh = box.h + 2 * ACTOR_BOX_PAD;
  const rects = avoid.filter((r) => r && r.w > 0 && r.h > 0);
  const centre = { x: vw / 2, y: vh / 2 };
  // the box centre sits where the actor's box centre would be when the actor is centred (anchor + box offset)
  const boxCx = box.x + box.w / 2 - anchor.x;
  const boxCy = box.y + box.h / 2 - anchor.y;
  const spot = pickFramePoint(viewport, rects, { w: bw, h: bh }, { x: centre.x + boxCx, y: centre.y + boxCy }, 4, 4);
  if (spot.overlap === 0 && Math.abs(spot.x - (centre.x + boxCx)) < 0.5 && Math.abs(spot.y - (centre.y + boxCy)) < 0.5) return { x: 0, z: 0, overlap: 0 };
  const desired = { x: spot.x - boxCx, y: spot.y - boxCy };
  const r = solveFocus((fx, fz) => rig.probe(fx, fz, () => project(rig.camera, vw, vh, 0, ACTOR_ENVELOPE.height / 2, 0)), { x: 0, z: 0 }, desired, 6, 0.5, 0.5);
  if (!r) return null;
  return { x: r.x, z: r.z, overlap: spot.overlap };
}

/** Overlap (px²) of the actor's body box (current pose) with HUD rects — tests / diagnostics. */
export function actorHudOverlap(rig: CameraRig, viewport: FrameSize, ax: number, az: number, avoid: readonly FrameRect[]): number {
  const b = actorScreenBox(rig, viewport, ax, az);
  if (!b) return Infinity;
  return avoid.reduce((s, r) => s + rectOverlap(b, r), 0);
}
