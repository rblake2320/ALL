import { rigFor, poseRig, sampleRig, disposeRigs } from './rigs';
import { writeShot, renderShots } from './shots';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
const out = 'docs/research/crawl-diagnostic';
const names: string[] = [];
for (const body of ['classic', 'shield'] as const) {
  const lr = await rigFor({ body, height: 1, limbs: { legL: 'missing', legR: 'missing' } });
  for (const t of [0.8666666666666667, 2]) {
    poseRig(lr, { anim: 'crawl' }, { x: 0, y: 0, z: 0, facing: 0 }, t);
    const s = sampleRig(lr), name = `astra-${body}-crawl-${t === 2 ? 'end' : 'worst'}`;
    const mesh = s.body;
    let vi = 0;
    for (let i = 1; i < mesh.pos.length / 3; i++) if (mesh.pos[i * 3 + 1] < mesh.pos[vi * 3 + 1]) vi = i;
    const handTriangles: number[] = [], otherTriangles: number[] = [];
    for (let i = 0; i < mesh.tri.length; i += 3) {
      const tri = Array.from(mesh.tri.slice(i, i + 3));
      (tri.some(v => mesh.labels[mesh.vLabel[v]] === 'hand_L') ? handTriangles : otherTriangles).push(...tri);
    }
    const json = writeShot({ name, title: `${body}@h1 legless crawl requested t=${t}; red=hand_L-weighted geometry`,
      parts: [{ mesh: { ...mesh, tri: Uint32Array.from(otherTriangles) }, color: '#9fc27a' },
        { mesh: { ...mesh, tri: Uint32Array.from(handTriangles) }, color: '#e55b64' }],
      markers: [{ at: Array.from(mesh.pos.slice(vi * 3, vi * 3 + 3)) as [number, number, number], color: '#ffff00', label: 'lowest vertex' }] });
    copyFileSync(json, `${out}/${name}.json`);
    names.push(name);
  }
}
for (const png of await renderShots(names)) copyFileSync(png, `${out}/${png.split(/[\\/]/).at(-1)}`);
writeFileSync(`${out}/shots-status.json`, JSON.stringify({ screenshots: names, renderer: 'existing clip-audit SwiftShader renderer; measured triangle soups, not game screenshots' }, null, 2));
disposeRigs();
