/**
 * CLIP-AUDIT screenshots (optional, for human review of findings): the exact soups the detector measured are
 * written to dev/out/clip-audit/shots/<name>.json and rendered by headless Chromium (SwiftShader WebGL) with three.js
 * from node_modules - three views per shot (3/4 front, side, top) with the deepest penetration point marked.
 * No game code runs in the browser: what you see is the measured geometry.
 */
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { ROOT } from './assets';
import type { TriMesh } from './geometry';

export const OUT = resolve(ROOT, 'dev/out/clip-audit');
const SHOTS = resolve(OUT, 'shots');

export interface ShotPart {
  mesh: TriMesh;
  color: string;
  opacity?: number;
}

export interface Shot {
  name: string;
  title: string;
  parts: ShotPart[];
  markers: { at: [number, number, number]; color: string; label: string }[];
}

function f32(a: Float64Array): number[] {
  return Array.from(a, (v) => Math.round(v * 10000) / 10000);
}

export function writeShot(s: Shot): string {
  mkdirSync(SHOTS, { recursive: true });
  const data = {
    title: s.title,
    parts: s.parts.map((p) => ({ pos: f32(p.mesh.pos), idx: Array.from(p.mesh.tri), color: p.color, opacity: p.opacity ?? 1 })),
    markers: s.markers,
  };
  const file = resolve(SHOTS, `${s.name}.json`);
  writeFileSync(file, JSON.stringify(data));
  return file;
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#1d1b22;color:#ddd;font:14px sans-serif}#t{position:absolute;left:8px;top:6px;z-index:2;text-shadow:0 1px 2px #000}
</style></head><body><div id="t"></div><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script>
<script type="module">
import * as THREE from 'three';
const name = new URLSearchParams(location.search).get('shot');
const data = await (await fetch('/dev/out/clip-audit/shots/' + name + '.json')).json();
document.getElementById('t').textContent = data.title;
const W = 1500, H = 560;
const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
r.setSize(W, H); r.setScissorTest(true); document.body.appendChild(r.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(3, 6, 4); scene.add(sun);
const box = new THREE.Box3();
for (const p of data.parts) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
  g.setIndex(p.idx); g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.8, side: THREE.DoubleSide, transparent: p.opacity < 1, opacity: p.opacity, flatShading: true });
  const mesh = new THREE.Mesh(g, m); scene.add(mesh); g.computeBoundingBox(); box.union(g.boundingBox);
}
for (const k of data.markers) {
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), new THREE.MeshBasicMaterial({ color: k.color, depthTest: false }));
  s.position.set(...k.at); s.renderOrder = 10; scene.add(s);
}
const floor = new THREE.GridHelper(6, 24, 0x555566, 0x333344); floor.position.set((box.min.x+box.max.x)/2, 0, (box.min.z+box.max.z)/2); scene.add(floor);
const c = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3()).length();
const views = [[1, 0.55, 1.2], [1.6, 0.25, 0], [0.01, 1.8, 0.2]];
views.forEach((v, i) => {
  const cam = new THREE.PerspectiveCamera(32, (W / 3) / H, 0.01, 50);
  const d = new THREE.Vector3(...v).normalize().multiplyScalar(size * 1.35);
  cam.position.copy(c).add(d); cam.lookAt(c);
  r.setViewport(i * W / 3, 0, W / 3, H); r.setScissor(i * W / 3, 0, W / 3, H); r.render(scene, cam);
});
window.__done = true;
</script></body></html>`;

/** The slice of Playwright's API used here (playwright is a tool dependency, not a project dependency). */
interface PwPage {
  goto(url: string): Promise<unknown>;
  waitForFunction(fn: () => boolean, arg: null, opts: { timeout: number }): Promise<unknown>;
  screenshot(opts: { path: string }): Promise<unknown>;
}
interface PwChromium {
  launch(opts: { args: string[] }): Promise<{ newPage(o: { viewport: { width: number; height: number } }): Promise<PwPage>; close(): Promise<void> }>;
}

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

function serve(): Promise<{ server: Server; port: number }> {
  writeFileSync(resolve(OUT, 'shot.html'), PAGE);
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const p = resolve(ROOT, '.' + decodeURIComponent(u.pathname));
    if (!p.startsWith(ROOT) || !existsSync(p)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(readFileSync(p));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: (server.address() as { port: number }).port })));
}

/** Render the given shots (already written) to dev/out/clip-audit/shots/<name>.png. */
export async function renderShots(names: string[]): Promise<string[]> {
  if (!names.length) return [];
  const req = createRequire(import.meta.url);
  const { chromium } = req('playwright') as { chromium: PwChromium };
  const { server, port } = await serve();
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const out: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 560 } });
    for (const n of names) {
      await page.goto(`http://127.0.0.1:${port}/dev/out/clip-audit/shot.html?shot=${encodeURIComponent(n)}`);
      await page.waitForFunction(() => (window as unknown as { __done?: boolean }).__done === true, null, { timeout: 60000 });
      const file = resolve(SHOTS, `${n}.png`);
      await page.screenshot({ path: file });
      out.push(file);
    }
  } finally {
    await browser.close();
    server.close();
  }
  return out;
}
