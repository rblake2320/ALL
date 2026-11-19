/** Read-only request F diagnostic. Runs the shipped rigs and a raw source-clip control. */
import * as THREE from 'three';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { rigFor, poseRig, sampleRig, internals, disposeRigs, factoryWarnings } from './rigs';
import { loadGlb, assetPath, extractMeshes } from './assets';

const out = 'docs/research/crawl-diagnostic';
mkdirSync(out, { recursive: true });
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
function measure(root: THREE.Object3D, mesh: ReturnType<typeof extractMeshes>) {
  root.updateMatrixWorld(true);
  const bones: Record<string, number> = {};
  const v = new THREE.Vector3();
  root.traverse(o => { if ((o as THREE.Bone).isBone) bones[o.name] = o.getWorldPosition(v).y; });
  let minY = Infinity, label = '', referencedMinY = Infinity;
  const parts: Record<string, number> = {};
  for (let i = 0; i < mesh.pos.length / 3; i++) {
    const y = mesh.pos[3 * i + 1], l = mesh.labels[mesh.vLabel[i]] ?? 'unlabelled';
    if (!Number.isFinite(y)) throw new Error('non-finite vertex');
    parts[l] = Math.min(parts[l] ?? Infinity, y);
    if (y < minY) { minY = y; label = l; }
  }
  if (!Number.isFinite(minY) || !Object.keys(bones).length) throw new Error('empty sample');
  for (const i of mesh.tri) referencedMinY = Math.min(referencedMinY, mesh.pos[i * 3 + 1]);
  if (!Number.isFinite(referencedMinY)) throw new Error('empty triangles');
  return { minY, referencedMinY, label, bones, parts };
}
const rows: any[] = [], summaries: any[] = [];
function finish(id: string, samples: any[], metadata: any) {
  const min = (fn: (r: any) => number) => samples.reduce((a, b) => fn(b) < fn(a) ? b : a);
  const worst = min(r => r.minY);
  const boneMin: Record<string, any> = {};
  for (const n of Object.keys(samples[0].bones)) {
    const r = min(r => r.bones[n]);
    boneMin[n] = { y: r.bones[n], t: r.t };
  }
  summaries.push({ id, ...metadata, count: samples.length, minY: worst.minY, minAt: worst.t,
    minLabel: worst.label, boneMin });
  rows.push(...samples.map(r => ({ id, ...r })));
}
// Samples cover every 1/120 s plus the end epsilon; t=2 is separately labelled as harness-clamped.
for (const body of ['classic', 'shield'] as const) for (const height of [0, 0.5, 1]) {
  for (const variant of ['crawl-intact', 'crawl-legless', 'walk-legless', 'walk-intact'] as const) {
    const legless = variant.endsWith('legless');
    const lr = await rigFor({ body, height, limbs: legless ? { legL: 'missing', legR: 'missing' } : {} }, variant);
    const anim = variant.startsWith('crawl') ? 'crawl' : 'walk';
    poseRig(lr, { anim }, { x: 0, y: 0, z: 0, facing: 0 }, 0);
    const active = [...internals(lr.rig).actions.values()].filter(a => a.isRunning() && a.getEffectiveWeight() > 0.99);
    if (active.length !== 1) throw new Error(`expected one settled clip: ${body} ${variant}`);
    const clip = active[0].getClip(), duration = clip.duration;
    const times = Array.from({ length: Math.ceil(duration * 120) }, (_, i) => i / 120).filter(t => t < duration - 1e-4);
    times.push(duration - 1e-4, 2);
    const samples = times.map(t => {
      poseRig(lr, { anim }, { x: 0, y: 0, z: 0, facing: 0 }, t);
      const s = sampleRig(lr);
      return { t, effectiveTime: active[0].time, clip: s.clip, rootY: lr.rig.root.position.y, ...measure(lr.rig.root, s.body) };
    });
    finish(`${body}@h${height}:${variant}`, samples, { body, height, variant, kind: lr.rig.kind, clip: clip.name, duration,
      tracksHash: createHash('sha256').update(JSON.stringify({ name: clip.name, duration: clip.duration,
        tracks: clip.tracks.map(track => THREE.KeyframeTrack.toJSON(track)) })).digest('hex') });
    console.log(`${body}@h${height}:${variant} ${clip.name} min=${summaries.at(-1).minY}`);
  }
}
const raw = await loadGlb('models/characters/zombie.glb');
const crawl = raw.animations.find(c => c.name === 'crawl');
if (!crawl) throw new Error('source crawl absent');
const mixer = new THREE.AnimationMixer(raw.scene), action = mixer.clipAction(crawl);
action.play();
const rawSamples = [];
for (let i = 0; i <= Math.ceil(crawl.duration * 120); i++) {
  const t = Math.min(i / 120, crawl.duration - 1e-4);
  mixer.setTime(t); raw.scene.updateMatrixWorld(true);
  rawSamples.push({ t, ...measure(raw.scene, extractMeshes(raw.scene)) });
}
finish('raw-zombie-glb:crawl', rawSamples, { duration: crawl.duration, clip: crawl.name });
// Counterfactual only: move this isolated rig, never mutate game code or assets.
const worstShield = rows.filter(r => r.id === 'shield@h1:crawl-legless').reduce((a, b) => b.minY < a.minY ? b : a);
const liftedRig = await rigFor({ body: 'shield', height: 1, limbs: { legL: 'missing', legR: 'missing' } }, 'lift-control');
poseRig(liftedRig, { anim: 'crawl' }, { x: 0, y: -worstShield.minY, z: 0, facing: 0 }, worstShield.t);
const lifted = sampleRig(liftedRig);
const liftControl = { t: worstShield.t, liftY: -worstShield.minY, ...measure(liftedRig.rig.root, lifted.body) };
if (Math.abs(liftControl.minY) > 1e-8) throw new Error('root translation control failed');
const manifest = JSON.parse(readFileSync(assetPath('manifest.cast.json'), 'utf8'));
const files = ['models/characters/zombie.glb', 'manifest.cast.json'];
const shield = JSON.stringify(manifest).match(/models\/characters\/[^" ]*shield[^" ]*\.glb/);
if (shield) files.push(shield[0]);
const report = { pin: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sampleRate: 120, timesNote: 'Whole cycle at 120 Hz, end epsilon, plus requested t=2 clamped by existing poseRig; not a continuous analytic bound.',
  assets: Object.fromEntries(files.map(f => [f, sha(assetPath(f))])), warnings: factoryWarnings(), liftControl, summaries };
writeFileSync(`${out}/samples.jsonl`, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
disposeRigs();
