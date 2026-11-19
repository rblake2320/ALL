/**
 * Animation clip preparation: strips tracks that never change (bone scale, rest translations, root), and builds
 * left/right mirrored variants. Mirroring is exact for this rig because right-side bones are authored as mirror
 * images of the left (verified by tests): quaternion (x, y, z, w) -> (x, -y, -z, w), translation x -> -x.
 */
import * as THREE from 'three';
import { mirrorBoneName } from './names';

/** Bones whose translation is animated (everything else keeps its rest offset). */
const TRANSLATED_BONES = new Set(['pelvis']);

function splitTrackName(name: string): { node: string; prop: string } {
  const i = name.lastIndexOf('.');
  return i < 0 ? { node: name, prop: '' } : { node: name.slice(0, i), prop: name.slice(i + 1) };
}

/** Drop redundant tracks; returns a new clip (the input is not modified). */
export function stripClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const t of clip.tracks) {
    const { node, prop } = splitTrackName(t.name);
    if (prop === 'scale') continue;
    if (node === 'root') continue;
    if (prop === 'position' && !TRANSLATED_BONES.has(node)) continue;
    if (prop === 'morphTargetInfluences') continue;
    tracks.push(t.clone());
  }
  const out = new THREE.AnimationClip(clip.name, clip.duration, tracks);
  out.optimize();
  return out;
}

/** Left/right mirror image of a clip (for missing-limb variants). */
export function mirrorClip(clip: THREE.AnimationClip, name = `${clip.name}__mirror`): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const t of clip.tracks) {
    const { node, prop } = splitTrackName(t.name);
    const target = `${mirrorBoneName(node)}.${prop}`;
    const values = Float32Array.from(t.values as ArrayLike<number>);
    if (prop === 'quaternion') {
      for (let i = 0; i < values.length; i += 4) {
        values[i + 1] = -values[i + 1];
        values[i + 2] = -values[i + 2];
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(target, Array.from(t.times), Array.from(values)));
    } else if (prop === 'position') {
      for (let i = 0; i < values.length; i += 3) values[i] = -values[i];
      tracks.push(new THREE.VectorKeyframeTrack(target, Array.from(t.times), Array.from(values)));
    } else {
      const c = t.clone();
      c.name = target;
      tracks.push(c);
    }
  }
  return new THREE.AnimationClip(name, clip.duration, tracks);
}

/** Map clip name -> clip, stripping every clip once. */
export function prepareClips(clips: readonly THREE.AnimationClip[]): Map<string, THREE.AnimationClip> {
  const out = new Map<string, THREE.AnimationClip>();
  for (const c of clips) {
    try {
      out.set(c.name, stripClip(c));
    } catch {
      /* a malformed clip is skipped; the rig falls back to idle */
    }
  }
  return out;
}
